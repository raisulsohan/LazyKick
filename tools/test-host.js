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
PItem.prototype.getInPoint = function () { return { seconds: 0 }; };
PItem.prototype.getOutPoint = function () { return { seconds: this.duration }; };

function addChild(bin, item) {
    bin.children[bin.children.numItems] = item;
    bin.children.numItems++;
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
});

// ========================================================== After Effects
function AEFolder(name) {
    this.name = name;
    this.items = { length: 0 };
}

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
        this.file = file; this.name = file.fsName;
        this.width = file.info ? file.info.width : 0;
        this.height = file.info ? file.info.height : 0;
        this.parentFolder = null;
    };
    ImportOptions = function (file) { this.file = file; };

    var imports = 0;
    var root = new AEFolder("Root");
    var items = { length: 0 };
    function addItem(it) {
        items.length++;
        items[items.length] = it;
    }
    items.addFolder = function (name) {
        var f = new AEFolder(name);
        addItem(f);
        root.items.length++;
        root.items[root.items.length] = f;
        return f;
    };
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
    eq("ae sync: failed", s.failedFiles.join("|"), "D:/Media/c.heic|D:/Media/gone.wav");
    eq("ae sync: one undo step", undoGroups - groupsBefore, 1);
    eq("ae sync: undo balanced", undoDepth, 0);

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
