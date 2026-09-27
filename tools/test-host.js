/*
 * LazyKick — host.jsx tests against mocked After Effects and Premiere Pro.
 *
 *   cscript //Nologo tools\test-host.js
 *
 * Windows Script Host's JScript is ES3, like ExtendScript, and has no native
 * JSON — so host.jsx's own JSON fallback is exercised too. The mocks model only
 * the parts of each host's scripting API that host.jsx touches; they are not a
 * substitute for trying a release in the real apps.
 */
var fso = new ActiveXObject("Scripting.FileSystemObject");
var scriptDir = fso.GetParentFolderName(WScript.ScriptFullName);
var repoRoot = fso.GetParentFolderName(scriptDir);

function read(path) {
    var st = new ActiveXObject("ADODB.Stream");
    st.Type = 2; st.Charset = "utf-8"; st.Open();
    st.LoadFromFile(path);
    var s = st.ReadText(-1);
    st.Close();
    return s;
}

// ------------------------------------------------------------------ harness
var passed = 0;
var failures = [];

function check(name, condition, detail) {
    if (condition) {
        passed++;
    } else {
        failures.push(name + (detail !== undefined ? "  [" + detail + "]" : ""));
    }
}

/** Runs one group of checks; an exception counts as a failure instead of ending the run. */
function section(name, fn) {
    try {
        fn();
    } catch (e) {
        failures.push(name + ": threw " + (e.message || e));
    }
}

function eq(name, actual, expected) {
    check(name, actual === expected, "got " + actual + ", expected " + expected);
}

// ---------------------------------------------------------- shared globals
var $ = { os: "Windows 10 Pro" };
var existingFiles = {};   // normalised path -> { width, height }

function norm(p) { return String(p).replace(/\//g, "\\").toLowerCase(); }

var existingFolders = {}; // normalised path -> true

function File(p) {
    this.fsName = String(p).replace(/\//g, "\\");
    var info = existingFiles[norm(p)];
    this.exists = !!info;
    this.info = info;
    var cut = this.fsName.lastIndexOf("\\");
    this.name = this.fsName.substr(cut + 1).replace(/ /g, "%20");
    this.parent = cut > 0 ? new Folder(this.fsName.substr(0, cut)) : null;
}
File.prototype.remove = function () {
    delete existingFiles[norm(this.fsName)];
    this.exists = false;
    return true;
};

function Folder(p) {
    this.fsName = String(p).replace(/\//g, "\\").replace(/\\+$/, "");
    this.exists = !!existingFolders[norm(this.fsName)];
    var cut = this.fsName.lastIndexOf("\\");
    this.name = this.fsName.substr(cut + 1);
    this.parent = cut > 0 ? new Folder(this.fsName.substr(0, cut)) : null;
}
/** Direct children, from the existingFolders / existingFiles maps (mask: "*.ext"). */
Folder.prototype.getFiles = function (mask) {
    var base = norm(this.fsName) + "\\";
    var out = [];
    var k;
    for (k in existingFolders) {
        if (k.indexOf(base) === 0 && k.substr(base.length).indexOf("\\") === -1) out.push(new Folder(k));
    }
    var ext = mask ? mask.replace(/^\*/, "").toLowerCase() : "";
    for (k in existingFiles) {
        if (k.indexOf(base) === 0 && k.substr(base.length).indexOf("\\") === -1 && (!ext || k.substr(k.length - ext.length) === ext)) out.push(new File(k));
    }
    return out;
};

function addFolderChain(p) {
    var parts = norm(p).split("\\");
    for (var i = 1; i <= parts.length; i++) existingFolders[parts.slice(0, i).join("\\")] = true;
}

// After Effects classes (set to undefined while testing Premiere).
var CompItem, FolderItem, FootageItem, ImportOptions;

var app = null;
var undoDepth = 0;
var undoGroups = 0;

// Loaded at global scope, the way ExtendScript loads a panel's ScriptPath.
eval(read(fso.BuildPath(repoRoot, "host\\host.jsx")));

function parse(s) { return eval("(" + s + ")"); }

// ============================================================ pure helpers
section("pure helpers", function () {
    var H = LazyKickHost;
    eq("sanitize: plain", H.sanitizeBinPath("Pasted Images", "X"), "Pasted Images");
    eq("sanitize: trims", H.sanitizeBinPath("  Refs  ", "X"), "Refs");
    eq("sanitize: nested + backslash", H.sanitizeBinPath("A\\B//C", "X"), "A/B/C");
    eq("sanitize: no parent escape", H.sanitizeBinPath("../../Windows/x", "X"), "Windows/x");
    eq("sanitize: dot segments", H.sanitizeBinPath("a/./../b", "X"), "a/b");
    eq("sanitize: bad chars", H.sanitizeBinPath('bad:name*?"', "X"), "bad_name___");
    eq("sanitize: empty -> fallback", H.sanitizeBinPath("", "Fallback"), "Fallback");
    eq("sanitize: only dots -> fallback", H.sanitizeBinPath("./..", "Fallback"), "Fallback");

    eq("timecode: float playhead rounds to its frame", H.formatFramesTimecode(1.9999999, 25), "00:00:02:00");
    eq("timecode: hours", H.formatFramesTimecode(3661.5, 30), "01:01:01:15");
    eq("timecode: 29.97 counts nominal 30", H.formatFramesTimecode(10, 29.97), "00:00:10:00");
    eq("timecode: negative clamps", H.formatFramesTimecode(-3, 24), "00:00:00:00");

    var T = function (locked, clips) { return { locked: locked, clips: clips }; };
    var C = function (s, e) { return { start: s, end: e }; };
    eq("track: busy V1 -> empty V2", H.choosePremiereTrack([T(false, [C(0, 20)]), T(false, [])], 10, 5), 1);
    eq("track: gap too small is skipped", H.choosePremiereTrack([T(false, [C(12, 20)]), T(false, [])], 10, 5), 1);
    eq("track: gap big enough is used", H.choosePremiereTrack([T(false, [C(30, 40)]), T(false, [])], 10, 5), 0);
    eq("track: unknown duration needs empty-onward track", H.choosePremiereTrack([T(false, [C(30, 40)]), T(false, [])], 10, 0), 1);
    eq("track: locked skipped", H.choosePremiereTrack([T(true, []), T(false, [])], 10, 5), 1);
    eq("track: clip ending at playhead is not in the way", H.choosePremiereTrack([T(false, [C(0, 10)])], 10, 5), 0);
    eq("track: clip starting at playhead is in the way", H.choosePremiereTrack([T(false, [C(10, 15)]), T(false, [])], 10, 5), 1);
    eq("track: all busy", H.choosePremiereTrack([T(false, [C(0, 20)]), T(true, [])], 10, 5), -1);
});

// ============================================================ Premiere Pro
function PItem(type, name, mediaPath, duration) {
    this.type = type;
    this.name = name;
    this.nodeId = ppro.noNodeIds ? undefined : "node" + (PItem.next++);
    this.children = { numItems: 0 };
    this.mediaPath = mediaPath;
    this.duration = duration || 0;
}
PItem.next = 1;
PItem.prototype.createBin = function (name) {
    var bin = new PItem(2, name);
    addChild(this, bin);
    return bin;
};
PItem.prototype.getMediaPath = function () { return this.mediaPath; };
PItem.prototype.moveBin = function (dest) {
    removeChild(this.parentBin, this);
    addChild(dest, this);
    ppro.moves++;
    return 0;
};
PItem.prototype.deleteBin = function () {
    // The real one deletes the bin with everything in it: never call it on a full bin.
    if (this.children.numItems) throw new Error("deleteBin on a bin that still holds " + this.children.numItems + " items");
    removeChild(this.parentBin, this);
    ppro.deleted.push(this.name);
    return 0;
};
PItem.prototype.canChangeMediaPath = function () { return true; };
PItem.prototype.changeMediaPath = function (p) {
    this.mediaPath = p;
    ppro.relinks.push(p);
    return 0;
};
PItem.prototype.getInPoint = function () { return { seconds: 0 }; };
PItem.prototype.getOutPoint = function () { return { seconds: this.duration }; };

function addChild(bin, item) {
    bin.children[bin.children.numItems] = item;
    bin.children.numItems++;
    item.parentBin = bin;
}

function removeChild(bin, item) {
    var kept = [];
    for (var i = 0; i < bin.children.numItems; i++) if (bin.children[i] !== item) kept.push(bin.children[i]);
    bin.children = { numItems: 0 };
    for (var k = 0; k < kept.length; k++) addChild(bin, kept[k]);
}

function PTrack(locked, clips) {
    this.locked = locked;
    this.clips = { numItems: 0 };
    this.overwrites = 0;
    this.inserts = 0;
    for (var i = 0; i < clips.length; i++) this.addClip(clips[i][0], clips[i][1], null);
}
PTrack.prototype.addClip = function (s, e, item) {
    this.clips[this.clips.numItems] = { start: { seconds: s }, end: { seconds: e }, projectItem: item };
    this.clips.numItems++;
};
PTrack.prototype.isLocked = function () { return this.locked; };
PTrack.prototype.overwriteClip = function (item, time) {
    var s = (typeof time === "number") ? time : time.seconds;
    this.overwrites++;
    this.addClip(s, s + item.duration, item);
};
PTrack.prototype.insertClip = function () { this.inserts++; };

var ppro = {};

function setupPremiere(tracks, playhead) {
    CompItem = undefined; FolderItem = undefined; FootageItem = undefined; ImportOptions = undefined;
    ppro.imports = [];
    ppro.unsupported = {};
    ppro.moves = 0;
    ppro.deleted = [];
    ppro.relinks = [];
    var root = new PItem(2, "root");
    var seq = {
        name: "Seq 01",
        timebase: "10160640000", // 25 fps
        videoTracks: { numTracks: tracks.length },
        getPlayerPosition: function () { return { seconds: playhead }; },
        getSettings: function () { return { videoFrameRate: { seconds: 0.04 }, videoDisplayFormat: 101 }; }
    };
    for (var i = 0; i < tracks.length; i++) seq.videoTracks[i] = tracks[i];
    app = {
        project: {
            path: "D:\\Work\\Edit.prproj",
            documentID: "doc-123",
            name: "Edit.prproj",
            rootItem: root,
            activeSequence: seq,
            importFiles: function (paths, suppressUI, targetBin) {
                ppro.imports.push({ paths: paths, suppressUI: suppressUI, bin: targetBin.name });
                for (var p = 0; p < paths.length; p++) {
                    if (ppro.unsupported[norm(paths[p])]) continue;
                    var name = String(paths[p]).replace(/\//g, "\\");
                    addChild(targetBin, new PItem(1, name.substr(name.lastIndexOf("\\") + 1), name, 5));
                }
                return true;
            }
        }
    };
    return seq;
}

section("Premiere Pro", function () {
    existingFiles = {};
    existingFiles[norm("D:/Work/Pasted Images/pasted_1.png")] = { width: 800, height: 600 };

    // V1 busy at the playhead, V2 has room before its clip at 30 s, V3 empty.
    var v1 = new PTrack(false, [[0, 20]]);
    var v2 = new PTrack(false, [[30, 40]]);
    var v3 = new PTrack(false, []);
    setupPremiere([v1, v2, v3], 10);

    eq("ppro: host detected", LazyKickHost.getHostName(), "ppro");
    eq("ppro: project id", LazyKickHost.getProjectPath(), "ppro|saved|D:\\Work\\Edit.prproj");

    var r = parse(importPastedImage("D:/Work/Pasted Images/pasted_1.png", true, false, "Refs/Screens"));
    check("ppro paste: ok", r.ok === true, r.msg);
    check("ppro paste: placed", r.placedOnTimeline === true, r.msg);
    eq("ppro paste: on V2 (room before next clip)", r.track, 2);
    eq("ppro paste: overwrite edit used", v2.overwrites, 1);
    eq("ppro paste: never insertClip (no ripple)", v1.inserts + v2.inserts + v3.inserts, 0);
    eq("ppro paste: V1 untouched", v1.overwrites, 0);
    eq("ppro paste: imported once", ppro.imports.length, 1);
    eq("ppro paste: suppressUI", ppro.imports[0].suppressUI, true);
    eq("ppro paste: nested bin", ppro.imports[0].bin, "Screens");
    var refs = app.project.rootItem.children[0];
    check("ppro paste: bin tree Refs/Screens", refs && refs.name === "Refs" && refs.children[0].name === "Screens");
    eq("ppro paste: not reused first time", r.reused, false);

    var r2 = parse(importPastedImage("D:/Work/Pasted Images/pasted_1.png", true, false, "Refs/Screens"));
    eq("ppro paste again: reuses project item", r2.reused, true);
    eq("ppro paste again: no second import", ppro.imports.length, 1);
    // The first still now fills V2 10-15 s, so the next one goes to V3.
    eq("ppro paste again: next free track", r2.track, 3);

    // Every track busy: stays in the bin, nothing is pushed around.
    var b1 = new PTrack(false, [[0, 60]]);
    var b2 = new PTrack(true, []);
    setupPremiere([b1, b2], 10);
    var r3 = parse(importPastedImage("D:/Work/Pasted Images/pasted_1.png", false, false, ""));
    check("ppro busy: ok", r3.ok === true, r3.msg);
    eq("ppro busy: not placed", r3.placedOnTimeline, false);
    check("ppro busy: says why", r3.msg.indexOf("No free video track") === 0, r3.msg);
    eq("ppro busy: default bin", r3.binPath, "Pasted Images");
    eq("ppro busy: no edits", b1.overwrites + b1.inserts + b2.overwrites + b2.inserts, 0);

    // Timecode through getFormatted with the sequence's display format.
    app.project.activeSequence.getPlayerPosition = function () {
        return { seconds: 12.5, getFormatted: function (rate, fmt) { return fmt === 101 ? "00:00:12:12" : ""; } };
    };
    eq("ppro timecode: getFormatted", parse(getCurrentTimecode()).timecode, "00:00:12:12");
    app.project.activeSequence.getPlayerPosition = function () {
        return { seconds: 12.5, getFormatted: function () { throw new Error("no"); } };
    };
    eq("ppro timecode: fallback from timebase", parse(getCurrentTimecode()).timecode, "00:00:12:13");

    // Watch-bin import: wrong project is refused, partial failures reported.
    existingFiles[norm("D:/Media/a.mp4")] = {};
    existingFiles[norm("D:/Media/b.wav")] = {};
    existingFiles[norm("D:/Media/c.heic")] = {};
    setupPremiere([new PTrack(false, [])], 0);
    var files = '["D:/Media/a.mp4","D:/Media/b.wav","D:/Media/c.heic","D:/Media/gone.mov"]';
    var wrong = parse(importFilesToBin("SFX", files, "ppro|saved|D:\\Other.prproj"));
    eq("ppro sync: other project refused", wrong.ok, false);
    eq("ppro sync: flagged projectChanged", wrong.projectChanged, true);
    eq("ppro sync: nothing imported into the wrong project", ppro.imports.length, 0);

    ppro.unsupported[norm("D:/Media/c.heic")] = true;
    var s = parse(importFilesToBin("SFX/Hits", files, "ppro|saved|D:\\Work\\Edit.prproj"));
    eq("ppro sync: ok", s.ok, true);
    eq("ppro sync: imported count", s.imported, 2);
    eq("ppro sync: failed count", s.failed, 2);
    eq("ppro sync: imported list", s.importedFiles.join("|"), "D:/Media/a.mp4|D:/Media/b.wav");
    eq("ppro sync: failed list", s.failedFiles.join("|"), "D:/Media/gone.mov|D:/Media/c.heic");
    eq("ppro sync: one batch, dialogs suppressed", ppro.imports.length + ":" + ppro.imports[0].suppressUI, "1:true");

    // Media already in the project, in any bin, is reported and not imported again.
    setupPremiere([new PTrack(false, [])], 0);
    var oldBin = app.project.rootItem.createBin("Old Stuff");
    addChild(oldBin, new PItem(1, "a.mp4", "D:\\MEDIA\\a.mp4", 5)); // other case and slashes
    var ex = parse(importFilesToBin("SFX", '["D:/Media/a.mp4","D:/Media/b.wav"]', "ppro|saved|D:\\Work\\Edit.prproj"));
    eq("ppro existing: reported", ex.existingFiles.join("|"), "D:/Media/a.mp4");
    eq("ppro existing: counted", ex.existing, 1);
    eq("ppro existing: only the new file sent to Premiere", ppro.imports.length + ":" + ppro.imports[0].paths.join("|"), "1:D:/Media/b.wav");
    eq("ppro existing: imported list", ex.importedFiles.join("|"), "D:/Media/b.wav");

    var allThere = parse(importFilesToBin("Fresh/Bin", '["D:/Media/a.mp4","D:/Media/b.wav"]', "ppro|saved|D:\\Work\\Edit.prproj"));
    eq("ppro all existing: nothing imported", ppro.imports.length, 1);
    eq("ppro all existing: both reported", allThere.imported + ":" + allThere.existing + ":" + allThere.failed, "0:2:0");
    var madeFresh = false;
    for (var rb = 0; rb < app.project.rootItem.children.numItems; rb++) {
        if (app.project.rootItem.children[rb].name === "Fresh") madeFresh = true;
    }
    eq("ppro all existing: no empty bin made", madeFresh, false);
});

// ============================================== Premiere Pro: mirrored folders
function pproKids(bin) {
    var names = [];
    for (var i = 0; i < bin.children.numItems; i++) {
        var c = bin.children[i];
        names.push(c.type === 2 ? c.name + "/" : c.name);
    }
    return names.join(",");
}
function pproBin(path) {
    var bin = app.project.rootItem;
    var parts = path.split("/");
    for (var p = 0; p < parts.length && bin; p++) {
        var found = null;
        for (var i = 0; i < bin.children.numItems; i++) {
            if (bin.children[i].type === 2 && bin.children[i].name === parts[p]) found = bin.children[i];
        }
        bin = found;
    }
    return bin;
}
function clip(bin, mediaPath) {
    var item = new PItem(1, mediaPath.replace(/^.*\\/, ""), mediaPath, 5);
    addChild(bin, item);
    return item;
}
function payload(folder, arrange, files) {
    var list = [];
    for (var i = 0; i < files.length; i++) {
        list.push({ p: files[i][0], s: files[i][1], n: files[i][2] === true });
    }
    return JSON.stringify({ folder: folder, arrange: arrange, files: list });
}
var PPRO_ID = "ppro|saved|D:\\Work\\Edit.prproj";

section("Premiere Pro: mirrored folders", function () {
    existingFiles = {};
    var shoot = ["D:/Shoot/a.mp4", "D:/Shoot/Day 1/b.mp4", "D:/Shoot/Day 1/Cam A/c.mp4", "D:/Shoot/Day 2/d.mp4", "D:/Shoot/Day 2/e.mp4"];
    for (var f = 0; f < shoot.length; f++) existingFiles[norm(shoot[f])] = {};

    // First sync: subfolders become bins inside the watch bin, in folder order.
    setupPremiere([new PTrack(false, [])], 0);
    var r = parse(syncWatchBin("Footage", payload("D:/Shoot", true, [
        ["D:/Shoot/Day 1/Cam A/c.mp4", "Day 1/Cam A", true],
        ["D:/Shoot/Day 1/b.mp4", "Day 1", true],
        ["D:/Shoot/Day 2/d.mp4", "Day 2", true],
        ["D:/Shoot/a.mp4", "", true]
    ]), PPRO_ID));
    check("mirror: ok", r.ok === true, r.msg);
    eq("mirror: all imported", r.imported + ":" + r.failed + ":" + r.existing + ":" + r.moved, "4:0:0:0");
    eq("mirror: one import per bin", ppro.imports.length, 4);
    eq("mirror: Footage holds the folders first, then its own file", pproKids(pproBin("Footage")), "Day 1/,Day 2/,a.mp4");
    eq("mirror: Day 1", pproKids(pproBin("Footage/Day 1")), "Cam A/,b.mp4");
    eq("mirror: Day 1/Cam A", pproKids(pproBin("Footage/Day 1/Cam A")), "c.mp4");
    eq("mirror: Day 2", pproKids(pproBin("Footage/Day 2")), "d.mp4");
    eq("mirror: nothing else at the root", pproKids(app.project.rootItem), "Footage/");

    // A 1.2 watch bin: everything flat in one bin. One sync sorts it.
    setupPremiere([new PTrack(false, [])], 0);
    var footage = app.project.rootItem.createBin("Footage");
    for (var s = 0; s < 4; s++) clip(footage, shoot[s].replace(/\//g, "\\"));
    var own = clip(footage, "D:\\Other\\logo.png");          // put there by the user
    existingFiles[norm("D:/Other/logo.png")] = {};
    var lower = footage.createBin("day 2");                   // same name, other case
    var selects = app.project.rootItem.createBin("Selects");
    var picked = clip(selects, "D:\\Shoot\\Day 2\\e.mp4");    // dragged out by the user
    var all = [
        ["D:/Shoot/Day 1/Cam A/c.mp4", "Day 1/Cam A"],
        ["D:/Shoot/Day 1/b.mp4", "Day 1"],
        ["D:/Shoot/Day 2/d.mp4", "Day 2"],
        ["D:/Shoot/Day 2/e.mp4", "Day 2"],
        ["D:/Shoot/a.mp4", ""]
    ];
    var ar = parse(syncWatchBin("Footage", payload("D:/Shoot", true, all), PPRO_ID));
    eq("arrange: nothing imported", ppro.imports.length, 0);
    eq("arrange: three clips moved", ar.moved, 3);
    eq("arrange: Footage keeps its own file and the user's logo", pproKids(pproBin("Footage")), "a.mp4,logo.png,day 2/,Day 1/");
    eq("arrange: Day 1 built from the folders", pproKids(pproBin("Footage/Day 1")), "Cam A/,b.mp4");
    eq("arrange: Cam A", pproKids(pproBin("Footage/Day 1/Cam A")), "c.mp4");
    eq("arrange: an existing bin that differs only in case is reused", pproKids(lower), "d.mp4");
    eq("arrange: a clip outside the watch bin stays put", picked.parentBin === selects && own.parentBin === footage, true);
    var again = parse(syncWatchBin("Footage", payload("D:/Shoot", true, all), PPRO_ID));
    eq("arrange again: nothing to move", again.moved + ":" + ppro.moves, "0:3");

    var noArrange = parse(syncWatchBin("Footage", payload("D:/Shoot", false, all), PPRO_ID));
    eq("arrange off: nothing looked at", noArrange.moved, 0);

    // The watch bin was deleted in Premiere: sorting makes nothing.
    setupPremiere([new PTrack(false, [])], 0);
    var gone = parse(syncWatchBin("Footage", payload("D:/Shoot", true, all), PPRO_ID));
    eq("arrange without the bin: nothing made", gone.moved + ":" + pproKids(app.project.rootItem), "0:");
    // A watch bin at the project root is never rearranged.
    clip(app.project.rootItem, "D:\\Shoot\\Day 1\\b.mp4");
    eq("arrange at the root: left alone", parse(syncWatchBin("", payload("D:/Shoot", true, all), PPRO_ID)).moved, 0);

    // A file moved to another folder on disk: its clip is relinked and follows it.
    setupPremiere([new PTrack(false, [])], 0);
    footage = app.project.rootItem.createBin("Footage");
    var moved = clip(footage, "D:\\Shoot\\old.mp4");       // no longer on disk
    existingFiles[norm("D:/Shoot/Day 3/old.mp4")] = {};
    var rl = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [["D:/Shoot/Day 3/old.mp4", "Day 3", true]]), PPRO_ID));
    eq("relink: counted", rl.relinked + ":" + rl.imported + ":" + rl.failed, "1:0:0");
    eq("relink: no second copy imported", ppro.imports.length, 0);
    eq("relink: same clip, new path", moved.mediaPath, "D:\\Shoot\\Day 3\\old.mp4");
    eq("relink: reported from/to", rl.relinkedFiles[0].from + " > " + rl.relinkedFiles[0].to, "D:\\Shoot\\old.mp4 > D:/Shoot/Day 3/old.mp4");
    eq("relink: moved into its folder's bin", pproKids(pproBin("Footage/Day 3")), "old.mp4");

    // Two new files with the missing clip's name, equally close: not guessed.
    setupPremiere([new PTrack(false, [])], 0);
    footage = app.project.rootItem.createBin("Footage");
    var cam = clip(footage, "D:\\Shoot\\A001.mp4");
    existingFiles[norm("D:/Shoot/Day 1/A001.mp4")] = {};
    existingFiles[norm("D:/Shoot/Day 2/A001.mp4")] = {};
    var amb = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [
        ["D:/Shoot/Day 1/A001.mp4", "Day 1", true],
        ["D:/Shoot/Day 2/A001.mp4", "Day 2", true]
    ]), PPRO_ID));
    eq("ambiguous: nothing relinked, both imported", amb.relinked + ":" + amb.imported, "0:2");
    eq("ambiguous: old clip untouched", cam.mediaPath, "D:\\Shoot\\A001.mp4");

    // One new file, two missing clips that fit it equally well: not guessed either.
    setupPremiere([new PTrack(false, [])], 0);
    footage = app.project.rootItem.createBin("Footage");
    var card1 = clip(footage, "E:\\Card 1\\A001.mp4");
    var card2 = clip(footage, "E:\\Card 2\\A001.mp4");
    existingFiles[norm("D:/Shoot/A001.mp4")] = {};
    var amb2 = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [["D:/Shoot/A001.mp4", "", true]]), PPRO_ID));
    eq("ambiguous the other way: imported, not relinked", amb2.relinked + ":" + amb2.imported, "0:1");
    eq("ambiguous the other way: both clips untouched", card1.mediaPath + " | " + card2.mediaPath, "E:\\Card 1\\A001.mp4 | E:\\Card 2\\A001.mp4");

    // The whole shoot moved to another drive: folder names tell the clips apart.
    setupPremiere([new PTrack(false, [])], 0);
    footage = app.project.rootItem.createBin("Footage");
    var day1 = footage.createBin("Day 1");
    var day2 = footage.createBin("Day 2");
    var c1 = clip(day1, "E:\\Card\\Day 1\\A001.mp4");
    var c2 = clip(day2, "E:\\Card\\Day 2\\A001.mp4");
    var drive = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [
        ["D:/Shoot/Day 1/A001.mp4", "Day 1", true],
        ["D:/Shoot/Day 2/A001.mp4", "Day 2", true]
    ]), PPRO_ID));
    eq("new drive: both relinked", drive.relinked + ":" + drive.imported, "2:0");
    eq("new drive: each to its own day", c1.mediaPath + " | " + c2.mediaPath, "D:\\Shoot\\Day 1\\A001.mp4 | D:\\Shoot\\Day 2\\A001.mp4");
    eq("new drive: nothing moved", drive.moved + ":" + c1.parentBin.name + ":" + c2.parentBin.name, "0:Day 1:Day 2");

    // A clip that still has its file is never taken over by a new file of the same name.
    setupPremiere([new PTrack(false, [])], 0);
    footage = app.project.rootItem.createBin("Footage");
    existingFiles[norm("D:/Library/logo.png")] = {};
    existingFiles[norm("D:/Shoot/logo.png")] = {};
    var lib = clip(footage, "D:\\Library\\logo.png");
    var twin = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [["D:/Shoot/logo.png", "", true]]), PPRO_ID));
    eq("not missing: imported, not relinked", twin.relinked + ":" + twin.imported + ":" + lib.mediaPath, "0:1:D:\\Library\\logo.png");

    // A missing clip elsewhere in the project, from another folder, is not ours.
    setupPremiere([new PTrack(false, [])], 0);
    var elsewhere = clip(app.project.rootItem.createBin("Archive"), "F:\\Old\\old.mp4");
    var foreign = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [["D:/Shoot/Day 3/old.mp4", "Day 3", true]]), PPRO_ID));
    eq("not ours: imported, not relinked", foreign.relinked + ":" + foreign.imported + ":" + elsewhere.mediaPath, "0:1:F:\\Old\\old.mp4");
    // ...but one dragged out of the watch bin, from the watch folder, is.
    setupPremiere([new PTrack(false, [])], 0);
    var dragged = clip(app.project.rootItem.createBin("Selects"), "D:\\Shoot\\old.mp4");
    var follow = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [["D:/Shoot/Day 3/old.mp4", "Day 3", true]]), PPRO_ID));
    eq("dragged out: relinked where it is", follow.relinked + ":" + dragged.mediaPath + ":" + dragged.parentBin.name, "1:D:\\Shoot\\Day 3\\old.mp4:Selects");

    // createBin answering 0 (documented on failure) still finds the bin it made.
    setupPremiere([new PTrack(false, [])], 0);
    var realCreate = PItem.prototype.createBin;
    PItem.prototype.createBin = function (name) { realCreate.call(this, name); return 0; };
    try {
        parse(syncWatchBin("Zero", payload("D:/Shoot", false, [["D:/Shoot/Day 1/b.mp4", "Day 1", true]]), PPRO_ID));
        eq("createBin returns 0: bin still used", pproKids(pproBin("Zero/Day 1")), "b.mp4");
    } finally {
        PItem.prototype.createBin = realCreate;
    }
});

// ========================================================== After Effects
function AEFolder(name) {
    this.name = name;
    this.id = AEFolder.next++;
    this.items = { length: 0 };
    this.parentFolder = null;
}
AEFolder.next = 1;

section("After Effects", function () {
    CompItem = function (w, h) {
        this.name = "Main Comp"; this.width = w; this.height = h;
        this.frameRate = 25; this.time = 4; this.displayStartTime = 10;
        var comp = this;
        this.layersAdded = [];
        this.layers = {
            add: function (footage) {
                var scale = { value: null, setValue: function (v) { this.value = v; } };
                var layer = {
                    source: footage, startTime: 0, guideLayer: false, scale: scale,
                    property: function () { return { property: function () { return scale; } }; }
                };
                comp.layersAdded.push(layer);
                return layer;
            }
        };
    };
    FolderItem = AEFolder;
    FootageItem = function (file) {
        this.id = AEFolder.next++;
        this.file = file; this.name = file.fsName;
        this.width = file.info ? file.info.width : 0;
        this.height = file.info ? file.info.height : 0;
        this.parentFolder = root;
    };
    FootageItem.prototype.replace = function (file) {
        this.file = file;
        this.name = file.fsName;
        aeReplaced.push(file.fsName);
    };
    ImportOptions = function (file) { this.file = file; };

    var imports = 0;
    var aeReplaced = [];
    var root = new AEFolder("Root");
    var items = { length: 0 };
    function addItem(it) {
        items.length++;
        items[items.length] = it;
    }
    // Only root.items is kept up to date; where an item really is comes from
    // its parentFolder, as in After Effects (see aeKids).
    items.addFolder = function (name) {
        var f = new AEFolder(name);
        f.parentFolder = root;
        addItem(f);
        root.items.length++;
        root.items[root.items.length] = f;
        return f;
    };
    function aeKids(folder) {
        var names = [];
        for (var i = 1; i <= items.length; i++) {
            if (items[i].parentFolder === folder) names.push(items[i] instanceof AEFolder ? items[i].name + "/" : (items[i].file ? items[i].file.fsName.replace(/^.*\\/, "") : items[i].name));
        }
        return names.join(",");
    }
    function aeFolder(parent, name) {
        for (var i = 1; i <= items.length; i++) {
            if (items[i] instanceof AEFolder && items[i].parentFolder === parent && items[i].name === name) return items[i];
        }
        return null;
    }
    var comp = new CompItem(1920, 1080);
    app = {
        project: {
            file: null,
            name: "Untitled Project",
            items: items,
            rootFolder: root,
            activeItem: comp,
            importFile: function (io) {
                if (!io.file.exists) throw new Error("File not found");
                if (/\.heic$/i.test(io.file.fsName)) throw new Error("Unsupported");
                imports++;
                var footage = new FootageItem(io.file);
                addItem(footage);
                return footage;
            }
        },
        beginUndoGroup: function () { undoDepth++; undoGroups++; },
        endUndoGroup: function () { undoDepth--; }
    };
    timeToCurrentFormat = function (t, fps) { return "TC" + t + "@" + fps; };

    eq("ae: host detected", LazyKickHost.getHostName(), "ae");
    eq("ae: unsaved project id is stable", getProjectPath(), "ae|unsaved|untitled");
    addItem({ name: "something" });
    eq("ae: id unchanged after an import", getProjectPath(), "ae|unsaved|untitled");
    eq("ae: no folder for unsaved", getProjectFolder(), "NO_PROJECT");

    eq("ae timecode: display start + project format", parse(getCurrentTimecode()).timecode, "TC14@25");

    existingFiles = {};
    existingFiles[norm("D:/Shots/big.png")] = { width: 3840, height: 2160 };
    existingFiles[norm("D:/Shots/small.png")] = { width: 400, height: 300 };

    var r = parse(importPastedImage("D:/Shots/big.png", true, true, "Pasted Images"));
    check("ae paste: ok", r.ok === true, r.msg);
    eq("ae paste: placed", r.placedOnTimeline, true);
    var layer = comp.layersAdded[0];
    eq("ae paste: at CTI", layer.startTime, 4);
    eq("ae paste: guide layer", layer.guideLayer, true);
    eq("ae paste: scaled to fit", layer.scale.value && layer.scale.value.join(","), "50,50");
    eq("ae paste: undo balanced", undoDepth, 0);
    eq("ae paste: folder created", root.items.length >= 1 && root.items[1].name, "Pasted Images");

    var again = parse(importPastedImage("D:/Shots/big.png", true, true, "Pasted Images"));
    eq("ae paste again: reused", again.reused, true);
    eq("ae paste again: imported once", imports, 1);

    parse(importPastedImage("D:/Shots/small.png", false, true, "Pasted Images"));
    eq("ae paste small: never enlarged", comp.layersAdded[2].scale.value, null);
    eq("ae paste small: guide off", comp.layersAdded[2].guideLayer, false);

    app.project.activeItem = null;
    existingFiles[norm("D:/Shots/third.png")] = { width: 10, height: 10 };
    var noComp = parse(importPastedImage("D:/Shots/third.png", true, false, "Refs"));
    eq("ae no comp: ok but not placed", noComp.ok + ":" + noComp.placedOnTimeline, "true:false");

    existingFiles[norm("D:/Media/a.mp4")] = {};
    existingFiles[norm("D:/Media/c.heic")] = {};
    var groupsBefore = undoGroups;
    var s = parse(importFilesToBin("SFX", '["D:/Media/a.mp4","D:/Media/c.heic","D:/Media/gone.wav"]', "ae|unsaved|untitled"));
    eq("ae sync: imported", s.importedFiles.join("|"), "D:/Media/a.mp4");
    eq("ae sync: failed", s.failedFiles.join("|"), "D:/Media/gone.wav|D:/Media/c.heic");
    eq("ae sync: one undo step", undoGroups - groupsBefore, 1);
    eq("ae sync: undo balanced", undoDepth, 0);

    // a.mp4 is in the project now; c2.mov is new.
    existingFiles[norm("D:/Media/c2.mov")] = {};
    var importsBefore = imports;
    var ex = parse(importFilesToBin("SFX", '["D:/MEDIA/A.MP4","D:/Media/c2.mov"]', "ae|unsaved|untitled"));
    eq("ae existing: reported", ex.existingFiles.join("|"), "D:/MEDIA/A.MP4");
    eq("ae existing: new one imported", ex.importedFiles.join("|"), "D:/Media/c2.mov");
    eq("ae existing: one import", imports - importsBefore, 1);
    var allThere = parse(importFilesToBin("Never Made", '["D:/Media/a.mp4","D:/Media/c2.mov"]', "ae|unsaved|untitled"));
    eq("ae all existing: none imported", allThere.imported + ":" + allThere.existing + ":" + allThere.failed, "0:2:0");
    eq("ae all existing: still one import", imports - importsBefore, 1);
    var madeFolder = false;
    for (var rf = 1; rf <= root.items.length; rf++) {
        if (root.items[rf].name === "Never Made") madeFolder = true;
    }
    eq("ae all existing: no empty folder made", madeFolder, false);
    eq("ae existing: undo balanced", undoDepth, 0);

    // ---- mirrored folders
    var shots = ["D:/Shoot/a.mp4", "D:/Shoot/Day 1/b.mp4", "D:/Shoot/Day 1/Cam A/c.mp4", "D:/Shoot/Day 2/d.mp4"];
    for (var sh = 0; sh < shots.length; sh++) existingFiles[norm(shots[sh])] = {};
    groupsBefore = undoGroups;
    var mirror = parse(syncWatchBin("Footage", payload("D:/Shoot", true, [
        ["D:/Shoot/Day 1/Cam A/c.mp4", "Day 1/Cam A", true],
        ["D:/Shoot/Day 1/b.mp4", "Day 1", true],
        ["D:/Shoot/a.mp4", "", true]
    ]), "ae|unsaved|untitled"));
    eq("ae mirror: imported", mirror.imported + ":" + mirror.failed + ":" + mirror.moved, "3:0:0");
    var aeFootage = aeFolder(root, "Footage");
    var aeDay1 = aeFolder(aeFootage, "Day 1");
    eq("ae mirror: Footage", aeKids(aeFootage), "Day 1/,a.mp4");
    eq("ae mirror: Day 1", aeKids(aeDay1), "Cam A/,b.mp4");
    eq("ae mirror: Cam A", aeKids(aeFolder(aeDay1, "Cam A")), "c.mp4");
    eq("ae mirror: one undo step", undoGroups - groupsBefore, 1);

    // d.mp4 imported by an older version straight into Footage; x.mp4 dragged out by the user.
    var flat = app.project.importFile(new ImportOptions(new File("D:/Shoot/Day 2/d.mp4")));
    flat.parentFolder = aeFootage;
    existingFiles[norm("D:/Shoot/Day 2/x.mp4")] = {};
    var dragged = app.project.importFile(new ImportOptions(new File("D:/Shoot/Day 2/x.mp4")));
    var sorted = parse(syncWatchBin("Footage", payload("D:/Shoot", true, [
        ["D:/Shoot/Day 1/Cam A/c.mp4", "Day 1/Cam A"],
        ["D:/Shoot/Day 1/b.mp4", "Day 1"],
        ["D:/Shoot/Day 2/d.mp4", "Day 2"],
        ["D:/Shoot/Day 2/x.mp4", "Day 2"],
        ["D:/Shoot/a.mp4", ""]
    ]), "ae|unsaved|untitled"));
    eq("ae arrange: one moved", sorted.moved + ":" + sorted.imported, "1:0");
    eq("ae arrange: into Footage/Day 2", flat.parentFolder.name + "<" + flat.parentFolder.parentFolder.name, "Day 2<Footage");
    eq("ae arrange: dragged-out item stays at the root", dragged.parentFolder === root, true);

    // Moved on disk: Replace Footage instead of a second import.
    existingFiles[norm("D:/Shoot/Day 3/b.mp4")] = {};
    delete existingFiles[norm("D:/Shoot/Day 1/b.mp4")];
    var bItem = null;
    for (var bi = 1; bi <= items.length; bi++) {
        if (items[bi].file && /Day 1\\b\.mp4$/.test(items[bi].file.fsName)) bItem = items[bi];
    }
    var importsNow = imports;
    var aeRelink = parse(syncWatchBin("Footage", payload("D:/Shoot", false, [["D:/Shoot/Day 3/b.mp4", "Day 3", true]]), "ae|unsaved|untitled"));
    eq("ae relink: counted", aeRelink.relinked + ":" + aeRelink.imported, "1:0");
    eq("ae relink: no import", imports, importsNow);
    eq("ae relink: same item replaced", bItem && bItem.file.fsName, "D:\\Shoot\\Day 3\\b.mp4");
    eq("ae relink: moved into Footage/Day 3", bItem && bItem.parentFolder.name + "<" + bItem.parentFolder.parentFolder.name, "Day 3<Footage");
    eq("ae mirror: undo balanced", undoDepth, 0);

    // ---- the folder's existing bin: two "03. Videos" folders become one
    AEFolder.prototype.remove = function () {
        var kept = [];
        for (var i = 1; i <= items.length; i++) if (items[i] !== this) kept.push(items[i]);
        for (var j = 1; j <= items.length; j++) delete items[j];
        items.length = 0;
        for (var k = 0; k < kept.length; k++) addItem(kept[k]);
        aeRemoved.push(this.name);
    };
    var aeRemoved = [];
    var vids = ["D:/Proj/03. Videos/01. Desktop/chunk-01.mp4", "D:/Proj/03. Videos/01. Desktop/chunk-02.mp4", "D:/Proj/03. Videos/02. Smartphone/chunk-01-4x5.mp4"];
    for (var vf = 0; vf < vids.length; vf++) existingFiles[norm(vids[vf])] = {};
    function footageIn(folder, filePath) {
        var it = app.project.importFile(new ImportOptions(new File(filePath)));
        it.parentFolder = folder;
        return it;
    }
    function folderIn(parent, name) {
        var fo = items.addFolder(name);
        fo.parentFolder = parent;
        return fo;
    }
    var oldVideos = folderIn(root, "03. Videos");
    footageIn(oldVideos, vids[0]);
    footageIn(oldVideos, vids[2]);
    var aeComp = { name: "Main Comp", parentFolder: oldVideos };   // a comp kept in that folder
    addItem(aeComp);
    var madeVideos = folderIn(root, "03. Videos");
    footageIn(folderIn(madeVideos, "01. Desktop"), vids[1]);
    var twinFiles = [];
    twinFiles.push([vids[0], "01. Desktop"], [vids[1], "01. Desktop"], [vids[2], "02. Smartphone"]);
    var aeTwins = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, twinFiles), "ae|unsaved|untitled"));
    check("ae twins: ok", aeTwins.ok === true, aeTwins.msg);
    var videosLeft = 0;
    for (var vl = 1; vl <= items.length; vl++) if (items[vl] instanceof AEFolder && items[vl].parentFolder === root && items[vl].name === "03. Videos") videosLeft++;
    eq("ae twins: one '03. Videos' folder left", videosLeft, 1);
    eq("ae twins: the emptied copy removed", aeRemoved.join(","), "03. Videos");
    eq("ae twins: the user's folder kept, comp included", aeKids(oldVideos).split(",").sort().join(","), "01. Desktop/,02. Smartphone/,Main Comp");
    eq("ae twins: the comp stays in it", aeComp.parentFolder === oldVideos, true);
    eq("ae twins: Desktop sorted", aeKids(aeFolder(oldVideos, "01. Desktop")).split(",").sort().join(","), "chunk-01.mp4,chunk-02.mp4");
    eq("ae twins: Smartphone sorted", aeKids(aeFolder(oldVideos, "02. Smartphone")), "chunk-01-4x5.mp4");
    eq("ae twins: reported", aeTwins.merged + ":" + aeTwins.rootPath, "1:03. Videos");
    eq("ae twins: undo balanced", undoDepth, 0);

    app.project.file = new File("D:/Work/Promo.aep");
    eq("ae: saved id", getProjectPath(), "ae|saved|D:\\Work\\Promo.aep");
    var info = parse(getProjectInfo());
    eq("ae info: name", info.name, "Promo.aep");
    check("ae info: version reported", /^\d+\.\d+\.\d+$/.test(info.version) && info.version === LazyKickHost.VERSION, info.version);
    var refused = parse(importFilesToBin("SFX", '["D:/Media/a.mp4"]', "ae|unsaved|untitled"));
    eq("ae sync: refused after project changed", refused.projectChanged, true);
});

// ======================================= Premiere Pro: the folder's existing bin
function binsNamed(parent, name) {
    var n = 0;
    for (var i = 0; i < parent.children.numItems; i++) if (parent.children[i].type === 2 && parent.children[i].name === name) n++;
    return n;
}
function binIn(parent, name) {
    for (var i = 0; i < parent.children.numItems; i++) if (parent.children[i].type === 2 && parent.children[i].name === name) return parent.children[i];
    return null;
}
var VID = "D:\\Proj\\03. Videos";
function videoFiles(newOnes) {
    var list = [
        ["D:/Proj/03. Videos/01. Desktop/chunk-01.mp4", "01. Desktop"],
        ["D:/Proj/03. Videos/01. Desktop/chunk-02.mp4", "01. Desktop"],
        ["D:/Proj/03. Videos/02. Smartphone/chunk-01-4x5.mp4", "02. Smartphone"],
        ["D:/Proj/03. Videos/02. Smartphone/chunk-02-4x5.mp4", "02. Smartphone"]
    ];
    for (var i = 0; i < list.length; i++) if (newOnes && newOnes[list[i][0].replace(/^.*\//, "")]) list[i].push(true);
    return list;
}

function existingBinSection(noNodeIds) {
    var tag = noNodeIds ? " (no nodeId)" : "";
    ppro.noNodeIds = noNodeIds;
    existingFiles = {};
    var all = videoFiles();
    for (var f = 0; f < all.length; f++) existingFiles[norm(all[f][0])] = {};

    // What 1.3 left: the user's own "03. Videos" (flat) and a second one it made beside it.
    setupPremiere([new PTrack(false, [])], 0);
    var root = app.project.rootItem;
    var old = root.createBin("03. Videos");
    clip(old, VID + "\\01. Desktop\\chunk-01.mp4");
    clip(old, VID + "\\02. Smartphone\\chunk-01-4x5.mp4");
    clip(old, "D:\\Old\\chunk-02-v2.mp4");             // not in the folder any more
    addChild(old, new PItem(1, "Edit v1", "", 0));      // a sequence
    var made = root.createBin("03. Videos");
    clip(made.createBin("01. Desktop"), VID + "\\01. Desktop\\chunk-02.mp4");
    clip(made.createBin("02. Smartphone"), VID + "\\02. Smartphone\\chunk-02-4x5.mp4");
    addChild(made, new PItem(1, "Rough cut", "", 0));   // a sequence made in the copy
    var r = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, videoFiles()), PPRO_ID));
    check("twins" + tag + ": ok", r.ok === true, r.msg);
    eq("twins" + tag + ": one '03. Videos' left", binsNamed(root, "03. Videos"), 1);
    eq("twins" + tag + ": the emptied copy deleted, nothing else", ppro.deleted.join(","), "03. Videos");
    eq("twins" + tag + ": reported", r.merged + ":" + r.rootPath, "1:03. Videos");
    var videos = binIn(root, "03. Videos");
    eq("twins" + tag + ": the user's bin kept, with its leftovers and the copy's sequence", videos === old && pproKids(old), "chunk-02-v2.mp4,Edit v1,01. Desktop/,02. Smartphone/,Rough cut");
    eq("twins" + tag + ": Desktop sorted", pproKids(binIn(old, "01. Desktop")), "chunk-02.mp4,chunk-01.mp4");
    eq("twins" + tag + ": Smartphone sorted", pproKids(binIn(old, "02. Smartphone")), "chunk-02-4x5.mp4,chunk-01-4x5.mp4");

    // First link, the folder's bin nested elsewhere: it becomes the watch bin.
    setupPremiere([new PTrack(false, [])], 0);
    root = app.project.rootItem;
    var assets = root.createBin("Assets");
    var nested = assets.createBin("03. Videos");
    clip(nested, VID + "\\01. Desktop\\chunk-01.mp4");
    clip(nested, VID + "\\02. Smartphone\\chunk-01-4x5.mp4");
    clip(nested, "D:\\Old\\chunk-02-v2.mp4");
    delete existingFiles[norm("D:/Proj/03. Videos/01. Desktop/chunk-02.mp4")];
    existingFiles[norm("D:/Proj/03. Videos/01. Desktop/chunk-02.mp4")] = {};
    var first = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, videoFiles({ "chunk-02.mp4": 1, "chunk-02-4x5.mp4": 1 })), PPRO_ID));
    eq("adopt" + tag + ": no second bin at the top", pproKids(root), "Assets/");
    eq("adopt" + tag + ": watch bin is the existing one", first.adopted + ":" + first.rootPath, "true:Assets/03. Videos");
    eq("adopt" + tag + ": new files imported there", first.imported + ":" + first.failed, "2:0");
    eq("adopt" + tag + ": sorted like the disk", pproKids(nested), "chunk-02-v2.mp4,01. Desktop/,02. Smartphone/");
    eq("adopt" + tag + ": Desktop", pproKids(binIn(nested, "01. Desktop")), "chunk-02.mp4,chunk-01.mp4");
    eq("adopt" + tag + ": Smartphone", pproKids(binIn(nested, "02. Smartphone")), "chunk-02-4x5.mp4,chunk-01-4x5.mp4");
    var again = parse(syncWatchBin("Assets/03. Videos", payload("D:/Proj/03. Videos", true, videoFiles()), PPRO_ID));
    eq("adopt" + tag + ": next sync finds it by its path, nothing to do", again.moved + ":" + again.merged + ":" + again.adopted, "0:0:false");
}

section("Premiere Pro: the folder's existing bin", function () {
    existingBinSection(false);
    existingBinSection(true);

    // No nodeId from Premiere: a new file imported into a sub-bin that already has clips is still seen.
    setupPremiere([new PTrack(false, [])], 0);
    var fullBin = app.project.rootItem.createBin("03. Videos").createBin("01. Desktop");
    clip(fullBin, VID + "\\01. Desktop\\chunk-01.mp4");
    var intoFull = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", false, [["D:/Proj/03. Videos/01. Desktop/chunk-02.mp4", "01. Desktop", true]]), PPRO_ID));
    eq("no nodeId: import into a bin with clips counted right", intoFull.imported + ":" + intoFull.failed + ":" + pproKids(fullBin), "1:0:chunk-01.mp4,chunk-02.mp4");
    ppro.noNodeIds = false;

    existingFiles = {};
    var all = videoFiles();
    for (var f = 0; f < all.length; f++) existingFiles[norm(all[f][0])] = {};
    existingFiles[norm("D:/Other/x.mp4")] = {};

    // Spelled differently (spaces, capitals): still the folder's bin.
    setupPremiere([new PTrack(false, [])], 0);
    var root = app.project.rootItem;
    var odd = root.createBin("Footage").createBin("03.  videos ");
    clip(odd, VID + "\\01. Desktop\\chunk-01.mp4");
    var spelled = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, videoFiles()), PPRO_ID));
    eq("spelling: adopted", spelled.adopted + ":" + spelled.rootPath, "true:Footage/03.  videos ");

    // Same name but none of the folder's media: not the folder's bin.
    setupPremiere([new PTrack(false, [])], 0);
    root = app.project.rootItem;
    var unrelated = root.createBin("Archive").createBin("03. Videos");
    clip(unrelated, "D:\\Other\\x.mp4");
    var fresh = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, videoFiles({ "chunk-01.mp4": 1 })), PPRO_ID));
    eq("unrelated: a new watch bin at its own path", fresh.adopted + ":" + fresh.rootPath + ":" + pproKids(root), "false:03. Videos:Archive/,03. Videos/");
    eq("unrelated: left alone", pproKids(unrelated), "x.mp4");

    // Copies elsewhere: folded in only when they hold nothing but the folder's media.
    setupPremiere([new PTrack(false, [])], 0);
    root = app.project.rootItem;
    var watch = root.createBin("03. Videos");
    clip(watch.createBin("01. Desktop"), VID + "\\01. Desktop\\chunk-02.mp4");
    var pure = root.createBin("Old Import").createBin("03. Videos");
    clip(pure, VID + "\\01. Desktop\\chunk-01.mp4");
    var mixed = root.createBin("Client").createBin("03. Videos");
    clip(mixed, VID + "\\02. Smartphone\\chunk-01-4x5.mp4");
    clip(mixed, "D:\\Other\\x.mp4");
    var folded = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, videoFiles()), PPRO_ID));
    eq("copies: only the pure copy folded in", folded.merged + ":" + ppro.deleted.join(","), "1:03. Videos");
    eq("copies: its clip now in the watch bin", pproKids(binIn(watch, "01. Desktop")), "chunk-02.mp4,chunk-01.mp4");
    eq("copies: a bin that also holds other work is left alone", pproKids(mixed), "chunk-01-4x5.mp4,x.mp4");

    // Twin sub-bins inside the watch bin become one.
    setupPremiere([new PTrack(false, [])], 0);
    root = app.project.rootItem;
    watch = root.createBin("03. Videos");
    var desk1 = watch.createBin("01. Desktop");
    clip(desk1, VID + "\\01. Desktop\\chunk-01.mp4");
    var desk2 = watch.createBin("01. desktop");
    clip(desk2, VID + "\\01. Desktop\\chunk-02.mp4");
    var twinsInside = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, videoFiles()), PPRO_ID));
    eq("twins inside: one Desktop bin with both clips", twinsInside.merged + ":" + pproKids(watch) + ":" + pproKids(desk1), "1:01. Desktop/:chunk-01.mp4,chunk-02.mp4");

    // A subfolder with the root's own name stays a sub-bin.
    setupPremiere([new PTrack(false, [])], 0);
    root = app.project.rootItem;
    existingFiles[norm("D:/Proj/03. Videos/03. Videos/inner.mp4")] = {};
    watch = root.createBin("03. Videos");
    var inner = watch.createBin("03. Videos");
    clip(inner, VID + "\\03. Videos\\inner.mp4");
    var same = parse(syncWatchBin("03. Videos", payload("D:/Proj/03. Videos", true, [["D:/Proj/03. Videos/03. Videos/inner.mp4", "03. Videos"]]), PPRO_ID));
    eq("inner namesake: not merged into its parent", same.merged + ":" + pproKids(watch) + ":" + pproKids(inner), "0:03. Videos/:inner.mp4");

    // An Auto-Sync import (no sorting) still lands in the folder's existing bin, and merges nothing.
    setupPremiere([new PTrack(false, [])], 0);
    root = app.project.rootItem;
    var assets = root.createBin("Assets");
    var nested = assets.createBin("03. Videos");
    clip(nested, VID + "\\01. Desktop\\chunk-01.mp4");
    var twin = root.createBin("03. Videos");
    clip(twin, VID + "\\02. Smartphone\\chunk-01-4x5.mp4");
    var auto = parse(syncWatchBin("Assets/03. Videos", payload("D:/Proj/03. Videos", false, [["D:/Proj/03. Videos/01. Desktop/chunk-02.mp4", "01. Desktop", true]]), PPRO_ID));
    eq("auto import: into the existing bin's sub-bin", pproKids(binIn(nested, "01. Desktop")), "chunk-02.mp4");
    eq("auto import: nothing merged or sorted", auto.merged + ":" + auto.moved + ":" + pproKids(nested), "0:0:chunk-01.mp4,01. Desktop/");
    eq("auto import: the other bin untouched", pproKids(twin), "chunk-01-4x5.mp4");
});

// ================================================ Premiere Pro: script to audio
var TICKS = 254016000000;
var PRESET_DIR = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\MediaIO\\systempresets\\3F3F3F3F_57415645";
var PRESET = PRESET_DIR + "\\Waveform Audio 48kHz 16-bit.epr";

function PAudioTrack(name, muted, selectedClips) {
    this.name = name;
    this.muted = muted;
    this.clips = { numItems: selectedClips.length };
    for (var i = 0; i < selectedClips.length; i++) {
        this.clips[i] = { sel: selectedClips[i], isSelected: function () { return this.sel; } };
    }
}
PAudioTrack.prototype.isMuted = function () { return this.muted; };
PAudioTrack.prototype.setMute = function (v) { this.muted = !!v; ppro.muteCalls++; };

function setupPremiereAudio(audioTracks) {
    var seq = setupPremiere([new PTrack(false, [])], 0);
    ppro.exports = [];
    ppro.captions = [];
    ppro.muteCalls = 0;
    seq.zeroPoint = String(3600 * TICKS);         // timecode starts at 01:00:00:00
    seq.end = String(3600 * TICKS + 90 * TICKS);
    seq.audioTracks = { numTracks: audioTracks.length };
    for (var i = 0; i < audioTracks.length; i++) seq.audioTracks[i] = audioTracks[i];
    seq.exportAsMediaDirect = function (out, preset, range) {
        var mutes = [];
        for (var t = 0; t < audioTracks.length; t++) mutes.push(audioTracks[t].muted ? "M" : "-");
        ppro.exports.push({ out: out, preset: preset, range: range, mutes: mutes.join("") });
        if (!ppro.exportFails) existingFiles[norm(out)] = {};
        return !ppro.exportFails;
    };
    seq.createCaptionTrack = function (item, start, format) {
        ppro.captions.push({ item: item, start: start, format: format });
        return true;
    };
    app.path = "C:\\Program Files\\Adobe\\Adobe Premiere Pro 2026\\Adobe Premiere Pro.exe";
    return seq;
}

var Sequence = { CAPTION_FORMAT_SUBTITLE: 11 };

section("Premiere Pro: script to audio", function () {
    existingFiles = {};
    existingFolders = {};
    addFolderChain(PRESET_DIR);
    existingFiles[norm(PRESET)] = {};
    ppro.exportFails = false;

    var a1 = new PAudioTrack("A1", false, [false]);
    var a2 = new PAudioTrack("A2", false, [false, true]);   // the voiceover clip is selected
    var a3 = new PAudioTrack("A3", true, [false]);          // muted by the user
    setupPremiereAudio([a1, a2, a3]);

    var ph = parse(getPlayhead());
    eq("ppro playhead: seconds from the sequence start, with fps and offset", ph.ok + ":" + ph.t + ":" + ph.fps + ":" + ph.offset + ":" + ph.name, "true:0:25:3600:Seq 01");
    var info = parse(getTimelineInfo());
    eq("ppro info: sequence", info.ok + ":" + info.name + ":" + info.fps, "true:Seq 01:25");
    eq("ppro info: timecode offset and length", info.offset + ":" + info.duration, "3600:3690");

    var r = parse(getTimelineAudio("C:/Temp/voice.wav"));
    check("ppro audio: ok", r.ok === true, r.msg);
    eq("ppro audio: a WAV", r.kind + ":" + r.path, "wav:C:\\Temp\\voice.wav");
    eq("ppro audio: Premiere's own WAV preset", ppro.exports[0].preset, PRESET);
    eq("ppro audio: the whole sequence", ppro.exports[0].range, 0);
    eq("ppro audio: only the selected clip's track heard", ppro.exports[0].mutes, "M-M");
    eq("ppro audio: reported", r.used, "selected");
    eq("ppro audio: tracks as they were", (a1.muted ? "M" : "-") + (a2.muted ? "M" : "-") + (a3.muted ? "M" : "-"), "--M");
    eq("ppro audio: the user's own mute never touched", ppro.muteCalls, 2);
    eq("ppro audio: timeline facts", r.fps + ":" + r.offset, "25:3600");

    a2.clips[1].sel = false;
    var all = parse(getTimelineAudio("C:/Temp/voice2.wav"));
    eq("ppro audio: nothing selected, everything heard", all.used + ":" + ppro.exports[1].mutes, "all:--M");

    a2.clips[1].sel = true;
    ppro.exportFails = true;
    var failed = parse(getTimelineAudio("C:/Temp/voice3.wav"));
    eq("ppro audio: export failed, said so", failed.ok, false);
    eq("ppro audio: mutes put back after a failure too", (a1.muted ? "M" : "-") + (a2.muted ? "M" : "-") + (a3.muted ? "M" : "-"), "--M");
    ppro.exportFails = false;

    // The preset found by its folder when the file has another name.
    delete existingFiles[norm(PRESET)];
    existingFiles[norm(PRESET_DIR + "\\Custom WAV.epr")] = {};
    var other = parse(getTimelineAudio("C:/Temp/voice4.wav"));
    eq("ppro audio: any preset of the WAV exporter", other.ok && ppro.exports[ppro.exports.length - 1].preset.toLowerCase(), norm(PRESET_DIR + "\\Custom WAV.epr"));
    delete existingFiles[norm(PRESET_DIR + "\\Custom WAV.epr")];
    var none = parse(getTimelineAudio("C:/Temp/voice5.wav"));
    check("ppro audio: no preset, clear message", none.ok === false && /preset/.test(none.msg), none.msg);

    app.project.activeSequence = null;
    eq("ppro audio: no sequence", parse(getTimelineAudio("C:/Temp/x.wav")).msg, "Open a sequence first");
    eq("ppro info: no sequence", parse(getTimelineInfo()).ok, false);
    eq("ppro playhead: no sequence", parse(getPlayhead()).ok, false);

    // Subtitles: the SRT goes into a Subtitles bin and onto a caption track.
    setupPremiereAudio([new PAudioTrack("A1", false, [])]);
    existingFiles[norm("D:/Work/LazyKick Subtitles/Seq 01.srt")] = {};
    var subs = parse(placeSubtitles(JSON.stringify({ srtPath: "D:/Work/LazyKick Subtitles/Seq 01.srt", cues: [] })));
    check("ppro subtitles: ok", subs.ok === true && subs.placed === true, subs.msg);
    eq("ppro subtitles: imported into a Subtitles bin", ppro.imports[0].bin, "Subtitles");
    eq("ppro subtitles: caption track from the imported file", ppro.captions.length && ppro.captions[0].item.mediaPath, "D:\\Work\\LazyKick Subtitles\\Seq 01.srt");
    eq("ppro subtitles: at the sequence start, as subtitles", ppro.captions[0].start + ":" + ppro.captions[0].format, "0:11");

    var seq2 = setupPremiereAudio([]);
    seq2.createCaptionTrack = undefined;
    var older = parse(placeSubtitles(JSON.stringify({ srtPath: "D:/Work/LazyKick Subtitles/Seq 01.srt" })));
    check("ppro subtitles: older Premiere, left in the bin with a hint", older.ok === true && older.placed === false && /drag/.test(older.msg), older.msg);
    var missing = parse(placeSubtitles(JSON.stringify({ srtPath: "D:/Nowhere/none.srt" })));
    eq("ppro subtitles: missing file", missing.ok, false);
});

// ============================================== After Effects: script to audio
section("After Effects: script to audio", function () {
    var fps = 25;
    var comp;
    var commands = [];
    function AELayer(name, loud) {
        this.name = name;
        this.loud = loud;           // loudness at time t, or null for no audio
        this.hasAudio = !!loud;
        this.audioEnabled = !!loud;
        this.inPoint = 0;
        this.outPoint = 0;
        this.index = 0;
    }
    AELayer.prototype.remove = function () {
        for (var i = 0; i < comp.list.length; i++) if (comp.list[i] === this) comp.list.splice(i, 1);
        comp.reindex();
    };
    function TextLayer(box, text) {
        this.box = box;
        var self = this;
        this.doc = { text: text, font: "ArialMT", fontSize: 0, justification: 0 };
        this.position = null;
        this.hasAudio = false;
        this.property = function (name) {
            if (name === "ADBE Text Properties") return { property: function () { return { value: self.doc, setValue: function (d) { self.doc = d; } }; } };
            return { property: function () { return { setValue: function (v) { self.position = v; } }; } };
        };
    }
    TextLayer.prototype.remove = AELayer.prototype.remove;

    CompItem = function () {};
    FolderItem = function () {};
    FootageItem = function () {};
    ImportOptions = function () {};
    ParagraphJustification = { CENTER_JUSTIFY: 7 };
    ComposerEngine = { UNIVERSAL_TYPE_ENGINE: 2 };
    comp = new CompItem();
    comp.name = "Explainer";
    comp.frameRate = fps;
    comp.frameDuration = 1 / fps;
    comp.duration = 10;
    comp.width = 1920;
    comp.height = 1080;
    comp.displayStartTime = 0;
    comp.workAreaStart = 2;
    comp.workAreaDuration = 3;
    comp.list = [];
    comp.selectedLayers = [];
    comp.reindex = function () {
        this.numLayers = this.list.length;
        for (var i = 0; i < this.list.length; i++) this.list[i].index = i + 1;
    };
    comp.layer = function (i) { return this.list[i - 1]; };
    comp.openInViewer = function () { commands.push("view"); };
    comp.layers = {
        addBoxText: function (box, text) {
            var l = new TextLayer(box, text);
            comp.list.unshift(l);
            comp.reindex();
            return l;
        }
    };
    // Voice speaks 1-3 s and 5-8 s; music plays throughout, quieter.
    var voice = new AELayer("Voice", function (t) { return (t >= 1 && t < 3) || (t >= 5 && t < 8) ? 10 : 0; });
    var music = new AELayer("Music", function () { return 1; });
    var title = new AELayer("Title", null);
    comp.list = [title, voice, music];
    comp.reindex();

    app = {
        project: { file: null, activeItem: comp, items: { length: 0 }, rootFolder: {}, importFile: function () {} },
        beginUndoGroup: function () { undoDepth++; undoGroups++; },
        endUndoGroup: function () { undoDepth--; },
        beginSuppressDialogs: function () { commands.push("quiet"); },
        endSuppressDialogs: function () { commands.push("loud"); },
        fonts: { getFontsByPostScriptName: function (n) { return n === "NirmalaUI" ? [{}] : []; } },
        executeCommand: function (id) {
            commands.push(id);
            // Convert Audio to Keyframes: one keyframe a frame over the work area.
            var keys = [];
            for (var f = 0; f < Math.round(comp.workAreaDuration * fps); f++) {
                var t = comp.workAreaStart + f / fps;
                var v = 0;
                for (var i = 0; i < comp.list.length; i++) {
                    var l = comp.list[i];
                    if (l.hasAudio && l.audioEnabled && l.selected) v += l.loud(t); // as in After Effects: selected layers only
                }
                keys.push([t, v]);
            }
            var slider = {
                numKeys: keys.length,
                keyValue: function (k) { return keys[k - 1][1]; },
                keyTime: function (k) { return keys[k - 1][0]; }
            };
            var amp = new AELayer("Audio Amplitude", null);
            amp.property = function () {
                return { numProperties: 3, property: function (n) { return { property: function () { return n === 3 ? slider : null; } }; } };
            };
            comp.list.unshift(amp);
            comp.reindex();
        }
    };

    eq("ae script: host detected", LazyKickHost.getHostName(), "ae");
    comp.time = 2.48;
    var aePh = parse(getPlayhead());
    eq("ae playhead: comp time, fps and start offset", aePh.ok + ":" + aePh.t + ":" + aePh.fps + ":" + aePh.offset + ":" + aePh.name, "true:2.48:25:0:Explainer");
    var info = parse(getTimelineInfo());
    eq("ae info: composition", info.ok + ":" + info.name + ":" + info.fps + ":" + info.duration, "true:Explainer:25:10");

    var groupsBefore = undoGroups;
    // The title (no audio) is selected, as layers often are: still everything is heard.
    comp.selectedLayers = [title];
    title.selected = true;
    var r = parse(getTimelineAudio(""));
    check("ae audio: ok", r.ok === true, r.msg);
    eq("ae audio: the user's selection put back", (title.selected ? "T" : "-") + (voice.selected ? "V" : "-") + (music.selected ? "M" : "-"), "T--");
    eq("ae audio: levels, one a frame over the whole comp", r.kind + ":" + r.values.length + ":" + r.step + ":" + r.start, "levels:250:0.04:0");
    eq("ae audio: the Convert Audio to Keyframes command, dialogs held back", commands.slice(0, 4).join(","), "view,quiet,4218,loud");
    eq("ae audio: everything heard (voice + music)", r.values[25 * 2] + ":" + r.values[25 * 4], "11:1");
    eq("ae audio: helper layer removed", comp.numLayers + ":" + comp.layer(1).name, "3:Title");
    eq("ae audio: work area put back", comp.workAreaStart + ":" + comp.workAreaDuration, "2:3");
    eq("ae audio: one undo step, balanced", (undoGroups - groupsBefore) + ":" + undoDepth, "1:0");
    eq("ae audio: reported", r.used, "all");

    comp.selectedLayers = [voice];
    title.selected = false;
    voice.selected = true;
    var solo = parse(getTimelineAudio(""));
    eq("ae audio: only the selected voice heard", solo.values[25 * 2] + ":" + solo.values[25 * 4], "10:0");
    eq("ae audio: selection put back again", (title.selected ? "T" : "-") + (voice.selected ? "V" : "-") + (music.selected ? "M" : "-"), "-V-");
    eq("ae audio: the music's audio switched back on", music.audioEnabled, true);
    eq("ae audio: reported selected", solo.used, "selected");

    comp.selectedLayers = [title];
    voice.audioEnabled = false;
    music.audioEnabled = false;
    commands = [];
    var silent = parse(getTimelineAudio(""));
    check("ae audio: nothing to hear, said so without running the command", silent.ok === false && commands.length === 0, silent.msg);
    voice.audioEnabled = true;
    music.audioEnabled = true;
    comp.selectedLayers = [];

    // Subtitles as text layers.
    var cues = [
        { s: 1, e: 2.9, t: "Hello and welcome." },
        { s: 5, e: 7.9, t: "\u0986\u09AE\u09BF \u09AC\u09BE\u0982\u09B2\u09BE\u09AF\u09BC \u0995\u09A5\u09BE \u09AC\u09B2\u09BF" },
        { s: 12, e: 13, t: "Past the end" }
    ];
    groupsBefore = undoGroups;
    var subs = parse(placeSubtitles(JSON.stringify({ cues: cues })));
    check("ae subtitles: ok", subs.ok === true, subs.msg);
    eq("ae subtitles: two made, one past the end left out", subs.count + ":" + subs.skipped, "2:1");
    var first = comp.layer(1);
    var second = comp.layer(2);
    eq("ae subtitles: first cue on top", first.doc.text, "Hello and welcome.");
    eq("ae subtitles: timed", first.inPoint + "-" + first.outPoint + " " + second.inPoint + "-" + second.outPoint, "1-2.9 5-7.9");
    eq("ae subtitles: named in order", first.name.substr(0, 6) + "|" + second.name.substr(0, 6), "Sub 01|Sub 02");
    eq("ae subtitles: lower third, centred", first.position.join(","), "960,907");
    eq("ae subtitles: size from the comp height, box 84% wide", first.doc.fontSize + ":" + first.box.join("x"), "49:1613x167");
    eq("ae subtitles: white with an outline, centred text", first.doc.fillColor.join(",") + "|" + first.doc.applyStroke + "|" + first.doc.justification, "1,1,1|true|7");
    eq("ae subtitles: English keeps the default font", first.doc.font, "ArialMT");
    eq("ae subtitles: Bengali gets a Bengali font and the Universal engine", second.doc.font + ":" + second.doc.composerEngine, "NirmalaUI:2");
    eq("ae subtitles: one undo step, balanced", (undoGroups - groupsBefore) + ":" + undoDepth, "1:0");

    app.project.activeItem = null;
    eq("ae subtitles: no comp", parse(placeSubtitles(JSON.stringify({ cues: cues }))).msg, "Open a composition first");
    eq("ae audio: no comp", parse(getTimelineAudio("")).msg, "Open a composition first");
    eq("ae playhead: no comp", parse(getPlayhead()).ok, false);
});

// ------------------------------------------------------------------ report
WScript.Echo("LazyKick - host.jsx tests");
WScript.Echo("");
for (var f = 0; f < failures.length; f++) WScript.Echo("  FAIL " + failures[f]);
WScript.Echo((failures.length ? "" : "  ") + passed + " passed, " + failures.length + " failed");
WScript.Quit(failures.length ? 1 : 0);
