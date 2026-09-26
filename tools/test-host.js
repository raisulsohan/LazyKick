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

function File(p) {
    this.fsName = String(p).replace(/\//g, "\\");
    var info = existingFiles[norm(p)];
    this.exists = !!info;
    this.info = info;
    var cut = this.fsName.lastIndexOf("\\");
    this.name = this.fsName.substr(cut + 1).replace(/ /g, "%20");
    this.parent = { fsName: this.fsName.substr(0, cut) };
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
    this.nodeId = "node" + (PItem.next++);
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
            if (items[i].parentFolder === folder) names.push(items[i] instanceof AEFolder ? items[i].name + "/" : items[i].file.fsName.replace(/^.*\\/, ""));
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

    app.project.file = new File("D:/Work/Promo.aep");
    eq("ae: saved id", getProjectPath(), "ae|saved|D:\\Work\\Promo.aep");
    var info = parse(getProjectInfo());
    eq("ae info: name", info.name, "Promo.aep");
    check("ae info: version reported", /^\d+\.\d+\.\d+$/.test(info.version) && info.version === LazyKickHost.VERSION, info.version);
    var refused = parse(importFilesToBin("SFX", '["D:/Media/a.mp4"]', "ae|unsaved|untitled"));
    eq("ae sync: refused after project changed", refused.projectChanged, true);
});

// ------------------------------------------------------------------ report
WScript.Echo("LazyKick - host.jsx tests");
WScript.Echo("");
for (var f = 0; f < failures.length; f++) WScript.Echo("  FAIL " + failures[f]);
WScript.Echo((failures.length ? "" : "  ") + passed + " passed, " + failures.length + " failed");
WScript.Quit(failures.length ? 1 : 0);
