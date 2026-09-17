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

    var VERSION = "1.2.0";
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

    /**
     * Normalised paths of every file the project already holds. A watch folder
     * linked to media that is already in the project (imported by hand, or
     * before the bin was reset or relinked) then does not import it again.
     * Built once per sync, not once per file.
     */
    function projectMediaIndexAE() {
        var index = {};
        for (var j = 1; j <= app.project.items.length; j++) {
            try {
                var it = app.project.items[j];
                if (it instanceof FootageItem && it.file) index[normalizeMediaPath(it.file.fsName)] = true;
            } catch (e) {}
        }
        return index;
    }

    function projectMediaIndexPPRO(bin, index) {
        if (!bin || !bin.children) return index;
        for (var k = 0; k < bin.children.numItems; k++) {
            try {
                var cItem = bin.children[k];
                if (cItem.type === 2) {
                    projectMediaIndexPPRO(cItem, index);
                } else if (typeof cItem.getMediaPath === "function") {
                    var mediaPath = cItem.getMediaPath();
                    if (mediaPath) index[normalizeMediaPath(mediaPath)] = true;
                }
            } catch (e) {}
        }
        return index;
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

    /**
     * Import files into a (nested) bin. Reports exactly which files went in,
     * which were already in the project (left alone, wherever they are), and
     * which failed, so the panel only remembers the ones that really are in.
     * `expectedProjectId` guards against the user switching projects while the
     * panel was scanning: the files are then not dropped into the wrong one.
     */
    function importFilesToBin(binPath, filePathsJson, expectedProjectId) {
        try {
            var filePaths = (typeof filePathsJson === "string") ? JSON.parse(filePathsJson) : filePathsJson;
            if (!filePaths || !filePaths.length) {
                return reply(true, "No files to import", { imported: 0, failed: 0, existing: 0, importedFiles: [], failedFiles: [], existingFiles: [] });
            }

            if (expectedProjectId && getProjectPath() !== expectedProjectId) {
                return reply(false, "The open project changed; sync skipped", { projectChanged: true });
            }

            var host = getHostName();
            var importedFiles = [];
            var failedFiles = [];
            var existingFiles = [];

            // ---------- AFTER EFFECTS ----------
            if (host === "ae") {
                app.beginUndoGroup("LazyKick: Watch Bin Sync");
                try {
                    var inProject = projectMediaIndexAE();
                    var targetFolder = null;
                    for (var i = 0; i < filePaths.length; i++) {
                        try {
                            var f = new File(filePaths[i]);
                            if (!f.exists) {
                                failedFiles.push(filePaths[i]);
                                continue;
                            }
                            var key = normalizeMediaPath(f.fsName);
                            if (inProject[key] === true) {
                                existingFiles.push(filePaths[i]);
                                continue;
                            }
                            var footage = app.project.importFile(new ImportOptions(f));
                            // Made only when something goes in, so a bin of files
                            // that are all elsewhere in the project stays unmade.
                            if (!targetFolder) targetFolder = resolveBinPathAE(binPath);
                            footage.parentFolder = targetFolder;
                            inProject[key] = true;
                            importedFiles.push(filePaths[i]);
                        } catch (eAE) {
                            failedFiles.push(filePaths[i]);
                        }
                    }
                } finally {
                    app.endUndoGroup();
                }
                return reply(true, "Import finished", {
                    imported: importedFiles.length, failed: failedFiles.length, existing: existingFiles.length,
                    importedFiles: importedFiles, failedFiles: failedFiles, existingFiles: existingFiles
                });
            }

            // ---------- PREMIERE PRO ----------
            if (host === "ppro") {
                var inProjectP = projectMediaIndexPPRO(app.project.rootItem, {});
                var validPaths = [];
                for (var j = 0; j < filePaths.length; j++) {
                    var pf = new File(filePaths[j]);
                    if (!pf.exists) {
                        failedFiles.push(filePaths[j]);
                    } else if (inProjectP[normalizeMediaPath(pf.fsName)] === true) {
                        existingFiles.push(filePaths[j]);
                    } else {
                        validPaths.push(filePaths[j]);
                    }
                }

                if (validPaths.length > 0) {
                    var targetBin = resolveBinPathPPRO(binPath);
                    var before = childIdsPPRO(targetBin);
                    var batchThrew = false;
                    try {
                        // suppressUI = true: a layered PSD or AI must not stop
                        // a background sync with Premiere's import dialog.
                        app.project.importFiles(validPaths, true, targetBin, false);
                    } catch (eBatch) {
                        batchThrew = true;
                    }

                    if (batchThrew) {
                        for (var k = 0; k < validPaths.length; k++) {
                            var beforeOne = childIdsPPRO(targetBin);
                            try { app.project.importFiles([validPaths[k]], true, targetBin, false); } catch (eOne) {}
                            if (newChildrenPPRO(targetBin, beforeOne).length > 0) importedFiles.push(validPaths[k]);
                            else failedFiles.push(validPaths[k]);
                        }
                    } else {
                        var added = newChildrenPPRO(targetBin, before);
                        if (added.length >= validPaths.length) {
                            for (var a = 0; a < validPaths.length; a++) importedFiles.push(validPaths[a]);
                        } else {
                            // Some did not import: match what arrived by path,
                            // then by file name.
                            var byPath = {};
                            var byName = {};
                            for (var n = 0; n < added.length; n++) {
                                try {
                                    var mp = normalizeMediaPath(added[n].getMediaPath());
                                    byPath[mp] = true;
                                    byName[mp.substr(mp.lastIndexOf("/") + 1)] = true;
                                } catch (eMp) {}
                            }
                            for (var v = 0; v < validPaths.length; v++) {
                                var want = normalizeMediaPath(validPaths[v]);
                                var wantName = want.substr(want.lastIndexOf("/") + 1);
                                if (byPath[want] || byName[wantName]) importedFiles.push(validPaths[v]);
                                else failedFiles.push(validPaths[v]);
                            }
                        }
                    }
                }
                return reply(true, "Import finished", {
                    imported: importedFiles.length, failed: failedFiles.length, existing: existingFiles.length,
                    importedFiles: importedFiles, failedFiles: failedFiles, existingFiles: existingFiles
                });
            }

            return reply(false, "Unsupported host");
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
