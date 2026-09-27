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
import { MiniDOMParser } from "./mini-html.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_SRC = readFileSync(join(root, "client", "main.js"), "utf8");
const ALIGN_SRC = readFileSync(join(root, "client", "align.js"), "utf8");
const PASTE_SRC = readFileSync(join(root, "client", "paste.js"), "utf8");
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
    [/\b(alert|confirm|prompt)\(/, "a native alert/confirm/prompt (a white system window in CEP)"],
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
    this.offsetLeft = 0; this.offsetTop = 0; this.clientLeft = 0; this.clientTop = 0;
    this.clientWidth = 300; this.clientHeight = 400; this.scrollTop = 0;
  }
  scrollTo(opts) { this.scrollTop = opts.top; (this.doc.scrolls ||= []).push(opts.top); }
  getBoundingClientRect() {
    const editor = this.doc.byId.get("noteEditor");
    if (this === editor || this.attributes.id === "followLayer") return fakeRect(0, 0, 300, 400);
    if (editor && this.parentNode === editor) return fakeRect(0, editor.children.indexOf(this) * 20 - editor.scrollTop, 300, 20);
    return fakeRect(0, 0, 0, 0);
  }
  get className() { return [...this.classList.set].join(" "); }
  set className(v) { this.classList = new FakeClassList(); String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c)); }
  get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join("") : this._text; }
  set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = String(v); this._html = ""; }
  get nodeType() { return this.tagName === "#TEXT" ? 3 : 1; }
  get nodeValue() { return this.tagName === "#TEXT" ? this._text : null; }
  get nodeName() { return this.tagName; }
  get childNodes() { return this.children; }
  get firstChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.children;
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    const at = ref ? this.children.indexOf(ref) : -1;
    if (at < 0) this.children.push(n); else this.children.splice(at, 0, n);
    n.parentNode = this;
    return n;
  }
  /** Children built with DOM calls are written out as HTML; otherwise what was assigned. */
  get innerHTML() { return this.children.length ? this.children.map(serialize).join("") : this._html; }
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
    if (sel.includes(",")) return sel.split(",").some((one) => this.matches(one.trim()));
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

function fakeRect(left, top, width, height) { return { left, top, width, height, right: left + width, bottom: top + height }; }

/** Ranges measure words on the fake layout: the line's top, and 7 px per character before the start. */
class FakeRange {
  selectNodeContents() {} collapse() {}
  setStart(node, offset) { this.sn = node; this.so = offset; }
  setEnd(node, offset) { this.en = node; this.eo = offset; }
  getBoundingClientRect() {
    const editor = this.sn.doc.byId.get("noteEditor");
    let line = this.sn;
    while (line.parentNode && line.parentNode !== editor) line = line.parentNode;
    const texts = [];
    (function walk(n) { for (const c of n.children) { if (c.nodeType === 3) texts.push(c); else if (!c.classList.contains("timecode-tag")) walk(c); } })(line);
    const before = (node, off) => { let n = 0; for (const t of texts) { if (t === node) return n + off; n += t._text.length; } return n; };
    const a = before(this.sn, this.so);
    const b = before(this.en, this.eo);
    return fakeRect(a * 7, editor.children.indexOf(line) * 20 - editor.scrollTop, (b - a) * 7, 18);
  }
  getClientRects() { return [this.getBoundingClientRect()]; }
}

function serialize(node) {
  if (node.nodeType === 3) return node._text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/ /g, "&nbsp;");
  const tag = node.tagName.toLowerCase();
  const attrs = (node.className ? ` class="${node.className}"` : "") +
    Object.keys(node.attributes).filter((k) => k !== "id").map((k) => ` ${k}="${node.attributes[k]}"`).join("");
  if (tag === "br" || tag === "input") return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.children.length ? node.children.map(serialize).join("") : node._text}</${tag}>`;
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
  doc.createRange = () => new FakeRange();
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
  movedOnDisk: {},           // lower-cased new path -> old path the host relinks from
  movesToReport: 0,          // clips the host says it sorted, when asked to
  mergedToReport: 0,         // duplicate bins the host says it merged, when sorting
  rootPathToReport: null,    // where the host says the watch bin really is (null: where asked)
  timeline: { ok: false, msg: "Open a sequence first" },
  audioCalls: [],
  audioReply: () => ({ ok: false, msg: "Open a sequence first" }),
  subtitleCalls: [],
  playhead: null,            // seconds from the timeline start, or null for no timeline
  playheadCalls: 0,
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
    case "syncWatchBin": {
      if (host.refuseProject || args[2] !== host.info.fullId) return JSON.stringify({ ok: false, projectChanged: true, msg: "changed" });
      const payload = JSON.parse(args[1]);
      const subOf = {};
      payload.files.forEach((f) => { subOf[f.p] = f.s; });
      const files = payload.files.filter((f) => f.n).map((f) => f.p);
      host.binImports.push({ bin: args[0], files, payload });
      const existing = files.filter((f) => host.projectFiles.has(f.toLowerCase()));
      const relinkedFiles = files.filter((f) => !existing.includes(f) && host.movedOnDisk[f.toLowerCase()])
        .map((f) => ({ from: host.movedOnDisk[f.toLowerCase()], to: f }));
      const relinked = relinkedFiles.map((r) => r.to);
      const failed = files.filter((f) => !existing.includes(f) && !relinked.includes(f) && host.failNames.has(f.split("/").pop()));
      const imported = files.filter((f) => !existing.includes(f) && !relinked.includes(f) && !failed.includes(f));
      relinked.forEach((f) => host.projectFiles.add(f.toLowerCase()));
      imported.forEach((f) => {
        host.projectFiles.add(f.toLowerCase());
        host.imported.push({ bin: subOf[f] ? `${args[0]}/${subOf[f]}` : args[0], file: f });
      });
      return JSON.stringify({
        ok: true, imported: imported.length, failed: failed.length, existing: existing.length,
        relinked: relinked.length, moved: payload.arrange ? host.movesToReport : 0,
        merged: payload.arrange ? host.mergedToReport : 0, rootPath: host.rootPathToReport || args[0],
        importedFiles: imported, failedFiles: failed, existingFiles: existing, relinkedFiles,
      });
    }
    case "getTimelineInfo": return JSON.stringify(host.timeline);
    case "getPlayhead":
      host.playheadCalls++;
      return JSON.stringify(host.playhead === null ? { ok: false, msg: "No sequence" } : { ok: true, t: host.playhead, fps: 25, offset: 0, name: "Seq 01" });
    case "getTimelineAudio": {
      host.audioCalls.push(args[0]);
      const reply = host.audioReply(args[0]);
      return JSON.stringify(reply);
    }
    case "placeSubtitles": {
      const payload = JSON.parse(args[0]);
      host.subtitleCalls.push(payload);
      return JSON.stringify({ ok: true, msg: `Subtitles placed on a new caption track in '${host.timeline.name}'`, placed: true });
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
doc.getElementById("dialogOverlay").classList.add("hidden");
doc.getElementById("optTargetFolder").value = "Pasted Images";

const nativePopups = [];
class FakeCSInterface {
  evalScript(script, cb) {
    const res = answer(script);
    const deliver = () => setImmediate(() => cb && cb(res));
    // host.gate holds watch-bin imports, like a slow import in the real app.
    if (host.gate && script.startsWith("syncWatchBin")) host.gate.then(deliver);
    else if (host.audioGate && script.startsWith("getTimelineAudio")) host.audioGate.then(deliver);
    else deliver();
  }
  registerKeyEventsInterest(json) { host.keys = json; }
  openURLInDefaultBrowser(url) { host.openedUrl = url; }
}

const cepModule = { id: ".", exports: {}, loaded: false, children: [], paths: [] };
const context = vm.createContext({
  document: doc,
  window: { getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {} }), addEventListener() {}, open() {} },
  navigator: {},
  CSInterface: FakeCSInterface,
  DOMParser: MiniDOMParser,
  require: (name) => (name === "child_process" ? fakeChildProcess : nodeRequire(name)),
  // CEP's --enable-nodejs --mixed-context puts Node's module and exports on
  // the page too, so scripts that look for them must still set their globals.
  module: cepModule,
  exports: cepModule.exports,
  process: { platform: "win32", env: { APPDATA: appData } },
  Buffer,
  console: { log() {}, error: console.error },
  alert: (m) => { nativePopups.push(`alert: ${m}`); },
  confirm: (m) => { nativePopups.push(`confirm: ${m}`); return true; },
  ...fakeTimers,
});

const $ = (id) => doc.getElementById(id);
/** The in-panel dialog as it stands: { open, title, message, ok, okClass, cancelShown }. */
const dialog = () => ({
  open: !$("dialogOverlay").classList.contains("hidden"),
  title: $("dialogTitle").textContent,
  message: $("dialogMessage").textContent,
  ok: $("dialogOk").textContent,
  okClass: $("dialogOk").className,
  cancelShown: $("dialogCancel").style.display !== "none",
});
/** Waits for the dialog, then clicks OK (true) or Cancel (false). Returns what it showed. */
async function answerDialog(ok, label) {
  await waitFor(() => dialog().open, `dialog: ${label}`);
  const shown = dialog();
  $(ok ? "dialogOk" : "dialogCancel").click();
  await settle();
  return shown;
}
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
  vm.runInContext(ALIGN_SRC, context, { filename: "align.js" }); // <script src="align.js"> comes first
  vm.runInContext(PASTE_SRC, context, { filename: "paste.js" });
  vm.runInContext(MAIN_SRC, context, { filename: "main.js" });
  await settle();
  check("startup: align.js is a page global despite CEP's module", typeof context.LazyAlign?.alignLines === "function");
  check("startup: paste.js is a page global despite CEP's module", typeof context.LazyPaste?.toNoteHtml === "function");

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
  $("btnDeleteNoteTab").click();
  const askDelete = await answerDialog(true, "delete tab");
  eq("delete tab: asked in the panel, red Delete", `${askDelete.title}|${askDelete.ok}|${askDelete.okClass}`, "Delete note tab|Delete|btn-danger-sm");
  check("delete tab: names the tab", /"Note 2"/.test(askDelete.message), askDelete.message);
  eq("delete tab: dialog closed", dialog().open, false);
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
  eq("bins: only real media, subfolders first, recursive",
    host.binImports[0].files.map((f) => f.split("/").pop()).join(","), "c.png,a.mp4,b.wav");
  eq("bins: each file carries its subfolder; only real new ones marked new",
    host.binImports[0].payload.files.map((f) => `${f.s}:${f.p.split("/").pop()}${f.n ? "*" : ""}`).join(" "), "sub:c.png* :a.mp4* :b.wav* :empty.mov");
  eq("bins: first sync also sorts the bin", host.binImports[0].payload.arrange, true);
  eq("bins: host told the watch folder", host.binImports[0].payload.folder, media.replace(/\\/g, "/"));
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

  $("btnAddBin").click();
  $("modalFolderInput").value = media;
  $("modalBinNameInput").value = "SFX/<Hits>";
  $("btnModalSaveBin").click();
  const dupe = await answerDialog(true, "duplicate link");
  check("bins: duplicate link refused, in the panel with one OK", /already linked/.test(dupe.message) && !dupe.cancelShown, JSON.stringify(dupe));
  check("bins: the link dialog stays open under the message", !$("binModalOverlay").classList.contains("hidden"));
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
  calls = host.binImports.length;
  actionsOf(1)[3].click();
  const askReset = await answerDialog(false, "reset");
  eq("reset: asked in the panel", `${askReset.title}|${askReset.ok}|${askReset.okClass}`, "Reset watch bin|Reset|btn-primary-sm");
  await settle(20);
  eq("reset cancelled: nothing synced", host.binImports.length, calls);
  eq("reset cancelled: history kept", readJson(binsFile(aId)).bins[1].importedCount, 2);
  actionsOf(1)[3].click();
  await answerDialog(true, "reset ok");
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
  calls = host.binImports.length;
  $("btnModalSaveBin").click();
  await settle(20);
  eq("edit unchanged: not a duplicate of itself", dialog().open, false);
  eq("edit unchanged: still two bins", readJson(binsFile(aId)).bins.length, 2);
  eq("edit unchanged: nothing new to import", host.binImports.slice(calls).map((b) => b.files.length).join(","), "0");
  eq("edit unchanged: bin sorted to match the folder", host.binImports[calls] && host.binImports[calls].payload.arrange, true);

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
  $("btnModalSaveBin").click();
  const copyMsg = await answerDialog(true, "edit into a copy");
  check("edit: cannot turn into a copy of another bin", /already linked/.test(copyMsg.message), copyMsg.message);
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

  // ---- watch bins mirror their folders
  const shoot = join(work, "Media", "Shoot");
  ["Day 2", "Day 10", "Adobe Premiere Pro Video Previews", "Adobe After Effects Auto-Save"].forEach((d) => mkdirSync(join(shoot, d), { recursive: true }));
  writeFileSync(join(shoot, "Day 10", "y.mp4"), "yyyy");
  writeFileSync(join(shoot, "Day 2", "x.mp4"), "xxxx");
  writeFileSync(join(shoot, "a.mp4"), "aaaa");
  writeFileSync(join(shoot, "Adobe Premiere Pro Video Previews", "preview.mpeg"), "prev");
  writeFileSync(join(shoot, "Adobe After Effects Auto-Save", "cache.mov"), "cache");
  calls = host.binImports.length;
  $("btnAddBin").click();
  $("modalFolderInput").value = shoot;
  $("modalBinNameInput").value = "Shoot";
  $("modalRecursiveCheck").checked = true;
  $("btnModalSaveBin").click();
  await waitFor(() => host.binImports.length === calls + 1, "shoot link");
  await settle();
  eq("mirror: Explorer order, numbers by value, Adobe caches skipped",
    host.binImports[calls].payload.files.map((f) => `${f.s}:${f.p.split("/").pop()}`).join(" "), "Day 2:x.mp4 Day 10:y.mp4 :a.mp4");
  eq("mirror: each file into its folder's bin", host.imported.slice(-3).map((i) => i.bin).join("|"), "Shoot/Day 2|Shoot/Day 10|Shoot");
  eq("card: subfolder chip", $("binCardsList").children[2].children[2].children[0].children[3].textContent, "Subfolders");

  // A manual Sync with nothing new still sorts the bin.
  host.movesToReport = 4;
  calls = host.binImports.length;
  actionsOf(2)[0].click();
  await waitFor(() => host.binImports.length === calls + 1, "manual sort");
  await settle();
  const sortCall = host.binImports[calls];
  eq("manual Sync: every file sent for sorting, none as new", `${sortCall.payload.arrange}:${sortCall.payload.files.length}:${sortCall.files.length}`, "true:3:0");
  check("manual Sync: status reports the sorting", /4 sorted into subfolder bins/.test($("globalStatus").textContent), $("globalStatus").textContent);
  host.movesToReport = 0;

  // The host found the folder's bin elsewhere in the project and merged a duplicate:
  // the watch bin follows it there.
  host.rootPathToReport = "Footage/Shoot";
  host.mergedToReport = 1;
  calls = host.binImports.length;
  actionsOf(2)[0].click();
  await waitFor(() => host.binImports.length === calls + 1, "take over");
  await settle();
  eq("take over: the watch bin now points at the existing bin", readJson(binsFile(aId)).bins[2].binPath, "Footage/Shoot");
  eq("take over: card shows it", $("binCardsList").children[2].children[0].children[0].textContent, "📁 Footage/Shoot");
  check("take over: status says so, and what was merged", /Using the existing bin Footage\/Shoot/.test($("globalStatus").textContent) && /1 duplicate bin merged/.test($("globalStatus").textContent), $("globalStatus").textContent);
  host.rootPathToReport = null;
  host.mergedToReport = 0;
  calls = host.binImports.length;
  actionsOf(2)[0].click();
  await waitFor(() => host.binImports.length === calls + 1, "sync after take over");
  await settle();
  eq("take over: the next sync goes to the new path", host.binImports[calls].bin, "Footage/Shoot");

  // Auto-Sync sorts a bin once per session, then only calls for new files.
  const cId = `ae|saved|${fileC}`;
  const oldPath = toFwd(join(shoot, "old.mp4"));
  writeFileSync(binsFile(cId), JSON.stringify({ bins: [{
    folderPath: shoot, binPath: "Shoot", filterVideo: true, filterAudio: true, filterImage: true, recursive: true,
    history: { [toFwd(join(shoot, "a.mp4"))]: true, [toFwd(join(shoot, "Day 2", "x.mp4"))]: true, [toFwd(join(shoot, "Day 10", "y.mp4"))]: true, [oldPath.toUpperCase()]: true },
    skipped: {}, importedCount: 4,
  }] }));
  setProject("saved", fileC);
  await advance(2500);
  calls = host.binImports.length;
  $("autoSyncToggle").checked = true;
  $("autoSyncToggle").dispatch("change");
  await advance(6000);
  await waitFor(() => host.binImports.length === calls + 1, "auto sort once");
  await settle();
  eq("auto: sorts a bin once a session", `${host.binImports[calls].payload.arrange}:${host.binImports[calls].files.length}`, "true:0");
  await advance(6000);
  eq("auto: then leaves the host alone", host.binImports.length, calls + 1);

  // old.mp4 moved into Day 3 on disk: the host relinks its clip.
  mkdirSync(join(shoot, "Day 3"), { recursive: true });
  writeFileSync(join(shoot, "Day 3", "old.mp4"), "oooo");
  const newPath = toFwd(join(shoot, "Day 3", "old.mp4"));
  host.movedOnDisk[newPath.toLowerCase()] = join(shoot, "old.mp4");
  await advance(12000);
  await waitFor(() => host.binImports.length === calls + 2, "moved file");
  await settle();
  const moveCall = host.binImports[calls + 1];
  eq("auto relink: only the new file sent, no sorting", `${moveCall.payload.arrange}:${moveCall.payload.files.map((f) => `${f.s}/${f.p.split("/").pop()}`).join(",")}`, "false:Day 3/old.mp4");
  const cBin = readJson(binsFile(cId)).bins[0];
  check("auto relink: new place remembered", cBin.history[newPath] === true);
  check("auto relink: old place forgotten (any case)", !Object.keys(cBin.history).some((k) => k.toLowerCase() === oldPath.toLowerCase()), Object.keys(cBin.history).join(" | "));
  eq("auto relink: count unchanged", cBin.importedCount, 4);
  check("auto relink: status says so", /0 imported, 1 relinked/.test($("globalStatus").textContent), $("globalStatus").textContent);
  $("autoSyncToggle").checked = false;
  $("autoSyncToggle").dispatch("change");
  setProject("saved", fileA);
  await advance(2500);

  // ---- The in-panel dialog: keys, focus, queueing, and nothing changes behind it
  const key = (k, extra = {}) => doc.dispatch("keydown", { key: k, target: doc.body, ...extra });
  const binsNow = () => readJson(binsFile(aId)).bins.length;
  const libSpare = join(work, "Media", "Spare");
  mkdirSync(libSpare, { recursive: true });
  $("btnAddBin").click();
  $("modalFolderInput").value = libSpare;
  $("modalBinNameInput").value = "Spare";
  $("btnModalSaveBin").click();
  await settle(20);
  const spareIndex = binsNow() - 1;
  const spareUnlink = () => $("binCardsList").children[spareIndex].children[0].children[1].children[4];
  spareUnlink().click();
  await waitFor(() => dialog().open, "unlink dialog");
  eq("unlink: asked in the panel, red Unlink", `${dialog().title}|${dialog().ok}|${dialog().okClass}`, "Unlink watch bin|Unlink|btn-danger-sm");
  eq("unlink: Cancel has the focus (Enter is safe)", doc.activeElement === $("dialogCancel"), true);
  key("Enter");
  await settle();
  eq("unlink: Enter on Cancel keeps the bin", `${dialog().open}:${binsNow()}`, `false:${spareIndex + 1}`);
  spareUnlink().click();
  await waitFor(() => dialog().open, "unlink dialog again");
  key("Escape");
  await settle();
  eq("unlink: Esc keeps the bin", `${dialog().open}:${binsNow()}`, `false:${spareIndex + 1}`);
  spareUnlink().click();
  await waitFor(() => dialog().open, "unlink dialog, close button");
  $("dialogClose").click();
  await settle();
  eq("unlink: the close button keeps the bin", `${dialog().open}:${binsNow()}`, `false:${spareIndex + 1}`);
  spareUnlink().click();
  await answerDialog(true, "unlink ok");
  eq("unlink: OK unlinks", binsNow(), spareIndex);

  // Two messages at once: the second waits for the first.
  $("btnAddBin").click();
  $("modalFolderInput").value = "";
  $("btnModalSaveBin").click();
  $("btnModalSaveBin").click();
  await waitFor(() => dialog().open, "first message");
  check("message: one OK, no Cancel", dialog().ok === "OK" && !dialog().cancelShown && dialog().okClass === "btn-primary-sm", JSON.stringify(dialog()));
  const pastesBefore = host.pastes.length;
  key("v", { ctrlKey: true, keyCode: 86 });
  await settle(10);
  eq("message: Ctrl+V does nothing while a dialog is open", host.pastes.length, pastesBefore);
  key("Enter");
  await settle();
  eq("message: Enter closes it and the queued one follows", dialog().open, true);
  key("Enter");
  await settle();
  eq("message: then all closed", dialog().open, false);
  $("btnModalCancel").click();

  // A note tab is not deleted if another project opened while the dialog was up.
  $("btnAddNoteTab").click();
  await settle();
  const tabsBefore = readJson(notesFile(aId)).tabs.length;
  $("btnDeleteNoteTab").click();
  await waitFor(() => dialog().open, "delete tab dialog");
  setProject("saved", fileB);
  await advance(2500);
  $("dialogOk").click();
  await settle();
  eq("delete tab across a project switch: nothing deleted", readJson(notesFile(aId)).tabs.length, tabsBefore);
  setProject("saved", fileA);
  await advance(2500);
  $("btnDeleteNoteTab").click();                      // back in A: the extra tab goes
  await answerDialog(true, "delete the extra tab");
  eq("delete tab back in the project: deleted", readJson(notesFile(aId)).tabs.length, tabsBefore - 1);

  // ---- Script to Audio: timecodes from the voiceover, then subtitles
  const LazyAlign = context.LazyAlign;
  check("script: align.js loaded before main.js", !!LazyAlign && typeof LazyAlign.alignLines === "function");
  const script = [
    "Welcome back, everyone.",
    "Today we test the new subtitle button.",
    "Thanks for watching.",
  ];
  // A voiceover that says each line for 0.1 s per letter, with pauses between.
  const RATE = 16000;
  const bursts = [];
  let cursor = 0.8;
  script.forEach((line, i) => {
    const len = LazyAlign.lineWeight(line) / 10;
    bursts.push({ s: cursor, e: cursor + len });
    cursor += len + [0.5, 0.7, 0][i];
  });
  const total = cursor + 1;
  function writeVoiceWav(file) {
    const n = Math.round(total * RATE);
    const data = Buffer.alloc(n * 2);
    for (let i = 0; i < n; i++) {
      const t = i / RATE;
      const on = bursts.some((b) => t >= b.s && t < b.e);
      const v = on ? Math.sin(2 * Math.PI * 180 * t) * (0.4 + 0.1 * Math.sin(2 * Math.PI * 3 * t)) : ((i * 7919) % 97) / 97e3;
      data.writeInt16LE(Math.round(v * 32767), i * 2);
    }
    const h = Buffer.alloc(44);
    h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24);
    h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
    writeFileSync(file, Buffer.concat([h, data]));
  }
  const editor = $("noteEditor");
  function setEditor(nodes) {
    editor.innerHTML = "";
    for (const n of nodes) {
      if (typeof n === "string") { editor.appendChild(doc.createTextNode(n)); continue; }
      const e = doc.createElement(n.tag);
      if (n.cls) e.className = n.cls;
      for (const c of n.kids || []) {
        if (typeof c === "string") e.appendChild(doc.createTextNode(c));
        else { const k = doc.createElement(c.tag); if (c.cls) k.className = c.cls; if (c.text) k.appendChild(doc.createTextNode(c.text)); e.appendChild(k); }
      }
      editor.appendChild(e);
    }
  }
  const lineDivs = () => editor.children.filter((c) => c.nodeType === 1 && !c.classList.contains("todo-item"));
  const tagOf = (div) => div.children.find((c) => c.nodeType === 1 && c.classList.contains("timecode-tag"));
  const tagsIn = (div) => div.children.filter((c) => c.nodeType === 1 && c.classList.contains("timecode-tag")).length;

  // As Chromium keeps it: the first line loose, later ones in <div>s; plus a
  // checklist item, a divider, an empty line and a line that already has a tag.
  setEditor([
    script[0],
    { tag: "div", kids: ["-----"] },
    { tag: "div", cls: "todo-item", kids: [{ tag: "input", cls: "todo-checkbox" }, { tag: "span", cls: "todo-text", text: "Check the music level" }] },
    { tag: "div", kids: [{ tag: "br" }] },
    { tag: "div", kids: [{ tag: "span", cls: "timecode-tag", text: "[00:00:09:00]" }, " ", { tag: "span", cls: "timecode-tag", text: "[00:00:09:10]" }, " " + script[1]] },
    { tag: "div", kids: [script[2]] },
  ]);
  host.timeline = { ok: true, host: "ppro", name: "Seq 01", fps: 25, offset: 3600, duration: total };
  let voicePath = null;
  host.audioReply = (wavPath) => {
    voicePath = wavPath;
    writeVoiceWav(wavPath);
    return { ok: true, kind: "wav", path: wavPath, used: "selected", name: "Seq 01", fps: 25, offset: 3600, duration: total };
  };
  $("btnTimeToAudio").click();
  $("btnTimeToAudio").click();                         // a double click listens once
  await waitFor(() => lineDivs().filter((d) => tagOf(d) && tagOf(d).getAttribute("data-t")).length === 3, "lines timed");
  await settle();
  eq("time to audio: one host call for a double click", host.audioCalls.length, 1);
  check("time to audio: the WAV goes to the temp folder", voicePath && voicePath.startsWith(tmpdir().replace(/\\/g, "/")), voicePath);
  check("time to audio: the WAV is deleted after reading", voicePath && !existsSync(voicePath));
  const timedDivs = lineDivs().filter((d) => tagOf(d));
  eq("time to audio: the loose first line became a line of its own", editor.children[0].tagName, "DIV");
  eq("time to audio: only spoken lines timed (no divider, checklist or blank)", timedDivs.length, 3);
  bursts.forEach((b, i) => {
    const tag = tagOf(timedDivs[i]);
    const t = parseFloat(tag.getAttribute("data-t"));
    const e = parseFloat(tag.getAttribute("data-e"));
    check(`time to audio: line ${i + 1} starts where it is spoken`, Math.abs(t - b.s) < 0.05, `${t} vs ${b.s}`);
    check(`time to audio: line ${i + 1} ends where it stops`, Math.abs(e - b.e) < 0.05, `${e} vs ${b.e}`);
    eq(`time to audio: line ${i + 1} tag in the sequence's timecode`, tag.textContent, `[${LazyAlign.formatTimecode(3600 + t, 25)}]`);
  });
  eq("time to audio: an old tag is replaced, not kept", tagsIn(timedDivs[1]), 1);
  eq("time to audio: the line text is kept", timedDivs[1].textContent.replace(/^\[[^\]]*\] /, ""), script[1]);
  check("time to audio: saved with the note", /class="timecode-tag" data-t="/.test(readJson(notesFile(aId)).tabs[0].content), readJson(notesFile(aId)).tabs[0].content.slice(0, 120));
  check("time to audio: status says what was heard", /Timed 3 lines to the selected audio of 'Seq 01'/.test($("globalStatus").textContent), $("globalStatus").textContent);

  // Again, from After Effects' levels: tags are replaced, never doubled.
  const fps = 25;
  const levels = [];
  for (let f = 0; f < Math.round(total * fps); f++) {
    const t = f / fps;
    levels.push(bursts.some((b) => t >= b.s && t < b.e) ? 30 : 0.2);
  }
  host.timeline = { ok: true, host: "ae", name: "Explainer", fps, offset: 10, duration: total };
  host.audioReply = () => ({ ok: true, kind: "levels", step: 1 / fps, start: 0, values: levels, used: "all", name: "Explainer", fps, offset: 10, duration: total });
  $("btnTimeToAudio").click();
  await waitFor(() => /Explainer/.test($("globalStatus").textContent), "levels timing");
  await settle();
  const again = lineDivs().filter((d) => tagOf(d));
  eq("levels: still one tag per line", again.map(tagsIn).join(","), "1,1,1");
  check("levels: frame-accurate starts", again.every((d, i) => Math.abs(parseFloat(tagOf(d).getAttribute("data-t")) - bursts[i].s) <= 1 / fps + 1e-9),
    again.map((d) => tagOf(d).getAttribute("data-t")).join(" "));
  eq("levels: comp timecode includes its start time", tagOf(again[0]).textContent, `[${LazyAlign.formatTimecode(10 + parseFloat(tagOf(again[0]).getAttribute("data-t")), fps)}]`);

  // Nothing to hear, or the host refuses: the note is untouched.
  const before = editor.innerHTML;
  host.audioReply = () => ({ ok: true, kind: "levels", step: 0.04, start: 0, values: new Array(200).fill(0.0001), used: "selected", name: "Explainer", fps, offset: 0 });
  $("btnTimeToAudio").click();
  await waitFor(() => /No speech found in the selected audio/.test($("globalStatus").textContent), "no speech");
  eq("no speech: note untouched", editor.innerHTML, before);
  host.audioReply = () => ({ ok: false, msg: "Open a composition first" });
  $("btnTimeToAudio").click();
  await waitFor(() => $("globalStatus").textContent === "Open a composition first", "host refused");
  eq("host refused: note untouched", editor.innerHTML, before);

  // The note changes while the host is still listening: nothing is written into the new one.
  host.audioReply = () => ({ ok: true, kind: "levels", step: 1 / fps, start: 0, values: levels, used: "all", name: "Explainer", fps, offset: 10 });
  let releaseAudio;
  host.audioGate = new Promise((r) => { releaseAudio = r; });
  $("btnTimeToAudio").click();
  await settle();
  check("busy: buttons disabled while listening", $("btnTimeToAudio").disabled && $("btnSubtitles").disabled);
  $("notesTabBar").children[0].click();               // 🌐 Global
  releaseAudio();
  host.audioGate = null;
  await waitFor(() => /note changed while listening/.test($("globalStatus").textContent), "note changed");
  check("busy: buttons back afterwards", !$("btnTimeToAudio").disabled && !$("btnSubtitles").disabled);
  $("notesTabBar").children[1].click();               // back to the project note

  // Subtitles from the timed lines; one tag edited by hand.
  setEditor([
    { tag: "div", kids: [{ tag: "span", cls: "timecode-tag", text: "[00:00:10:20]" }, " " + script[0]] },
    { tag: "div", kids: [{ tag: "span", cls: "timecode-tag", text: "[00:00:13:05]" }, " " + script[1]] },
    { tag: "div", kids: ["No timecode on this line"] },
    { tag: "div", kids: [{ tag: "span", cls: "timecode-tag", text: "[00:00:17:02]" }, " " + script[2]] },
  ]);
  const tags = lineDivs().map(tagOf);
  tags[0].setAttribute("data-t", "0.815"); tags[0].setAttribute("data-e", "2.700");   // as LazyKick wrote it (between frames)
  tags[1].setAttribute("data-t", "3.000"); tags[1].setAttribute("data-e", "6.400");   // text differs: edited by hand
  host.timeline = { ok: true, host: "ppro", name: "Seq: 01/Final", fps: 25, offset: 10, duration: 60 };
  $("btnSubtitles").click();
  await waitFor(() => host.subtitleCalls.length === 1, "subtitles placed");
  await settle();
  const placed = host.subtitleCalls[0];
  eq("subtitles: one cue per timed line", placed.cues.length, 3);
  eq("subtitles: LazyKick's tag gives its exact measured start and end", `${placed.cues[0].s}-${placed.cues[0].e}`, "0.815-2.7");
  eq("subtitles: an edited tag is read from its text", placed.cues[1].s, 3.2);
  check("subtitles: its measured end kept", placed.cues[1].e === 6.4, placed.cues[1].e);
  eq("subtitles: a typed timecode (minus the timeline start)", placed.cues[2].s, 7.08);
  const srtDir = join(projA, "LazyKick Subtitles");
  const srtFiles = existsSync(srtDir) ? readdirSync(srtDir) : [];
  eq("subtitles: SRT next to the project, named after the timeline", srtFiles.join(","), "Seq_ 01_Final.srt");
  const srt = srtFiles.length ? readFileSync(join(srtDir, srtFiles[0]), "utf8") : "";
  eq("subtitles: SRT starts with a BOM", srt.charCodeAt(0), 0xFEFF);
  check("subtitles: SRT cues", srt.includes("1\r\n00:00:00,815 --> 00:00:02,700\r\nWelcome back, everyone.\r\n"), JSON.stringify(srt.slice(0, 80)));
  eq("subtitles: host told where the SRT is", toFwd(placed.srtPath), toFwd(join(srtDir, srtFiles[0] || "")));
  check("subtitles: status", /caption track/.test($("globalStatus").textContent) && /SRT: Seq_ 01_Final\.srt/.test($("globalStatus").textContent), $("globalStatus").textContent);
  $("btnSubtitles").click();
  await waitFor(() => host.subtitleCalls.length === 2, "second subtitles");
  eq("subtitles again: never overwrites the first SRT", readdirSync(srtDir).sort().join(","), "Seq_ 01_Final.srt,Seq_ 01_Final_2.srt");

  setEditor([{ tag: "div", kids: ["Just words, no timecodes."] }]);
  $("btnSubtitles").click();
  await settle();
  check("subtitles: nothing timed, says what to do", /Time to Audio first/.test($("globalStatus").textContent), $("globalStatus").textContent);
  eq("subtitles: nothing timed, host not called", host.subtitleCalls.length, 2);
  setEditor([]);
  $("btnTimeToAudio").click();
  await settle();
  check("time to audio: empty note, says what to do", /Write the script first/.test($("globalStatus").textContent), $("globalStatus").textContent);

  // ---- Pasting a Google Doc keeps its look; Ctrl+Shift+V pastes plain text
  const DOC_HTML = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
    '<p dir="ltr"><span style="font-size:20pt;color:#000000;font-weight:700;">#1 | Prohibition</span></p>' +
    '<p dir="ltr"><span style="font-size:10pt;color:#666666;">Series: Nomolos | Target: 8-12 min</span></p>' +
    '<h2 dir="ltr"><span style="font-size:16pt;color:#000000;font-weight:700;">HOOK</span></h2>' +
    '<p dir="ltr"><span style="font-size:11pt;color:#000000;">In 1920, a country decided to delete a problem. </span><span style="font-size:11pt;font-weight:700;">Delete it.</span></p></b>';
  const pasteInto = (html, text) => {
    const ev = $("noteEditor").dispatch("paste", { clipboardData: { getData: (t) => (t === "text/html" ? html : text), types: ["text/html", "text/plain"] } });
    return ev;
  };
  let pasteExecBefore = doc.execCommands.length;
  const richPaste = pasteInto(DOC_HTML, "#1 | Prohibition\nSeries...");
  await settle();
  const richCmd = doc.execCommands[pasteExecBefore];
  check("doc paste: handled by the panel", richPaste.defaultPrevented === true);
  eq("doc paste: the Doc's structure, rebuilt", `${richCmd && richCmd.cmd}|${richCmd && richCmd.value}`,
    "insertHTML|<h1>#1 | Prohibition</h1><p class=\"note-muted\">Series: Nomolos | Target: 8-12 min</p><h2>HOOK</h2><p>In 1920, a country decided to delete a problem. <b>Delete it.</b></p>");
  pasteExecBefore = doc.execCommands.length;
  $("noteEditor").dispatch("keydown", { key: "V", keyCode: 86, ctrlKey: true, shiftKey: true });
  pasteInto(DOC_HTML, "just the words");
  await settle();
  eq("Ctrl+Shift+V: plain text", `${doc.execCommands[pasteExecBefore].cmd}|${doc.execCommands[pasteExecBefore].value}`, "insertText|just the words");
  pasteExecBefore = doc.execCommands.length;
  pasteInto('<img src=x onerror="alert(1)"><script>alert(2)</script>', "");
  await settle();
  eq("a paste with nothing readable inserts nothing", doc.execCommands.length, pasteExecBefore);
  const realToNoteHtml = context.LazyPaste.toNoteHtml;
  context.LazyPaste.toNoteHtml = () => { throw new Error("clean-up failed"); };
  pasteExecBefore = doc.execCommands.length;
  pasteInto(DOC_HTML, "the words anyway");
  await settle();
  context.LazyPaste.toNoteHtml = realToNoteHtml;
  eq("a failed clean-up still pastes the plain text", `${doc.execCommands[pasteExecBefore]?.cmd}|${doc.execCommands[pasteExecBefore]?.value}`,
    "insertText|the words anyway");

  // What the browser leaves after pasting is tidied: no styles, no stray wrappers, one block per line.
  setEditor([]);
  const box = doc.createElement("div");
  box.setAttribute("style", "font-size:20px");
  box.appendChild(doc.createTextNode("Intro "));
  const h2 = doc.createElement("h2");
  h2.appendChild(doc.createTextNode("Section"));
  box.appendChild(h2);
  const para = doc.createElement("p");
  const styledSpan = doc.createElement("span");
  styledSpan.setAttribute("style", "color:black");
  styledSpan.appendChild(doc.createTextNode("Body"));
  para.appendChild(styledSpan);
  box.appendChild(para);
  $("noteEditor").appendChild(box);
  const styledP = doc.createElement("p");
  styledP.setAttribute("style", "color:red");
  styledP.appendChild(doc.createTextNode("Plain"));
  $("noteEditor").appendChild(styledP);
  pasteInto("<p>x</p><p>y</p>", "x");
  await settle();
  eq("tidy: nested blocks lifted to lines, wrappers and styles gone",
    $("noteEditor").children.map((c) => `${c.tagName}:${c.textContent}:${c.children.some((k) => k.tagName === "SPAN") || !!c.attributes.style}`).join(" "),
    "DIV:Intro :false H2:Section:false P:Body:false P:Plain:false");

  // ---- Note text size
  const sizeBefore = readJson(join(storage, "lazykick_settings.json")).notesFontSize || 14;
  $("btnTextBigger").click();
  $("btnTextBigger").click();
  eq("text size: A+ twice", $("noteEditor").style.fontSize, `${sizeBefore + 2}px`);
  eq("text size: remembered", readJson(join(storage, "lazykick_settings.json")).notesFontSize, sizeBefore + 2);
  for (let i = 0; i < 30; i++) $("btnTextSmaller").click();
  eq("text size: never below 10 px", $("noteEditor").style.fontSize, "10px");
  for (let i = 0; i < 30; i++) $("btnTextBigger").click();
  eq("text size: never above 24 px", $("noteEditor").style.fontSize, "24px");
  while (readJson(join(storage, "lazykick_settings.json")).notesFontSize > 14) $("btnTextSmaller").click();

  // ---- Time to Audio skips headings and side notes, and keeps each word's time
  setEditor([
    { tag: "h1", kids: ["#1 | Prohibition"] },
    { tag: "p", cls: "note-muted", kids: ["Series: Nomolos | Target: 8-12 min"] },
    { tag: "h3", kids: ["HOOK"] },
    { tag: "p", kids: [script[0]] },
    { tag: "p", kids: [script[1]] },
    { tag: "h3", kids: ["THE PROBLEM"] },
    { tag: "p", kids: [script[2]] },
  ]);
  host.timeline = { ok: true, host: "ppro", name: "Seq 01", fps: 25, offset: 0, duration: total };
  host.audioReply = (wavPath) => {
    writeVoiceWav(wavPath);
    return { ok: true, kind: "wav", path: wavPath, used: "all", name: "Seq 01", fps: 25, offset: 0, duration: total };
  };
  $("btnTimeToAudio").click();
  await waitFor(() => /Timed 3 lines/.test($("globalStatus").textContent), "headings skipped");
  const docKids = $("noteEditor").children;
  eq("headings and side notes get no timecode", docKids.map((k) => (tagOf(k) ? "T" : "-")).join(""), "---TT-T");
  const timedP = docKids.filter((k) => tagOf(k));
  timedP.forEach((k, i) => {
    const t = parseFloat(tagOf(k).getAttribute("data-t"));
    check(`headings skipped: line ${i + 1} still lands on its words`, Math.abs(t - bursts[i].s) < 0.05, `${t} vs ${bursts[i].s}`);
    const w = tagOf(k).getAttribute("data-w").split(",").map(Number);
    eq(`word times: one per word in line ${i + 1}`, w.length, script[i].split(/\s+/).length);
    check(`word times: line ${i + 1} starts at 0 and only goes forward`, w[0] === 0 && w.every((x, j) => j === 0 || x >= w[j - 1]), w.join(","));
    check(`word times: line ${i + 1} ends inside the line`, w[w.length - 1] < bursts[i].e - bursts[i].s, `${w[w.length - 1]} vs ${bursts[i].e - bursts[i].s}`);
  });

  // ---- A long paragraph becomes several subtitles, each when its first word is said
  const longText = "In 1920, a country decided to delete a problem. Not reduce it. Not manage it. Delete it. " +
    "The United States looked at alcohol, at the drunkenness and the broken homes, and did something no nation had tried.";
  const longWords = longText.split(" ");
  const offsets = longWords.map((w, i) => (i * 0.35).toFixed(2));
  setEditor([{ tag: "p", kids: [{ tag: "span", cls: "timecode-tag", text: "[00:00:02:00]" }, " " + longText] }]);
  const longTag = tagOf($("noteEditor").children[0]);
  longTag.setAttribute("data-t", "2.000");
  longTag.setAttribute("data-e", (2 + longWords.length * 0.35).toFixed(3));
  longTag.setAttribute("data-w", offsets.join(","));
  const subsBefore = host.subtitleCalls.length;
  $("btnSubtitles").click();
  await waitFor(() => host.subtitleCalls.length === subsBefore + 1, "long subtitles");
  const longCues = host.subtitleCalls[subsBefore].cues;
  check("long line: cut into several subtitles", longCues.length >= 3, longCues.length);
  check("long line: every subtitle fits two lines of 42", longCues.every((c) => c.t.split("\n").length <= 2 && c.t.replace("\n", " ").length <= 84), longCues.map((c) => c.t.length).join(","));
  check("long line: pieces end at sentence ends", longCues.slice(0, -1).every((c) => /[.,]$/.test(c.t)), longCues.map((c) => c.t.slice(-8)).join(" | "));
  let wordAt = 0;
  longCues.forEach((c, i) => {
    const expected = 2 + wordAt * 0.35;
    check(`long line: subtitle ${i + 1} starts with its first word`, Math.abs(c.s - expected) < 0.01, `${c.s} vs ${expected}`);
    wordAt += c.t.split(/\s+/).length;
  });
  eq("long line: all words kept, in order", longCues.map((c) => c.t.replace("\n", " ")).join(" "), longText);

  // ---- Following the playhead
  const lineEl = (text, t, e, w) => ({ tag: "p", kids: [{ tag: "span", cls: "timecode-tag", text: `[${LazyAlign.formatTimecode(t, 25)}]` }, " " + text], t, e, w });
  const followLines = [
    { tag: "h1", kids: ["Title"] },
    { tag: "p", cls: "note-muted", kids: ["Series: x"] },
    lineEl("One two three", 1, 3, "0,0.6,1.2"),
    lineEl("Four five six seven", 4, 6, "0,0.5,1,1.5"),
  ];
  for (let i = 0; i < 24; i++) followLines.push(lineEl(`Filler line ${i}`, 10 + i * 2, 11.5 + i * 2, "0,0.5,1"));
  setEditor(followLines);
  $("noteEditor").children.forEach((k, i) => {
    const spec = followLines[i];
    const tg = tagOf(k);
    if (tg && spec.t !== undefined) { tg.setAttribute("data-t", String(spec.t)); tg.setAttribute("data-e", String(spec.e)); tg.setAttribute("data-w", spec.w); }
  });
  $("noteEditor").dispatch("input");
  $("tabNotes").classList.add("active");
  await realTimeout(2600);                             // earlier typing in the note pauses the scrolling for 2.5 s
  host.playhead = 1.7;
  doc.scrolls = [];
  await advance(1000);
  await settle();
  check("follow: the highlight shows", !$("followLayer").classList.contains("hidden"));
  eq("follow: on the line being said (the third block: headings are skipped)", $("followLine").style.top, `${2 * 20 - 2}px`);
  eq("follow: on the word being said (\"two\" starts 5 characters in)", `${$("followWord").style.left}|${$("followWord").style.width}`, `${5 * 7 - 2}px|${3 * 7 + 4}px`);
  check("follow: the word shows", !$("followWord").classList.contains("hidden"));
  host.playhead = 4.6;
  await advance(900);
  eq("follow: next line", $("followLine").style.top, `${3 * 20 - 2}px`);
  eq("follow: its second word (\"five\" starts 6 characters in)", $("followWord").style.left, `${6 * 7 - 2}px`);
  host.playhead = 3.5;
  await advance(250);
  eq("follow: in a pause the line stays, no word", `${$("followLine").style.top}|${$("followWord").classList.contains("hidden")}`, `${2 * 20 - 2}px|true`);
  host.playhead = 0.2;
  await advance(250);
  check("follow: before the first line, nothing shows", $("followLayer").classList.contains("hidden"));
  eq("follow: no scrolling while everything is in view", doc.scrolls.length, 0);
  host.playhead = 10 + 23 * 2 + 0.2;                   // the last filler line, far below the fold
  await advance(250);
  eq("follow: a line out of view is scrolled up to a third of the way down", doc.scrolls[0], (4 + 23) * 20 - 400 * 0.3);
  $("noteEditor").scrollTop = 0;
  $("noteEditor").dispatch("wheel");
  host.playhead = 10 + 22 * 2 + 0.2;
  await advance(250);
  eq("follow: no scrolling right after the user scrolled", doc.scrolls.length, 1);
  const callsWhileOn = host.playheadCalls;
  $("btnFollow").click();
  eq("follow off: button shows it", $("btnFollow").classList.contains("is-on"), false);
  check("follow off: highlight hidden", $("followLayer").classList.contains("hidden"));
  await advance(3000);
  eq("follow off: the host is not asked any more", host.playheadCalls, callsWhileOn);
  eq("follow off: remembered", readJson(join(storage, "lazykick_settings.json")).follow, false);
  $("btnFollow").click();
  host.playhead = null;
  await advance(1000);
  check("follow: no timeline, nothing shows", $("followLayer").classList.contains("hidden"));
  $("tabNotes").classList.remove("active");
  const callsHidden = host.playheadCalls;
  host.playhead = 1.7;
  await advance(3000);
  eq("follow: the host is not asked while another tab shows", host.playheadCalls, callsHidden);

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

eq("no native alert/confirm window was opened", nativePopups.join(" | "), "");
console.log("LazyKick - panel tests\n");
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`${failures.length ? "" : "  "}${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
