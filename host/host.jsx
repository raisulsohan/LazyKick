/*
========================================================================
  Script Name: LazyKick Host Engine
  Author: Raisul Sohan (raisulsohan.com)
  Developed By: RaisulSohan
  Description: Unified backend host script for After Effects & Premiere Pro.
               Powers Notes & Tasks, Watch Bins and LazyPaste.
  Copyright (c) 2026 Raisul Sohan. Free and open source under the MIT License.
========================================================================

  Everything here is ExtendScript (ES3): no trailing commas, no Array
  indexOf, no reserved words as property names. `tools/check-extendscript.js`
  checks this file and `tools/test-host.js` runs it against mocked hosts.
*/

// ---------- Minimal JSON Safety Net ----------
if (typeof JSON === "undefined" || !JSON.stringify) {
    JSON = (typeof JSON !== "undefined") ? JSON : {};
    JSON.stringify = JSON.stringify || function (o) {
        if (o === null || o === undefined) return "null";
        var t = typeof o;
        if (t === "number" || t === "boolean") return String(o);
        if (t === "string") return '"' + o.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t") + '"';
        if (o instanceof Array) {
            var a = [];
            for (var i = 0; i < o.length; i++) a.push(JSON.stringify(o[i]));
            return "[" + a.join(",") + "]";
        }
        if (t === "object") {
            var p = [];
            for (var k in o) if (o.hasOwnProperty(k)) p.push('"' + k + '":' + JSON.stringify(o[k]));
            return "{" + p.join(",") + "}";
        }
        return "null";
    };
    JSON.parse = JSON.parse || function (s) { return eval("(" + s + ")"); };
}

var LazyKickHost = (function () {
    "use strict";

    var VERSION = "1.6.0";
    var PASTE_BIN_DEFAULT = "Pasted Images";
    var TIME_EPSILON = 0.0005; // seconds; clip edges and the playhead are floats

    function reply(ok, msg, extra) {
        var o = { ok: ok, msg: msg, developer: "RaisulSohan" };
        if (extra) {
            for (var k in extra) {
                if (extra.hasOwnProperty(k)) o[k] = extra[k];
            }
        }
        return JSON.stringify(o);
    }

    function isWindows() {
        try { return $.os.toLowerCase().indexOf("windows") !== -1; } catch (e) { return false; }
    }

    // ============================================================
    // Host Detection
    // ============================================================
    function isAE() {
        try {
            return typeof CompItem !== "undefined"
                && typeof FolderItem !== "undefined"
                && typeof app.project.importFile === "function";
        } catch (e) { return false; }
    }

    function isPPRO() {
        try {
            return app.project
                && app.project.rootItem
                && typeof app.project.importFiles === "function";
        } catch (e) { return false; }
    }

    function getHostName() {
        if (isAE()) return "ae";
        if (isPPRO()) return "ppro";
        return "unknown";
    }

    // ============================================================
    // Paths & Names
    // ============================================================

    /** Compare media paths the way the file system does. */
    function normalizeMediaPath(p) {
        var s = String(p || "").replace(/\\/g, "/");
        return isWindows() ? s.toLowerCase() : s;
    }

    /**
     * Turn whatever was typed as a bin/folder name into "A/B/C": no empty or
     * "."/".." segments and none of the characters Windows refuses in names,
     * so a typed name can never point outside the project folder.
     */
    function sanitizeBinPath(pathStr, fallback) {
        var parts = String(pathStr || "").split(/[\/\\]/);
        var clean = [];
        for (var i = 0; i < parts.length; i++) {
            var seg = parts[i].replace(/[<>:"|?*\x00-\x1f]/g, "_").replace(/^\s+|\s+$/g, "");
            if (!seg || seg === "." || seg === "..") continue;
            clean.push(seg);
        }
        return clean.length ? clean.join("/") : (fallback || "");
    }

    // ============================================================
    // Project Identification & Path
    // ============================================================
    function savedProjectPath() {
        var savedPath = "";
        try {
            if (app.project.file && app.project.file.fsName) {
                savedPath = String(app.project.file.fsName);
            }
        } catch (e1) {}
        if (!savedPath) {
            try {
                if (typeof app.project.path === "string" && app.project.path.length > 0) {
                    savedPath = app.project.path;
                }
            } catch (e2) {}
        }
        return savedPath;
    }

    function getProjectPath() {
        try {
            var appTag = getHostName();
            if (!app.project) return appTag + "|none|";

            var savedPath = savedProjectPath();
            if (savedPath) return appTag + "|saved|" + savedPath;

            // Unsaved in PPro: every document carries a stable ID of its own.
            try {
                if (typeof app.project.documentID === "string" && app.project.documentID.length > 0) {
                    return appTag + "|unsaved|" + app.project.documentID;
                }
            } catch (e3) {}

            // Unsaved in AE: there is one untitled project at a time. v1.0
            // fingerprinted it by item count, so every import looked like a new
            // project and the panel's notes and bins vanished mid-session.
            return appTag + "|unsaved|untitled";
        } catch (err) {
            return "error|none|" + err.toString();
        }
    }

    function getProjectFolder() {
        try {
            var savedPath = savedProjectPath();
            if (!savedPath) return "NO_PROJECT";
            return new File(savedPath).parent.fsName;
        } catch (e) {
            return "NO_PROJECT";
        }
    }

    function getProjectInfo() {
        try {
            var host = getHostName();
            if (host === "unknown") return reply(false, "Unsupported host application", { host: host, version: VERSION });
            if (!app.project) return reply(false, "No project open", { host: host, version: VERSION });

            var savedPath = savedProjectPath();
            var projName = "Untitled";
            if (savedPath) {
                projName = new File(savedPath).name;
                try { projName = decodeURI(projName); } catch (eName) {}
            } else if (app.project.name) {
                projName = app.project.name;
            }

            return reply(true, "OK", {
                host: host,
                saved: !!savedPath,
                path: savedPath,
                name: projName,
                fullId: getProjectPath(),
                version: VERSION
            });
        } catch (e) {
            return reply(false, "Error: " + e.toString());
        }
    }

    // ============================================================
    // Timecode Engine
    // ============================================================
    function padZero(num, size) {
        var s = "000000000" + num;
        return s.substr(s.length - (size || 2));
    }

    /**
     * HH:MM:SS:FF from seconds. Frames are counted with Math.round so a
     * playhead stored as 1.9999999 reads as the frame it is on, not the one
     * before. Fractional rates (29.97) count in whole frames of the nominal
     * rate, as non-drop-frame timecode does.
     */
    function formatFramesTimecode(seconds, fps) {
        var nominal = Math.round(fps) || 30;
        var totalFrames = Math.max(0, Math.round(seconds * fps));
        var frames = totalFrames % nominal;
        var totalSecs = Math.floor(totalFrames / nominal);
        var hours = Math.floor(totalSecs / 3600);
        var minutes = Math.floor((totalSecs % 3600) / 60);
        var secs = totalSecs % 60;
        return padZero(hours, 2) + ":" + padZero(minutes, 2) + ":" + padZero(secs, 2) + ":" + padZero(frames, 2);
    }

    /** Premiere's frame rate in frames per second, from the ticks-per-frame timebase. */
    function sequenceFps(seq) {
        try {
            var ticksPerFrame = Number(seq.timebase);
            if (ticksPerFrame > 0) return 254016000000 / ticksPerFrame;
        } catch (e) {}
        return 30;
    }

    function getCurrentTimecode() {
        try {
            if (isAE()) {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    return reply(false, "No active composition found");
                }
                var fps = comp.frameRate || 30;
                var t = comp.time;
                try { t += comp.displayStartTime || 0; } catch (eStart) {}

                // Match what the Timeline shows: timecode or frames, with the
                // comp's own start time, as the project is set to display.
                var tc = "";
                try {
                    if (typeof timeToCurrentFormat === "function") tc = String(timeToCurrentFormat(t, fps, false));
                } catch (eFmt) { tc = ""; }
                if (!tc) tc = formatFramesTimecode(t, fps);

                return reply(true, "OK", { timecode: tc, compName: comp.name, fps: fps });
            }

            if (isPPRO()) {
                var seq = app.project.activeSequence;
                if (!seq) {
                    return reply(false, "No active sequence found");
                }
                var pos = seq.getPlayerPosition();
                var tcStr = "";
                if (pos && typeof pos.getFormatted === "function") {
                    var settings = null;
                    try { settings = seq.getSettings(); } catch (eS) {}
                    var formats = [];
                    try { if (settings && settings.videoDisplayFormat !== undefined) formats.push(settings.videoDisplayFormat); } catch (eF1) {}
                    try { if (app.project.timeDisplay !== undefined) formats.push(app.project.timeDisplay); } catch (eF2) {}
                    for (var i = 0; i < formats.length && !tcStr; i++) {
                        try { tcStr = String(pos.getFormatted(settings.videoFrameRate, formats[i]) || ""); } catch (eP) { tcStr = ""; }
                    }
                }
                if (!tcStr && pos) tcStr = formatFramesTimecode(pos.seconds, sequenceFps(seq));
                return reply(true, "OK", { timecode: tcStr, seqName: seq.name });
            }

            return reply(false, "Unknown host application");
        } catch (e) {
            return reply(false, "Failed to get timecode: " + e.toString());
        }
    }

    // ============================================================
    // Bins & Folders
    // ============================================================
    function findOrCreateFolderAE(parentFolder, name) {
        for (var i = 1; i <= parentFolder.items.length; i++) {
            var it = parentFolder.items[i];
            if (it instanceof FolderItem && it.name === name) return it;
        }
        var nf = app.project.items.addFolder(name);
        nf.parentFolder = parentFolder;
        return nf;
    }

    function resolveBinPathAE(pathStr) {
        var current = app.project.rootFolder;
        var clean = sanitizeBinPath(pathStr, "");
        if (!clean) return current;
        var parts = clean.split("/");
        for (var i = 0; i < parts.length; i++) {
            current = findOrCreateFolderAE(current, parts[i]);
        }
        return current;
    }

    function findOrCreateBinPPRO(parentBin, name) {
        for (var i = 0; i < parentBin.children.numItems; i++) {
            var item = parentBin.children[i];
            // ProjectItemType.BIN = 2
            if (item.type === 2 && item.name === name) return item;
        }
        return parentBin.createBin(name);
    }

    function resolveBinPathPPRO(pathStr) {
        var current = app.project.rootItem;
        var clean = sanitizeBinPath(pathStr, "");
        if (!clean) return current;
        var parts = clean.split("/");
        for (var i = 0; i < parts.length; i++) {
            current = findOrCreateBinPPRO(current, parts[i]);
        }
        return current;
    }

    function findFootageAE(fsName) {
        var wanted = normalizeMediaPath(fsName);
        for (var j = 1; j <= app.project.items.length; j++) {
            var it = app.project.items[j];
            try {
                if (it instanceof FootageItem && it.file && normalizeMediaPath(it.file.fsName) === wanted) return it;
            } catch (e) {}
        }
        return null;
    }

    function findMediaItemPPRO(bin, wanted) {
        if (!bin || !bin.children) return null;
        for (var k = 0; k < bin.children.numItems; k++) {
            var cItem = bin.children[k];
            if (cItem.type === 2) {
                var nested = findMediaItemPPRO(cItem, wanted);
                if (nested) return nested;
            } else if (typeof cItem.getMediaPath === "function") {
                try {
                    if (normalizeMediaPath(cItem.getMediaPath()) === wanted) return cItem;
                } catch (eP) {}
            }
        }
        return null;
    }

    /** An item's identity in a bin: its nodeId, or its name and media path if Premiere gives none. */
    function itemKeyPPRO(item) {
        var key = "";
        try { key = item.nodeId ? String(item.nodeId) : ""; } catch (eId) {}
        if (key) return "i" + key;
        var mediaPath = "";
        try { mediaPath = String(item.getMediaPath() || ""); } catch (ePath) {}
        return "n" + item.name + "|" + mediaPath;
    }

    function childIdsPPRO(bin) {
        var ids = {};
        for (var i = 0; i < bin.children.numItems; i++) {
            try { ids[itemKeyPPRO(bin.children[i])] = true; } catch (e) {}
        }
        return ids;
    }

    function newChildrenPPRO(bin, before) {
        var added = [];
        for (var i = 0; i < bin.children.numItems; i++) {
            var c = bin.children[i];
            try { if (!before[itemKeyPPRO(c)]) added.push(c); } catch (e) {}
        }
        return added;
    }

    // ============================================================
    // Premiere Track Placement
    // ============================================================

    /**
     * Pick the lowest unlocked video track that can take a still at the
     * playhead without touching anything already there.
     *
     * trackInfos: [{ locked: Boolean, clips: [{ start: Number, end: Number }] }]
     * A track qualifies when no clip covers the playhead and either nothing
     * starts after it, or the gap before the next clip is at least `duration`
     * seconds (only trusted when duration > 0). Returns the index, or -1.
     */
    function choosePremiereTrack(trackInfos, playhead, duration) {
        for (var i = 0; i < trackInfos.length; i++) {
            var info = trackInfos[i];
            if (!info || info.locked) continue;

            var busy = false;
            var nextStart = -1;
            for (var c = 0; c < info.clips.length; c++) {
                var clip = info.clips[c];
                if (clip.end <= playhead + TIME_EPSILON) continue; // ends before the playhead
                if (clip.start <= playhead + TIME_EPSILON) { busy = true; break; }
                if (nextStart < 0 || clip.start < nextStart) nextStart = clip.start;
            }
            if (busy) continue;
            if (nextStart < 0) return i;
            if (duration > 0 && (nextStart - playhead) >= duration - TIME_EPSILON) return i;
        }
        return -1;
    }

    function trackInfosPPRO(seq) {
        var infos = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
            var track = seq.videoTracks[t];
            var locked = false;
            try { locked = (typeof track.isLocked === "function") ? !!track.isLocked() : false; } catch (eL) {}
            var clips = [];
            for (var c = 0; c < track.clips.numItems; c++) {
                var clip = track.clips[c];
                clips.push({ start: clip.start.seconds, end: clip.end.seconds });
            }
            infos.push({ locked: locked, clips: clips });
        }
        return infos;
    }

    /**
     * How long Premiere will make the still on the timeline, in seconds, or 0
     * when it cannot be told. Stills take the "Default still duration" from
     * Preferences at import, which shows up as the item's in/out range.
     */
    function stillDurationPPRO(item) {
        var d = 0;
        try { d = item.getOutPoint().seconds - item.getInPoint().seconds; } catch (e1) { d = 0; }
        if (!(d > 0)) {
            try { d = item.getOutPoint(1).seconds - item.getInPoint(1).seconds; } catch (e2) { d = 0; }
        }
        return (d > 0 && d <= 3600) ? d : 0;
    }

    function clipPlacedAt(track, item, playheadSeconds) {
        for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            try {
                if (Math.abs(clip.start.seconds - playheadSeconds) <= 0.01 && clip.projectItem && clip.projectItem.nodeId === item.nodeId) {
                    return true;
                }
            } catch (e) {}
        }
        return false;
    }

    /**
     * Put `item` on the lowest free video track at the playhead with an
     * overwrite edit into empty space. v1.0 used insertClip, which pushes every
     * later clip on the track (and sync-locked tracks) to the right.
     */
    function placeOnSequencePPRO(seq, item) {
        var playhead = seq.getPlayerPosition();
        var frame = 1 / sequenceFps(seq);
        var duration = stillDurationPPRO(item);
        // A frame or two of slack: out points are inclusive in some versions.
        var needed = duration > 0 ? duration + frame * 2 : 0;
        var index = choosePremiereTrack(trackInfosPPRO(seq), playhead.seconds, needed);
        if (index < 0) return { placed: false, track: -1 };

        var track = seq.videoTracks[index];
        try {
            track.overwriteClip(item, playhead);
        } catch (eTime) {
            try { track.overwriteClip(item, playhead.seconds); } catch (eSecs) {}
        }
        var placed = clipPlacedAt(track, item, playhead.seconds);
        return { placed: placed, track: index };
    }

    // ============================================================
    // LazyPaste Engine (Clipboard Image to Timeline/Bin)
    // ============================================================
    function importPastedImage(filePath, asGuideLayer, autoFit, binName) {
        try {
            var f = new File(filePath);
            if (!f.exists) return reply(false, "Image file does not exist on disk");
            var binPath = sanitizeBinPath(binName, PASTE_BIN_DEFAULT);

            // ---------- AFTER EFFECTS ----------
            if (isAE()) {
                var footageItem = findFootageAE(f.fsName);
                var reused = !!footageItem;
                var placedAE = false;
                var compName = "";

                app.beginUndoGroup("LazyKick: Paste Image");
                try {
                    if (!footageItem) {
                        footageItem = app.project.importFile(new ImportOptions(f));
                        footageItem.parentFolder = resolveBinPathAE(binPath);
                    }

                    var activeComp = app.project.activeItem;
                    if (activeComp && (activeComp instanceof CompItem)) {
                        var layer = activeComp.layers.add(footageItem);
                        try { layer.startTime = activeComp.time; } catch (eT) {}

                        // Guide layers show in the viewer but never render.
                        if (asGuideLayer) {
                            try { layer.guideLayer = true; } catch (eG) {}
                        }

                        // Only ever scale down, so small images stay pixel-sharp.
                        if (autoFit) {
                            try {
                                var imgW = footageItem.width;
                                var imgH = footageItem.height;
                                if (imgW > 0 && imgH > 0) {
                                    var scaleFactor = Math.min((activeComp.width / imgW) * 100, (activeComp.height / imgH) * 100);
                                    if (scaleFactor < 100) {
                                        layer.property("Transform").property("Scale").setValue([scaleFactor, scaleFactor]);
                                    }
                                }
                            } catch (eS) {}
                        }
                        placedAE = true;
                        compName = activeComp.name;
                    }
                } finally {
                    app.endUndoGroup();
                }

                if (placedAE) {
                    return reply(true, "Layer added to '" + compName + "'", { placedOnTimeline: true, reused: reused, binPath: binPath });
                }
                return reply(true, "No composition open: image is in the '" + binPath + "' folder", { placedOnTimeline: false, reused: reused, binPath: binPath });
            }

            // ---------- PREMIERE PRO ----------
            if (isPPRO()) {
                var targetBin = resolveBinPathPPRO(binPath);
                var newItem = findMediaItemPPRO(app.project.rootItem, normalizeMediaPath(f.fsName));
                var reusedP = !!newItem;

                if (!newItem) {
                    var before = childIdsPPRO(targetBin);
                    app.project.importFiles([f.fsName], true, targetBin, false);
                    var added = newChildrenPPRO(targetBin, before);
                    for (var m = 0; m < added.length && !newItem; m++) {
                        try {
                            if (normalizeMediaPath(added[m].getMediaPath()) === normalizeMediaPath(f.fsName)) newItem = added[m];
                        } catch (eM) {}
                    }
                    if (!newItem && added.length) newItem = added[0];
                }
                if (!newItem) return reply(false, "Premiere Pro did not import the image");

                var activeSeq = app.project.activeSequence;
                if (!activeSeq) {
                    return reply(true, "No sequence open: image is in the '" + binPath + "' bin", { placedOnTimeline: false, reused: reusedP, binPath: binPath });
                }

                var result = placeOnSequencePPRO(activeSeq, newItem);
                if (result.placed) {
                    return reply(true, "Clip placed on V" + (result.track + 1), { placedOnTimeline: true, reused: reusedP, track: result.track + 1, binPath: binPath });
                }
                if (result.track < 0) {
                    return reply(true, "No free video track at the playhead: image is in the '" + binPath + "' bin", { placedOnTimeline: false, reused: reusedP, binPath: binPath });
                }
                return reply(true, "Could not place the clip: image is in the '" + binPath + "' bin", { placedOnTimeline: false, reused: reusedP, binPath: binPath });
            }

            return reply(false, "Unsupported host application");
        } catch (e) {
            return reply(false, "Import error: " + e.toString());
        }
    }

    // ============================================================
    // Watch Bins Engine (Folder-to-Bin Sync)
    // ============================================================
    //
    // A watch bin mirrors its folder: each subfolder on disk becomes a bin of
    // the same name, nested the same way, and media already in the watch bin
    // is moved to the bin its folder maps to. Each sync works on a small model
    // of the project, built once per call, so one piece of logic serves both
    // hosts:
    //
    //   tree.bins[id] = { bin: <FolderItem | bin ProjectItem>, name, parent: id }
    //   tree.kids[id] = [ids of the bins inside it]
    //   tree.media    = [{ item: <FootageItem | ProjectItem>, path, parent: id }]
    //   tree.others   = [{ item, parent: id }]  (comps, sequences: moved when bins merge)
    //
    // plus the host operations create, move, moveBin, removeEmptyBin, relink
    // and importInto.

    var ROOT_ID = "root";

    function fileNameOf(p) {
        var s = String(p || "").replace(/\\/g, "/");
        return s.substr(s.lastIndexOf("/") + 1);
    }

    /** Bin names compared the way people read them: case, and runs of spaces, do not matter. */
    function normName(s) {
        return String(s || "").replace(/\s+/g, " ").replace(/^ | $/g, "").toLowerCase();
    }

    /** How many trailing names two paths share: "D:/A/Day 1/x.mp4" and "E:/Day 1/x.mp4" share 2. */
    function sharedTail(a, b) {
        var x = normalizeMediaPath(a).split("/");
        var y = normalizeMediaPath(b).split("/");
        var n = 0;
        while (n < x.length && n < y.length && x[x.length - 1 - n] === y[y.length - 1 - n]) n++;
        return n;
    }

    /** Keeps the best score seen for `id` and how many times it was seen. */
    function noteBest(best, id, score) {
        var b = best[id];
        if (!b || score > b.score) best[id] = { score: score, count: 1 };
        else if (score === b.score) b.count++;
    }

    function newTree(rootBin) {
        var tree = { bins: {}, kids: {}, media: [], others: [], nextId: 1 };
        tree.bins[ROOT_ID] = { bin: rootBin, name: "", parent: null };
        tree.kids[ROOT_ID] = [];
        return tree;
    }

    /** Ids are made here, not taken from the host, so they are unique whatever the host reports. */
    function addTreeBin(tree, bin, name, parentId) {
        var id = "b" + (tree.nextId++);
        tree.bins[id] = { bin: bin, name: String(name), parent: parentId };
        tree.kids[id] = [];
        if (!tree.kids[parentId]) tree.kids[parentId] = [];
        tree.kids[parentId].push(id);
        return id;
    }

    /** The bin called `name` inside `parentId`: the exact name first, then as people read it. */
    function childBinId(tree, parentId, name) {
        var kids = tree.kids[parentId] || [];
        var wanted = normName(name);
        var loose = null;
        for (var i = 0; i < kids.length; i++) {
            var b = tree.bins[kids[i]];
            if (b.name === name) return kids[i];
            if (loose === null && normName(b.name) === wanted) loose = kids[i];
        }
        return loose;
    }

    /** Id of the bin at "A/B/C" under `fromId` (the project root by default), made on the way when `create` is set; null when it is not there. */
    function resolveTreeBin(tree, pathStr, create, fromId) {
        var clean = sanitizeBinPath(pathStr, "");
        var id = fromId || ROOT_ID;
        if (!clean) return id;
        var parts = clean.split("/");
        for (var i = 0; i < parts.length && id !== null; i++) {
            var next = childBinId(tree, id, parts[i]);
            if (next === null && create) next = tree.create(id, parts[i]);
            id = next;
        }
        return id;
    }

    function insideBin(tree, binId, ancestorId) {
        var id = binId;
        for (var guard = 0; id !== null && id !== undefined && guard < 1000; guard++) {
            if (id === ancestorId) return true;
            id = tree.bins[id] ? tree.bins[id].parent : null;
        }
        return false;
    }

    function binPathOf(tree, id) {
        var names = [];
        for (var guard = 0; id && id !== ROOT_ID && tree.bins[id] && guard < 1000; guard++) {
            names.unshift(tree.bins[id].name);
            id = tree.bins[id].parent;
        }
        return names.join("/");
    }

    function depthOf(tree, id) {
        var d = 0;
        for (var guard = 0; id && id !== ROOT_ID && tree.bins[id] && guard < 1000; guard++) {
            d++;
            id = tree.bins[id].parent;
        }
        return d;
    }

    function detachKid(tree, parentId, id) {
        var kids = tree.kids[parentId] || [];
        for (var i = 0; i < kids.length; i++) {
            if (kids[i] === id) {
                kids.splice(i, 1);
                return;
            }
        }
    }

    function moveTreeBin(tree, id, intoId) {
        tree.moveBin(tree.bins[id].bin, tree.bins[intoId].bin);
        detachKid(tree, tree.bins[id].parent, id);
        tree.bins[id].parent = intoId;
        tree.kids[intoId].push(id);
    }

    /** Deletes a bin only when nothing at all is left in it, in LazyKick's view and in the host's. */
    function removeIfEmpty(tree, id) {
        if ((tree.kids[id] || []).length) return false;
        var i;
        for (i = 0; i < tree.media.length; i++) if (tree.media[i].parent === id) return false;
        for (i = 0; i < tree.others.length; i++) if (tree.others[i].parent === id) return false;
        if (!tree.removeEmptyBin(tree.bins[id].bin)) return false;
        detachKid(tree, tree.bins[id].parent, id);
        delete tree.bins[id];
        delete tree.kids[id];
        return true;
    }

    /**
     * Moves everything in `fromId` into `intoId`: bins with the same name are
     * merged in turn, the rest moves across, and `fromId` is deleted once it
     * is empty. Nothing is ever deleted that still holds anything.
     */
    function mergeBin(tree, fromId, intoId) {
        var kids = (tree.kids[fromId] || []).slice();
        for (var k = 0; k < kids.length; k++) {
            try {
                var same = childBinId(tree, intoId, tree.bins[kids[k]].name);
                if (same !== null) mergeBin(tree, kids[k], same);
                else moveTreeBin(tree, kids[k], intoId);
            } catch (eKid) {}
        }
        var lists = [tree.media, tree.others];
        for (var l = 0; l < lists.length; l++) {
            for (var i = 0; i < lists[l].length; i++) {
                if (lists[l][i].parent !== fromId) continue;
                try { tree.move(lists[l][i], intoId); } catch (eMove) {}
            }
        }
        return removeIfEmpty(tree, fromId);
    }

    /** Two bins of the same name side by side inside the watch bin become one (they mirror one folder). */
    function mergeTwinsWithin(tree, id, out) {
        var kids = (tree.kids[id] || []).slice();
        var first = {};
        for (var k = 0; k < kids.length; k++) {
            if (!tree.bins[kids[k]]) continue;
            var nm = "n" + normName(tree.bins[kids[k]].name);
            if (first.hasOwnProperty(nm)) {
                mergeBin(tree, kids[k], first[nm]);
                out.merged++;
            } else {
                first[nm] = kids[k];
            }
        }
        var after = (tree.kids[id] || []).slice();
        for (var a = 0; a < after.length; a++) mergeTwinsWithin(tree, after[a], out);
    }

    /**
     * The watch bin itself: { id, path } (id null while it does not exist yet).
     *
     * Found at its path first. When there is nothing there yet (a folder just
     * linked), a bin that already holds this folder's media and carries its
     * name (the watch bin's name or the folder's) becomes the watch bin, even
     * nested elsewhere or spelled with other capitals, so linking a folder the
     * project already has never makes a second copy of it.
     *
     * With `merge` (a full sync), copies of it are folded in and deleted once
     * empty: bins of the same name beside it, whatever they hold, and bins of
     * that name elsewhere that hold nothing but this folder's media. A bin
     * that also holds other work is left alone.
     */
    function watchRoot(tree, rootPath, folder, files, merge, out) {
        var clean = sanitizeBinPath(rootPath, "");
        if (!clean) return { id: ROOT_ID, path: "" };
        var root = { id: resolveTreeBin(tree, clean, false), path: clean };
        if (!folder) return root; // the flat 1.2 call goes by path only

        var folderKey = normalizeMediaPath(folder).replace(/\/+$/, "") + "/";
        var listed = {};
        for (var f = 0; f < files.length; f++) listed["n" + fileNameOf(normalizeMediaPath(files[f].p))] = true;

        // How much of this folder's media each bin holds (with its sub-bins),
        // and which bins hold anything else too.
        var ours = {};
        var foreign = {};
        var id;
        var guard;
        for (var m = 0; m < tree.media.length; m++) {
            var key = normalizeMediaPath(tree.media[m].path);
            var mine = key.indexOf(folderKey) === 0 || listed.hasOwnProperty("n" + fileNameOf(key));
            for (id = tree.media[m].parent, guard = 0; id && id !== ROOT_ID && tree.bins[id] && guard < 1000; id = tree.bins[id].parent, guard++) {
                if (mine) ours[id] = (ours[id] || 0) + 1;
                else foreign[id] = true;
            }
        }
        for (var o = 0; o < tree.others.length; o++) {
            for (id = tree.others[o].parent, guard = 0; id && id !== ROOT_ID && tree.bins[id] && guard < 1000; id = tree.bins[id].parent, guard++) foreign[id] = true;
        }

        var names = {};
        names["n" + normName(clean.substr(clean.lastIndexOf("/") + 1))] = true;
        names["n" + normName(fileNameOf(String(folder).replace(/[\\\/]+$/, "")))] = true;
        var namesakes = [];
        for (var b in tree.bins) {
            if (!tree.bins.hasOwnProperty(b) || b === ROOT_ID) continue;
            if (ours[b] && names.hasOwnProperty("n" + normName(tree.bins[b].name))) namesakes.push(b);
        }

        if (root.id === null) {
            var best = null;
            for (var c = 0; c < namesakes.length; c++) {
                var cand = namesakes[c];
                if (best === null || ours[cand] > ours[best] || (ours[cand] === ours[best] && depthOf(tree, cand) < depthOf(tree, best))) best = cand;
            }
            if (best !== null) {
                root.id = best;
                out.adopted = true;
            }
        }
        if (root.id === null) return root;

        if (merge) {
            var parentId = tree.bins[root.id].parent;
            var rootName = normName(tree.bins[root.id].name);
            var copies = [];
            var beside = (tree.kids[parentId] || []).slice();
            for (var s = 0; s < beside.length; s++) {
                if (beside[s] !== root.id && normName(tree.bins[beside[s]].name) === rootName) copies.push(beside[s]);
            }
            for (var n = 0; n < namesakes.length; n++) {
                var other = namesakes[n];
                if (other === root.id || tree.bins[other].parent === parentId || foreign[other]) continue;
                copies.push(other);
            }
            for (var q = 0; q < copies.length; q++) {
                var copy = copies[q];
                // Gone already (merged with another), inside the watch bin now, or holding it.
                if (!tree.bins[copy] || insideBin(tree, copy, root.id) || insideBin(tree, root.id, copy)) continue;
                mergeBin(tree, copy, root.id);
                out.merged++;
            }
        }
        root.path = binPathOf(tree, root.id);
        return root;
    }

    function projectTreeAE() {
        var rootFolder = app.project.rootFolder;
        var tree = newTree(rootFolder);
        var idOf = {}; // After Effects item id -> tree id
        idOf["i" + rootFolder.id] = ROOT_ID;
        function treeIdOf(folder) {
            var t = idOf["i" + folder.id];
            return t === undefined ? ROOT_ID : t;
        }

        // Folders first (one may come after its contents in the flat list), then the rest.
        var count = app.project.items.length;
        var folders = [];
        var j;
        for (j = 1; j <= count; j++) {
            try {
                var it = app.project.items[j];
                if (it instanceof FolderItem) {
                    var fid = "b" + (tree.nextId++);
                    idOf["i" + it.id] = fid;
                    folders.push({ id: fid, item: it });
                }
            } catch (eFolder) {}
        }
        for (var f = 0; f < folders.length; f++) {
            try {
                var parentId = treeIdOf(folders[f].item.parentFolder);
                tree.bins[folders[f].id] = { bin: folders[f].item, name: String(folders[f].item.name), parent: parentId };
                if (!tree.kids[folders[f].id]) tree.kids[folders[f].id] = [];
                if (!tree.kids[parentId]) tree.kids[parentId] = [];
                tree.kids[parentId].push(folders[f].id);
            } catch (eTree) {}
        }
        for (j = 1; j <= count; j++) {
            try {
                var item = app.project.items[j];
                if (item instanceof FolderItem) continue;
                var rec = { item: item, parent: treeIdOf(item.parentFolder) };
                if (item instanceof FootageItem && item.file) {
                    rec.path = String(item.file.fsName);
                    tree.media.push(rec);
                } else {
                    tree.others.push(rec); // comps, solids: moved along when bins merge
                }
            } catch (eItem) {}
        }

        tree.create = function (parentId, name) {
            var folder = app.project.items.addFolder(name);
            folder.parentFolder = tree.bins[parentId].bin;
            var id = addTreeBin(tree, folder, name, parentId);
            idOf["i" + folder.id] = id;
            return id;
        };
        tree.move = function (rec, binId) {
            rec.item.parentFolder = tree.bins[binId].bin;
            rec.parent = binId;
        };
        tree.moveBin = function (folder, into) {
            folder.parentFolder = into;
        };
        tree.removeEmptyBin = function (folder) {
            for (var i = 1; i <= app.project.items.length; i++) {
                try { if (app.project.items[i].parentFolder.id === folder.id) return false; } catch (eScan) {}
            }
            folder.remove();
            return true;
        };
        // Replace Footage: layers using the item follow it to the new file.
        tree.relink = function (rec, newPath) {
            rec.item.replace(new File(newPath));
            return normalizeMediaPath(rec.item.file.fsName) === normalizeMediaPath(newPath);
        };
        tree.importInto = function (targetId, paths, importedFiles, failedFiles) {
            for (var i = 0; i < paths.length; i++) {
                try {
                    var footage = app.project.importFile(new ImportOptions(new File(paths[i])));
                    var binId = targetId();
                    if (binId !== null) footage.parentFolder = tree.bins[binId].bin;
                    importedFiles.push(paths[i]);
                } catch (eImport) {
                    failedFiles.push(paths[i]);
                }
            }
        };
        return tree;
    }

    function projectTreePPRO() {
        var tree = newTree(app.project.rootItem);
        function walk(bin, binId) {
            for (var k = 0; k < bin.children.numItems; k++) {
                try {
                    var c = bin.children[k];
                    if (c.type === 2) {
                        walk(c, addTreeBin(tree, c, c.name, binId));
                        continue;
                    }
                    var mediaPath = "";
                    try { mediaPath = typeof c.getMediaPath === "function" ? String(c.getMediaPath() || "") : ""; } catch (ePath) {}
                    if (mediaPath) tree.media.push({ item: c, path: mediaPath, parent: binId });
                    else tree.others.push({ item: c, parent: binId }); // sequences and the like
                } catch (e) {}
            }
        }
        walk(app.project.rootItem, ROOT_ID);

        tree.create = function (parentId, name) {
            var parent = tree.bins[parentId].bin;
            var known = 0;
            var kids = tree.kids[parentId] || [];
            for (var n = 0; n < kids.length; n++) if (tree.bins[kids[n]].name === name) known++;
            var made = null;
            try { made = parent.createBin(name); } catch (eCreate) { made = null; }
            if (!made || made.type !== 2) {
                // createBin is documented to return 0 when it fails: if a bin
                // by that name appeared anyway, it is the last one.
                made = null;
                var seen = [];
                for (var i = 0; i < parent.children.numItems; i++) {
                    var c = parent.children[i];
                    if (c.type === 2 && c.name === name) seen.push(c);
                }
                if (seen.length > known) made = seen[seen.length - 1];
            }
            return made ? addTreeBin(tree, made, name, parentId) : null;
        };
        tree.move = function (rec, binId) {
            rec.item.moveBin(tree.bins[binId].bin);
            rec.parent = binId;
        };
        tree.moveBin = function (bin, into) {
            bin.moveBin(into);
        };
        // deleteBin takes everything inside with it, so only a bin Premiere
        // itself reports as empty is deleted.
        tree.removeEmptyBin = function (bin) {
            if (!bin.children || bin.children.numItems !== 0) return false;
            bin.deleteBin();
            return true;
        };
        // Relinks the clip itself, so every sequence using it follows.
        tree.relink = function (rec, newPath) {
            var it = rec.item;
            if (typeof it.changeMediaPath !== "function") return false;
            try {
                if (typeof it.canChangeMediaPath === "function" && !it.canChangeMediaPath()) return false;
            } catch (eCan) {}
            it.changeMediaPath(new File(newPath).fsName, true);
            return normalizeMediaPath(it.getMediaPath()) === normalizeMediaPath(newPath);
        };
        tree.importInto = function (targetId, paths, importedFiles, failedFiles) {
            var binId = targetId();
            if (binId === null) {
                for (var f = 0; f < paths.length; f++) failedFiles.push(paths[f]);
                return;
            }
            var targetBin = tree.bins[binId].bin;
            var before = childIdsPPRO(targetBin);
            var batchThrew = false;
            try {
                // suppressUI = true: a layered PSD or AI must not stop a
                // background sync with Premiere's import dialog.
                app.project.importFiles(paths, true, targetBin, false);
            } catch (eBatch) {
                batchThrew = true;
            }

            if (batchThrew) {
                for (var k = 0; k < paths.length; k++) {
                    var beforeOne = childIdsPPRO(targetBin);
                    try { app.project.importFiles([paths[k]], true, targetBin, false); } catch (eOne) {}
                    if (newChildrenPPRO(targetBin, beforeOne).length > 0) importedFiles.push(paths[k]);
                    else failedFiles.push(paths[k]);
                }
                return;
            }

            var added = newChildrenPPRO(targetBin, before);
            if (added.length >= paths.length) {
                for (var a = 0; a < paths.length; a++) importedFiles.push(paths[a]);
                return;
            }
            // Some did not import: match what arrived by path, then by file name.
            var byPath = {};
            var byName = {};
            for (var n = 0; n < added.length; n++) {
                try {
                    var mp = normalizeMediaPath(added[n].getMediaPath());
                    byPath[mp] = true;
                    byName[fileNameOf(mp)] = true;
                } catch (eMp) {}
            }
            for (var v = 0; v < paths.length; v++) {
                var want = normalizeMediaPath(paths[v]);
                if (byPath[want] || byName[fileNameOf(want)]) importedFiles.push(paths[v]);
                else failedFiles.push(paths[v]);
            }
        };
        return tree;
    }

    /**
     * Files that moved to another folder on disk (or whose whole watch folder
     * moved) show up as new files while their old clip goes missing. The clip
     * is pointed at the file's new place instead of importing a second copy,
     * so edits and comps keep using it. Only unambiguous matches relink: the
     * same file name, a missing clip inside the watch bin or from the watch
     * folder, and the longest shared tail of folder names being unique for
     * both the new file and the missing clip. Everything else is imported.
     */
    function relinkMoved(tree, rootId, folder, toAdd, out) {
        var folderKey = folder ? normalizeMediaPath(folder).replace(/\/+$/, "") + "/" : "";
        var watched = rootId !== null && rootId !== ROOT_ID ? rootId : null;

        var newByName = {};
        for (var a = 0; a < toAdd.length; a++) {
            var nk = "n" + fileNameOf(normalizeMediaPath(toAdd[a].p));
            if (!newByName.hasOwnProperty(nk)) newByName[nk] = [];
            newByName[nk].push(a);
        }

        // Missing clips with one of those names, grouped by path: the same
        // file can be in the project more than once.
        var gone = [];
        var goneByPath = {};
        for (var m = 0; m < tree.media.length; m++) {
            var rec = tree.media[m];
            var key = normalizeMediaPath(rec.path);
            var name = "n" + fileNameOf(key);
            if (!newByName.hasOwnProperty(name)) continue;
            var ours = (watched !== null && insideBin(tree, rec.parent, watched)) || (folderKey !== "" && key.indexOf(folderKey) === 0);
            if (!ours) continue;
            var pk = "p" + key;
            if (!goneByPath.hasOwnProperty(pk)) {
                var missing = false;
                try { missing = !(new File(rec.path).exists); } catch (eExists) { missing = false; }
                goneByPath[pk] = missing ? { path: rec.path, name: name, recs: [] } : null;
                if (missing) gone.push(goneByPath[pk]);
            }
            if (goneByPath[pk]) goneByPath[pk].recs.push(rec);
        }
        if (!gone.length) return [];

        var pairs = [];
        var bestNew = {};
        var bestGone = {};
        for (var g = 0; g < gone.length; g++) {
            var sameName = newByName[gone[g].name];
            for (var s = 0; s < sameName.length; s++) {
                var score = sharedTail(toAdd[sameName[s]].p, gone[g].path);
                pairs.push({ a: sameName[s], g: g, score: score });
                noteBest(bestNew, "a" + sameName[s], score);
                noteBest(bestGone, "g" + g, score);
            }
        }

        var relinked = [];
        for (var p = 0; p < pairs.length; p++) {
            var pair = pairs[p];
            var bn = bestNew["a" + pair.a];
            var bg = bestGone["g" + pair.g];
            if (pair.score < 1 || pair.score !== bn.score || bn.count !== 1 || pair.score !== bg.score || bg.count !== 1) continue;
            var entry = toAdd[pair.a];
            var from = gone[pair.g];
            var ok = false;
            for (var r = 0; r < from.recs.length; r++) {
                try {
                    if (tree.relink(from.recs[r], entry.p)) {
                        from.recs[r].path = new File(entry.p).fsName;
                        ok = true;
                    }
                } catch (eRelink) {}
            }
            if (ok) {
                entry.done = true;
                relinked.push(entry);
                out.relinkedFiles.push({ from: from.path, to: entry.p });
            }
        }
        return relinked;
    }

    /**
     * Move media inside the watch bin to the bin its folder maps to, in the
     * order the files are listed, so new bins are made in folder order.
     * Media outside the watch bin stays where the user put it, and the
     * project root is never rearranged.
     */
    function arrangeInto(tree, rootId, files) {
        if (rootId === null || rootId === ROOT_ID || !files.length) return 0;

        var byPath = {};
        for (var m = 0; m < tree.media.length; m++) {
            var rec = tree.media[m];
            if (!insideBin(tree, rec.parent, rootId)) continue;
            var k = "p" + normalizeMediaPath(rec.path);
            if (!byPath.hasOwnProperty(k)) byPath[k] = [];
            byPath[k].push(rec);
        }

        var moved = 0;
        var targets = {};
        for (var i = 0; i < files.length; i++) {
            var recs = byPath["p" + normalizeMediaPath(files[i].p)];
            if (!recs) continue;
            var sub = sanitizeBinPath(files[i].s, "");
            var tk = "b" + normName(sub);
            for (var r = 0; r < recs.length; r++) {
                var want = targets.hasOwnProperty(tk) ? targets[tk] : resolveTreeBin(tree, sub, false, rootId);
                if (want !== null) targets[tk] = want;
                if (want === recs[r].parent) continue;
                if (want === null) {
                    want = resolveTreeBin(tree, sub, true, rootId);
                    if (want === null) continue;
                    targets[tk] = want;
                }
                try {
                    tree.move(recs[r], want);
                    moved++;
                } catch (eMove) {}
            }
        }
        return moved;
    }

    /** A sub-bin of the watch bin that is made (with the watch bin) the first time it is asked for. */
    function subBin(tree, root, sub) {
        var id;
        return function () {
            if (id !== undefined) return id;
            if (root.id === null) root.id = resolveTreeBin(tree, root.path, true);
            id = root.id === null ? null : resolveTreeBin(tree, sub, true, root.id);
            return id;
        };
    }

    /**
     * One watch-bin sync against a project tree.
     *   files    [{ p: path, s: "Sub/Folder" it sits in, n: true when new }]
     *   folder   the watch folder on disk (relinking, finding its bin)
     *   arrange  true (a full sync): fold copies of the watch bin into it and
     *            sort every listed file already in it into its bin; false:
     *            only the files relinked now
     * New files that are already in the project anywhere are left alone.
     */
    function syncTree(tree, rootPath, files, folder, arrange) {
        var out = { importedFiles: [], failedFiles: [], existingFiles: [], relinkedFiles: [], moved: 0, merged: 0, adopted: false, rootPath: "" };
        var inProject = {};
        for (var m = 0; m < tree.media.length; m++) inProject[normalizeMediaPath(tree.media[m].path)] = true;

        var toAdd = [];
        for (var i = 0; i < files.length; i++) {
            var entry = files[i];
            if (!entry.n) continue;
            var f = new File(entry.p);
            var key = normalizeMediaPath(f.fsName);
            if (!f.exists) {
                out.failedFiles.push(entry.p);
            } else if (inProject[key] === true) {
                out.existingFiles.push(entry.p);
            } else {
                inProject[key] = true; // listed twice (other case): imported once
                toAdd.push(entry);
            }
        }

        var root = watchRoot(tree, rootPath, folder, files, arrange, out);
        var relinked = toAdd.length ? relinkMoved(tree, root.id, folder, toAdd, out) : [];

        // One import per bin, in the order the files are listed.
        var groups = [];
        var byBin = {};
        for (var a = 0; a < toAdd.length; a++) {
            if (toAdd[a].done) continue;
            var sub = sanitizeBinPath(toAdd[a].s, "");
            var gk = "b" + normName(sub);
            if (!byBin.hasOwnProperty(gk)) {
                byBin[gk] = { sub: sub, paths: [] };
                groups.push(byBin[gk]);
            }
            byBin[gk].paths.push(toAdd[a].p);
        }
        for (var g = 0; g < groups.length; g++) {
            tree.importInto(subBin(tree, root, groups[g].sub), groups[g].paths, out.importedFiles, out.failedFiles);
        }

        if (arrange && root.id !== null && root.id !== ROOT_ID) mergeTwinsWithin(tree, root.id, out);
        out.moved = arrangeInto(tree, root.id, arrange ? files : relinked);
        out.rootPath = root.id === null ? root.path : binPathOf(tree, root.id);
        return out;
    }

    /**
     * Runs a sync and reports exactly which files went in, which were already
     * in the project, which were relinked and which failed, so the panel only
     * remembers the ones that really are in. `rootPath` is where the watch bin
     * really is (an existing bin may have been taken over). `expectedProjectId`
     * guards against the user switching projects while the panel was
     * scanning: the files are then not dropped into the wrong one.
     */
    function runWatchSync(binPath, files, folder, arrange, expectedProjectId) {
        if (expectedProjectId && getProjectPath() !== expectedProjectId) {
            return reply(false, "The open project changed; sync skipped", { projectChanged: true });
        }
        var host = getHostName();
        var out;
        if (host === "ae") {
            app.beginUndoGroup("LazyKick: Watch Bin Sync");
            try {
                out = syncTree(projectTreeAE(), binPath, files, folder, arrange);
            } finally {
                app.endUndoGroup();
            }
        } else if (host === "ppro") {
            out = syncTree(projectTreePPRO(), binPath, files, folder, arrange);
        } else {
            return reply(false, "Unsupported host");
        }
        return reply(true, "Sync finished", {
            imported: out.importedFiles.length, failed: out.failedFiles.length, existing: out.existingFiles.length,
            relinked: out.relinkedFiles.length, moved: out.moved, merged: out.merged, adopted: out.adopted, rootPath: out.rootPath,
            importedFiles: out.importedFiles, failedFiles: out.failedFiles, existingFiles: out.existingFiles,
            relinkedFiles: out.relinkedFiles
        });
    }

    /**
     * Sync one watch folder into its bin, mirroring its subfolders.
     * payloadJson: { folder: "D:/Footage", arrange: true,
     *                files: [{ p: "D:/Footage/Day 1/a.mp4", s: "Day 1", n: true }] }
     */
    function syncWatchBin(binPath, payloadJson, expectedProjectId) {
        try {
            var payload = ((typeof payloadJson === "string") ? JSON.parse(payloadJson) : payloadJson) || {};
            return runWatchSync(binPath, payload.files || [], payload.folder || "", !!payload.arrange, expectedProjectId);
        } catch (e) {
            return reply(false, "Sync error: " + e.toString());
        }
    }

    /** Import files straight into one bin, without subfolders (the 1.2 call). */
    function importFilesToBin(binPath, filePathsJson, expectedProjectId) {
        try {
            var filePaths = (typeof filePathsJson === "string") ? JSON.parse(filePathsJson) : filePathsJson;
            if (!filePaths || !filePaths.length) {
                return reply(true, "No files to import", { imported: 0, failed: 0, existing: 0, importedFiles: [], failedFiles: [], existingFiles: [] });
            }
            var files = [];
            for (var i = 0; i < filePaths.length; i++) files.push({ p: String(filePaths[i]), s: "", n: true });
            return runWatchSync(binPath, files, "", false, expectedProjectId);
        } catch (e) {
            return reply(false, "Sync error: " + e.toString());
        }
    }

    // ============================================================
    // Script to Audio (voiceover timing and subtitles)
    // ============================================================
    //
    // The panel does the listening (client/align.js); the host only hands it
    // the timeline's audio and places the finished subtitles. Premiere
    // exports the sequence mix to a WAV the panel reads; After Effects has no
    // audio export without the render queue, so its own Convert Audio to
    // Keyframes measures the loudness of every frame instead.

    var TICKS_PER_SECOND = 254016000000;
    var CONVERT_AUDIO_TO_KEYFRAMES = 4218; // Animation > Keyframe Assistant; the same id in every language

    function timelinePPRO() {
        var seq = app.project.activeSequence;
        if (!seq) return null;
        var offset = 0;
        var duration = 0;
        try { offset = Number(seq.zeroPoint) / TICKS_PER_SECOND || 0; } catch (e1) {}
        try { duration = Number(seq.end) / TICKS_PER_SECOND || 0; } catch (e2) {}
        return { seq: seq, name: String(seq.name), fps: sequenceFps(seq), offset: offset, duration: duration };
    }

    function timelineAE() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) return null;
        var offset = 0;
        try { offset = comp.displayStartTime || 0; } catch (e) {}
        return { comp: comp, name: String(comp.name), fps: comp.frameRate || 30, offset: offset, duration: comp.duration };
    }

    /** The open sequence or composition: name, fps, the time its timecode starts at, and length (seconds). */
    function getTimelineInfo() {
        try {
            var host = getHostName();
            var t = host === "ae" ? timelineAE() : (host === "ppro" ? timelinePPRO() : null);
            if (!t) return reply(false, host === "ae" ? "Open a composition first" : "Open a sequence first", { host: host });
            return reply(true, "OK", { host: host, name: t.name, fps: t.fps, offset: t.offset, duration: t.duration });
        } catch (e) {
            return reply(false, "Error: " + e.toString());
        }
    }

    /**
     * Where the playhead is: `t` in seconds from the timeline's start (the
     * time the note's tags are measured in), with fps, the timecode offset
     * and the timeline's name. Kept tiny: the panel asks several times a
     * second while the notes follow the playhead.
     */
    function getPlayhead() {
        try {
            var host = getHostName();
            if (host === "ae") {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) return reply(false, "No composition");
                var offset = 0;
                try { offset = comp.displayStartTime || 0; } catch (eOffset) {}
                return reply(true, "OK", { t: comp.time, fps: comp.frameRate || 30, offset: offset, name: String(comp.name) });
            }
            if (host === "ppro") {
                var seq = app.project.activeSequence;
                if (!seq) return reply(false, "No sequence");
                var zero = 0;
                try { zero = Number(seq.zeroPoint) / TICKS_PER_SECOND || 0; } catch (eZero) {}
                return reply(true, "OK", { t: Number(seq.getPlayerPosition().seconds) || 0, fps: sequenceFps(seq), offset: zero, name: String(seq.name) });
            }
            return reply(false, "Unsupported host application");
        } catch (e) {
            return reply(false, "Error: " + e.toString());
        }
    }

    /** Premiere's own "Waveform Audio 48kHz 16-bit" export preset, wherever Premiere is installed. */
    function wavPresetPPRO() {
        var starts = [];
        try { starts.push(new File(String(app.path))); } catch (e1) {}
        try { starts.push(Folder.appPackage); } catch (e2) {}
        var subPaths = ["MediaIO/systempresets", "Contents/MediaIO/systempresets"];
        for (var s = 0; s < starts.length; s++) {
            // app.path may name the executable or its folder; look a few levels up.
            var dir = starts[s];
            for (var up = 0; up < 4 && dir; up++) {
                for (var p = 0; p < subPaths.length; p++) {
                    var presets = new Folder(dir.fsName + "/" + subPaths[p]);
                    if (!presets.exists) continue;
                    var exact = new File(presets.fsName + "/3F3F3F3F_57415645/Waveform Audio 48kHz 16-bit.epr");
                    if (exact.exists) return exact.fsName;
                    // "57415645" is WAVE: any preset of Premiere's WAV exporter will do.
                    var groups = presets.getFiles();
                    for (var g = 0; g < groups.length; g++) {
                        if (!(groups[g] instanceof Folder) || !/57415645$/i.test(groups[g].name)) continue;
                        var eprs = groups[g].getFiles("*.epr");
                        if (eprs.length) return eprs[0].fsName;
                    }
                }
                dir = dir.parent;
            }
        }
        return "";
    }

    /**
     * With audio clips selected, only their tracks are heard while the audio
     * is read: the other audio tracks are muted and unmuted again after.
     */
    function soloSelectedTracksPPRO(seq) {
        var tracks = seq.audioTracks;
        var chosen = [];
        var any = false;
        for (var t = 0; t < tracks.numTracks; t++) {
            var has = false;
            try {
                for (var c = 0; c < tracks[t].clips.numItems && !has; c++) {
                    if (tracks[t].clips[c].isSelected()) has = true;
                }
            } catch (eSel) {}
            chosen.push(has);
            if (has) any = true;
        }
        var muted = [];
        if (!any) return { used: "all", muted: muted };
        for (var m = 0; m < tracks.numTracks; m++) {
            if (chosen[m]) continue;
            try {
                if (!tracks[m].isMuted()) {
                    tracks[m].setMute(1);
                    muted.push(tracks[m]);
                }
            } catch (eMute) {}
        }
        return { used: "selected", muted: muted };
    }

    function timelineAudioPPRO(wavPath) {
        var t = timelinePPRO();
        if (!t) return reply(false, "Open a sequence first");
        var preset = wavPresetPPRO();
        if (!preset) return reply(false, "Premiere's WAV export preset (Waveform Audio 48kHz 16-bit) was not found");
        var out = new File(wavPath);
        try { if (out.exists) out.remove(); } catch (eOld) {}
        var solo = soloSelectedTracksPPRO(t.seq);
        try {
            t.seq.exportAsMediaDirect(out.fsName, preset, 0); // 0: the entire sequence
        } finally {
            for (var i = 0; i < solo.muted.length; i++) {
                try { solo.muted[i].setMute(0); } catch (eUnmute) {}
            }
        }
        if (!new File(out.fsName).exists) return reply(false, "Premiere did not export the sequence audio");
        return reply(true, "OK", { kind: "wav", path: out.fsName, used: solo.used, name: t.name, fps: t.fps, offset: t.offset, duration: t.duration });
    }

    function timelineAudioAE() {
        var t = timelineAE();
        if (!t) return reply(false, "Open a composition first");
        var comp = t.comp;

        // With audio layers selected, only they are heard while measuring.
        var picked = {};
        var any = false;
        var sel = comp.selectedLayers;
        var userSelection = [];
        for (var s = 0; s < sel.length; s++) {
            try {
                userSelection.push(sel[s].index);
                if (sel[s].hasAudio && sel[s].audioEnabled) {
                    picked[sel[s].index] = true;
                    any = true;
                }
            } catch (eSel) {}
        }
        var audible = 0;
        for (var a = 1; a <= comp.numLayers; a++) {
            try { if (comp.layer(a).hasAudio && comp.layer(a).audioEnabled && (!any || picked[a])) audible++; } catch (eA) {}
        }
        if (!audible) return reply(false, "This composition has no audio to listen to");

        var silenced = [];
        var workStart = comp.workAreaStart;
        var workDuration = comp.workAreaDuration;
        var values = [];
        var step = comp.frameDuration;
        var start = 0;
        var layersBefore = comp.numLayers;
        var failure = "";
        app.beginUndoGroup("LazyKick: Read Audio");
        try {
            if (any) {
                for (var i = 1; i <= comp.numLayers; i++) {
                    var layer = comp.layer(i);
                    try {
                        if (layer.hasAudio && layer.audioEnabled && !picked[i]) {
                            layer.audioEnabled = false;
                            silenced.push(layer);
                        }
                    } catch (eSilence) {}
                }
            }
            // Convert Audio to Keyframes measures the selected layers, so select
            // exactly the ones to hear (a selected text layer would give silence).
            for (var d = 1; d <= comp.numLayers; d++) {
                try {
                    var each = comp.layer(d);
                    each.selected = !!(each.hasAudio && each.audioEnabled);
                } catch (eSelect) {}
            }
            comp.workAreaStart = 0;
            comp.workAreaDuration = comp.duration;
            try { comp.openInViewer(); } catch (eView) {}
            try { app.beginSuppressDialogs(); } catch (eSup) {}
            try {
                app.executeCommand(CONVERT_AUDIO_TO_KEYFRAMES);
            } finally {
                try { app.endSuppressDialogs(false); } catch (eEnd) {}
            }
            if (comp.numLayers !== layersBefore + 1) {
                failure = "After Effects could not measure the audio";
            } else {
                var amp = comp.layer(1);
                var effects = amp.property("ADBE Effect Parade");
                // Left, Right, Both Channels: the last one, a Slider Control.
                var both = effects.property(effects.numProperties).property(1);
                var keys = both.numKeys;
                for (var k = 1; k <= keys; k++) values.push(Math.round(both.keyValue(k) * 1000) / 1000);
                if (keys) start = both.keyTime(1);
                if (keys > 1) step = both.keyTime(2) - both.keyTime(1);
                amp.remove();
            }
        } finally {
            for (var r = 0; r < silenced.length; r++) {
                try { silenced[r].audioEnabled = true; } catch (eRestore) {}
            }
            try {
                comp.workAreaStart = workStart;
                comp.workAreaDuration = workDuration;
            } catch (eWork) {}
            // The user's own selection back, by index (the helper layer is gone).
            var wasSelected = {};
            for (var u = 0; u < userSelection.length; u++) wasSelected[userSelection[u]] = true;
            for (var q = 1; q <= comp.numLayers; q++) {
                try { comp.layer(q).selected = !!wasSelected[q]; } catch (eReselect) {}
            }
            app.endUndoGroup();
        }
        if (failure) return reply(false, failure);
        return reply(true, "OK", { kind: "levels", step: step, start: start, values: values, used: any ? "selected" : "all",
                                   name: t.name, fps: t.fps, offset: t.offset, duration: t.duration });
    }

    /**
     * The open timeline's audio, for timing a script to it. Premiere writes a
     * WAV to `wavPath` ({ kind: "wav", path }); After Effects measures it in
     * place ({ kind: "levels", step, start, values }). Both report `used`
     * ("selected" when only the selected clips or layers were heard), and the
     * timeline's name, fps, timecode offset and duration.
     */
    function getTimelineAudio(wavPath) {
        try {
            var host = getHostName();
            if (host === "ppro") return timelineAudioPPRO(wavPath);
            if (host === "ae") return timelineAudioAE();
            return reply(false, "Unsupported host application");
        } catch (e) {
            return reply(false, "Could not read the audio: " + e.toString());
        }
    }

    function pad2(n) { return n < 10 ? "0" + n : String(n); }

    /** A font that has Bengali letters, when the subtitles need one; "" to keep the default. */
    function bengaliFontAE() {
        var names = ["NirmalaUI", "Vrinda", "ShonarBangla", "KohinoorBangla-Regular", "BanglaSangamMN", "NotoSansBengali-Regular"];
        try {
            if (app.fonts && typeof app.fonts.getFontsByPostScriptName === "function") {
                for (var i = 0; i < names.length; i++) {
                    var found = app.fonts.getFontsByPostScriptName(names[i]);
                    if (found && found.length) return names[i];
                }
            }
        } catch (e) {}
        return "";
    }

    function hasBengali(text) {
        return /[\u0980-\u09FF]/.test(String(text || ""));
    }

    /** One text layer per cue, lower third, white with a dark outline, first cue on top. */
    function subtitlesAE(cues) {
        var t = timelineAE();
        if (!t) return reply(false, "Open a composition first");
        var comp = t.comp;
        var fontSize = Math.max(12, Math.round(comp.height * 0.045));
        var box = [Math.round(comp.width * 0.84), Math.round(fontSize * 3.4)];
        var anyBengali = false;
        for (var b = 0; b < cues.length; b++) if (hasBengali(cues[b].t)) anyBengali = true;
        var bengaliFont = anyBengali ? bengaliFontAE() : "";
        var made = 0;
        var skipped = 0;
        app.beginUndoGroup("LazyKick: Subtitles");
        try {
            for (var i = cues.length - 1; i >= 0; i--) {
                var cue = cues[i];
                if (!(cue.s < comp.duration) || !(cue.e > cue.s)) {
                    skipped++;
                    continue;
                }
                var layer = comp.layers.addBoxText(box, String(cue.t));
                var textProp = layer.property("ADBE Text Properties").property("ADBE Text Document");
                var doc = textProp.value;
                doc.fontSize = fontSize;
                doc.applyFill = true;
                doc.fillColor = [1, 1, 1];
                doc.applyStroke = true;
                doc.strokeColor = [0, 0, 0];
                doc.strokeWidth = Math.max(2, Math.round(fontSize * 0.1));
                doc.strokeOverFill = false;
                doc.justification = ParagraphJustification.CENTER_JUSTIFY;
                if (bengaliFont && hasBengali(cue.t)) {
                    try { doc.font = bengaliFont; } catch (eFont) {}
                    // Bengali letters join correctly only with the Universal Type Engine.
                    try { doc.composerEngine = ComposerEngine.UNIVERSAL_TYPE_ENGINE; } catch (eEngine) {}
                }
                textProp.setValue(doc);
                layer.property("ADBE Transform Group").property("ADBE Position").setValue([Math.round(comp.width / 2), Math.round(comp.height * 0.84)]);
                layer.inPoint = cue.s;
                layer.outPoint = Math.min(cue.e, comp.duration);
                layer.name = "Sub " + pad2(i + 1) + "  " + String(cue.t).replace(/\s+/g, " ").substr(0, 40);
                made++;
            }
        } finally {
            app.endUndoGroup();
        }
        var msg = made + " subtitle layer" + (made === 1 ? "" : "s") + " added to '" + t.name + "'";
        if (skipped) msg += " (" + skipped + " past the end of the composition left out)";
        return reply(true, msg, { placed: made > 0, count: made, skipped: skipped, font: bengaliFont });
    }

    /** Imports the SRT into a "Subtitles" bin and lays it on the sequence as a subtitle caption track. */
    function subtitlesPPRO(srtPath) {
        var t = timelinePPRO();
        if (!t) return reply(false, "Open a sequence first");
        var f = new File(srtPath);
        if (!f.exists) return reply(false, "The subtitle file was not written");
        var bin = resolveBinPathPPRO("Subtitles");
        var before = childIdsPPRO(bin);
        app.project.importFiles([f.fsName], true, bin, false);
        var added = newChildrenPPRO(bin, before);
        var item = null;
        for (var i = 0; i < added.length && !item; i++) {
            try { if (normalizeMediaPath(added[i].getMediaPath()) === normalizeMediaPath(f.fsName)) item = added[i]; } catch (eItem) {}
        }
        if (!item && added.length) item = added[0];
        if (!item) return reply(false, "Premiere Pro did not import the subtitle file");
        if (typeof t.seq.createCaptionTrack !== "function") {
            return reply(true, "Subtitles are in the 'Subtitles' bin: drag them onto the sequence (this Premiere Pro cannot place them by script)", { placed: false });
        }
        var format;
        try { format = Sequence.CAPTION_FORMAT_SUBTITLE; } catch (eFormat) { format = undefined; }
        var ok = format !== undefined ? t.seq.createCaptionTrack(item, 0, format) : t.seq.createCaptionTrack(item, 0);
        if (ok === false) return reply(true, "Subtitles are in the 'Subtitles' bin, but Premiere Pro did not make the caption track", { placed: false });
        return reply(true, "Subtitles placed on a new caption track in '" + t.name + "'", { placed: true });
    }

    /**
     * Put subtitles on the open timeline.
     * payloadJson: { srtPath: "...", cues: [{ s, e, t }] } in seconds from the
     * timeline's start. Premiere uses the SRT, After Effects the cues.
     */
    function placeSubtitles(payloadJson) {
        try {
            var payload = ((typeof payloadJson === "string") ? JSON.parse(payloadJson) : payloadJson) || {};
            var host = getHostName();
            if (host === "ppro") return subtitlesPPRO(payload.srtPath || "");
            if (host === "ae") return subtitlesAE(payload.cues || []);
            return reply(false, "Unsupported host application");
        } catch (e) {
            return reply(false, "Could not place the subtitles: " + e.toString());
        }
    }

    // Public API Object
    return {
        VERSION: VERSION,
        reply: reply,
        isAE: isAE,
        isPPRO: isPPRO,
        getHostName: getHostName,
        getProjectPath: getProjectPath,
        getProjectFolder: getProjectFolder,
        getProjectInfo: getProjectInfo,
        getCurrentTimecode: getCurrentTimecode,
        importPastedImage: importPastedImage,
        importFilesToBin: importFilesToBin,
        syncWatchBin: syncWatchBin,
        getTimelineInfo: getTimelineInfo,
        getPlayhead: getPlayhead,
        getTimelineAudio: getTimelineAudio,
        placeSubtitles: placeSubtitles,
        // Pure helpers, exported for tools/test-host.js
        sanitizeBinPath: sanitizeBinPath,
        formatFramesTimecode: formatFramesTimecode,
        choosePremiereTrack: choosePremiereTrack,
        normalizeMediaPath: normalizeMediaPath
    };
})();

// Bridge functions for CSInterface.evalScript
function getProjectPath() { return LazyKickHost.getProjectPath(); }
function getProjectFolder() { return LazyKickHost.getProjectFolder(); }
function getProjectInfo() { return LazyKickHost.getProjectInfo(); }
function getCurrentTimecode() { return LazyKickHost.getCurrentTimecode(); }
function importPastedImage(filePath, asGuideLayer, autoFit, binName) {
    return LazyKickHost.importPastedImage(filePath, asGuideLayer, autoFit, binName);
}
function importFilesToBin(binPath, filePathsJson, expectedProjectId) {
    return LazyKickHost.importFilesToBin(binPath, filePathsJson, expectedProjectId);
}
function syncWatchBin(binPath, payloadJson, expectedProjectId) {
    return LazyKickHost.syncWatchBin(binPath, payloadJson, expectedProjectId);
}
function getTimelineInfo() { return LazyKickHost.getTimelineInfo(); }
function getPlayhead() { return LazyKickHost.getPlayhead(); }
function getTimelineAudio(wavPath) { return LazyKickHost.getTimelineAudio(wavPath); }
function placeSubtitles(payloadJson) { return LazyKickHost.placeSubtitles(payloadJson); }
