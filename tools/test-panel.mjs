/*
 * LazyKick — panel controller tests.
 *
 *   node tools/test-panel.mjs
 *
 * Runs the real client/main.js in a Node vm against a small fake DOM, a fake
 * CSInterface that answers like host.jsx, fake timers, and a fake PowerShell
 * for the clipboard. Files are real: every run gets its own temp folder for
 * the panel's storage, the "projects" and a watched media folder.
 *
 * What it guards: notes survive tab deletion and project switches, notes made
 * before the first save follow the project, watch bins import each file once
 * (skipping failures, waiting for files still being copied, never racing), and
 * LazyPaste reuses identical images, never overwrites, and honours the folder
 * setting. Also a guard that main.js stays within CEP 9's Chromium 61 / Node 8.
 */
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_SRC = readFileSync(join(root, "client", "main.js"), "utf8");
const nodeRequire = createRequire(import.meta.url);

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) passed++;
  else failures.push(`${name}${detail !== undefined ? `  [${detail}]` : ""}`);
}
function eq(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const realTimeout = (ms) => new Promise((r) => setTimeout(r, ms));
async function settle(rounds = 8) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setImmediate(r));
    await realTimeout(4);
  }
}
async function waitFor(fn, label, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return true;
    await realTimeout(10);
  }
  failures.push(`timed out waiting for: ${label}`);
  return false;
}

/* ------------------------------------------------------------ static guard */
{
  // CEP 9 = Chromium 61 + Node 8.6. These arrived later.
  const banned = [
    [/\?\.[a-zA-Z_(\[]/, "optional chaining"],
    [/\?\?/, "nullish coalescing"],
    [/catch\s*\{/, "optional catch binding"],
    [/\.finally\(/, "Promise.prototype.finally"],
    [/fs\.promises/, "fs.promises"],
    [/recursive:\s*true/, "recursive mkdir"],
    [/\.flat(Map)?\(/, "Array.prototype.flat"],
    [/Object\.fromEntries/, "Object.fromEntries"],
    [/navigator\.clipboard\.writeText\(text\)\.then/, "navigator.clipboard without fallback"],
    [/\bconst\b|\blet\b|=>/, "ES2015 syntax (kept ES5 style)"],
  ];
  // Block comments are blanked (line numbers kept), so prose about these
  // features does not count; line comments and strings are blanked per line.
  const source = MAIN_SRC.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
  const codeLines = source.split("\n").map((line) =>
    line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\/\/.*$/, ""));
  codeLines.forEach((code, n) => {
    for (const [re, what] of banned) {
      if (re.test(code)) failures.push(`main.js:${n + 1} uses ${what}: ${MAIN_SRC.split("\n")[n].trim()}`);
    }
  });
  const withFileTypes = codeLines.join("\n").match(/withFileTypes/g) || [];
  eq("withFileTypes only in listSubfolders (with Node 8 fallback)", withFileTypes.length, 1);
  passed++;
}

/* ---------------------------------------------------------------- fake DOM */
class FakeClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  contains(c) { return this.set.has(c); }
  toggle(c, force) { const on = force === undefined ? !this.set.has(c) : force; on ? this.set.add(c) : this.set.delete(c); return on; }
}

class FakeElement {
  constructor(tag, doc) {
    this.doc = doc;
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.classList = new FakeClassList();
    this._text = "";
    this._html = "";
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.title = "";
    this._qs = {};
  }
  get className() { return [...this.classList.set].join(" "); }
  set className(v) { this.classList = new FakeClassList(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c)); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); this._html = ""; }
  get innerHTML() { return this._html; }
  set innerHTML(v) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._text = "";
    this._html = String(v);
    if (this._html) this.doc.htmlAssignments.push({ id: this.attributes.id, html: this._html });
  }
  get innerText() { return this.textContent || this._html; }
  get isContentEditable() { return this.attributes.contenteditable === "true"; }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.children.push(c); return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1); c.parentNode = null; return c; }
  replaceChild(n, o) { const i = this.children.indexOf(o); if (n.parentNode) n.parentNode.removeChild(n); this.children[i] = n; n.parentNode = this; o.parentNode = null; return o; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener() {}
  dispatch(type, props = {}) {
    const event = { type, target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...props };
    (this.listeners[type] || []).slice().forEach((fn) => fn(event));
    return event;
  }
  click() { return this.dispatch("click"); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  hasAttribute(k) { return k in this.attributes; }
  removeAttribute(k) { delete this.attributes[k]; }
  matches(sel) {
    if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
    if (sel.startsWith("[")) return sel.slice(1, -1) in this.attributes;
    return this.tagName === sel.toUpperCase();
  }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel) { return this.all().filter((c) => c.matches(sel)); }
  querySelector(sel) { return this.all().find((c) => c.matches(sel)) || (this._qs[sel] ||= new FakeElement("span", this.doc)); }
  closest(sel) { let n = this; while (n) { if (n.matches && n.matches(sel)) return n; n = n.parentNode; } return null; }
  contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  focus() { this.doc.activeElement = this; }
  blur() { this.dispatch("blur"); }
  select() {}
  cloneNode() { const c = new FakeElement(this.tagName, this.doc); c._html = this._html; c._text = this._text; c.attributes = { ...this.attributes }; return c; }
}

function makeDocument() {
  const doc = {
    htmlAssignments: [],
    execCommands: [],
    listeners: {},
    activeElement: null,
    byId: new Map(),
  };
  doc.body = new FakeElement("body", doc);
  doc.getElementById = (id) => {
    if (!doc.byId.has(id)) {
      const tag = /Input$|^opt|^filter|Toggle$|Check$/.test(id) ? "input" : (/^btn|Btn$/.test(id) ? "button" : "div");
      const e = new FakeElement(tag, doc);
      e.attributes.id = id;
      doc.byId.set(id, e);
    }
    return doc.byId.get(id);
  };
  doc.querySelectorAll = () => [];
  doc.createElement = (tag) => new FakeElement(tag, doc);
  doc.createTextNode = (text) => { const t = new FakeElement("#text", doc); t._text = String(text); return t; };
  doc.createRange = () => ({ selectNodeContents() {}, collapse() {} });
  doc.execCommand = (cmd, ui, value) => {
    doc.execCommands.push({ cmd, value });
    if ((cmd === "insertHTML" || cmd === "insertText") && doc.activeElement) doc.activeElement._html += value;
    return true;
  };
  doc.addEventListener = (type, fn) => { (doc.listeners[type] ||= []).push(fn); };
  doc.dispatch = (type, props) => {
    const event = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, target: doc.body, ...props };
    (doc.listeners[type] || []).forEach((fn) => fn(event));
    return event;
  };
  return doc;
}

/* --------------------------------------------------------------- the world */
const work = mkdtempSync(join(tmpdir(), "lazykick-test-"));
const appData = join(work, "AppData");
const storage = join(appData, "AdobeProjectNotepad");
mkdirSync(appData, { recursive: true });

const projA = join(work, "Projects", "Promo");
const projB = join(work, "Projects", "Other");
const projC = join(work, "Projects", "It's New");
[projA, projB, projC].forEach((p) => mkdirSync(p, { recursive: true }));
const fileA = join(projA, "Promo.aep");
const fileB = join(projB, "Other.aep");
const fileC = join(projC, "Fresh.aep");
writeFileSync(fileA, "aep");
writeFileSync(fileB, "aep");
const hourAgo = new Date(Date.now() - 3600 * 1000);
utimesSync(fileA, hourAgo, hourAgo);
utimesSync(fileB, hourAgo, hourAgo);

/* A host that answers like host.jsx. */
const host = {
  info: null,
  folder: "NO_PROJECT",
  calls: [],
  pastes: [],
  binImports: [],
  projectFiles: new Set(),   // lower-cased paths the "project" already holds
  imported: [],              // what the host really imported, in order
  failNames: new Set(),
  refuseProject: false,
  timecode: { ok: true, timecode: "00:00:05:00" },
};
function setProject(kind, file) {
  if (kind === "none") {
    host.info = { ok: false, msg: "No project open", host: "ae" };
    host.folder = "NO_PROJECT";
  } else if (kind === "unsaved") {
    host.info = { ok: true, host: "ae", saved: false, path: "", name: "Untitled Project", fullId: "ae|unsaved|untitled" };
    host.folder = "NO_PROJECT";
  } else {
    host.info = { ok: true, host: "ae", saved: true, path: file, name: file.split(/[\\/]/).pop(), fullId: `ae|saved|${file}` };
    host.folder = dirname(file);
  }
}
function answer(script) {
  host.calls.push(script);
  const m = /^(\w+)\((.*)\)$/s.exec(script);
  const args = m[2] ? JSON.parse(`[${m[2]}]`) : [];
  switch (m[1]) {
    case "getProjectInfo": return JSON.stringify(host.info);
    case "getProjectFolder": return host.folder;
    case "getCurrentTimecode": return JSON.stringify(host.timecode);
    case "importPastedImage":
      host.pastes.push({ path: args[0], guide: args[1], fit: args[2], bin: args[3] });
      return JSON.stringify({ ok: true, msg: "Layer added", placedOnTimeline: true });
    case "importFilesToBin": {
      if (host.refuseProject || args[2] !== host.info.fullId) return JSON.stringify({ ok: false, projectChanged: true, msg: "changed" });
      const files = JSON.parse(args[1]);
      host.binImports.push({ bin: args[0], files });
      const existing = files.filter((f) => host.projectFiles.has(f.toLowerCase()));
      const failed = files.filter((f) => !existing.includes(f) && host.failNames.has(f.split("/").pop()));
      const imported = files.filter((f) => !existing.includes(f) && !failed.includes(f));
      imported.forEach((f) => { host.projectFiles.add(f.toLowerCase()); host.imported.push({ bin: args[0], file: f }); });
      return JSON.stringify({
        ok: true, imported: imported.length, failed: failed.length, existing: existing.length,
        importedFiles: imported, failedFiles: failed, existingFiles: existing,
      });
    }
    default: return "EvalScript error.";
  }
}

/* Fake timers for the panel only. */
const timers = new Map();
let fakeNow = 0;
let timerId = 1;
const fakeTimers = {
  setTimeout: (fn, ms) => { const id = timerId++; timers.set(id, { fn, at: fakeNow + (ms || 0), every: 0 }); return id; },
  setInterval: (fn, ms) => { const id = timerId++; timers.set(id, { fn, at: fakeNow + ms, every: ms }); return id; },
  clearTimeout: (id) => timers.delete(id),
  clearInterval: (id) => timers.delete(id),
};
async function advance(ms) {
  const end = fakeNow + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
    if (!next) break;
    fakeNow = next.t.at;
    if (next.t.every) next.t.at += next.t.every; else timers.delete(next.id);
    next.t.fn();
    await settle(2);
  }
  fakeNow = end;
  await settle();
}

/* Fake PowerShell clipboard. */
const clipboard = { mode: "none", bytes: null, file: null, lastScript: "", lastArgs: [] };
const spawned = [];
const fakeChildProcess = {
  execFile(cmd, args, opts, cb) {
    clipboard.lastArgs = [cmd, ...args];
    const encoded = args[args.indexOf("-EncodedCommand") + 1];
    const script = Buffer.from(encoded, "base64").toString("utf16le");
    clipboard.lastScript = script;
    const target = /\$target = '((?:[^']|'')*)'/.exec(script)[1].replace(/''/g, "'");
    setImmediate(() => {
      if (clipboard.mode === "image") { writeFileSync(target, clipboard.bytes); cb(null, "OK\r\n", ""); }
      else if (clipboard.mode === "file") cb(null, `FILE:${clipboard.file}\r\n`, "");
      else cb(null, "NO_IMAGE\r\n", "");
    });
  },
  spawn(cmd, args, opts) {
    spawned.push({ cmd, args, opts });
    return { on() {}, unref() {} };
  },
};

const doc = makeDocument();
doc.getElementById("noteEditor").setAttribute("contenteditable", "true");
doc.getElementById("binModalOverlay").classList.add("hidden");
doc.getElementById("fbOverlay").classList.add("hidden");
doc.getElementById("optTargetFolder").value = "Pasted Images";

const alerts = [];
let confirmAnswer = true;
class FakeCSInterface {
  evalScript(script, cb) {
    const res = answer(script);
    const deliver = () => setImmediate(() => cb && cb(res));
    // host.gate holds watch-bin imports, like a slow import in the real app.
    if (host.gate && script.startsWith("importFilesToBin")) host.gate.then(deliver);
    else deliver();
  }
  registerKeyEventsInterest(json) { host.keys = json; }
  openURLInDefaultBrowser(url) { host.openedUrl = url; }
}

const context = vm.createContext({
  document: doc,
  window: { getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {} }), addEventListener() {}, open() {} },
  navigator: {},
  CSInterface: FakeCSInterface,
  require: (name) => (name === "child_process" ? fakeChildProcess : nodeRequire(name)),
  process: { platform: "win32", env: { APPDATA: appData } },
  Buffer,
  console: { log() {}, error: console.error },
  alert: (m) => alerts.push(m),
  confirm: () => confirmAnswer,
  ...fakeTimers,
});

const $ = (id) => doc.getElementById(id);
const notesFile = (id) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) { h = ((h << 5) - h) + id.charCodeAt(i); h = h & h; }
  return join(storage, `proj_${Math.abs(h)}.json`);
};
const binsFile = (id) => notesFile(id).replace(/proj_(\d+)\.json$/, "bins_proj_$1.json");
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const type = async (html) => { $("noteEditor").innerHTML = html; $("noteEditor").dispatch("input"); };

/* ------------------------------------------------------------------- tests */
try {
  setProject("saved", fileA);
  vm.runInContext(MAIN_SRC, context, { filename: "main.js" });
  await settle();

  // ---- startup
  eq("startup: project name shown", $("projectName").textContent, "Promo.aep");
  eq("startup: host badge", $("hostBadge").textContent, "AE");
  const panelVersion = /var PANEL_VERSION = "([\d.]+)"/.exec(MAIN_SRC)[1];
  eq("startup: version in footer", $("brandTag").textContent, `LazyKick v${panelVersion.replace(/\.0$/, "")}`);
  check("startup: Ctrl+V handed to the panel", /"keyCode":86/.test(host.keys || ""), host.keys);

  // ---- notes: deleting a tab never overwrites another tab
  await type("<p>first</p>");
  await advance(300);
  eq("notes: saved after typing", readJson(notesFile(host.info.fullId)).tabs[0].content, "<p>first</p>");

  $("btnAddNoteTab").click();
  await settle();
  eq("notes: second tab active", readJson(notesFile(host.info.fullId)).activeTabId, "1");
  await type("<p>second</p>");           // save still pending when deleting
  confirmAnswer = true;
  $("btnDeleteNoteTab").click();
  await advance(1000);
  let saved = readJson(notesFile(host.info.fullId));
  eq("notes delete: one tab left", saved.tabs.length, 1);
  eq("notes delete: first tab untouched", saved.tabs[0].content, "<p>first</p>");
  eq("notes delete: editor shows first tab", $("noteEditor").innerHTML, "<p>first</p>");

  // ---- notes: rename in place (no window.prompt)
  const tabButton = $("notesTabBar").children[1];
  tabButton.dispatch("dblclick");
  const renameInput = $("notesTabBar").children[1];
  eq("rename: input replaces the tab", renameInput.tagName, "INPUT");
  renameInput.value = "Client notes";
  renameInput.dispatch("keydown", { key: "Enter" });
  await settle();
  eq("rename: saved", readJson(notesFile(host.info.fullId)).tabs[0].name, "Client notes");
  eq("rename: tab bar rebuilt", $("notesTabBar").children[1].textContent, "Client notes");

  // ---- notes: last keystrokes stay with the project they were typed in
  await type("<p>A latest</p>");         // no time for the debounce
  setProject("saved", fileB);
  await advance(2500);
  eq("switch: project B shown", $("projectName").textContent, "Other.aep");
  eq("switch: A kept its last words", readJson(notesFile(`ae|saved|${fileA}`)).tabs[0].content, "<p>A latest</p>");
  eq("switch: B starts empty", $("noteEditor").innerHTML, "");

  // ---- notes made before the first save follow the project
  setProject("unsaved");
  await advance(2500);
  await type("<p>draft idea</p>");
  await advance(300);
  check("unsaved: notes written", existsSync(notesFile("ae|unsaved|untitled")));
  writeFileSync(fileC, "aep");            // "just saved"
  setProject("saved", fileC);
  await advance(2500);
  eq("first save: notes moved", $("noteEditor").innerHTML, "<p>draft idea</p>");
  check("first save: untitled bucket emptied", !existsSync(notesFile("ae|unsaved|untitled")));
  check("first save: status says so", /moved/.test($("globalStatus").textContent), $("globalStatus").textContent);

  setProject("unsaved");
  await advance(2500);
  await type("<p>scratch</p>");
  await advance(300);
  setProject("saved", fileB);             // opened, not just saved
  await advance(2500);
  eq("open other project: nothing inherited", $("noteEditor").innerHTML, "");
  check("open other project: untitled notes kept", existsSync(notesFile("ae|unsaved|untitled")));

  // ---- timecode: a failed read inserts nothing
  host.timecode = { ok: false, msg: "No active composition found" };
  const execBefore = doc.execCommands.length;
  $("btnInsertTimecode").click();
  await settle();
  eq("timecode fail: nothing inserted", doc.execCommands.length, execBefore);
  eq("timecode fail: status explains", $("globalStatus").textContent, "No active composition found");
  host.timecode = { ok: true, timecode: "00:01:24:12" };
  $("btnInsertTimecode").click();
  await settle();
  check("timecode: inserted", /\[00:01:24:12\]/.test($("noteEditor").innerHTML), $("noteEditor").innerHTML);

  // ---- watch bins
  setProject("saved", fileA);
  await advance(2500);
  const media = join(work, "Media", "SFX");
  mkdirSync(join(media, "sub"), { recursive: true });
  writeFileSync(join(media, "a.mp4"), "aaaa");
  writeFileSync(join(media, "b.wav"), "bbbb");
  writeFileSync(join(media, "._a.mp4"), "resource fork");
  writeFileSync(join(media, "notes.txt"), "not media");
  writeFileSync(join(media, "photo.cr2"), "raw");
  writeFileSync(join(media, "empty.mov"), "");
  writeFileSync(join(media, "sub", "c.png"), "cccc");
  host.failNames = new Set(["b.wav"]);

  $("btnAddBin").click();
  check("bins: modal opened", !$("binModalOverlay").classList.contains("hidden"));
  $("modalFolderInput").value = media;
  $("modalBinNameInput").value = "SFX/<Hits>";
  $("filterVideo").checked = true;
  $("filterAudio").checked = true;
  $("filterImage").checked = true;
  $("modalRecursiveCheck").checked = true;
  $("btnModalSaveBin").click();
  await waitFor(() => host.binImports.length === 1, "first bin import");
  await settle();

  const toFwd = (p) => p.replace(/\\/g, "/");
  eq("bins: sanitized bin name", host.binImports[0].bin, "SFX/_Hits_");
  eq("bins: only real media, sorted, recursive",
    host.binImports[0].files.map((f) => f.split("/").pop()).join(","), "a.mp4,b.wav,c.png");
  const aId = `ae|saved|${fileA}`;
  let bin = readJson(binsFile(aId)).bins[0];
  check("bins: imported remembered", bin.history[toFwd(join(media, "a.mp4"))] && bin.history[toFwd(join(media, "sub", "c.png"))]);
  check("bins: failure not remembered as imported", !bin.history[toFwd(join(media, "b.wav"))]);
  check("bins: failure remembered as skipped", !!bin.skipped[toFwd(join(media, "b.wav"))]);
  eq("bins: count", bin.importedCount, 2);
  const card = $("binCardsList").children[0];
  check("bins: card shows skipped", card && /1 skipped/.test(card.textContent), card && card.textContent);
  eq("bins: no HTML built from names", doc.htmlAssignments.filter((a) => a.id !== "noteEditor").length, 0);

  $("autoSyncToggle").checked = true;
  $("autoSyncToggle").dispatch("change");
  await advance(6000);
  await settle();
  eq("auto: unchanged failure not retried", host.binImports.length, 1);

  writeFileSync(join(media, "d.mp4"), "dddd");
  await advance(6000);
  eq("auto: new file waits one scan (could still be copying)", host.binImports.length, 1);
  await advance(6000);
  await waitFor(() => host.binImports.length === 2, "d.mp4 import");
  eq("auto: then imported alone", host.binImports[1] && host.binImports[1].files.map((f) => f.split("/").pop()).join(","), "d.mp4");

  writeFileSync(join(media, "grow.mov"), "12");
  await advance(6000);
  appendFileSync(join(media, "grow.mov"), "3456");  // still being written
  await advance(6000);
  eq("auto: growing file not imported", host.binImports.length, 2);
  await advance(6000);
  await waitFor(() => host.binImports.length === 3, "grow.mov import");
  eq("auto: imported once size held", host.binImports[2] && host.binImports[2].files.map((f) => f.split("/").pop()).join(","), "grow.mov");

  host.failNames = new Set();
  appendFileSync(join(media, "b.wav"), "fixed");     // the failed file changed
  await advance(12000);
  await waitFor(() => host.binImports.length === 4, "b.wav retry");
  bin = readJson(binsFile(aId)).bins[0];
  check("auto: changed failure retried and cleared", bin.history[toFwd(join(media, "b.wav"))] && !bin.skipped[toFwd(join(media, "b.wav"))]);

  $("autoSyncToggle").checked = false;
  $("autoSyncToggle").dispatch("change");
  writeFileSync(join(media, "e.mp4"), "eeee");
  $("btnSyncAll").click();
  $("btnSyncAll").click();
  $("btnSyncAll").click();
  await waitFor(() => host.binImports.length >= 5, "sync all");
  await settle(20);
  eq("race: three Sync All clicks import e.mp4 once", host.binImports.filter((b) => b.files.some((f) => f.endsWith("e.mp4"))).length, 1);

  host.refuseProject = true;
  writeFileSync(join(media, "f.mp4"), "ffff");
  $("btnSyncAll").click();
  await settle(20);
  bin = readJson(binsFile(aId)).bins[0];
  check("project changed: nothing marked imported", !bin.history[toFwd(join(media, "f.mp4"))]);
  host.refuseProject = false;

  alerts.length = 0;
  $("btnAddBin").click();
  $("modalFolderInput").value = media;
  $("modalBinNameInput").value = "SFX/<Hits>";
  $("btnModalSaveBin").click();
  check("bins: duplicate link refused", alerts.some((a) => /already linked/.test(a)), alerts.join(" | "));
  $("btnModalCancel").click();

  card.children[0].children[1].children[1].click();  // 📂
  const open = spawned[spawned.length - 1];
  check("open folder: no shell, path as argument", open && open.cmd === "explorer.exe" && open.args.length === 1 && !open.opts.shell, JSON.stringify(open));

  // ---- watch bins: media already in the project, Reset, Edit
  const actionsOf = (i) => $("binCardsList").children[i].children[0].children[1].children;
  const lib = join(work, "Media", "Library");
  mkdirSync(lib, { recursive: true });
  writeFileSync(join(lib, "x.mp4"), "xxxx");
  writeFileSync(join(lib, "y.mp4"), "yyyy");
  host.projectFiles.add(toFwd(join(lib, "x.mp4")).toLowerCase());   // imported by hand earlier
  const importedBefore = host.imported.length;
  const importedNames = () => host.imported.slice(importedBefore).map((i) => i.file.split("/").pop()).join(",");

  $("btnAddBin").click();
  eq("add: dialog title", $("binModalTitle").textContent, "Link Folder to Bin");
  eq("add: save label", $("btnModalSaveBin").textContent, "Save Watch Bin");
  $("modalFolderInput").value = lib;
  $("modalBinNameInput").value = "Library";
  let calls = host.binImports.length;
  $("btnModalSaveBin").click();
  await waitFor(() => host.binImports.length === calls + 1, "library link");
  await settle();
  eq("existing: only the new file imported", importedNames(), "y.mp4");
  let libBin = readJson(binsFile(aId)).bins[1];
  check("existing: both count as synced", libBin.history[toFwd(join(lib, "x.mp4"))] && libBin.history[toFwd(join(lib, "y.mp4"))]);
  eq("existing: count", libBin.importedCount, 2);
  check("existing: status says so", /1 already in the project/.test($("globalStatus").textContent), $("globalStatus").textContent);
  eq("card: sync, open, edit, reset, unlink", Array.from(actionsOf(1)).map((b) => b.textContent).join(" "), "⚡ Sync 📂 ✎ ↺ ✕");

  // Reset after y.mp4 was deleted from the project; x.mp4 is still there.
  host.projectFiles.delete(toFwd(join(lib, "y.mp4")).toLowerCase());
  confirmAnswer = false;
  calls = host.binImports.length;
  actionsOf(1)[3].click();
  await settle(20);
  eq("reset cancelled: nothing synced", host.binImports.length, calls);
  eq("reset cancelled: history kept", readJson(binsFile(aId)).bins[1].importedCount, 2);
  confirmAnswer = true;
  actionsOf(1)[3].click();
  await waitFor(() => host.binImports.length === calls + 1, "reset sync");
  await settle();
  eq("reset: both files looked at again", host.binImports[calls].files.map((f) => f.split("/").pop()).join(","), "x.mp4,y.mp4");
  eq("reset: only the removed file comes back", importedNames(), "y.mp4,y.mp4");
  eq("reset: history rebuilt", readJson(binsFile(aId)).bins[1].importedCount, 2);

  // Edit: open, save unchanged, then move the bin to another folder.
  const music = join(work, "Media", "Music");
  mkdirSync(join(music, "deep"), { recursive: true });
  writeFileSync(join(music, "song.wav"), "song");
  writeFileSync(join(music, "deep", "stem.wav"), "stem");
  actionsOf(1)[2].click();
  check("edit: dialog open", !$("binModalOverlay").classList.contains("hidden"));
  eq("edit: title", $("binModalTitle").textContent, "Edit Watch Bin");
  eq("edit: save label", $("btnModalSaveBin").textContent, "Save Changes");
  eq("edit: folder filled in", $("modalFolderInput").value, lib);
  eq("edit: bin name filled in", $("modalBinNameInput").value, "Library");
  eq("edit: recursive filled in", $("modalRecursiveCheck").checked, true);
  alerts.length = 0;
  calls = host.binImports.length;
  $("btnModalSaveBin").click();
  await settle(20);
  eq("edit unchanged: not a duplicate of itself", alerts.length, 0);
  eq("edit unchanged: still two bins", readJson(binsFile(aId)).bins.length, 2);
  eq("edit unchanged: nothing to import", host.binImports.length, calls);

  actionsOf(1)[2].click();
  $("modalFolderInput").value = music;
  $("modalBinNameInput").value = "Music/Beds";
  $("modalRecursiveCheck").checked = false;
  $("btnModalSaveBin").click();
  check("edit: dialog closed", $("binModalOverlay").classList.contains("hidden"));
  await waitFor(() => host.binImports.length === calls + 1, "edited bin sync");
  await settle();
  libBin = readJson(binsFile(aId)).bins[1];
  eq("edit: still two bins", readJson(binsFile(aId)).bins.length, 2);
  eq("edit: same bin, new folder", toFwd(libBin.folderPath), toFwd(music));
  eq("edit: new bin name", libBin.binPath, "Music/Beds");
  const lastImport = host.binImports[host.binImports.length - 1];
  eq("edit: new folder into the new bin, subfolders off", `${lastImport.bin}:${lastImport.files.map((f) => f.split("/").pop()).join(",")}`, "Music/Beds:song.wav");
  eq("edit: old folder's history dropped", Object.keys(libBin.history).map((p) => p.split("/").pop()).join(","), "song.wav");
  eq("edit: count follows", libBin.importedCount, 1);
  eq("edit: card shows the new bin", $("binCardsList").children[1].children[0].children[0].textContent, "📁 Music/Beds");

  actionsOf(1)[2].click();
  $("modalFolderInput").value = media;
  $("modalBinNameInput").value = "SFX/<Hits>";
  alerts.length = 0;
  $("btnModalSaveBin").click();
  check("edit: cannot turn into a copy of another bin", alerts.some((a) => /already linked/.test(a)), alerts.join(" | "));
  $("btnModalCancel").click();
  eq("edit cancelled: bin unchanged", readJson(binsFile(aId)).bins[1].binPath, "Music/Beds");
  $("btnAddBin").click();
  eq("add after edit: empty again", $("modalFolderInput").value + "|" + $("binModalTitle").textContent, "|Link Folder to Bin");
  $("modalFolderInput").value = music;
  $("btnBrowseFolder").click();
  check("browse: opens at the typed folder", $("fbPathInput").value === music, $("fbPathInput").value);
  $("fbSelectBtn").click();
  eq("browse: last folder remembered across restarts", readJson(join(storage, "lazykick_settings.json")).lastPickerPath, music);
  $("modalFolderInput").value = "";
  $("btnBrowseFolder").click();
  eq("browse: empty field opens at the last folder", $("fbPathInput").value, music);
  $("fbCancelBtn").click();
  $("btnModalCancel").click();

  // The project changes while the edit dialog is open: nothing is written anywhere.
  actionsOf(1)[2].click();
  $("modalBinNameInput").value = "Wrong/Project";
  setProject("saved", fileB);
  await advance(2500);
  $("btnModalSaveBin").click();
  await settle(20);
  check("edit across a project switch: refused", /project changed/.test($("globalStatus").textContent), $("globalStatus").textContent);
  eq("edit across a project switch: A untouched", readJson(binsFile(aId)).bins[1].binPath, "Music/Beds");
  check("edit across a project switch: B gets no bin", !existsSync(binsFile(`ae|saved|${fileB}`)));
  setProject("saved", fileA);
  await advance(2500);

  // A Sync clicked in project A, still queued when B opens, must not run in B.
  writeFileSync(join(media, "held.mp4"), "held");
  let release;
  host.gate = new Promise((r) => { release = r; });
  $("btnSyncAll").click();
  await waitFor(() => host.binImports.some((b) => b.files.some((f) => f.endsWith("held.mp4"))), "held sync");
  writeFileSync(join(media, "later.mp4"), "later");
  actionsOf(0)[0].click();                    // queued behind the held sync
  setProject("saved", fileB);
  await advance(2500);
  calls = host.binImports.length;
  host.gate = null;
  release();
  await settle(40);
  eq("queued sync after a project switch: not run in the new project", host.binImports.length, calls);
  check("queued sync after a project switch: B gets no bin", !existsSync(binsFile(`ae|saved|${fileB}`)));
  check("held sync still recorded in A", !!readJson(binsFile(aId)).bins[0].history[toFwd(join(media, "held.mp4"))]);
  setProject("saved", fileA);
  await advance(2500);

  // ---- LazyPaste
  const pasteDir = join(projA, "Pasted Images");
  const pngs = () => (existsSync(pasteDir) ? readdirSync(pasteDir).sort() : []);
  clipboard.mode = "image";
  clipboard.bytes = Buffer.from("PNG-ONE");
  $("lazyPasteBtn").click();
  await waitFor(() => host.pastes.length === 1, "first paste");
  await settle();
  eq("paste: one file, no temp left", pngs().length, 1);
  check("paste: timestamped name", /^pasted_\d{8}_\d{6}\.png$/.test(pngs()[0]), pngs()[0]);
  eq("paste: host got the file", toFwd(host.pastes[0].path), toFwd(join(pasteDir, pngs()[0])));
  eq("paste: default bin", host.pastes[0].bin, "Pasted Images");
  check("paste: STA + EncodedCommand", clipboard.lastArgs.includes("-STA") && clipboard.lastArgs.includes("-EncodedCommand"));
  check("paste: PNG format tried first (transparency)", clipboard.lastScript.indexOf("GetDataPresent('PNG')") < clipboard.lastScript.indexOf("GetImage()"));
  eq("paste: recent list saved", readJson(join(storage, "recent_pastes.json")).length, 1);

  $("lazyPasteBtn").click();
  await waitFor(() => host.pastes.length === 2, "same paste");
  await settle();
  eq("paste same picture: no new file", pngs().length, 1);
  eq("paste same picture: same file reused", host.pastes[1].path, host.pastes[0].path);

  clipboard.bytes = Buffer.from("PNG-TWO");
  $("lazyPasteBtn").click();
  await waitFor(() => host.pastes.length === 3, "second picture");
  clipboard.bytes = Buffer.from("PNG-THREE");
  $("lazyPasteBtn").click();
  await waitFor(() => host.pastes.length === 4, "third picture");
  await settle();
  eq("paste different pictures quickly: never overwritten", pngs().length, 3);
  eq("paste: distinct files", new Set(host.pastes.slice(2).map((p) => p.path)).size, 2);

  const outside = join(work, "Downloads", "photo.JPG");
  mkdirSync(dirname(outside), { recursive: true });
  writeFileSync(outside, "JPEG!");
  clipboard.mode = "file";
  clipboard.file = outside;
  $("lazyPasteBtn").click();
  await waitFor(() => host.pastes.length === 5, "copied file paste");
  await settle();
  check("paste copied file: copied into project with its extension", /\.jpg$/.test(host.pastes[4].path) && host.pastes[4].path.includes("Pasted Images"), host.pastes[4].path);
  check("paste copied file: original untouched", existsSync(outside));

  clipboard.mode = "none";
  $("lazyPasteBtn").click();
  await settle(20);
  eq("paste nothing: host not called", host.pastes.length, 5);
  check("paste nothing: says so", /No image/.test($("globalStatus").textContent), $("globalStatus").textContent);
  check("paste nothing: no temp files", !readdirSync(pasteDir).some((n) => n.startsWith(".lazykick_clipboard_")));

  $("optTargetFolder").value = "Refs/../Screens";
  $("optTargetFolder").dispatch("input");
  $("optTargetFolder").dispatch("change");
  eq("folder setting: sanitized", $("optTargetFolder").value, "Refs/Screens");
  clipboard.mode = "image";
  clipboard.bytes = Buffer.from("PNG-FOUR");
  doc.dispatch("keydown", { ctrlKey: true, keyCode: 86, key: "v", target: doc.body });
  await waitFor(() => host.pastes.length === 6, "Ctrl+V paste");
  await settle();
  eq("Ctrl+V: pastes", host.pastes.length, 6);
  eq("folder setting: bin", host.pastes[5] && host.pastes[5].bin, "Refs/Screens");
  check("folder setting: disk folder", existsSync(join(projA, "Refs", "Screens")) && host.pastes[5].path.includes("Refs/Screens"), host.pastes[5] && host.pastes[5].path);

  const typing = doc.dispatch("keydown", { ctrlKey: true, keyCode: 86, key: "v", target: $("noteEditor") });
  await settle(10);
  eq("Ctrl+V in notes: left to the editor", host.pastes.length, 6);
  eq("Ctrl+V in notes: default not prevented", typing.defaultPrevented, false);

  // Apostrophe in the project path survives PowerShell quoting.
  setProject("saved", fileC);
  await advance(2500);
  clipboard.bytes = Buffer.from("PNG-FIVE");
  $("optTargetFolder").value = "Pasted Images";
  $("optTargetFolder").dispatch("input");
  $("lazyPasteBtn").click();
  await waitFor(() => host.pastes.length === 7, "apostrophe paste");
  await settle();
  check("apostrophe path: quoted for PowerShell", clipboard.lastScript.includes("It''s New"));
  check("apostrophe path: file landed", host.pastes[6] && existsSync(host.pastes[6].path), host.pastes[6] && host.pastes[6].path);

  // Footer link goes to the default browser, not a CEF popup.
  $("devLink").setAttribute("href", "https://raisulsohan.com");
  const linkEvent = $("devLink").click();
  eq("footer link: default browser", host.openedUrl, "https://raisulsohan.com");
  eq("footer link: in-panel navigation prevented", linkEvent.defaultPrevented, true);
} catch (error) {
  failures.push(`threw: ${error && error.stack ? error.stack : error}`);
} finally {
  try { rmSync(work, { recursive: true, force: true }); } catch {}
}

console.log("LazyKick - panel tests\n");
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`${failures.length ? "" : "  "}${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
