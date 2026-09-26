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

    var VERSION = "1.3.0";
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

    function childIdsPPRO(bin) {
        var ids = {};
        for (var i = 0; i < bin.children.numItems; i++) {
            try { ids[bin.children[i].nodeId] = true; } catch (e) {}
        }
        return ids;
    }

    function newChildrenPPRO(bin, before) {
        var added = [];
        for (var i = 0; i < bin.children.numItems; i++) {
            var c = bin.children[i];
            try { if (!before[c.nodeId]) added.push(c); } catch (e) {}
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
    //
    // plus four host operations: create, move, relink and importInto.

    var ROOT_ID = "root";

    function fileNameOf(p) {
        var s = String(p || "").replace(/\\/g, "/");
        return s.substr(s.lastIndexOf("/") + 1);
    }

    function joinBinPath(a, b) {
        return sanitizeBinPath(String(a || "") + "/" + String(b || ""), "");
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
        var tree = { bins: {}, kids: {}, media: [] };
        tree.bins[ROOT_ID] = { bin: rootBin, name: "", parent: null };
        tree.kids[ROOT_ID] = [];
        return tree;
    }

    function addTreeBin(tree, id, bin, name, parentId) {
        tree.bins[id] = { bin: bin, name: String(name), parent: parentId };
        if (!tree.kids[id]) tree.kids[id] = [];
        if (!tree.kids[parentId]) tree.kids[parentId] = [];
        tree.kids[parentId].push(id);
        return id;
    }

    /** The bin called `name` inside `parentId`: the exact name first, then ignoring case, as folders on disk do. */
    function childBinId(tree, parentId, name) {
        var kids = tree.kids[parentId] || [];
        var lower = String(name).toLowerCase();
        var loose = null;
        for (var i = 0; i < kids.length; i++) {
            var b = tree.bins[kids[i]];
            if (b.name === name) return kids[i];
            if (loose === null && b.name.toLowerCase() === lower) loose = kids[i];
        }
        return loose;
    }

    /** Id of the bin at "A/B/C", made on the way when `create` is set; null when it is not there. */
    function resolveTreeBin(tree, pathStr, create) {
        var clean = sanitizeBinPath(pathStr, "");
        var id = ROOT_ID;
        if (!clean) return id;
        var parts = clean.split("/");
        for (var i = 0; i < parts.length && id !== null; i++) {
            var next = childBinId(tree, id, parts[i]);
            if (next === null && create) next = tree.create(id, parts[i]);
            id = next;
        }
        return id;
    }

    /** A bin id that is made the first time it is asked for, so nothing is made for a batch that imports nothing. */
    function lazyBin(tree, pathStr) {
        var id;
        return function () {
            if (id === undefined) id = resolveTreeBin(tree, pathStr, true);
            return id;
        };
    }

    function insideBin(tree, binId, ancestorId) {
        var id = binId;
        for (var guard = 0; id !== null && id !== undefined && guard < 1000; guard++) {
            if (id === ancestorId) return true;
            id = tree.bins[id] ? tree.bins[id].parent : null;
        }
        return false;
    }

    function projectTreeAE() {
        var rootFolder = app.project.rootFolder;
        var rootKey = String(rootFolder.id);
        var tree = newTree(rootFolder);
        function key(folder) {
            var k = String(folder.id);
            return k === rootKey ? ROOT_ID : "f" + k;
        }

        // One pass over the flat item list; a folder may come after its contents.
        for (var j = 1; j <= app.project.items.length; j++) {
            try {
                var it = app.project.items[j];
                if (it instanceof FolderItem) {
                    addTreeBin(tree, key(it), it, it.name, key(it.parentFolder));
                } else if (it instanceof FootageItem && it.file) {
                    tree.media.push({ item: it, path: String(it.file.fsName), parent: key(it.parentFolder) });
                }
            } catch (e) {}
        }

        tree.create = function (parentId, name) {
            var folder = app.project.items.addFolder(name);
            folder.parentFolder = tree.bins[parentId].bin;
            return addTreeBin(tree, key(folder), folder, name, parentId);
        };
        tree.move = function (rec, binId) {
            rec.item.parentFolder = tree.bins[binId].bin;
            rec.parent = binId;
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
                        walk(c, addTreeBin(tree, "n" + c.nodeId, c, c.name, binId));
                    } else if (typeof c.getMediaPath === "function") {
                        var mediaPath = c.getMediaPath();
                        if (mediaPath) tree.media.push({ item: c, path: String(mediaPath), parent: binId });
                    }
                } catch (e) {}
            }
        }
        walk(app.project.rootItem, ROOT_ID);

        tree.create = function (parentId, name) {
            var parent = tree.bins[parentId].bin;
            var made = null;
            try { made = parent.createBin(name); } catch (eCreate) { made = null; }
            if (!made || made.type !== 2) {
                // createBin is documented to return 0 when it fails: look for
                // a bin by that name that was not there before.
                made = null;
                for (var i = parent.children.numItems - 1; i >= 0 && !made; i--) {
                    var c = parent.children[i];
                    if (c.type === 2 && c.name === name && !tree.bins["n" + c.nodeId]) made = c;
                }
            }
            return made ? addTreeBin(tree, "n" + made.nodeId, made, name, parentId) : null;
        };
        tree.move = function (rec, binId) {
            rec.item.moveBin(tree.bins[binId].bin);
            rec.parent = binId;
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
    function relinkMoved(tree, rootPath, folder, toAdd, out) {
        var root = sanitizeBinPath(rootPath, "");
        var rootId = root ? resolveTreeBin(tree, root, false) : null;
        var folderKey = folder ? normalizeMediaPath(folder).replace(/\/+$/, "") + "/" : "";

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
            var ours = (rootId !== null && insideBin(tree, rec.parent, rootId)) || (folderKey !== "" && key.indexOf(folderKey) === 0);
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
    function arrangeInto(tree, rootPath, files) {
        var root = sanitizeBinPath(rootPath, "");
        if (!root || !files.length) return 0;
        var rootId = resolveTreeBin(tree, root, false);
        if (rootId === null) return 0;

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
            var target = joinBinPath(root, files[i].s);
            var tk = "b" + target.toLowerCase();
            for (var r = 0; r < recs.length; r++) {
                var want = targets.hasOwnProperty(tk) ? targets[tk] : resolveTreeBin(tree, target, false);
                if (want !== null) targets[tk] = want;
                if (want === recs[r].parent) continue;
                if (want === null) {
                    want = resolveTreeBin(tree, target, true);
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

    /**
     * One watch-bin sync against a project tree.
     *   files    [{ p: path, s: "Sub/Folder" it sits in, n: true when new }]
     *   folder   the watch folder on disk, for relinking moved files
     *   arrange  true: sort every listed file already in the watch bin into
     *            its bin; false: only the files relinked now
     * New files that are already in the project anywhere are left alone.
     */
    function syncTree(tree, rootPath, files, folder, arrange) {
        var out = { importedFiles: [], failedFiles: [], existingFiles: [], relinkedFiles: [], moved: 0 };
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

        var relinked = toAdd.length ? relinkMoved(tree, rootPath, folder, toAdd, out) : [];

        // One import per bin, in the order the files are listed.
        var groups = [];
        var byBin = {};
        for (var a = 0; a < toAdd.length; a++) {
            if (toAdd[a].done) continue;
            var target = joinBinPath(rootPath, toAdd[a].s);
            var gk = "b" + target.toLowerCase();
            if (!byBin.hasOwnProperty(gk)) {
                byBin[gk] = { path: target, paths: [] };
                groups.push(byBin[gk]);
            }
            byBin[gk].paths.push(toAdd[a].p);
        }
        for (var g = 0; g < groups.length; g++) {
            tree.importInto(lazyBin(tree, groups[g].path), groups[g].paths, out.importedFiles, out.failedFiles);
        }

        out.moved = arrangeInto(tree, rootPath, arrange ? files : relinked);
        return out;
    }

    /**
     * Runs a sync and reports exactly which files went in, which were already
     * in the project, which were relinked and which failed, so the panel only
     * remembers the ones that really are in. `expectedProjectId` guards
     * against the user switching projects while the panel was scanning: the
     * files are then not dropped into the wrong one.
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
            relinked: out.relinkedFiles.length, moved: out.moved,
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
