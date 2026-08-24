/*
========================================================================
  Script Name: LazyKick Host Engine
  Author: Raisul Sohan (raisulsohan.com)
  Developed By: RaisulSohan
  Description: Unified backend host script for After Effects & Premiere Pro.
               Powers Project Notepad, QuickBinSync, QuickPaste & Tools.
  Copyright (c) 2026 Raisul Sohan. All rights reserved.
========================================================================
*/

// ---------- Minimal JSON Safety Net ----------
if (typeof JSON === "undefined" || !JSON.stringify) {
    JSON = (typeof JSON !== "undefined") ? JSON : {};
    JSON.stringify = JSON.stringify || function (o) {
        if (o === null) return "null";
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

    function reply(ok, msg, extra) {
        var o = { ok: ok, msg: msg, developer: "RaisulSohan" };
        if (extra) {
            for (var k in extra) {
                if (extra.hasOwnProperty(k)) o[k] = extra[k];
            }
        }
        return JSON.stringify(o);
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
    // Project Identification & Path
    // ============================================================
    function getProjectPath() {
        try {
            var appTag = getHostName();
            if (!app.project) return appTag + "|none|";

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

            if (savedPath) return appTag + "|saved|" + savedPath;

            // Unsaved in PPro
            try {
                if (typeof app.project.documentID === "string" && app.project.documentID.length > 0) {
                    return appTag + "|unsaved|" + app.project.documentID;
                }
            } catch (e3) {}

            // Unsaved in AE
            if (appTag === "ae") {
                try {
                    var n = app.project.numItems || 0;
                    var fp = "items=" + n;
                    if (n > 0) {
                        try {
                            fp += "_" + (app.project.item(1) ? app.project.item(1).name : "");
                        } catch (e4) {}
                    }
                    return "ae|unsaved|" + fp;
                } catch (e5) {}
            }

            return appTag + "|unsaved|default";
        } catch (err) {
            return "error|none|" + err.toString();
        }
    }

    function getProjectFolder() {
        try {
            if (typeof app.project.file !== 'undefined' && app.project.file !== null) {
                return app.project.file.parent.fsName;
            }
            if (typeof app.project.path !== 'undefined' && app.project.path && app.project.path !== '') {
                var f = new File(app.project.path);
                return f.parent.fsName;
            }
            return 'NO_PROJECT';
        } catch (e) {
            return 'NO_PROJECT';
        }
    }

    function getProjectInfo() {
        try {
            var host = getHostName();
            if (host === "unknown") return reply(false, "Unsupported host application", { host: host });
            if (!app.project) return reply(false, "No project open", { host: host });

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

            var projName = "Untitled";
            if (savedPath) {
                projName = new File(savedPath).name;
            } else if (app.project.name) {
                projName = app.project.name;
            }

            return reply(true, "OK", {
                host: host,
                saved: !!savedPath,
                path: savedPath,
                name: projName,
                fullId: getProjectPath()
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

    function getCurrentTimecode() {
        try {
            if (isAE()) {
                var comp = app.project.activeItem;
                if (!comp || !(comp instanceof CompItem)) {
                    return reply(false, "No active composition found");
                }
                var fps = comp.frameRate || 30;
                var totalSecs = comp.time;
                var frames = Math.floor((totalSecs % 1) * fps);
                var totalIntSecs = Math.floor(totalSecs);
                var hours = Math.floor(totalIntSecs / 3600);
                var minutes = Math.floor((totalIntSecs % 3600) / 60);
                var seconds = totalIntSecs % 60;

                var tc = padZero(hours, 2) + ":" + padZero(minutes, 2) + ":" + padZero(seconds, 2) + ":" + padZero(frames, 2);
                return reply(true, "OK", { timecode: tc, compName: comp.name, fps: fps });
            }

            if (isPPRO()) {
                var seq = app.project.activeSequence;
                if (!seq) {
                    return reply(false, "No active sequence found");
                }
                var pos = seq.getPlayerPosition();
                var tcStr = "00:00:00:00";
                if (pos && typeof pos.getFormatted === "function") {
                    try {
                        var settings = seq.getSettings();
                        var fpsVal = settings ? settings.videoFrameRate : 24;
                        tcStr = pos.getFormatted(fpsVal, app.project.timeDisplay);
                    } catch (eP) {
                        tcStr = String(pos.seconds) + "s";
                    }
                }
                return reply(true, "OK", { timecode: tcStr, seqName: seq.name });
            }

            return reply(false, "Unknown host application");
        } catch (e) {
            return reply(false, "Failed to get timecode: " + e.toString());
        }
    }

    // ============================================================
    // QuickPaste Engine (Clipboard Image to Timeline/Bin)
    // ============================================================
    function importPastedImage(filePath, asGuideLayer, autoFit) {
        try {
            var f = new File(filePath);
            if (!f.exists) return reply(false, "Image file does not exist on disk");

            // ---------- AFTER EFFECTS ----------
            if (isAE()) {
                // 1. Find or create "Pasted Images" project folder
                var targetFolder = null;
                for (var i = 1; i <= app.project.items.length; i++) {
                    if (app.project.items[i] instanceof FolderItem && app.project.items[i].name === "Pasted Images") {
                        targetFolder = app.project.items[i];
                        break;
                    }
                }
                if (!targetFolder) {
                    targetFolder = app.project.items.addFolder("Pasted Images");
                }

                // 2. Check if this file is ALREADY imported in project items (prevent duplication)
                var footageItem = null;
                for (var j = 1; j <= app.project.items.length; j++) {
                    var it = app.project.items[j];
                    if (it instanceof FootageItem && it.file && it.file.fsName === f.fsName) {
                        footageItem = it;
                        break;
                    }
                }

                // If not already in project, import it now
                if (!footageItem) {
                    var io = new ImportOptions(f);
                    footageItem = app.project.importFile(io);
                    footageItem.parentFolder = targetFolder;
                }

                var activeComp = app.project.activeItem;
                if (activeComp && (activeComp instanceof CompItem)) {
                    app.beginUndoGroup("LazyKick: Paste Image to Comp");
                    try {
                        var layer = activeComp.layers.add(footageItem);
                        try { layer.startTime = activeComp.time; } catch (eT) {}

                        // Guide layer toggle
                        if (asGuideLayer) {
                            try { layer.guideLayer = true; } catch (eG) {}
                        }

                        // Auto scale to fit comp
                        if (autoFit) {
                            try {
                                var compW = activeComp.width;
                                var compH = activeComp.height;
                                var imgW = footageItem.width;
                                var imgH = footageItem.height;
                                if (imgW > 0 && imgH > 0) {
                                    var scaleFactor = Math.min((compW / imgW) * 100, (compH / imgH) * 100);
                                    if (scaleFactor < 100) {
                                        layer.property("Transform").property("Scale").setValue([scaleFactor, scaleFactor]);
                                    }
                                }
                            } catch (eS) {}
                        }
                    } finally {
                        app.endUndoGroup();
                    }
                    return reply(true, "Layer added to active composition", { placedOnTimeline: true, reused: true });
                }
                return reply(true, "Footage ready in 'Pasted Images' folder", { placedOnTimeline: false });
            }

            // ---------- PREMIERE PRO ----------
            if (isPPRO()) {
                var root = app.project.rootItem;
                var targetBin = null;
                for (var b = 0; b < root.children.numItems; b++) {
                    var child = root.children[b];
                    // ProjectItemType.BIN = 2
                    if (child.type === 2 && child.name === "Pasted Images") {
                        targetBin = child;
                        break;
                    }
                }
                if (!targetBin) {
                    targetBin = root.createBin("Pasted Images");
                }

                // Check if item already exists in targetBin or root
                function findExistingMediaItem(bin, fsName) {
                    if (!bin || !bin.children) return null;
                    for (var k = 0; k < bin.children.numItems; k++) {
                        var cItem = bin.children[k];
                        if (cItem.type === 1 && typeof cItem.getMediaPath === "function") {
                            try {
                                if (cItem.getMediaPath() === fsName) return cItem;
                            } catch (eP) {}
                        } else if (cItem.type === 2) {
                            var nested = findExistingMediaItem(cItem, fsName);
                            if (nested) return nested;
                        }
                    }
                    return null;
                }

                var newItem = findExistingMediaItem(targetBin, f.fsName) || findExistingMediaItem(root, f.fsName);

                if (!newItem) {
                    // Snapshot existing items to identify newly imported item
                    var before = {};
                    for (var si = 0; si < targetBin.children.numItems; si++) {
                        try { before[targetBin.children[si].nodeId] = true; } catch (eN) {}
                    }

                    // Import into target bin
                    app.project.importFiles([filePath], false, targetBin, false);

                    for (var m = 0; m < targetBin.children.numItems; m++) {
                        var c = targetBin.children[m];
                        try {
                            if (!before[c.nodeId]) { newItem = c; break; }
                        } catch (e) {}
                    }
                }

                var activeSeq = app.project.activeSequence;
                if (activeSeq && newItem) {
                    var playhead = activeSeq.getPlayerPosition();
                    var placed = false;

                    // Search for first empty video track at playhead
                    for (var t = 0; t < activeSeq.videoTracks.numTracks; t++) {
                        var track = activeSeq.videoTracks[t];
                        if (track.isLocked && track.isLocked()) continue;

                        var hasCollision = false;
                        for (var cl = 0; cl < track.clips.numItems; cl++) {
                            var clip = track.clips[cl];
                            if (playhead.seconds >= clip.start.seconds && playhead.seconds < clip.end.seconds) {
                                hasCollision = true;
                                break;
                            }
                        }

                        if (!hasCollision) {
                            try {
                                track.insertClip(newItem, playhead);
                                placed = true;
                                break;
                            } catch (eIns) {}
                        }
                    }

                    // If all tracks are occupied, insert on top track
                    if (!placed && activeSeq.videoTracks.numTracks > 0) {
                        try {
                            var topTrack = activeSeq.videoTracks[activeSeq.videoTracks.numTracks - 1];
                            topTrack.insertClip(newItem, playhead);
                            placed = true;
                        } catch (eTop) {}
                    }

                    return reply(true, placed ? "Clip placed on sequence timeline" : "Imported to 'Pasted Images' bin", { placedOnTimeline: placed });
                }

                return reply(true, "Imported to 'Pasted Images' bin", { placedOnTimeline: false });
            }

            return reply(false, "Unsupported host application");
        } catch (e) {
            return reply(false, "Import error: " + e.toString());
        }
    }

    // ============================================================
    // QuickBinSync Engine (Folder-to-Bin Sync)
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
        var root = app.project.rootFolder;
        if (!pathStr || pathStr.replace(/^\s+|\s+$/g, "") === "") return root;
        var parts = pathStr.split(/[\/\\]/);
        var current = root;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].replace(/^\s+|\s+$/g, "");
            if (p) current = findOrCreateFolderAE(current, p);
        }
        return current;
    }

    function findOrCreateBinPPRO(parentBin, name) {
        for (var i = 0; i < parentBin.children.numItems; i++) {
            var item = parentBin.children[i];
            // type 2 is BIN
            if (item.type === 2 && item.name === name) return item;
        }
        return parentBin.createBin(name);
    }

    function resolveBinPathPPRO(pathStr) {
        var root = app.project.rootItem;
        if (!pathStr || pathStr.replace(/^\s+|\s+$/g, "") === "") return root;
        var parts = pathStr.split(/[\/\\]/);
        var current = root;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].replace(/^\s+|\s+$/g, "");
            if (p) current = findOrCreateBinPPRO(current, p);
        }
        return current;
    }

    function importFilesToBin(binPath, filePathsJson) {
        try {
            var filePaths = (typeof filePathsJson === "string") ? JSON.parse(filePathsJson) : filePathsJson;
            if (!filePaths || !filePaths.length) return reply(true, "No files to import", { imported: 0, failed: 0 });

            var host = getHostName();
            var imported = 0;
            var failed = 0;
            var failedFiles = [];

            // ---------- AFTER EFFECTS ----------
            if (host === "ae") {
                var targetFolder = resolveBinPathAE(binPath);
                for (var i = 0; i < filePaths.length; i++) {
                    try {
                        var f = new File(filePaths[i]);
                        if (!f.exists) {
                            failed++;
                            failedFiles.push(filePaths[i]);
                            continue;
                        }
                        var io = new ImportOptions(f);
                        var footage = app.project.importFile(io);
                        footage.parentFolder = targetFolder;
                        imported++;
                    } catch (eAE) {
                        failed++;
                        failedFiles.push(filePaths[i]);
                    }
                }
                return reply(true, "Import finished", { imported: imported, failed: failed, failedFiles: failedFiles });
            }

            // ---------- PREMIERE PRO ----------
            if (host === "ppro") {
                var targetBin = resolveBinPathPPRO(binPath);
                var validPaths = [];
                for (var j = 0; j < filePaths.length; j++) {
                    var pf = new File(filePaths[j]);
                    if (pf.exists) {
                        validPaths.push(filePaths[j]);
                    } else {
                        failed++;
                        failedFiles.push(filePaths[j]);
                    }
                }

                if (validPaths.length > 0) {
                    try {
                        var res = app.project.importFiles(validPaths, false, targetBin, false);
                        imported = validPaths.length;
                    } catch (eP) {
                        // Fallback individual import
                        for (var k = 0; k < validPaths.length; k++) {
                            try {
                                app.project.importFiles([validPaths[k]], false, targetBin, false);
                                imported++;
                            } catch (eSub) {
                                failed++;
                                failedFiles.push(validPaths[k]);
                            }
                        }
                    }
                }
                return reply(true, "Import finished", { imported: imported, failed: failed, failedFiles: failedFiles });
            }

            return reply(false, "Unsupported host");
        } catch (e) {
            return reply(false, "Sync error: " + e.toString());
        }
    }

    // Public API Object
    return {
        reply: reply,
        isAE: isAE,
        isPPRO: isPPRO,
        getHostName: getHostName,
        getProjectPath: getProjectPath,
        getProjectFolder: getProjectFolder,
        getProjectInfo: getProjectInfo,
        getCurrentTimecode: getCurrentTimecode,
        importPastedImage: importPastedImage,
        importFilesToBin: importFilesToBin
    };
})();

// Bridge functions for CSInterface.evalScript
function getProjectPath() { return LazyKickHost.getProjectPath(); }
function getProjectFolder() { return LazyKickHost.getProjectFolder(); }
function getProjectInfo() { return LazyKickHost.getProjectInfo(); }
function getCurrentTimecode() { return LazyKickHost.getCurrentTimecode(); }
function importPastedImage(filePath, asGuideLayer, autoFit) {
    return LazyKickHost.importPastedImage(filePath, asGuideLayer, autoFit);
}
function importFilesToBin(binPath, filePathsJson) {
    return LazyKickHost.importFilesToBin(binPath, filePathsJson);
}
