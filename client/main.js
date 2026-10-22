/*
========================================================================
  LazyKick — Frontend Controller (main.js)
  Developed By: RaisulSohan
  Website: https://raisulsohan.com
  Description: Unified frontend for Notes, Watch Bins, and LazyPaste.
  Copyright (c) 2026 Raisul Sohan. Free and open source under the MIT License.
========================================================================

  Runs in CEP's Chromium with Node enabled. The oldest supported hosts
  (CEP 9) ship Chromium 61 and Node 8.6, so this file sticks to what those
  have: no optional chaining, no fs.promises, no readdir withFileTypes, no
  recursive mkdir, no navigator.clipboard without a fallback.
  `tools/test-panel.mjs` drives it against a mocked DOM and host.
*/

(function () {
    "use strict";

    var PANEL_VERSION = "1.10.0";

    console.log("%c ⚡ LazyKick v" + PANEL_VERSION + " • Developed By RaisulSohan (raisulsohan.com) ",
                "background: #18181a; color: #3ca9ff; font-weight: bold; font-size: 13px; padding: 4px 8px; border-radius: 4px; border: 1px solid #3ca9ff;");

    // ============================================================
    // Node.js & Host Interface Modules
    // ============================================================
    var fs           = require("fs");
    var path         = require("path");
    var os           = require("os");
    var crypto       = require("crypto");
    var childProcess = require("child_process");
    var cs           = new CSInterface();

    // ============================================================
    // Storage Directory & Constants
    // ============================================================
    function mkdirp(dir) {
        if (!dir || fs.existsSync(dir)) return;
        var parent = path.dirname(dir);
        if (parent !== dir) mkdirp(parent);
        try {
            fs.mkdirSync(dir);
        } catch (e) {
            if (e.code !== "EEXIST") throw e;
        }
    }

    function getStorageDir() {
        var base;
        if (process.platform === "win32") {
            base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        } else if (process.platform === "darwin") {
            base = path.join(os.homedir(), "Library", "Application Support");
        } else {
            base = path.join(os.homedir(), ".config");
        }
        // The folder keeps the name of the tool LazyKick grew out of, so notes
        // written by earlier versions are still found.
        var dir = path.join(base, "AdobeProjectNotepad");
        mkdirp(dir);
        return dir;
    }

    var STORAGE_DIR = getStorageDir();
    var SETTINGS_FILE = path.join(STORAGE_DIR, "lazykick_settings.json");
    var GLOBAL_NOTE_FILE = path.join(STORAGE_DIR, "global_scratchpad.txt");
    var RECENT_PASTES_FILE = path.join(STORAGE_DIR, "recent_pastes.json");
    var PASTE_INDEX_FILE = path.join(STORAGE_DIR, "paste_index.json");

    var NONE_ID = "__none__";
    var DEFAULT_PASTE_FOLDER = "Pasted Images";
    var AUTO_SYNC_INTERVAL_MS = 6000;
    var PROJECT_POLL_MS = 2500;
    var MAX_RECENT_PASTES = 12;
    var MAX_PASTE_INDEX = 500;
    var SAVED_JUST_NOW_MS = 120000;
    var DEFAULT_NOTES_FONT_SIZE = 14;
    var MIN_NOTES_FONT_SIZE = 10;
    var MAX_NOTES_FONT_SIZE = 24;

    var EXT_GROUPS = {
        video: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg", ".mxf", ".mts", ".m2ts", ".wmv"],
        audio: [".mp3", ".wav", ".aac", ".flac", ".m4a", ".ogg", ".aif", ".aiff", ".wma"],
        // No camera raw (.cr2, .nef, ...): After Effects opens a Camera Raw
        // dialog for each one, which would stall a background sync.
        image: [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".exr", ".dpx", ".tga", ".bmp", ".psd", ".ai", ".gif", ".webp", ".heic", ".svg"]
    };

    // Image files that can be pasted when copied in Explorer / Finder.
    var PASTE_FILE_EXTS = [".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tif", ".tiff", ".webp", ".psd"];

    var WIN_HIDDEN_FOLDERS = {
        "$recycle.bin": true, "system volume information": true, "$winreagent": true,
        "$getcurrent": true, "$sysreset": true, "config.msi": true, "recovery": true,
        "msocache": true, "perflogs": true, "windows.old": true, "boot": true
    };

    // Adobe's own caches and backups inside a project folder: previews are
    // .mpeg/.mov files, and none of them belong in a bin.
    var ADOBE_CACHE_FOLDERS = {
        "adobe premiere pro auto-save": true, "adobe premiere pro video previews": true,
        "adobe premiere pro audio previews": true, "adobe after effects auto-save": true
    };

    // ============================================================
    // Global Application State
    // ============================================================
    var appState = {
        projectId: null,
        projectPath: null,
        projectHost: "none",
        projectName: "(No project)",
        isSaved: false,
        touchedUnsaved: false,

        // Notes State
        notesData: { tabs: [{ name: "Note 1", content: "" }], activeTabId: "0" },
        globalNote: "",
        notesSaveTimer: null,

        // Watch Bins State
        bins: [],
        autoSync: false,
        autoSyncTimer: null,
        syncPending: 0,
        lastPickerPath: "",

        // LazyPaste & Tools Settings
        settings: {
            guideLayer: true,
            autoFit: false,
            targetFolder: DEFAULT_PASTE_FOLDER,
            notesFontSize: DEFAULT_NOTES_FONT_SIZE,
            follow: true,
            timeTitles: true, // 🔠 Titles: headings are timed and subtitled like spoken lines
            subtitles: null   // the last Create subtitles choices (LazyAlign.cueOptions fills the gaps)
        },
        recentPastes: [],
        pasteBusy: false
    };

    // Auto-sync only imports a file once its size has held still between two
    // scans, so a copy or download still in progress is not imported half-written.
    var stableSizes = {};
    var syncChain = Promise.resolve();

    // Folder Browser State
    var fb = {
        currentPath: "",
        selectedPath: "",
        callback: null
    };

    // ============================================================
    // DOM Element References
    // ============================================================
    var el = {
        hostBadge:             document.getElementById("hostBadge"),
        projectName:           document.getElementById("projectName"),
        lazyPasteBtn:         document.getElementById("lazyPasteBtn"),
        refreshBtn:            document.getElementById("refreshBtn"),
        globalStatus:          document.getElementById("globalStatus"),
        navTabs:               document.querySelectorAll(".nav-tab"),
        tabContents:           document.querySelectorAll(".tab-content"),
        binCountBadge:         document.getElementById("binCountBadge"),
        brandTag:              document.getElementById("brandTag"),
        devLink:               document.getElementById("devLink"),

        // Notes Elements
        notesTabBar:           document.getElementById("notesTabBar"),
        noteEditor:            document.getElementById("noteEditor"),
        btnAddNoteTab:         document.getElementById("btnAddNoteTab"),
        btnInsertTimecode:     document.getElementById("btnInsertTimecode"),
        btnInsertTask:         document.getElementById("btnInsertTask"),
        btnCopyNote:           document.getElementById("btnCopyNote"),
        btnExportNote:         document.getElementById("btnExportNote"),
        btnDeleteNoteTab:      document.getElementById("btnDeleteNoteTab"),

        // Notes right-click menu
        noteMenu:              document.getElementById("noteMenu"),
        noteMenuCut:           document.getElementById("noteMenuCut"),
        noteMenuCopy:          document.getElementById("noteMenuCopy"),
        noteMenuPaste:         document.getElementById("noteMenuPaste"),
        noteMenuPastePlain:    document.getElementById("noteMenuPastePlain"),
        noteMenuSelectAll:     document.getElementById("noteMenuSelectAll"),
        noteMenuPin:           document.getElementById("noteMenuPin"),
        noteMenuUnpin:         document.getElementById("noteMenuUnpin"),
        noteMenuCutTimeline:   document.getElementById("noteMenuCutTimeline"),
        noteMenuRemoveTimeline: document.getElementById("noteMenuRemoveTimeline"),
        noteMenuUnstrike:      document.getElementById("noteMenuUnstrike"),

        // In-panel dialog
        dialogOverlay:         document.getElementById("dialogOverlay"),
        dialogTitle:           document.getElementById("dialogTitle"),
        dialogMessage:         document.getElementById("dialogMessage"),
        dialogClose:           document.getElementById("dialogClose"),
        dialogCancel:          document.getElementById("dialogCancel"),
        dialogOk:              document.getElementById("dialogOk"),
        btnTimeToAudio:        document.getElementById("btnTimeToAudio"),
        btnRetakes:            document.getElementById("btnRetakes"),
        btnFollow:            document.getElementById("btnFollow"),
        btnTimeTitles:         document.getElementById("btnTimeTitles"),
        btnTextSmaller:        document.getElementById("btnTextSmaller"),
        btnTextBigger:         document.getElementById("btnTextBigger"),
        tabNotes:              document.getElementById("tabNotes"),
        followLayer:           document.getElementById("followLayer"),
        followLine:            document.getElementById("followLine"),
        followWord:            document.getElementById("followWord"),
        btnSubtitles:          document.getElementById("btnSubtitles"),

        // Create subtitles dialog
        subModalOverlay:       document.getElementById("subModalOverlay"),
        subModalClose:         document.getElementById("subModalClose"),
        optSubSingle:          document.getElementById("optSubSingle"),
        optSubDouble:          document.getElementById("optSubDouble"),
        optSubWord:            document.getElementById("optSubWord"),
        subLayoutHint:         document.getElementById("subLayoutHint"),
        subMaxCharsRow:        document.getElementById("subMaxCharsRow"),
        optSubMaxChars:        document.getElementById("optSubMaxChars"),
        optSubMaxCharsRange:   document.getElementById("optSubMaxCharsRange"),
        subMinSecondsRow:      document.getElementById("subMinSecondsRow"),
        optSubMinSeconds:      document.getElementById("optSubMinSeconds"),
        optSubMinSecondsRange: document.getElementById("optSubMinSecondsRange"),
        subGapRow:             document.getElementById("subGapRow"),
        optSubGap:             document.getElementById("optSubGap"),
        optSubGapRange:        document.getElementById("optSubGapRange"),
        optSubNoPunct:         document.getElementById("optSubNoPunct"),
        subPreviewCount:       document.getElementById("subPreviewCount"),
        subPreviewList:        document.getElementById("subPreviewList"),
        btnSubCancel:          document.getElementById("btnSubCancel"),
        btnSubCreate:          document.getElementById("btnSubCreate"),

        // Bins Elements
        btnAddBin:             document.getElementById("btnAddBin"),
        btnSyncAll:            document.getElementById("btnSyncAll"),
        autoSyncToggle:        document.getElementById("autoSyncToggle"),
        autoSyncDot:           document.getElementById("autoSyncDot"),
        binCardsList:          document.getElementById("binCardsList"),
        binsEmptyHint:         document.getElementById("binsEmptyHint"),

        // Bin Modal
        binModalOverlay:       document.getElementById("binModalOverlay"),
        binModalTitle:         document.getElementById("binModalTitle"),
        btnModalClose:         document.getElementById("btnModalClose"),
        modalFolderInput:      document.getElementById("modalFolderInput"),
        btnBrowseFolder:       document.getElementById("btnBrowseFolder"),
        modalBinNameInput:     document.getElementById("modalBinNameInput"),
        filterVideo:           document.getElementById("filterVideo"),
        filterAudio:           document.getElementById("filterAudio"),
        filterImage:           document.getElementById("filterImage"),
        modalRecursiveCheck:   document.getElementById("modalRecursiveCheck"),
        btnModalCancel:        document.getElementById("btnModalCancel"),
        btnModalSaveBin:       document.getElementById("btnModalSaveBin"),

        // Folder Browser Elements
        fbOverlay:             document.getElementById("fbOverlay"),
        fbCloseBtn:            document.getElementById("fbCloseBtn"),
        fbDrivesBar:           document.getElementById("fbDrivesBar"),
        fbUpBtn:               document.getElementById("fbUpBtn"),
        fbPathInput:           document.getElementById("fbPathInput"),
        fbGoBtn:               document.getElementById("fbGoBtn"),
        fbList:                document.getElementById("fbList"),
        fbSelectedHint:        document.getElementById("fbSelectedHint"),
        fbCancelBtn:           document.getElementById("fbCancelBtn"),
        fbSelectBtn:           document.getElementById("fbSelectBtn"),

        // Tools Elements
        optGuideLayer:         document.getElementById("optGuideLayer"),
        optAutoFit:            document.getElementById("optAutoFit"),
        optTargetFolder:       document.getElementById("optTargetFolder"),
        btnOpenPasteFolder:    document.getElementById("btnOpenPasteFolder"),
        recentPastesGallery:   document.getElementById("recentPastesGallery"),
        btnClearPastesHistory: document.getElementById("btnClearPastesHistory")
    };

    // ============================================================
    // Utility Helpers
    // ============================================================
    function hashPath(p) {
        if (!p) return "default";
        var h = 0;
        for (var i = 0; i < p.length; i++) {
            h = ((h << 5) - h) + p.charCodeAt(i);
            h = h & h;
        }
        return "proj_" + Math.abs(h).toString();
    }

    function setStatus(msg, duration) {
        if (el.globalStatus) {
            el.globalStatus.textContent = msg;
            el.globalStatus.title = msg;
            clearTimeout(setStatus._t);
            if (duration) {
                setStatus._t = setTimeout(function () {
                    el.globalStatus.textContent = "Ready";
                    el.globalStatus.title = "";
                }, duration);
            }
        }
    }

    function padZero(n) { return n < 10 ? "0" + n : "" + n; }

    function makeTimestampFilename(ext) {
        var d = new Date();
        return "pasted_" + d.getFullYear() + padZero(d.getMonth() + 1) + padZero(d.getDate()) +
               "_" + padZero(d.getHours()) + padZero(d.getMinutes()) + padZero(d.getSeconds()) + (ext || ".png");
    }

    /** `dir/name.ext`, or `dir/name_2.ext`, `_3`... when that is taken. */
    function uniqueFilePath(dir, fileName) {
        var ext = path.extname(fileName);
        var stem = fileName.slice(0, fileName.length - ext.length);
        var candidate = path.join(dir, fileName);
        for (var n = 2; fs.existsSync(candidate); n++) {
            candidate = path.join(dir, stem + "_" + n + ext);
        }
        return candidate;
    }

    function readJson(file, fallback) {
        try {
            if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (e) {}
        return fallback;
    }

    function writeJson(file, data) {
        try {
            fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
            return true;
        } catch (e) {
            return false;
        }
    }

    function normPath(p) { return String(p || "").replace(/\\/g, "/"); }

    function samePath(a, b) {
        var x = normPath(path.resolve(a)).replace(/\/+$/, "");
        var y = normPath(path.resolve(b)).replace(/\/+$/, "");
        return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
    }

    /** Same rules as sanitizeBinPath in host.jsx: "A/B", never outside the folder. */
    function sanitizeRelativePath(str, fallback) {
        var clean = String(str || "").split(/[\/\\]/).map(function (seg) {
            return seg.replace(/[<>:"|?*\x00-\x1f]/g, "_").trim();
        }).filter(function (seg) {
            return seg && seg !== "." && seg !== "..";
        });
        return clean.length ? clean.join("/") : (fallback || "");
    }

    function parseReply(res) {
        if (res === undefined || res === null || res === "" || res === "EvalScript error.") return null;
        if (typeof res !== "string") return res;
        try { return JSON.parse(res); } catch (e) { return null; }
    }

    function evalScriptRaw(script) {
        return new Promise(function (resolve) {
            cs.evalScript(script, function (res) { resolve(res); });
        });
    }

    function evalScriptP(script) {
        return evalScriptRaw(script).then(parseReply);
    }

    function fileMd5(filePath) {
        return new Promise(function (resolve) {
            var hash = crypto.createHash("md5");
            var stream = fs.createReadStream(filePath);
            stream.on("data", function (chunk) { hash.update(chunk); });
            stream.on("end", function () { resolve(hash.digest("hex")); });
            stream.on("error", function () { resolve(null); });
        });
    }

    function fileUrl(p) {
        return "file:///" + encodeURI(normPath(p).replace(/^\/+/, "")).replace(/#/g, "%23").replace(/\?/g, "%3F");
    }

    function makeEl(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function isEditableTarget(node) {
        if (!node || !node.tagName) return false;
        var tag = String(node.tagName).toUpperCase();
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
        if (node.isContentEditable) return true;
        return !!(node.closest && node.closest("[contenteditable]"));
    }

    function isModalOpen() {
        return !el.binModalOverlay.classList.contains("hidden") || !el.fbOverlay.classList.contains("hidden") ||
               !el.dialogOverlay.classList.contains("hidden") || !el.subModalOverlay.classList.contains("hidden");
    }

    // ============================================================
    // In-panel dialogs
    // ============================================================
    // CEP shows window.alert and window.confirm as white system windows
    // titled "JavaScript Confirm - file:///...". These look like the panel.
    var dialogQueue = Promise.resolve();
    var dialogDone = null;

    function finishDialog(answer) {
        if (!dialogDone) return;
        var done = dialogDone;
        dialogDone = null;
        el.dialogOverlay.classList.add("hidden");
        done(answer);
    }

    /**
     * One dialog at a time; resolves true for OK, false for Cancel, ✕ or Esc.
     * opts: { title, message, ok, cancel (false: no Cancel button),
     *         danger (a red OK, Cancel focused, for things that cannot be undone) }
     */
    function showDialog(opts) {
        var run = dialogQueue.then(function () {
            return new Promise(function (resolve) {
                el.dialogTitle.textContent = opts.title || "LazyKick";
                el.dialogMessage.textContent = opts.message || "";
                el.dialogOk.textContent = opts.ok || "OK";
                el.dialogOk.className = opts.danger ? "btn-danger-sm" : "btn-primary-sm";
                el.dialogCancel.textContent = opts.cancel || "Cancel";
                el.dialogCancel.style.display = opts.cancel === false ? "none" : "";
                dialogDone = resolve;
                el.dialogOverlay.classList.remove("hidden");
                try { (opts.danger ? el.dialogCancel : el.dialogOk).focus(); } catch (e) {}
            });
        });
        dialogQueue = run.then(function () {}, function () {});
        return run;
    }

    /** A message with a single OK. */
    function showMessage(title, message) {
        return showDialog({ title: title, message: message, cancel: false });
    }

    el.dialogOk.addEventListener("click", function () { finishDialog(true); });
    el.dialogCancel.addEventListener("click", function () { finishDialog(false); });
    el.dialogClose.addEventListener("click", function () { finishDialog(false); });
    document.addEventListener("keydown", function (e) {
        if (!dialogDone) return;
        if (e.key === "Escape") {
            e.preventDefault();
            finishDialog(false);
        } else if (e.key === "Enter") {
            e.preventDefault();
            finishDialog(document.activeElement !== el.dialogCancel);
        }
    });

    function hasOpenProject() {
        var id = appState.projectId;
        return !!id && id !== NONE_ID && id.indexOf("error|") !== 0 && appState.projectHost !== "none";
    }

    function isUnsavedId(id) {
        return !!id && String(id).split("|")[1] === "unsaved";
    }

    function openInOS(folderPath) {
        if (!folderPath || !fs.existsSync(folderPath)) {
            showMessage("Folder not found", "This folder does not exist on disk (any more):\n" + folderPath);
            return;
        }
        // Arguments go straight to the program, never through a shell, so a
        // folder name with quotes or ampersands cannot turn into a command.
        var command = process.platform === "win32" ? "explorer.exe" : "open";
        var target = process.platform === "win32" ? path.normalize(folderPath) : folderPath;
        try {
            var child = childProcess.spawn(command, [target], { detached: true, stdio: "ignore" });
            child.on("error", function () {});
            child.unref();
        } catch (e) {}
    }

    function openExternal(url) {
        try {
            cs.openURLInDefaultBrowser(url);
        } catch (e) {
            try { window.open(url); } catch (e2) {}
        }
    }

    function legacyCopy(text) {
        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.left = "-10000px";
        ta.style.userSelect = "text";
        document.body.appendChild(ta);
        ta.select();
        var ok = false;
        try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
        document.body.removeChild(ta);
        if (!ok) throw new Error("Copy was refused");
        return true;
    }

    /** navigator.clipboard arrived in Chromium 66; CEP 9 has 61. */
    function copyTextToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
        }
        return new Promise(function (resolve) { resolve(legacyCopy(text)); });
    }

    // ============================================================
    // Persistence: Settings & Global Notes
    // ============================================================
    function loadGeneralSettings() {
        var s = readJson(SETTINGS_FILE, {});
        if (s.guideLayer !== undefined) appState.settings.guideLayer = !!s.guideLayer;
        if (s.autoFit !== undefined) appState.settings.autoFit = !!s.autoFit;
        if (s.targetFolder) appState.settings.targetFolder = sanitizeRelativePath(s.targetFolder, DEFAULT_PASTE_FOLDER);
        if (s.autoSync !== undefined) appState.autoSync = !!s.autoSync;
        if (typeof s.lastPickerPath === "string") appState.lastPickerPath = s.lastPickerPath;
        if (typeof s.notesFontSize === "number" && s.notesFontSize >= MIN_NOTES_FONT_SIZE && s.notesFontSize <= MAX_NOTES_FONT_SIZE) {
            appState.settings.notesFontSize = s.notesFontSize;
        }
        if (s.follow !== undefined) appState.settings.follow = !!s.follow;
        if (s.timeTitles !== undefined) appState.settings.timeTitles = !!s.timeTitles;
        if (s.subtitles && typeof s.subtitles === "object") appState.settings.subtitles = s.subtitles;

        el.optGuideLayer.checked = appState.settings.guideLayer;
        el.optAutoFit.checked = appState.settings.autoFit;
        el.optTargetFolder.value = appState.settings.targetFolder;
        el.autoSyncToggle.checked = appState.autoSync;
        applyNotesFontSize();
        showFollowState();
        showTitlesState();
    }

    function saveGeneralSettings() {
        writeJson(SETTINGS_FILE, {
            guideLayer: appState.settings.guideLayer,
            autoFit: appState.settings.autoFit,
            targetFolder: appState.settings.targetFolder,
            autoSync: appState.autoSync,
            lastPickerPath: appState.lastPickerPath,
            notesFontSize: appState.settings.notesFontSize,
            follow: appState.settings.follow,
            timeTitles: appState.settings.timeTitles,
            subtitles: appState.settings.subtitles
        });
    }

    function loadGlobalNote() {
        try {
            if (fs.existsSync(GLOBAL_NOTE_FILE)) return fs.readFileSync(GLOBAL_NOTE_FILE, "utf8");
        } catch (e) {}
        return "";
    }

    function saveGlobalNote(content) {
        try { fs.writeFileSync(GLOBAL_NOTE_FILE, content, "utf8"); } catch (e) {}
    }

    // ============================================================
    // Tab Switching Navigation
    // ============================================================
    el.navTabs.forEach(function (tabBtn) {
        tabBtn.addEventListener("click", function () {
            var targetId = tabBtn.getAttribute("data-tab");
            el.navTabs.forEach(function (b) { b.classList.remove("active"); });
            el.tabContents.forEach(function (c) { c.classList.remove("active"); });

            tabBtn.classList.add("active");
            var content = document.getElementById(targetId);
            if (content) content.classList.add("active");
            if (targetId === "tabNotes") scheduleFollow(0);
        });
    });

    // ============================================================
    // Project Polling & State Management
    // ============================================================
    function notesFileFor(projId) {
        return path.join(STORAGE_DIR, hashPath(projId) + ".json");
    }

    function binsFileFor(projId) {
        return path.join(STORAGE_DIR, "bins_" + hashPath(projId) + ".json");
    }

    /**
     * Notes and watch bins made before a project was first saved move with it
     * to its saved file. Only when this session wrote them, and only when the
     * project file is brand new (just saved), so opening some other project
     * never inherits them.
     */
    function migrateUnsavedData(previousId, newId) {
        if (!previousId || !newId || !appState.touchedUnsaved) return false;
        var prev = previousId.split("|");
        var next = newId.split("|");
        if (prev[1] !== "unsaved" || next[1] !== "saved" || prev[0] !== next[0]) return false;

        var projectFile = newId.substring(next[0].length + "|saved|".length);
        try {
            if (Date.now() - fs.statSync(projectFile).mtime.getTime() > SAVED_JUST_NOW_MS) return false;
        } catch (e) {
            return false;
        }

        var moved = false;
        [[notesFileFor(previousId), notesFileFor(newId)], [binsFileFor(previousId), binsFileFor(newId)]].forEach(function (pair) {
            if (fs.existsSync(pair[0]) && !fs.existsSync(pair[1])) {
                try {
                    fs.renameSync(pair[0], pair[1]);
                    moved = true;
                } catch (e) {}
            }
        });
        appState.touchedUnsaved = false;
        return moved;
    }

    function pollProject() {
        cs.evalScript("getProjectInfo()", function (res) {
            var info = parseReply(res);
            if (!info) return; // host still starting up

            el.hostBadge.textContent = String(info.host || "none").toUpperCase();

            var id = (info.ok && info.fullId) ? info.fullId : NONE_ID;
            if (id === appState.projectId) return;

            // Whatever was typed in the last moments belongs to the project it
            // was typed in: write it there before switching.
            var previousId = appState.projectId;
            if (previousId !== null && appState.notesSaveTimer) saveCurrentNote();

            appState.projectId = id;
            appState.projectPath = info.path || null;
            appState.projectHost = info.ok ? (info.host || "none") : "none";
            appState.isSaved = !!info.saved;
            appState.projectName = info.ok ? (info.name || "Untitled") : "(No project)";

            el.projectName.textContent = appState.projectName;
            el.projectName.title = appState.projectPath || appState.projectName;

            var migrated = migrateUnsavedData(previousId, id);
            onProjectChanged(migrated);
        });
    }

    function onProjectChanged(migrated) {
        loadNotesForProject();
        loadBinsForProject();
        renderNotesTabBar();
        renderActiveNoteContent();
        renderBinCards();
        if (migrated) {
            setStatus("Notes and watch bins moved to the saved project", 3000);
        } else {
            setStatus("Loaded project: " + appState.projectName, 2000);
        }
    }

    // ============================================================
    // NOTES & TASKS ENGINE
    // ============================================================
    var savedRange = null;

    function loadNotesForProject() {
        appState.globalNote = loadGlobalNote();
        var d = readJson(notesFileFor(appState.projectId), null);
        if (!d || typeof d !== "object") d = {};
        if (!d.tabs || !d.tabs.length) d.tabs = [{ name: "Note 1", content: "" }];
        if (d.activeTabId !== "global" && !d.tabs[parseInt(d.activeTabId, 10)]) d.activeTabId = "0";
        appState.notesData = d;
    }

    /** Copy the editor into the state of whichever tab it is showing. */
    function captureEditor() {
        var html = el.noteEditor.innerHTML;
        if (appState.notesData.activeTabId === "global") {
            appState.globalNote = html;
        } else {
            var tab = appState.notesData.tabs[parseInt(appState.notesData.activeTabId, 10)];
            if (tab) tab.content = html;
        }
    }

    function writeProjectNotes() {
        if (!appState.projectId) return;
        writeJson(notesFileFor(appState.projectId), appState.notesData);
        if (isUnsavedId(appState.projectId)) appState.touchedUnsaved = true;
    }

    function saveCurrentNote() {
        clearTimeout(appState.notesSaveTimer);
        appState.notesSaveTimer = null;
        if (!appState.projectId) return; // nothing has been loaded into the editor yet

        captureEditor();
        if (appState.notesData.activeTabId === "global") {
            saveGlobalNote(appState.globalNote);
        } else {
            writeProjectNotes();
        }
        setStatus("Notes saved", 1000);
    }

    function debouncedSaveNote() {
        clearTimeout(appState.notesSaveTimer);
        appState.notesSaveTimer = setTimeout(saveCurrentNote, 300);
    }

    function renderNotesTabBar() {
        el.notesTabBar.innerHTML = "";

        // Global Tab
        var globalBtn = makeEl("button", "sub-tab" + (appState.notesData.activeTabId === "global" ? " active" : ""), "🌐 Global");
        globalBtn.setAttribute("data-tab-id", "global");
        globalBtn.title = "Scratchpad shared by every project";
        globalBtn.addEventListener("click", function () { switchNoteTab("global"); });
        el.notesTabBar.appendChild(globalBtn);

        // Project Tabs
        appState.notesData.tabs.forEach(function (tab, idx) {
            var strIdx = String(idx);
            var tabBtn = makeEl("button", "sub-tab" + (appState.notesData.activeTabId === strIdx ? " active" : ""), tab.name || ("Note " + (idx + 1)));
            tabBtn.setAttribute("data-tab-id", strIdx);
            tabBtn.title = "Double-click to rename";
            tabBtn.addEventListener("click", function () { switchNoteTab(strIdx); });
            tabBtn.addEventListener("dblclick", function () { startRenameTab(tabBtn, idx); });
            el.notesTabBar.appendChild(tabBtn);
        });
    }

    /** Rename in place: CEP's Chromium has no window.prompt(). */
    function startRenameTab(tabBtn, idx) {
        var tab = appState.notesData.tabs[idx];
        if (!tab || !tabBtn.parentNode) return;

        var input = makeEl("input", "sub-tab-rename");
        input.type = "text";
        input.value = tab.name || ("Note " + (idx + 1));
        input.maxLength = 40;
        input.spellcheck = false;
        tabBtn.parentNode.replaceChild(input, tabBtn);
        input.focus();
        input.select();

        var finished = false;
        function finish(commit) {
            if (finished) return;
            finished = true;
            if (commit) {
                var name = input.value.trim();
                if (name) tab.name = name;
                writeProjectNotes();
            }
            renderNotesTabBar();
        }
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") finish(true);
            else if (e.key === "Escape") finish(false);
            e.stopPropagation();
        });
        input.addEventListener("blur", function () { finish(true); });
    }

    function switchNoteTab(tabId) {
        saveCurrentNote();
        appState.notesData.activeTabId = tabId;
        writeProjectNotes();
        renderNotesTabBar();
        renderActiveNoteContent();
    }

    function renderActiveNoteContent() {
        if (appState.notesData.activeTabId === "global") {
            el.noteEditor.innerHTML = appState.globalNote || "";
        } else {
            var idx = parseInt(appState.notesData.activeTabId, 10);
            var tab = appState.notesData.tabs[idx] || appState.notesData.tabs[0];
            el.noteEditor.innerHTML = (tab && tab.content) ? tab.content : "";
        }
        savedRange = null;
        noteChanged();
        showRetakes();
    }

    function rememberSelection() {
        var sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && el.noteEditor.contains(sel.anchorNode)) {
            savedRange = sel.getRangeAt(0).cloneRange();
        }
    }

    /** Focus the editor with the caret back where it was before a toolbar click. */
    function focusEditor() {
        el.noteEditor.focus();
        var sel = window.getSelection();
        if (!sel) return;
        var range;
        if (savedRange && el.noteEditor.contains(savedRange.startContainer)) {
            range = savedRange;
        } else {
            range = document.createRange();
            range.selectNodeContents(el.noteEditor);
            range.collapse(false);
        }
        sel.removeAllRanges();
        sel.addRange(range);
    }

    /** The note as plain text, with checklist items written as [ ] and [x]. */
    function noteToPlainText() {
        var clone = el.noteEditor.cloneNode(true);
        var boxes = clone.querySelectorAll(".todo-checkbox");
        for (var i = 0; i < boxes.length; i++) {
            var marker = document.createTextNode(boxes[i].hasAttribute("checked") ? "[x] " : "[ ] ");
            boxes[i].parentNode.replaceChild(marker, boxes[i]);
        }
        clone.removeAttribute("id");
        clone.removeAttribute("contenteditable");
        clone.style.position = "absolute";
        clone.style.left = "-10000px";
        clone.style.top = "0";
        clone.style.height = "auto";
        document.body.appendChild(clone);
        var text = clone.innerText;
        document.body.removeChild(clone);
        return text;
    }

    // Checklist boxes: one delegated listener survives every re-render.
    el.noteEditor.addEventListener("change", function (e) {
        var cb = e.target;
        if (!cb || !cb.classList || !cb.classList.contains("todo-checkbox")) return;
        var item = cb.closest(".todo-item");
        if (!item) return;
        if (cb.checked) {
            item.classList.add("completed");
            cb.setAttribute("checked", "checked");
        } else {
            item.classList.remove("completed");
            cb.removeAttribute("checked");
        }
        debouncedSaveNote();
    });

    el.noteEditor.addEventListener("input", function () {
        rememberSelection();
        debouncedSaveNote();
    });
    el.noteEditor.addEventListener("keyup", rememberSelection);
    el.noteEditor.addEventListener("mouseup", rememberSelection);

    el.btnAddNoteTab.addEventListener("click", function () {
        saveCurrentNote();
        var newIdx = appState.notesData.tabs.length;
        appState.notesData.tabs.push({ name: "Note " + (newIdx + 1), content: "" });
        switchNoteTab(String(newIdx));
    });

    el.btnDeleteNoteTab.addEventListener("click", function () {
        if (appState.notesData.activeTabId === "global") {
            showMessage("Notes", "The Global Scratchpad cannot be deleted.");
            return;
        }
        if (appState.notesData.tabs.length <= 1) {
            showMessage("Notes", "You must keep at least one project note tab.");
            return;
        }
        var projectBefore = appState.projectId;
        var tabBefore = appState.notesData.activeTabId;
        var tabName = (appState.notesData.tabs[parseInt(tabBefore, 10)] || {}).name || "this tab";
        showDialog({
            title: "Delete note tab",
            message: "Delete \"" + tabName + "\"? Its notes cannot be brought back.",
            ok: "Delete",
            danger: true
        }).then(function (ok) {
            // Nothing is deleted if another project or tab came up meanwhile.
            if (!ok || appState.projectId !== projectBefore || appState.notesData.activeTabId !== tabBefore) return;
            // Drop any pending save: it would write the deleted tab's text
            // into whichever tab takes its place.
            clearTimeout(appState.notesSaveTimer);
            appState.notesSaveTimer = null;

            var idx = parseInt(appState.notesData.activeTabId, 10);
            appState.notesData.tabs.splice(idx, 1);
            appState.notesData.activeTabId = String(Math.max(0, idx - 1));
            writeProjectNotes();
            renderNotesTabBar();
            renderActiveNoteContent();
            setStatus("Note tab deleted", 1500);
        });
    });

    el.btnInsertTask.addEventListener("click", function () {
        focusEditor();
        var html = '<div class="todo-item"><input type="checkbox" class="todo-checkbox"><span class="todo-text">New Task</span></div><div><br></div>';
        document.execCommand("insertHTML", false, html);
        rememberSelection();
        debouncedSaveNote();
    });

    el.btnInsertTimecode.addEventListener("click", function () {
        evalScriptP("getCurrentTimecode()").then(function (data) {
            if (!data || !data.ok || !data.timecode) {
                setStatus((data && data.msg) || "Could not read the timeline timecode", 3000);
                return;
            }
            focusEditor();
            document.execCommand("insertHTML", false, '<span class="timecode-tag">[' + data.timecode + ']</span>&nbsp;');
            rememberSelection();
            debouncedSaveNote();
            setStatus("Inserted timecode: " + data.timecode, 2000);
        });
    });

    el.btnCopyNote.addEventListener("click", function () {
        copyTextToClipboard(noteToPlainText()).then(function () {
            setStatus("Note copied to clipboard!", 2000);
        }, function () {
            setStatus("Could not copy the note", 3000);
        });
    });

    el.btnExportNote.addEventListener("click", function () {
        saveCurrentNote();
        var text = noteToPlainText();
        var defaultFolder = appState.projectPath ? path.dirname(appState.projectPath) : os.homedir();
        var tabName = appState.notesData.activeTabId === "global"
            ? "Global"
            : ((appState.notesData.tabs[parseInt(appState.notesData.activeTabId, 10)] || {}).name || "Note");
        var projectPart = appState.projectName.replace(/\.[^.]+$/, "");
        var filename = ("Note_" + projectPart + "_" + tabName).replace(/[^\w\-]+/g, "_") + ".txt";
        var targetFile = uniqueFilePath(defaultFolder, filename);

        try {
            fs.writeFileSync(targetFile, text, "utf8");
            setStatus("Exported note to: " + path.basename(targetFile), 3000);
            showMessage("Note exported", "Saved to:\n" + targetFile);
        } catch (e) {
            showMessage("Export failed", "The note could not be saved:\n" + e.message);
        }
    });

    // ============================================================
    // SCRIPT TO AUDIO (timecodes from the voiceover, then subtitles)
    // ============================================================
    //
    // Every spoken line of the note (a sentence or a whole paragraph) is
    // timed. 🎙️ reads the open timeline's audio from the host, finds where
    // each sentence is spoken (client/align.js) and starts the line with a
    // timecode tag. The tag keeps the measured start and end in data-t /
    // data-e (seconds from the timeline start) and each word's time in
    // data-w; a tag edited by hand is read from its text instead. 💬 asks
    // for the layout (single line, double line or single word), turns the
    // tagged lines into subtitles (long ones split in several), writes an
    // .srt next to the project and has the host place them.

    var BLOCK_TAGS = { DIV: true, P: true, LI: true, UL: true, OL: true, BLOCKQUOTE: true, PRE: true,
                       H1: true, H2: true, H3: true, H4: true, H5: true, H6: true };
    var NBSP = String.fromCharCode(160);
    var scriptBusy = false;

    function isTimecodeTag(node) {
        return !!(node && node.nodeType === 1 && node.classList && node.classList.contains("timecode-tag"));
    }

    /** Words taken out of the timeline: struck through, and no longer timed or in subtitles. */
    function isStruckWords(node) {
        return !!(node && node.nodeType === 1 && node.classList && node.classList.contains("note-cut"));
    }

    function isBlankText(node) {
        return node.nodeType === 3 && !String(node.textContent).split(NBSP).join("").trim();
    }

    /** Every line its own block: Chromium leaves the first line loose, and pasted text may use <br>. */
    function normalizeEditorBlocks() {
        var editor = el.noteEditor;
        var node = editor.firstChild;
        var run = null;
        while (node) {
            var next = node.nextSibling;
            if (node.nodeType === 1 && BLOCK_TAGS[node.nodeName]) {
                run = null;
            } else if (node.nodeType === 1 && node.nodeName === "BR") {
                if (run) {
                    editor.removeChild(node); // it only ended the line before
                } else {
                    var empty = document.createElement("div");
                    editor.insertBefore(empty, node);
                    empty.appendChild(node);
                }
                run = null;
            } else {
                if (!run) {
                    run = document.createElement("div");
                    editor.insertBefore(run, node);
                }
                run.appendChild(node);
            }
            node = next;
        }
    }

    function textWithoutTags(node) {
        if (node.nodeType === 3) return String(node.textContent);
        if (isTimecodeTag(node) || isStruckWords(node)) return "";
        var s = "";
        for (var child = node.firstChild; child; child = child.nextSibling) s += textWithoutTags(child);
        return node.nodeName === "BR" ? s + " " : s;
    }

    /**
     * A line that is part of the script's layout, not something said: a grey
     * side note or a checklist item, and a heading while 🔠 Titles is off.
     */
    function isUnspoken(node) {
        return (/^H[1-6]$/.test(node.nodeName) && !appState.settings.timeTitles) ||
               node.classList.contains("note-muted") || node.classList.contains("todo-item");
    }

    /**
     * The note's spoken lines: [{ node, text }]. Grey side notes, checklist
     * items, lines like "---" and (with 🔠 Titles off) headings are left out.
     */
    function scriptLines() {
        normalizeEditorBlocks();
        var lines = [];
        for (var node = el.noteEditor.firstChild; node; node = node.nextSibling) {
            if (node.nodeType !== 1 || isUnspoken(node)) continue;
            var text = textWithoutTags(node).split(NBSP).join(" ").replace(/\s+/g, " ").trim();
            if (LazyAlign.isSpoken(text)) lines.push({ node: node, text: text });
        }
        return lines;
    }

    /** The timecode tag a line starts with, or null. */
    function leadingTag(line) {
        for (var n = line.firstChild; n; n = n.nextSibling) {
            if (isBlankText(n)) continue;
            return isTimecodeTag(n) ? n : null;
        }
        return null;
    }

    /**
     * Start the line with a tag for `span` (seconds from the timeline start),
     * replacing the one it had. `words`: each word's start, in seconds after
     * the line's (kept in data-w for following the playhead and subtitles).
     * `pin`: the time the user pinned the line to (kept in data-anchor).
     */
    function setLeadingTag(line, span, timeline, words, pin) {
        dropLeadingTags(line);
        var tag = document.createElement("span");
        tag.className = "timecode-tag";
        tag.setAttribute("data-t", span.start.toFixed(3));
        tag.setAttribute("data-e", span.end.toFixed(3));
        if (words && words.length) tag.setAttribute("data-w", words.map(function (w) { return String(Math.round(w * 100) / 100); }).join(","));
        if (typeof pin === "number" && isFinite(pin)) tag.setAttribute("data-anchor", pin.toFixed(3));
        tag.textContent = "[" + LazyAlign.formatTimecode(timeline.offset + span.start, timeline.fps) + "]";
        line.insertBefore(document.createTextNode(NBSP), line.firstChild);
        line.insertBefore(tag, line.firstChild);
    }

    function dropLeadingTags(line) {
        var old = leadingTag(line);
        while (old) {
            var after = old.nextSibling;
            line.removeChild(old);
            if (after && after.nodeType === 3) after.textContent = String(after.textContent).replace(/^[\s ]+/, "");
            old = leadingTag(line);
        }
    }

    /**
     * Start and end of a tag in seconds from the timeline start. A tag
     * LazyKick wrote and nobody changed gives its measured times; a tag typed
     * or edited by hand (or from ⏱️ Timecode) is read from its text.
     */
    function tagTimes(tag, timeline) {
        var text = String(tag.textContent || "").trim();
        var t = parseFloat(tag.getAttribute("data-t"));
        var e = parseFloat(tag.getAttribute("data-e"));
        if (isFinite(t) && text === "[" + LazyAlign.formatTimecode(timeline.offset + t, timeline.fps) + "]") {
            return { start: t, end: isFinite(e) ? e : undefined };
        }
        var typed = LazyAlign.parseTimecode(text, timeline.fps);
        if (typed === null) return null;
        var start = typed - timeline.offset;
        return { start: start, end: isFinite(e) && e > start + 0.3 ? e : undefined };
    }

    function lineWords(node) {
        return LazyAlign.splitWords(textWithoutTags(node).split(NBSP).join(" "));
    }

    /** Absolute start time of each word of a timed line: from data-w when it still fits the text, else spread by spoken length. */
    function wordTimesOf(tag, words, start, end) {
        var raw = String(tag.getAttribute("data-w") || "");
        var offsets = raw ? raw.split(",").map(Number) : [];
        if (offsets.length === words.length && offsets.every(function (o) { return isFinite(o); })) {
            return offsets.map(function (o) { return start + o; });
        }
        return LazyAlign.proportionalWordTimes(words, start, end);
    }

    function setScriptBusy(busy) {
        scriptBusy = busy;
        el.btnTimeToAudio.disabled = busy;
        el.btnSubtitles.disabled = busy;
        el.btnRetakes.disabled = busy;
    }

    /** RMS loudness every 10 ms of a WAV, read in chunks so the panel stays responsive. */
    function readWavEnvelope(filePath) {
        return new Promise(function (resolve) {
            var env = new LazyAlign.WavEnvelope(0.01);
            var stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
            stream.on("data", function (chunk) { env.push(chunk); });
            stream.on("end", function () { resolve(env.finish()); });
            stream.on("error", function (e) { resolve({ values: [], error: e.message }); });
        });
    }

    // The speech of the last timeline listened to, so pinning a line re-times
    // the others at once instead of exporting the audio again.
    var heardAudio = null;
    // The retakes the last 🎙️ Time to Audio left out, for ✂️ Retakes.
    var lastRetakes = null;

    function timelineKey(t) {
        return [appState.projectId, t.name, t.fps, t.offset, t.duration].join("|");
    }

    /** The open timeline's speech as last heard, or null when it was not heard or has changed shape. */
    function reusableAudio() {
        if (!heardAudio) return Promise.resolve(null);
        return evalScriptP("getTimelineInfo()").then(function (t) {
            return t && t.ok && timelineKey(t) === heardAudio.key ? heardAudio : null;
        });
    }

    /** Asks the host for the timeline audio: { key, speech, heard, timeline } or null (the status says why). */
    function listenToTimeline() {
        var wavPath = path.join(os.tmpdir(), "lazykick-voice-" + Date.now() + ".wav");
        setStatus("Listening to the timeline audio...");
        return evalScriptP("getTimelineAudio(" + JSON.stringify(normPath(wavPath)) + ")").then(function (r) {
            if (!r || !r.ok) {
                setStatus((r && r.msg) || "Could not read the timeline audio", 5000);
                return null;
            }
            var envelope = r.kind === "wav"
                ? readWavEnvelope(r.path)
                : Promise.resolve({ step: r.step, start: r.start, values: r.values || [] });
            return envelope.then(function (env) {
                if (r.kind === "wav") removeQuietly(r.path);
                if (env.error) {
                    setStatus("Could not read the audio: " + env.error, 5000);
                    return null;
                }
                heardAudio = {
                    key: timelineKey(r),
                    speech: LazyAlign.findSpeech(env),
                    heard: r.used === "selected" ? "the selected audio" : "the timeline audio",
                    timeline: r
                };
                return heardAudio;
            });
        });
    }

    /**
     * The pins among `lines` ([{ node }]): [{ line: index, word, t: seconds }].
     * A line's start is pinned on its tag (data-anchor), a word inside it by
     * a span.note-pin around the word (data-pin).
     */
    function pinsOf(lines) {
        var pins = [];
        for (var i = 0; i < lines.length; i++) {
            var tag = leadingTag(lines[i].node);
            var t = tag ? parseFloat(tag.getAttribute("data-anchor")) : NaN;
            if (isFinite(t)) pins.push({ line: i, word: 0, t: t });
            var spans = lines[i].node.querySelectorAll(".note-pin");
            if (!spans.length) continue;
            var ranges = wordRanges(lines[i].node);
            for (var s = 0; s < spans.length; s++) {
                var at = parseFloat(spans[s].getAttribute("data-pin"));
                if (!isFinite(at)) continue;
                for (var w = 0; w < ranges.length; w++) {
                    if (spans[s].contains(ranges[w].startContainer)) {
                        pins.push({ line: i, word: w, t: at });
                        break;
                    }
                }
            }
        }
        return pins;
    }

    /**
     * Times every spoken line to the voiceover, keeping pinned lines where
     * they were pinned. options.reuse: use the audio already heard from this
     * timeline, if any (after pinning a line), instead of listening again.
     */
    function timeToAudio(options) {
        options = options || {};
        if (scriptBusy) return Promise.resolve();
        var lines = scriptLines();
        if (!lines.length) {
            setStatus("Write or paste the script first: lines or whole paragraphs, in the order they are spoken", 5000);
            return Promise.resolve();
        }
        var projectBefore = appState.projectId;
        var tabBefore = appState.notesData.activeTabId;
        setScriptBusy(true);

        return (options.reuse ? reusableAudio() : Promise.resolve(null)).then(function (known) {
            return known || listenToTimeline();
        }).then(function (audio) {
            if (!audio) return null;
            var r = audio.timeline;
            var pins = pinsOf(lines);
            var spans = LazyAlign.alignScript(lines.map(function (l) { return l.text; }), audio.speech, { anchors: pins });
            if (!spans) {
                setStatus("No speech found in " + audio.heard + " of '" + r.name + "'", 5000);
                return null;
            }
            if (appState.projectId !== projectBefore || appState.notesData.activeTabId !== tabBefore ||
                !lines.every(function (l) { return l.node.parentNode === el.noteEditor; })) {
                setStatus("The note changed while listening; nothing was changed", 4000);
                return null;
            }
            var pinOf = {};   // lines pinned at their start keep the pin on their tag
            pins.forEach(function (p) { if (!p.word) pinOf[p.line] = p.t; });
            spans.forEach(function (span, i) {
                setLeadingTag(lines[i].node, span, r, span.words, pinOf[i]);
            });
            noteChanged();
            saveCurrentNote();
            var retakes = (spans.outtakes || []).length;
            lastRetakes = retakes ? { key: audio.key, projectId: projectBefore, tabId: tabBefore, outtakes: spans.outtakes } : null;
            showRetakes();
            setStatus("Timed " + lines.length + " line" + (lines.length === 1 ? "" : "s") + " to " + audio.heard + " of '" + r.name + "'" +
                      (retakes ? " · " + retakes + " retake" + (retakes === 1 ? "" : "s") + " left out" : "") +
                      (pins.length ? " · " + pins.length + " pinned" : ""), 5000);
            return spans;
        }).catch(function (err) {
            setStatus("Time to Audio failed: " + (err && err.message ? err.message : err), 5000);
            return null;
        }).then(function (result) {
            setScriptBusy(false);
            return result;
        });
    }

    // ------------------------------------------------------------
    // The Create subtitles dialog: layout, length, duration, gap and
    // punctuation, as Premiere Pro's Create captions offers them, with a
    // preview of the first subtitles. The choices are remembered.
    // ------------------------------------------------------------

    var subForm = { done: null, lines: null, timeline: null };
    var SUB_LAYOUT_HINTS = {
        single: "One line per subtitle",
        double: "Up to two lines per subtitle",
        word: "One word at a time, while it is said"
    };
    var SUB_PREVIEW_ROWS = 3;

    function subtitleChoices() {
        return LazyAlign.cueOptions(appState.settings.subtitles);
    }

    function readSubtitleForm() {
        return LazyAlign.cueOptions({
            layout: el.optSubWord.checked ? "word" : (el.optSubSingle.checked ? "single" : "double"),
            maxChars: el.optSubMaxChars.value,
            minSeconds: el.optSubMinSeconds.value,
            gapFrames: el.optSubGap.value,
            removePunctuation: !!el.optSubNoPunct.checked
        });
    }

    /** Single Word has no line length, minimum duration or gap, as in Premiere Pro: those rows are greyed out. */
    function showSubtitleLayout(layout) {
        var byWord = layout === "word";
        el.subLayoutHint.textContent = SUB_LAYOUT_HINTS[layout];
        [el.subMaxCharsRow, el.subMinSecondsRow, el.subGapRow].forEach(function (row) { row.classList.toggle("is-off", byWord); });
        [el.optSubMaxChars, el.optSubMaxCharsRange, el.optSubMinSeconds, el.optSubMinSecondsRange, el.optSubGap, el.optSubGapRange]
            .forEach(function (input) { input.disabled = byWord; });
    }

    function fillSubtitleForm(o) {
        el.optSubSingle.checked = o.layout === "single";
        el.optSubDouble.checked = o.layout === "double";
        el.optSubWord.checked = o.layout === "word";
        el.optSubMaxChars.value = el.optSubMaxCharsRange.value = String(o.maxChars);
        el.optSubMinSeconds.value = o.minSeconds.toFixed(1);
        el.optSubMinSecondsRange.value = String(o.minSeconds);
        el.optSubGap.value = el.optSubGapRange.value = String(o.gapFrames);
        el.optSubNoPunct.checked = o.removePunctuation;
        showSubtitleLayout(o.layout);
    }

    function subtitleCues(lines, timeline, o) {
        return LazyAlign.makeCues(lines, {
            layout: o.layout, maxChars: o.maxChars, minSeconds: o.minSeconds, gapFrames: o.gapFrames,
            removePunctuation: o.removePunctuation, fps: timeline.fps
        });
    }

    function updateSubtitlePreview() {
        if (!subForm.done) return;
        var o = readSubtitleForm();
        showSubtitleLayout(o.layout);
        var cues = subtitleCues(subForm.lines, subForm.timeline, o);
        el.subPreviewCount.textContent = "· " + cues.length + " subtitle" + (cues.length === 1 ? "" : "s");
        el.subPreviewList.textContent = "";
        cues.slice(0, SUB_PREVIEW_ROWS).forEach(function (c) {
            var row = makeEl("div", "sub-preview-row");
            row.appendChild(makeEl("span", "sub-preview-time", LazyAlign.formatTimecode(subForm.timeline.offset + c.start, subForm.timeline.fps)));
            row.appendChild(makeEl("span", "sub-preview-text", c.text));
            el.subPreviewList.appendChild(row);
        });
        if (cues.length > SUB_PREVIEW_ROWS) el.subPreviewList.appendChild(makeEl("div", "sub-preview-more", "and " + (cues.length - SUB_PREVIEW_ROWS) + " more"));
    }

    /** Resolves to the chosen options, or null for Cancel, ✕ or Esc. */
    function askSubtitleOptions(lines, timeline) {
        return new Promise(function (resolve) {
            subForm.done = resolve;
            subForm.lines = lines;
            subForm.timeline = timeline;
            fillSubtitleForm(subtitleChoices());
            updateSubtitlePreview();
            el.subModalOverlay.classList.remove("hidden");
            try { el.btnSubCreate.focus(); } catch (e) {}
        });
    }

    function finishSubtitleForm(create) {
        if (!subForm.done) return;
        var done = subForm.done;
        var choices = create ? readSubtitleForm() : null;
        subForm.done = null;
        subForm.lines = null;
        subForm.timeline = null;
        el.subModalOverlay.classList.add("hidden");
        if (choices) {
            appState.settings.subtitles = choices;
            saveGeneralSettings();
        }
        done(choices);
    }

    /** A slider and its number box move together; a typed number is put in range once it is left. */
    function linkSubtitleInputs(number, range) {
        range.addEventListener("input", function () {
            number.value = range.value;
            updateSubtitlePreview();
        });
        number.addEventListener("input", function () {
            if (isFinite(parseFloat(number.value))) range.value = number.value;
            updateSubtitlePreview();
        });
        number.addEventListener("change", function () {
            if (!subForm.done) return;
            fillSubtitleForm(readSubtitleForm());
            updateSubtitlePreview();
        });
    }

    linkSubtitleInputs(el.optSubMaxChars, el.optSubMaxCharsRange);
    linkSubtitleInputs(el.optSubMinSeconds, el.optSubMinSecondsRange);
    linkSubtitleInputs(el.optSubGap, el.optSubGapRange);
    [el.optSubSingle, el.optSubDouble, el.optSubWord, el.optSubNoPunct].forEach(function (input) {
        input.addEventListener("change", updateSubtitlePreview);
    });
    el.btnSubCreate.addEventListener("click", function () { finishSubtitleForm(true); });
    el.btnSubCancel.addEventListener("click", function () { finishSubtitleForm(false); });
    el.subModalClose.addEventListener("click", function () { finishSubtitleForm(false); });
    document.addEventListener("keydown", function (e) {
        if (!subForm.done || dialogDone) return;
        if (e.key === "Escape") {
            e.preventDefault();
            finishSubtitleForm(false);
        } else if (e.key === "Enter" && document.activeElement !== el.btnSubCancel && document.activeElement !== el.subModalClose) {
            e.preventDefault();
            finishSubtitleForm(true);
        }
    });

    function subtitlesToTimeline() {
        if (scriptBusy) return Promise.resolve();
        var timed = scriptLines().filter(function (l) { return !!leadingTag(l.node); });
        if (!timed.length) {
            setStatus("No timed lines yet: click 🎙️ Time to Audio first (or start lines with a timecode)", 5000);
            return Promise.resolve();
        }
        var projectBefore = appState.projectId;
        var tabBefore = appState.notesData.activeTabId;
        setScriptBusy(true);
        setStatus("Reading the timeline...");

        return evalScriptP("getTimelineInfo()").then(function (timeline) {
            if (!timeline || !timeline.ok) {
                setStatus((timeline && timeline.msg) || "Open a sequence or composition first", 4000);
                return null;
            }
            var lines = timed.map(function (l) {
                var tag = leadingTag(l.node);
                var times = tagTimes(tag, timeline);
                if (!times) return null;
                var words = LazyAlign.splitWords(l.text);
                var end = times.end !== undefined ? times.end : times.start + LazyAlign.readingTime(l.text);
                return { start: times.start, end: times.end, text: l.text, words: wordTimesOf(tag, words, times.start, end) };
            }).filter(function (c) { return c && c.start >= 0; });
            if (!subtitleCues(lines, timeline, subtitleChoices()).length) {
                setStatus("None of the timecodes fall on '" + timeline.name + "'", 4000);
                return null;
            }
            setStatus("Choose how the subtitles look");
            return askSubtitleOptions(lines, timeline).then(function (choices) {
                if (!choices) {
                    setStatus("No subtitles made", 2500);
                    return null;
                }
                if (appState.projectId !== projectBefore || appState.notesData.activeTabId !== tabBefore ||
                    !timed.every(function (l) { return l.node.parentNode === el.noteEditor; })) {
                    setStatus("The project or note changed; no subtitles were made", 4000);
                    return null;
                }
                var cues = subtitleCues(lines, timeline, choices);
                if (!cues.length) {
                    setStatus("Nothing left to show: every word was punctuation", 4000);
                    return null;
                }
                setStatus("Making subtitles...");
                return placeSubtitleCues(cues, timeline);
            });
        }).catch(function (err) {
            setStatus("Subtitles failed: " + (err && err.message ? err.message : err), 5000);
            return null;
        }).then(function (result) {
            setScriptBusy(false);
            return result;
        });
    }

    /** Writes the SRT next to the project and has the host lay the cues on the open timeline. */
    function placeSubtitleCues(cues, timeline) {
        return currentProjectFolder().then(function (projectFolder) {
            var dir = path.join(projectFolder || os.homedir(), "LazyKick Subtitles");
            mkdirp(dir);
            var base = sanitizeRelativePath(String(timeline.name || "").replace(/[\/\\]/g, "_"), "Subtitles");
            var srtPath = uniqueFilePath(dir, base + ".srt");
            // UTF-8 with a BOM, so every app reads Bengali and other scripts right.
            fs.writeFileSync(srtPath, String.fromCharCode(0xFEFF) + LazyAlign.buildSrt(cues), "utf8");
            var payload = {
                srtPath: normPath(srtPath),
                cues: cues.map(function (c) { return { s: Math.round(c.start * 1000) / 1000, e: Math.round(c.end * 1000) / 1000, t: c.text }; })
            };
            return evalScriptP("placeSubtitles(" + JSON.stringify(JSON.stringify(payload)) + ")").then(function (r) {
                if (r && r.ok) setStatus(r.msg + " · SRT: " + path.basename(srtPath), 6000);
                else setStatus(((r && r.msg) || "The host did not answer") + " · SRT saved: " + srtPath, 7000);
                return { reply: r, srtPath: srtPath, cues: cues };
            });
        });
    }

    el.btnTimeToAudio.addEventListener("click", function () { timeToAudio(); });
    el.btnSubtitles.addEventListener("click", function () { subtitlesToTimeline(); });

    // ============================================================
    // NOTE TEXT: size, and pasting from Docs and Word
    // ============================================================

    var noteVersion = 0;
    /** The note's lines changed: the playhead highlight works out its lines again. */
    function noteChanged() { noteVersion++; }

    function applyNotesFontSize() {
        el.noteEditor.style.fontSize = appState.settings.notesFontSize + "px";
    }

    function changeNotesFontSize(delta) {
        var size = Math.max(MIN_NOTES_FONT_SIZE, Math.min(MAX_NOTES_FONT_SIZE, appState.settings.notesFontSize + delta));
        if (size === appState.settings.notesFontSize) return;
        appState.settings.notesFontSize = size;
        applyNotesFontSize();
        saveGeneralSettings();
        noteChanged();
        setStatus("Notes text size: " + size + " px", 1500);
    }

    el.btnTextSmaller.addEventListener("click", function () { changeNotesFontSize(-1); });
    el.btnTextBigger.addEventListener("click", function () { changeNotesFontSize(1); });

    var LIFT_TAGS = { DIV: true, P: true, H1: true, H2: true, H3: true, H4: true, H5: true, H6: true,
                      BLOCKQUOTE: true, UL: true, OL: true, LI: true, PRE: true };

    function hasBlockChild(node) {
        for (var c = node.firstChild; c; c = c.nextSibling) {
            if (c.nodeType === 1 && LIFT_TAGS[c.nodeName]) return true;
        }
        return false;
    }

    function unwrap(node) {
        var parent = node.parentNode;
        if (!parent) return;
        while (node.firstChild) parent.insertBefore(node.firstChild, node);
        parent.removeChild(node);
    }

    /** A line that holds whole paragraphs (several were pasted into it) becomes one line per paragraph. */
    function liftBlocks(node) {
        var editor = el.noteEditor;
        var run = null;
        while (node.firstChild) {
            var c = node.firstChild;
            if (c.nodeType === 1 && LIFT_TAGS[c.nodeName]) {
                run = null;
                editor.insertBefore(c, node);
                if (hasBlockChild(c)) liftBlocks(c);
            } else {
                if (!run) {
                    run = document.createElement(node.nodeName === "P" ? "p" : "div");
                    if (node.className) run.className = node.className;
                    editor.insertBefore(run, node);
                }
                run.appendChild(c);
            }
        }
        editor.removeChild(node);
    }

    /**
     * After a paste: no inline styles and no <span>/<font> wrappers the
     * browser adds while pasting (LazyKick's own spans have a class), and
     * one block per line at the top, as the timing expects. A colour span
     * gets its style back from its own data-fg / data-bg, never from what
     * the browser wrote.
     */
    function tidyEditor() {
        var editor = el.noteEditor;
        var styled = editor.querySelectorAll("[style]");
        for (var s = 0; s < styled.length; s++) styled[s].removeAttribute("style");
        var wrappers = editor.querySelectorAll("span, font");
        for (var w = 0; w < wrappers.length; w++) {
            var span = wrappers[w];
            if (span.nodeName === "SPAN" && span.classList.contains("note-color")) {
                var look = LazyPaste.colourStyle(span.getAttribute("data-fg"), span.getAttribute("data-bg"));
                if (look) {
                    span.setAttribute("style", look);
                    continue;
                }
            } else if (span.nodeName === "SPAN" && span.className) {
                continue;
            }
            unwrap(span);
        }
        for (var node = editor.firstChild; node; ) {
            var next = node.nextSibling;
            if (node.nodeType === 1 && !node.classList.contains("todo-item") && hasBlockChild(node)) liftBlocks(node);
            node = next;
        }
        normalizeEditorBlocks();
    }

    // Ctrl/Cmd+Shift+V pastes plain text, as in most apps.
    var plainPasteUntil = 0;
    var pasteSeen = false;
    el.noteEditor.addEventListener("keydown", function (e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.keyCode === 86 || e.key === "v" || e.key === "V")) plainPasteUntil = Date.now() + 1500;
    });

    /**
     * Puts clipboard content at the caret: the HTML rebuilt by
     * client/paste.js, so it looks like the source (headings, bold, italic,
     * underline, strikethrough, lists, highlights and coloured text), or the
     * plain text when `plain` is set or the HTML gives nothing. The HTML is
     * never inserted as it came. False when there was nothing to paste.
     */
    function insertClipboard(html, text, plain) {
        demoteEmptyHeading();
        if (html && !plain && typeof DOMParser === "function") {
            // The paste was already stopped, so a failure here must not
            // lose it: fall through to the plain text.
            var clean = null;
            try {
                clean = LazyPaste.toNoteHtml(new DOMParser().parseFromString(html, "text/html"));
            } catch (err) {
                clean = null;
            }
            if (clean && clean.html) {
                document.execCommand("insertHTML", false, clean.html);
                tidyEditor();
                rememberSelection();
                noteChanged();
                debouncedSaveNote();
                return true;
            }
        }
        if (!text) return false;
        document.execCommand("insertText", false, text);
        // Lines split from a heading or a coloured run come with its size and
        // look on a <span style>: plain text keeps the note's own style.
        tidyEditor();
        rememberSelection();
        noteChanged();
        debouncedSaveNote();
        return true;
    }

    /**
     * A heading left with no text (select all and delete keeps the first
     * line's heading) would make what is pasted into it a heading too, and
     * every line split from it would take its size. It becomes a plain line
     * first, with the caret in it.
     */
    function demoteEmptyHeading() {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        var line = sel.anchorNode;
        while (line && line.parentNode !== el.noteEditor) line = line.parentNode;
        if (!line || line.nodeType !== 1 || !/^H[1-6]$/.test(line.nodeName)) return;
        if (String(line.textContent).split(NBSP).join("").trim()) return;
        var plainLine = document.createElement("div");
        plainLine.appendChild(document.createElement("br"));
        el.noteEditor.replaceChild(plainLine, line);
        var range = document.createRange();
        range.setStart(plainLine, 0);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    el.noteEditor.addEventListener("paste", function (e) {
        var data = e.clipboardData;
        if (!data) return;
        e.preventDefault();
        pasteSeen = true;
        var plain = Date.now() < plainPasteUntil;
        plainPasteUntil = 0;
        if (insertClipboard(data.getData("text/html"), data.getData("text/plain"), plain)) return;
        if (data.types && Array.prototype.indexOf.call(data.types, "Files") !== -1) {
            setStatus("Images go to the timeline: click Paste Image, or press Ctrl/Cmd+V outside the notes", 4000);
        }
    });

    // ============================================================
    // NOTES RIGHT-CLICK MENU (Cut, Copy, Paste, Paste without formatting)
    // ============================================================
    //
    // CEP shows no menu of its own on a right-click. Paste from the menu
    // uses Chromium's own paste when CEP allows it (it then goes through
    // the paste handler above); otherwise the clipboard is read through
    // PowerShell (Windows) or AppleScript (macOS) and goes through the
    // same clean-up as Ctrl+V.

    var menuPasteBusy = false;

    function noteMenuOpen() {
        return !el.noteMenu.classList.contains("hidden");
    }

    function hideNoteMenu() {
        el.noteMenu.classList.add("hidden");
    }

    function selectionInEditor() {
        var sel = window.getSelection();
        return !!(sel && sel.rangeCount > 0 && !sel.isCollapsed && el.noteEditor.contains(sel.anchorNode));
    }

    var menuLine = null; // the note line the menu was opened on
    var menuWord = -1;   // the word of it under the pointer
    var menuPick = [];   // the selected words, as selectedWords() gives them

    /** Whether a note line is timed when Time to Audio runs (so it can be pinned). */
    function isScriptLine(line) {
        return !!(line && line.nodeType === 1 && line.parentNode === el.noteEditor && !isUnspoken(line) &&
                  LazyAlign.isSpoken(textWithoutTags(line).split(NBSP).join(" ")));
    }

    el.noteEditor.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        rememberSelection();
        var selected = selectionInEditor();
        el.noteMenuCut.disabled = !selected;
        el.noteMenuCopy.disabled = !selected;
        menuLine = lineOf(e.target);
        menuWord = isScriptLine(menuLine) ? wordIndexAt(menuLine, e.clientX || 0, e.clientY || 0) : -1;
        el.noteMenuPin.disabled = !isScriptLine(menuLine) || scriptBusy;
        el.noteMenuUnpin.classList.toggle("hidden", !isScriptLine(menuLine) || !hasPins(menuLine));
        menuPick = selected ? selectedWords() : [];
        var timed = menuPick.some(function (p) { return !!leadingTag(p.line); });
        el.noteMenuCutTimeline.disabled = !timed || scriptBusy;
        el.noteMenuRemoveTimeline.disabled = !timed || scriptBusy;
        el.noteMenuUnstrike.classList.toggle("hidden", !menuLine || menuLine.parentNode !== el.noteEditor || !menuLine.querySelectorAll(".note-cut").length);
        el.noteMenu.classList.remove("hidden");
        // At the pointer, but inside the panel near its right and bottom edges.
        var width = window.innerWidth || document.body.clientWidth || 0;
        var height = window.innerHeight || document.body.clientHeight || 0;
        var x = Math.max(4, Math.min(e.clientX || 0, width - (el.noteMenu.offsetWidth || 0) - 4));
        var y = Math.max(4, Math.min(e.clientY || 0, height - (el.noteMenu.offsetHeight || 0) - 4));
        el.noteMenu.style.left = x + "px";
        el.noteMenu.style.top = y + "px";
    });

    // A click on the menu keeps the caret and the selection in the note.
    el.noteMenu.addEventListener("mousedown", function (e) { e.preventDefault(); });
    document.addEventListener("mousedown", function (e) {
        if (noteMenuOpen() && !el.noteMenu.contains(e.target)) hideNoteMenu();
    });
    document.addEventListener("keydown", function (e) {
        if (!noteMenuOpen()) return;
        if (e.key === "Escape") e.preventDefault();
        hideNoteMenu();
    });
    el.noteEditor.addEventListener("scroll", hideNoteMenu);
    window.addEventListener("blur", hideNoteMenu);
    window.addEventListener("resize", hideNoteMenu);

    if (process.platform === "darwin") {
        var menuKeys = el.noteMenu.querySelectorAll("kbd");
        for (var mk = 0; mk < menuKeys.length; mk++) {
            menuKeys[mk].textContent = menuKeys[mk].textContent.replace("Ctrl+Shift+", "⇧⌘").replace("Ctrl+", "⌘");
        }
    }

    function runEditCommand(command) {
        hideNoteMenu();
        focusEditor();
        try { document.execCommand(command); } catch (e) {}
        rememberSelection();
    }

    el.noteMenuCut.addEventListener("click", function () {
        if (el.noteMenuCut.disabled) return;
        runEditCommand("cut");
        debouncedSaveNote();
    });
    el.noteMenuCopy.addEventListener("click", function () {
        if (!el.noteMenuCopy.disabled) runEditCommand("copy");
    });
    el.noteMenuSelectAll.addEventListener("click", function () { runEditCommand("selectAll"); });
    el.noteMenuPaste.addEventListener("click", function () { pasteFromMenu(false); });
    el.noteMenuPastePlain.addEventListener("click", function () { pasteFromMenu(true); });
    el.noteMenuPin.addEventListener("click", function () {
        if (!el.noteMenuPin.disabled) pinAtPlayhead(menuLine, menuWord);
    });
    el.noteMenuUnpin.addEventListener("click", function () { unpinLine(menuLine); });
    el.noteMenuCutTimeline.addEventListener("click", function () {
        if (!el.noteMenuCutTimeline.disabled) editAtSelection(menuPick, false);
    });
    el.noteMenuRemoveTimeline.addEventListener("click", function () {
        if (!el.noteMenuRemoveTimeline.disabled) editAtSelection(menuPick, true);
    });
    el.noteMenuUnstrike.addEventListener("click", function () { unstrikeLine(menuLine); });

    /** A pin on the line's start (its tag) or on a word in it. */
    function hasPins(line) {
        var tag = leadingTag(line);
        return !!(tag && tag.hasAttribute("data-anchor")) || line.querySelectorAll(".note-pin").length > 0;
    }

    /**
     * Puts the start of a word (a DOM range from wordRanges) in a pin span,
     * splitting its text node: the pin stays with the word when text before
     * it is edited. A word already pinned keeps its span.
     */
    function pinSpanAt(range) {
        var node = range.startContainer;
        var parent = node.parentNode;
        if (parent.classList && parent.classList.contains("note-pin") && range.startOffset === 0) return parent;
        var text = String(node.nodeValue);
        var end = range.endContainer === node ? range.endOffset : text.length;
        var span = document.createElement("span");
        span.className = "note-pin";
        span.appendChild(document.createTextNode(text.slice(range.startOffset, end)));
        if (range.startOffset > 0) parent.insertBefore(document.createTextNode(text.slice(0, range.startOffset)), node);
        parent.insertBefore(span, node);
        if (end < text.length) parent.insertBefore(document.createTextNode(text.slice(end)), node);
        parent.removeChild(node);
        return span;
    }

    /**
     * Pins the word right-clicked to the playhead: it starts there (with the
     * voice just after it), and everything else is timed again around it.
     * For a retake or a sentence the timing could not tell by itself: put
     * the playhead where it is really said, then pin it. The first word of
     * a line pins the line's start, on its timecode tag.
     */
    function pinAtPlayhead(line, word) {
        hideNoteMenu();
        if (!isScriptLine(line) || scriptBusy) return Promise.resolve();
        var projectBefore = appState.projectId;
        return evalScriptP("getPlayhead()").then(function (p) {
            if (!p || !p.ok) {
                setStatus((p && p.msg ? p.msg + ": " : "") + "open the sequence or composition first", 3000);
                return null;
            }
            if (appState.projectId !== projectBefore || !isScriptLine(line)) return null;
            var range = word > 0 ? wordRanges(line)[word] : null;
            if (range) pinSpanAt(range).setAttribute("data-pin", p.t.toFixed(3));
            else setLeadingTag(line, { start: p.t, end: p.t }, p, null, p.t);
            noteChanged();
            saveCurrentNote();
            return timeToAudio({ reuse: true });
        });
    }

    /** Lets a line and every word in it be timed freely again, and re-times the note. */
    function unpinLine(line) {
        hideNoteMenu();
        if (!isScriptLine(line) || !hasPins(line) || scriptBusy) return Promise.resolve();
        var tag = leadingTag(line);
        if (tag) tag.removeAttribute("data-anchor");
        var spans = line.querySelectorAll(".note-pin");
        for (var s = 0; s < spans.length; s++) unwrap(spans[s]);
        if (line.normalize) line.normalize();
        noteChanged();
        saveCurrentNote();
        return timeToAudio({ reuse: true });
    }

    /** Paste at the caret the menu was opened at; `plain` pastes without formatting. */
    function pasteFromMenu(plain) {
        hideNoteMenu();
        if (menuPasteBusy) return Promise.resolve();
        focusEditor();
        pasteSeen = false;
        if (plain) plainPasteUntil = Date.now() + 1500;
        var handled = false;
        try { handled = document.execCommand("paste") && pasteSeen; } catch (e) { handled = false; }
        plainPasteUntil = 0;
        if (handled) return Promise.resolve();

        var projectBefore = appState.projectId;
        var tabBefore = appState.notesData.activeTabId;
        menuPasteBusy = true;
        setStatus("Reading the clipboard...");
        return readClipboardContent(!plain).then(function (clip) {
            menuPasteBusy = false;
            if (appState.projectId !== projectBefore || appState.notesData.activeTabId !== tabBefore || !notesShowing()) {
                setStatus("Nothing pasted: another note came up while the clipboard was read", 4000);
                return;
            }
            if (clip.error) {
                setStatus("Could not read the clipboard: " + clip.error, 5000);
                return;
            }
            focusEditor();
            if (insertClipboard(clip.html, clip.text, plain)) setStatus(plain ? "Pasted without formatting" : "Pasted", 1500);
            else setStatus("Nothing to paste: the clipboard holds no text", 3000);
        });
    }

    /**
     * Windows' "HTML Format" (CF_HTML) is a header with byte offsets, then
     * the page. The page from StartHTML to EndHTML is what Chromium hands to
     * Ctrl+V: the copied part (between StartFragment and EndFragment) inside
     * it, and the page's <style>, where Word keeps its paragraph styles.
     */
    function htmlFromCfHtml(bytes) {
        var head = bytes.slice(0, Math.min(bytes.length, 512)).toString("latin1");
        function offset(name) {
            var m = new RegExp(name + ":\\s*(\\d+)").exec(head);
            return m ? parseInt(m[1], 10) : -1;
        }
        var page = offset("StartHTML");
        var pageEnd = offset("EndHTML");
        if (page >= 0 && pageEnd > page && pageEnd <= bytes.length) return bytes.slice(page, pageEnd).toString("utf8");
        var start = offset("StartFragment");
        var end = offset("EndFragment");
        if (start >= 0 && end > start && end <= bytes.length) return bytes.slice(start, end).toString("utf8");
        if (page >= 0 && page < bytes.length) return bytes.slice(page).toString("utf8");
        var text = bytes.toString("utf8");
        var at = text.indexOf("<");
        return at >= 0 ? text.substr(at) : "";
    }

    /**
     * The clipboard's HTML and text as base64 lines, so no character is lost
     * on the way. WPF reads "HTML Format" as the UTF-8 it is; Windows Forms
     * on .NET Framework reads it in the ANSI code page (Bengali and curly
     * quotes come out garbled, and the byte offsets no longer fit), so its
     * text is turned back into those bytes when WPF is not there.
     */
    function clipboardTextScriptWindows(withHtml) {
        var lines = [
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
            "$ErrorActionPreference = 'Stop'",
            "try {",
            "  $utf8 = New-Object System.Text.UTF8Encoding($false)",
            "  try {",
            "    Add-Type -AssemblyName PresentationCore",
            "    $data = [System.Windows.Clipboard]::GetDataObject()",
            "    $ansi = $false",
            "  } catch {",
            "    Add-Type -AssemblyName System.Windows.Forms",
            "    $data = [System.Windows.Forms.Clipboard]::GetDataObject()",
            "    $ansi = $true",
            "  }",
            "  if ($data -eq $null) { 'DONE'; return }"
        ];
        if (withHtml) {
            lines.push(
                "  if ($data.GetDataPresent('HTML Format')) {",
                "    $h = $data.GetData('HTML Format')",
                "    if ($h -is [System.IO.MemoryStream]) { $b = $h.ToArray() }",
                "    elseif ($ansi) { $b = [System.Text.Encoding]::Default.GetBytes([string]$h) }",
                "    else { $b = $utf8.GetBytes([string]$h) }",
                "    'HTML:' + [System.Convert]::ToBase64String($b)",
                "  }"
            );
        }
        lines.push(
            "  if ($data.GetDataPresent('UnicodeText')) {",
            "    'TEXT:' + [System.Convert]::ToBase64String($utf8.GetBytes([string]$data.GetData('UnicodeText')))",
            "  }",
            "  'DONE'",
            "} catch { 'ERROR:' + $_.Exception.Message }"
        );
        return lines.join("\n");
    }

    function runOsascript(script) {
        return new Promise(function (resolve) {
            childProcess.execFile("osascript", ["-e", script], { timeout: 20000, maxBuffer: 64 * 1024 * 1024 }, function (err, stdout) {
                resolve({ err: err, out: String(stdout || "") });
            });
        });
    }

    /** Resolves { html, text } (either may be ""), or { error }. */
    function readClipboardContent(withHtml) {
        if (process.platform === "win32") {
            return new Promise(function (resolve) {
                var encoded = Buffer.from(clipboardTextScriptWindows(withHtml), "utf16le").toString("base64");
                childProcess.execFile("powershell.exe",
                    ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
                    { windowsHide: true, timeout: 20000, maxBuffer: 64 * 1024 * 1024 }, function (err, stdout) {
                        var clip = { html: "", text: "" };
                        var done = false;
                        var lines = String(stdout || "").split(/\r?\n/);
                        for (var i = 0; i < lines.length; i++) {
                            var line = lines[i].trim();
                            if (line.indexOf("HTML:") === 0) clip.html = htmlFromCfHtml(Buffer.from(line.substring(5), "base64"));
                            else if (line.indexOf("TEXT:") === 0) clip.text = Buffer.from(line.substring(5), "base64").toString("utf8");
                            else if (line.indexOf("ERROR:") === 0) return resolve({ error: line.substring(6) });
                            else if (line === "DONE") done = true;
                        }
                        if (!done) return resolve({ error: err ? err.message : "PowerShell gave no answer" });
                        clip.text = clip.text.replace(/\r\n?/g, "\n");
                        resolve(clip);
                    });
            });
        }
        if (process.platform === "darwin") {
            var clip = { html: "", text: "" };
            var html = withHtml
                ? runOsascript("try\n  return (the clipboard as «class HTML»)\non error\n  return \"\"\nend try")
                : Promise.resolve({ out: "" });
            return html.then(function (r) {
                // Printed as «data HTML3C6D657461...»: the page's bytes in hex.
                var m = /data HTML([0-9A-Fa-f]+)/.exec(r.out);
                if (m) {
                    var bytes = Buffer.from(m[1], "hex");
                    clip.html = bytes[0] === 0xFF && bytes[1] === 0xFE ? bytes.slice(2).toString("utf16le") : bytes.toString("utf8");
                }
                return runOsascript("try\n  return (the clipboard as text)\non error\n  return \"\"\nend try");
            }).then(function (r) {
                if (r.err && !clip.html) return { error: r.err.message };
                clip.text = r.out.replace(/\n$/, "").replace(/\r\n?/g, "\n");
                return clip;
            });
        }
        return Promise.resolve({ error: "the notes read the clipboard on Windows and macOS only" });
    }

    // ============================================================
    // FOLLOW THE PLAYHEAD (the line and word being said light up)
    // ============================================================
    //
    // While the Notes tab shows a note with timed lines, the panel asks the
    // host where the playhead is (five times a second while it moves, about
    // once a second while it rests) and lays a soft highlight over the line
    // and the word being said, scrolling the note along. Between two answers
    // the highlight glides on at the measured speed. The highlight is a layer
    // over the editor, never part of the note, so none of it is ever saved.

    var FOLLOW_FAST_MS = 200;
    var FOLLOW_SLOW_MS = 900;
    var follow = {
        timer: null, raf: 0, model: null, builtFor: -1, timelineKey: "",
        lastT: null, lastAt: 0, rate: 0, movingUntil: 0, shownT: null,
        pos: { line: -1, word: -1 }, userAt: 0
    };

    function notesShowing() {
        return el.tabNotes.classList.contains("active");
    }

    function hasTimedLine() {
        return el.noteEditor.querySelectorAll(".timecode-tag").length > 0;
    }

    /** The note's timed lines in time order, worked out again only when the note or the timeline changed. */
    function followModel(timeline) {
        var key = timeline.name + "|" + timeline.fps + "|" + timeline.offset;
        if (follow.model && follow.builtFor === noteVersion && follow.timelineKey === key) return follow.model;
        var lines = [];
        for (var node = el.noteEditor.firstChild; node; node = node.nextSibling) {
            if (node.nodeType !== 1 || isUnspoken(node)) continue;
            var tag = leadingTag(node);
            var times = tag ? tagTimes(tag, timeline) : null;
            if (times) lines.push({ node: node, tag: tag, start: times.start, end: times.end });
        }
        lines.sort(function (a, b) { return a.start - b.start; });
        for (var i = 0; i < lines.length; i++) {
            var l = lines[i];
            var next = lines[i + 1];
            if (l.end === undefined || (next && l.end > next.start)) {
                l.end = next ? next.start - 0.04 : l.start + LazyAlign.readingTime(textWithoutTags(l.node));
            }
            l.words = wordTimesOf(l.tag, lineWords(l.node), l.start, l.end);
            l.ranges = null;
        }
        follow.model = { lines: lines };
        follow.builtFor = noteVersion;
        follow.timelineKey = key;
        return follow.model;
    }

    /** A line's text nodes in reading order, null for a line break. Timecodes and struck words are not read. */
    function lineTexts(node) {
        var texts = [];
        (function collect(n) {
            for (var c = n.firstChild; c; c = c.nextSibling) {
                if (c.nodeType === 3) texts.push(c);
                else if (c.nodeType === 1 && !isTimecodeTag(c) && !isStruckWords(c)) {
                    if (c.nodeName === "BR") texts.push(null);
                    else collect(c);
                }
            }
        })(node);
        return texts;
    }

    /**
     * Where each word of a line is, in the order lineWords() counts them:
     * [{ sn, so, en, eo, from, to }], its first and last text node with the
     * offsets in them, and its place in the line's text in characters.
     */
    function wordSpots(node) {
        var texts = lineTexts(node);
        var spots = [];
        var open = null;
        function close(endNode, endOffset, at) {
            spots.push({ sn: open.node, so: open.offset, en: endNode, eo: endOffset, from: open.at, to: at });
            open = null;
        }
        var last = null;
        var base = 0;
        for (var t = 0; t < texts.length; t++) {
            if (texts[t] === null) {
                if (open) close(last, String(last.nodeValue).length, base);
                continue;
            }
            var s = String(texts[t].nodeValue);
            for (var i = 0; i < s.length; i++) {
                var space = /[\s\u00a0]/.test(s.charAt(i));
                if (!space && !open) open = { node: texts[t], offset: i, at: base + i };
                else if (space && open) close(texts[t], i, base + i);
            }
            base += s.length;
            last = texts[t];
        }
        if (open && last) close(last, String(last.nodeValue).length, base);
        return spots;
    }

    /** A DOM range over each word of a line, in the order lineWords() counts them. */
    function wordRanges(node) {
        return wordSpots(node).map(function (w) {
            var r = document.createRange();
            r.setStart(w.sn, w.so);
            r.setEnd(w.en, w.eo);
            return r;
        });
    }

    function hideFollow() {
        el.followLayer.classList.add("hidden");
        follow.pos = { line: -1, word: -1 };
    }

    /** Scrolls the note so the line being said stays in view, unless the user has been reading or typing elsewhere. */
    function keepInView(node) {
        if (Date.now() - follow.userAt < 2500) return;
        var editor = el.noteEditor;
        var box = editor.getBoundingClientRect();
        var r = node.getBoundingClientRect();
        if (r.top >= box.top + 8 && r.bottom <= box.bottom - 8) return;
        var top = Math.max(0, editor.scrollTop + (r.top - box.top) - editor.clientHeight * 0.3);
        try { editor.scrollTo({ top: top, behavior: "smooth" }); } catch (e) { editor.scrollTop = top; }
    }

    /** True when a text node sits on a pasted highlight (a colour span with a background). */
    function isOnMark(node) {
        var parent = node && node.parentNode;
        var mark = parent && parent.closest ? parent.closest(".note-color") : null;
        return !!(mark && el.noteEditor.contains(mark) && mark.getAttribute("data-bg"));
    }

    function showFollowAt(t) {
        var model = follow.model;
        var pos = model && model.lines.length ? LazyAlign.followAt(model.lines, t) : { line: -1, word: -1 };
        if (pos.line < 0) return hideFollow();
        var line = model.lines[pos.line];
        if (line.node.parentNode !== el.noteEditor) {
            follow.builtFor = -1; // the note was redrawn: work the lines out again next time
            return hideFollow();
        }
        var editor = el.noteEditor;
        var layer = el.followLayer;
        layer.style.left = (editor.offsetLeft + editor.clientLeft) + "px";
        layer.style.top = (editor.offsetTop + editor.clientTop) + "px";
        layer.style.width = editor.clientWidth + "px";
        layer.style.height = editor.clientHeight + "px";
        layer.classList.remove("hidden");
        var base = layer.getBoundingClientRect();
        var lr = line.node.getBoundingClientRect();
        el.followLine.style.top = (lr.top - base.top - 2) + "px";
        el.followLine.style.height = (lr.height + 4) + "px";
        var shown = false;
        if (pos.word >= 0) {
            if (!line.ranges) line.ranges = wordRanges(line.node);
            var range = line.ranges[pos.word];
            if (range) {
                var rects = range.getClientRects();
                var wr = rects && rects.length ? rects[0] : range.getBoundingClientRect();
                el.followWord.style.left = (wr.left - base.left - 2) + "px";
                el.followWord.style.top = (wr.top - base.top - 1) + "px";
                el.followWord.style.width = (wr.width + 4) + "px";
                el.followWord.style.height = (wr.height + 2) + "px";
                el.followWord.classList.toggle("on-mark", isOnMark(range.startContainer));
                shown = true;
            }
        }
        el.followWord.classList.toggle("hidden", !shown);
        if (pos.line !== follow.pos.line) keepInView(line.node);
        follow.pos = pos;
        follow.shownT = t;
    }

    /** Between two answers from the host, the highlight moves on at the measured playback speed. */
    function glide() {
        if (follow.raf || typeof requestAnimationFrame !== "function") return;
        var step = function () {
            follow.raf = 0;
            if (!follow.rate || Date.now() > follow.movingUntil || !appState.settings.follow || el.followLayer.classList.contains("hidden")) return;
            showFollowAt(follow.lastT + follow.rate * Math.min(Date.now() - follow.lastAt, 500) / 1000);
            follow.raf = requestAnimationFrame(step);
        };
        follow.raf = requestAnimationFrame(step);
    }

    function scheduleFollow(ms) {
        clearTimeout(follow.timer);
        follow.timer = setTimeout(followTick, ms);
    }

    function followTick() {
        follow.timer = null;
        if (!appState.settings.follow || !notesShowing() || !hasOpenProject() || isModalOpen() || !hasTimedLine()) {
            hideFollow();
            scheduleFollow(FOLLOW_SLOW_MS);
            return Promise.resolve();
        }
        return evalScriptP("getPlayhead()").then(function (p) {
            if (!p || !p.ok || typeof p.t !== "number") {
                hideFollow();
                scheduleFollow(FOLLOW_SLOW_MS);
                return;
            }
            var now = Date.now();
            if (follow.lastT !== null) {
                var moved = p.t - follow.lastT;
                var dt = (now - follow.lastAt) / 1000;
                if (Math.abs(moved) > 0.001) {
                    follow.movingUntil = now + 1200;
                    follow.rate = dt > 0 ? Math.max(-4, Math.min(4, moved / dt)) : 0;
                } else if (now > follow.movingUntil) {
                    follow.rate = 0;
                }
            }
            follow.lastT = p.t;
            follow.lastAt = now;
            followModel(p);
            showFollowAt(p.t);
            if (follow.rate) glide();
            scheduleFollow(now < follow.movingUntil ? FOLLOW_FAST_MS : FOLLOW_SLOW_MS);
        });
    }

    function showFollowState() {
        el.btnFollow.classList.toggle("is-on", !!appState.settings.follow);
        var jumpHint = " Click a timecode, or " + (process.platform === "darwin" ? "Cmd" : "Ctrl") + "+click a word, to move the playhead there.";
        el.btnFollow.title = (appState.settings.follow
            ? "Following the playhead: the line and word being said light up and the note scrolls along. Click to stop."
            : "Follow the playhead: light up the line and word being said while the timeline plays (needs timed lines).") + jumpHint;
    }

    el.btnFollow.addEventListener("click", function () {
        appState.settings.follow = !appState.settings.follow;
        saveGeneralSettings();
        showFollowState();
        if (!appState.settings.follow) hideFollow();
        scheduleFollow(0);
        setStatus(appState.settings.follow ? "Following the playhead" : "Not following the playhead", 1500);
    });

    function showTitlesState() {
        el.btnTimeTitles.classList.toggle("is-on", !!appState.settings.timeTitles);
        el.btnTimeTitles.title = appState.settings.timeTitles
            ? "Titles and headings are spoken: Time to Audio times them and Subtitles shows them, like any line. Click if they are not said in the voiceover."
            : "Titles and headings are skipped by Time to Audio and Subtitles. Click if the voiceover says them.";
    }

    el.btnTimeTitles.addEventListener("click", function () {
        appState.settings.timeTitles = !appState.settings.timeTitles;
        saveGeneralSettings();
        showTitlesState();
        noteChanged(); // the followed lines change
        setStatus(appState.settings.timeTitles
            ? "Titles are timed too: click 🎙️ Time to Audio again to time them"
            : "Titles are skipped: click 🎙️ Time to Audio again to time without them", 4000);
    });

    // Reading or typing in the note pauses the scrolling for a moment.
    ["wheel", "mousedown", "keydown", "touchstart"].forEach(function (type) {
        el.noteEditor.addEventListener(type, function () { follow.userAt = Date.now(); });
    });
    el.noteEditor.addEventListener("input", noteChanged);
    el.noteEditor.addEventListener("scroll", function () {
        if (follow.shownT !== null && !el.followLayer.classList.contains("hidden")) showFollowAt(follow.shownT);
    });
    window.addEventListener("resize", function () {
        if (follow.shownT !== null && !el.followLayer.classList.contains("hidden")) showFollowAt(follow.shownT);
    });

    // ============================================================
    // JUMP TO A WORD (click a timecode, or Ctrl/Cmd+click a word)
    // ============================================================
    //
    // The reverse of following: a click on a line's timecode moves the
    // playhead to the line's start, and Ctrl+click (Cmd+click on macOS) on a
    // word moves it to the moment that word is said, from the same word
    // times 👁 Follow uses. A plain click on a word still only places the
    // caret, so editing never moves the timeline.

    var JUMP_KEY_NAME = process.platform === "darwin" ? "Meta" : "Control";

    function isJumpClick(e) {
        return process.platform === "darwin" ? !!e.metaKey : !!e.ctrlKey;
    }

    /** The note line (a block directly in the editor) a node sits in, or null. */
    function lineOf(node) {
        while (node && node.parentNode !== el.noteEditor) node = node.parentNode;
        return node || null;
    }

    /** The index of the word of `line` under the point (x, y), else the nearest word on that row, or -1. */
    function wordIndexAt(line, x, y) {
        var ranges = wordRanges(line);
        var best = -1;
        var bestGap = Infinity;
        for (var i = 0; i < ranges.length; i++) {
            var rects = ranges[i].getClientRects();
            for (var k = 0; k < rects.length; k++) {
                var r = rects[k];
                if (y < r.top - 2 || y > r.bottom + 2) continue;
                var gap = x < r.left ? r.left - x : (x > r.right ? x - r.right : 0);
                if (gap < bestGap) {
                    bestGap = gap;
                    best = i;
                }
            }
        }
        return best;
    }

    /** Moves the playhead to `t` (seconds from the timeline start) and shows the word there at once. */
    function movePlayhead(t, timeline) {
        return evalScriptP("setPlayhead(" + JSON.stringify(Math.max(0, t)) + ")").then(function (r) {
            if (!r || !r.ok) {
                setStatus((r && r.msg) || "Could not move the playhead", 3000);
                return;
            }
            // A jump is not playback: the highlight must not glide on from it.
            follow.lastT = r.t;
            follow.lastAt = Date.now();
            follow.rate = 0;
            follow.movingUntil = 0;
            if (appState.settings.follow && notesShowing()) showFollowAt(r.t);
            scheduleFollow(FOLLOW_SLOW_MS);
            setStatus("Playhead at " + LazyAlign.formatTimecode(timeline.offset + r.t, timeline.fps), 2000);
        });
    }

    /** `tag`: jump to its line's start. Else jump to word `wordIndex` of `line` (its start when -1). */
    function jumpInNote(line, wordIndex, tag) {
        return evalScriptP("getPlayhead()").then(function (p) {
            if (!p || !p.ok) {
                setStatus((p && p.msg ? p.msg + ": " : "") + "open the sequence or composition first", 3000);
                return;
            }
            if (tag) {
                var times = tagTimes(tag, p);
                if (!times) return setStatus("This timecode cannot be read: write it like [00:01:24:12]", 4000);
                return movePlayhead(times.start, p);
            }
            var lines = followModel(p).lines;
            for (var i = 0; i < lines.length; i++) {
                if (lines[i].node !== line) continue;
                var t = wordIndex >= 0 && wordIndex < lines[i].words.length ? lines[i].words[wordIndex] : lines[i].start;
                return movePlayhead(t, p);
            }
            setStatus("This line has no timecode yet: click 🎙️ Time to Audio first", 4000);
        });
    }

    el.noteEditor.addEventListener("click", function (e) {
        if (isModalOpen() || noteMenuOpen() || !hasOpenProject()) return;
        var sel = window.getSelection();
        if (sel && sel.rangeCount && !sel.isCollapsed) return; // a drag that selected text
        var tag = e.target && e.target.closest ? e.target.closest(".timecode-tag") : null;
        if (tag && el.noteEditor.contains(tag)) {
            jumpInNote(lineOf(tag), -1, tag);
            return;
        }
        if (!isJumpClick(e)) return;
        var line = lineOf(e.target);
        if (!line) return;
        e.preventDefault();
        jumpInNote(line, wordIndexAt(line, e.clientX, e.clientY), null);
    });

    // While Ctrl (Cmd) is held over the note, the pointer shows that a click jumps.
    document.addEventListener("keydown", function (e) {
        if (e.key === JUMP_KEY_NAME) el.noteEditor.classList.add("jump-keys");
    });
    document.addEventListener("keyup", function (e) {
        if (e.key === JUMP_KEY_NAME) el.noteEditor.classList.remove("jump-keys");
    });
    window.addEventListener("blur", function () { el.noteEditor.classList.remove("jump-keys"); });

    // ============================================================
    // CUT AND REMOVE ON THE TIMELINE
    // ============================================================
    // Words selected in a timed note name a stretch of the timeline. From
    // the right-click menu, ✂️ Cut the timeline here splits every unlocked
    // track where the words start and end, and ✂️ Remove from the timeline
    // takes them out and closes the gap: the words are struck through and
    // the note's later times move to match. ✂️ Retakes takes out the earlier
    // takes 🎙️ Time to Audio left out. With the voice heard, every cut falls
    // in a pause, so no word is clipped.

    /** Where a selection boundary (node, offset) falls in a line's text, counted as wordSpots() counts it. */
    function textOffsetIn(line, node, offset) {
        var count = 0;
        var done = false;
        var stop = node.nodeType === 3 ? null : (node.childNodes[offset] || null);
        (function walk(n) {
            for (var c = n.firstChild; c && !done; c = c.nextSibling) {
                if (c === stop) {
                    done = true;
                } else if (c.nodeType === 3) {
                    if (c === node) {
                        count += offset;
                        done = true;
                    } else {
                        count += String(c.nodeValue).length;
                    }
                } else if (c.nodeType === 1) {
                    if (isTimecodeTag(c) || isStruckWords(c)) {
                        if (c.contains(node)) done = true;
                    } else {
                        walk(c);
                    }
                    if (c === node) done = true;
                }
            }
        })(line);
        return count;
    }

    /** A selection boundary as { line, at }: the note line it is in, and where in that line's text. */
    function selectionPoint(node, offset, isStart) {
        if (node === el.noteEditor) {
            var block = el.noteEditor.childNodes[isStart ? offset : offset - 1];
            return block ? { line: block, at: isStart ? 0 : Infinity } : null;
        }
        var line = lineOf(node);
        return line ? { line: line, at: textOffsetIn(line, node, offset) } : null;
    }

    /** The spoken words the note's selection touches: [{ line, words: [index] }], in the note's order. */
    function selectedWords() {
        var sel = window.getSelection();
        if (!sel || !sel.rangeCount || sel.isCollapsed) return [];
        var range = sel.getRangeAt(0);
        var first = selectionPoint(range.startContainer, range.startOffset, true);
        var last = selectionPoint(range.endContainer, range.endOffset, false);
        if (!first || !last) return [];
        var blocks = el.noteEditor.childNodes;
        var picked = [];
        for (var i = Array.prototype.indexOf.call(blocks, first.line); i >= 0 && i < blocks.length; i++) {
            var line = blocks[i];
            if (isScriptLine(line)) {
                var from = line === first.line ? first.at : 0;
                var to = line === last.line ? last.at : Infinity;
                var words = [];
                wordSpots(line).forEach(function (w, k) {
                    if (w.to > from && w.from < to) words.push(k);
                });
                if (words.length) picked.push({ line: line, words: words });
            }
            if (line === last.line) break;
        }
        return picked;
    }

    /**
     * The stretch of the timeline the `picked` words are said in, from the
     * word times 👁 Follow uses: { s, e } in seconds, or null when one of
     * their lines has no timecode. With the voice heard (`speech`), both
     * ends move into the pause next to them.
     */
    function pickedTimes(picked, timeline, speech) {
        var lines = followModel(timeline).lines;
        var s = Infinity;
        var e = -Infinity;
        for (var p = 0; p < picked.length; p++) {
            var l = null;
            for (var i = 0; i < lines.length && !l; i++) if (lines[i].node === picked[p].line) l = lines[i];
            if (!l) return null;
            for (var k = 0; k < picked[p].words.length; k++) {
                var w = picked[p].words[k];
                if (w >= l.words.length) continue;
                s = Math.min(s, l.words[w]);
                e = Math.max(e, w + 1 < l.words.length ? l.words[w + 1] : l.end);
            }
        }
        if (!(e > s)) return null;
        if (speech) {
            var from = LazyAlign.quietCut(speech, s);
            var to = LazyAlign.quietCut(speech, e);
            if (to > from) {
                s = from;
                e = to;
            }
        }
        return { s: Math.max(0, s), e: e };
    }

    function undoHint(host) {
        var key = process.platform === "darwin" ? "Cmd+Z" : "Ctrl+Z";
        return host === "ae" ? "To undo, press " + key + " once in After Effects." : "To undo, press " + key + " in Premiere Pro a few times: it keeps each cut as a step.";
    }

    function secondsText(n) {
        return (Math.round(n * 10) / 10) + " s";
    }

    /** ✂️ Cut the timeline here (`removing` false) or ✂️ Remove from the timeline (true) for words picked in the note. */
    function editAtSelection(picked, removing) {
        hideNoteMenu();
        if (!picked || !picked.length || scriptBusy) return Promise.resolve(null);
        var projectBefore = appState.projectId;
        var tabBefore = appState.notesData.activeTabId;
        return evalScriptP("getTimelineInfo()").then(function (timeline) {
            if (!timeline || !timeline.ok) {
                setStatus((timeline && timeline.msg) || "Open a sequence or composition first", 4000);
                return null;
            }
            if (appState.projectId !== projectBefore || appState.notesData.activeTabId !== tabBefore ||
                !picked.every(function (p) { return p.line.parentNode === el.noteEditor; })) {
                setStatus("The note changed; nothing was cut", 3000);
                return null;
            }
            var speech = heardAudio && heardAudio.key === timelineKey(timeline) ? heardAudio.speech : null;
            var span = pickedTimes(picked, timeline, speech);
            if (!span) {
                setStatus("Time the selected words first: click 🎙️ Time to Audio", 4000);
                return null;
            }
            if (!removing) return cutTimelineAt(timeline, [span.s, span.e]);
            var from = LazyAlign.formatTimecode(timeline.offset + span.s, timeline.fps);
            var to = LazyAlign.formatTimecode(timeline.offset + span.e, timeline.fps);
            return showDialog({
                title: "Remove from the timeline?",
                message: "Take " + from + " – " + to + " (" + secondsText(span.e - span.s) + ") out of '" + timeline.name +
                         "' on every unlocked track and close the gap. The words get struck through in the note. Locked tracks are left as they are. " +
                         undoHint(timeline.host),
                ok: "Remove",
                danger: true
            }).then(function (yes) {
                return yes ? removeFromTimeline(timeline, [span], picked) : null;
            });
        });
    }

    function cutTimelineAt(timeline, times) {
        setScriptBusy(true);
        setStatus("Cutting the timeline...");
        var payload = { name: timeline.name, times: times.map(function (t) { return Math.round(t * 1000) / 1000; }) };
        return evalScriptP("cutTimeline(" + JSON.stringify(JSON.stringify(payload)) + ")").then(function (r) {
            setStatus((r && r.msg) || "The host did not answer", r && r.ok ? 4000 : 8000);
            return r;
        }).catch(function (err) {
            setStatus("Cutting failed: " + (err && err.message ? err.message : err), 5000);
            return null;
        }).then(function (r) {
            setScriptBusy(false);
            return r;
        });
    }

    /**
     * Takes `stretches` ([{ s, e }]) out of the open timeline and closes the
     * gaps. Then the note's times move to match and the `picked` words are
     * struck through; the voice heard before no longer fits the timeline.
     */
    function removeFromTimeline(timeline, stretches, picked) {
        var projectBefore = appState.projectId;
        var tabBefore = appState.notesData.activeTabId;
        setScriptBusy(true);
        setStatus("Removing from the timeline...");
        var payload = {
            name: timeline.name,
            ranges: stretches.map(function (r) { return { s: Math.round(r.s * 1000) / 1000, e: Math.round(r.e * 1000) / 1000 }; })
        };
        return evalScriptP("removeTimeline(" + JSON.stringify(JSON.stringify(payload)) + ")").then(function (r) {
            if (!r) {
                setStatus("The host did not answer", 5000);
                return null;
            }
            // Ranges come back once anything was taken out, even when a later step failed.
            var changed = !!(r.ranges && r.ranges.length);
            if (changed) {
                heardAudio = null;
                lastRetakes = null;
                showRetakes();
                if (appState.projectId === projectBefore && appState.notesData.activeTabId === tabBefore) {
                    noteAfterRemoval(timeline, r.ranges, picked.filter(function (p) { return p.line.parentNode === el.noteEditor; }));
                    noteChanged();
                    saveCurrentNote();
                }
            }
            setStatus((r.msg || "Removed") + (changed ? " · the note's times moved to match" : ""), r.ok ? 6000 : 9000);
            return r;
        }).catch(function (err) {
            setStatus("Removing failed: " + (err && err.message ? err.message : err), 5000);
            return null;
        }).then(function (r) {
            setScriptBusy(false);
            return r;
        });
    }

    /**
     * After `cuts` ([{ s, e }], sorted, in whole frames) left the timeline:
     * every time in the note moves to match, and the `picked` words are
     * struck through and no longer timed. A line with nothing left to say
     * loses its timecode.
     */
    function noteAfterRemoval(timeline, cuts, picked) {
        function after(t) { return LazyAlign.timeAfterCuts(t, cuts); }
        var lines = followModel(timeline).lines;
        var lineTags = lines.map(function (l) { return l.tag; });
        var otherTags = Array.prototype.filter.call(el.noteEditor.querySelectorAll(".timecode-tag"), function (tag) {
            return lineTags.indexOf(tag) < 0;
        });
        lines.forEach(function (l) {
            var gone = [];
            picked.forEach(function (p) { if (p.line === l.node) gone = p.words; });
            var kept = [];
            l.words.forEach(function (t, w) { if (gone.indexOf(w) < 0) kept.push(after(t)); });
            if (!kept.length) {
                dropLeadingTags(l.node);
                return;
            }
            var startKept = gone.indexOf(0) < 0;
            var start = startKept ? after(l.start) : kept[0];
            var pin = parseFloat(l.tag.getAttribute("data-anchor"));
            setLeadingTag(l.node, { start: start, end: Math.max(start, after(l.end)) }, timeline,
                          kept.map(function (t) { return t - start; }), startKept && isFinite(pin) ? after(pin) : undefined);
        });
        // Timecodes in side notes and checklists move too.
        otherTags.forEach(function (tag) {
            var times = tagTimes(tag, timeline);
            if (!times) return;
            var t = after(times.start);
            ["data-t", "data-e", "data-anchor"].forEach(function (name) {
                var v = parseFloat(tag.getAttribute(name));
                if (isFinite(v)) tag.setAttribute(name, (name === "data-t" ? t : after(v)).toFixed(3));
            });
            tag.textContent = "[" + LazyAlign.formatTimecode(timeline.offset + t, timeline.fps) + "]";
        });
        var pins = el.noteEditor.querySelectorAll(".note-pin");
        for (var i = 0; i < pins.length; i++) {
            var at = parseFloat(pins[i].getAttribute("data-pin"));
            if (isFinite(at)) pins[i].setAttribute("data-pin", after(at).toFixed(3));
        }
        picked.forEach(function (p) { strikeWords(p.line, p.words); });
    }

    /** Wraps the parts [{ a, b }] (in order, apart) of a text node in struck spans. */
    function wrapStruck(node, parts) {
        var text = String(node.nodeValue);
        var parent = node.parentNode;
        var at = 0;
        parts.forEach(function (p) {
            if (p.a > at) parent.insertBefore(document.createTextNode(text.slice(at, p.a)), node);
            var span = document.createElement("span");
            span.className = "note-cut";
            span.appendChild(document.createTextNode(text.slice(p.a, p.b)));
            parent.insertBefore(span, node);
            at = p.b;
        });
        if (at < text.length) parent.insertBefore(document.createTextNode(text.slice(at)), node);
        parent.removeChild(node);
    }

    /** Strikes through words of a line (indexes as wordSpots() counts them); a pin on one of them goes. */
    function strikeWords(line, words) {
        var spots = wordSpots(line);
        var texts = lineTexts(line).filter(function (t) { return t; });
        var parts = [];   // [{ node, cuts: [{ a, b }] }] in the line's order
        function add(node, a, b) {
            if (b <= a) return;
            var prev = parts[parts.length - 1];
            if (prev && prev.node === node) prev.cuts.push({ a: a, b: b });
            else parts.push({ node: node, cuts: [{ a: a, b: b }] });
        }
        // Words side by side are struck as one, the spaces between them too.
        var sorted = words.slice().sort(function (x, y) { return x - y; });
        for (var k = 0; k < sorted.length; k++) {
            var head = spots[sorted[k]];
            while (k + 1 < sorted.length && sorted[k + 1] === sorted[k] + 1) k++;
            var tail = spots[sorted[k]];
            if (!head || !tail) continue;
            var i0 = texts.indexOf(head.sn);
            var i1 = texts.indexOf(tail.en);
            for (var i = i0; i >= 0 && i <= i1; i++) {
                add(texts[i], i === i0 ? head.so : 0, i === i1 ? tail.eo : String(texts[i].nodeValue).length);
            }
        }
        parts.forEach(function (p) { wrapStruck(p.node, p.cuts); });
        var pins = line.querySelectorAll(".note-pin");
        for (var n = 0; n < pins.length; n++) {
            if (!textWithoutTags(pins[n]).split(NBSP).join("").trim()) unwrap(pins[n]);
        }
    }

    /** Brings a line's struck words back into the timing, after the cut was undone on the timeline. */
    function unstrikeLine(line) {
        hideNoteMenu();
        if (!line || line.parentNode !== el.noteEditor) return;
        var struck = line.querySelectorAll(".note-cut");
        if (!struck.length) return;
        for (var i = 0; i < struck.length; i++) unwrap(struck[i]);
        if (line.normalize) line.normalize();
        noteChanged();
        saveCurrentNote();
        setStatus("The words are back in the script: click 🎙️ Time to Audio once the timeline has them again", 5000);
    }

    /** ✂️ Retakes shows while the retakes the last 🎙️ Time to Audio left out still fit this note and timeline. */
    function showRetakes() {
        var r = lastRetakes;
        var on = !!(r && heardAudio && heardAudio.key === r.key && r.projectId === appState.projectId &&
                    r.tabId === appState.notesData.activeTabId);
        var count = on ? LazyAlign.outtakeCuts(heardAudio.speech, r.outtakes).length : 0;
        el.btnRetakes.classList.toggle("hidden", !count);
        if (count) el.btnRetakes.textContent = "✂️ " + count + " retake" + (count === 1 ? "" : "s");
    }

    /** Takes the retakes the last 🎙️ Time to Audio left out off every unlocked track, after asking. */
    function removeRetakes() {
        var known = lastRetakes;
        if (scriptBusy || !known) return Promise.resolve(null);
        return evalScriptP("getTimelineInfo()").then(function (timeline) {
            var audio = heardAudio;
            if (!timeline || !timeline.ok || !audio || audio.key !== known.key || timelineKey(timeline) !== known.key) {
                lastRetakes = null;
                showRetakes();
                setStatus("The timeline changed after 🎙️ Time to Audio: click it again to find the retakes", 5000);
                return null;
            }
            var cuts = LazyAlign.outtakeCuts(audio.speech, known.outtakes);
            if (!cuts.length) return null;
            var total = cuts.reduce(function (n, c) { return n + c.e - c.s; }, 0);
            return showDialog({
                title: "Remove the retakes?",
                message: "Take " + (cuts.length === 1 ? "1 retake" : cuts.length + " retakes") + " (" + secondsText(total) + " in all) out of '" +
                         timeline.name + "' on every unlocked track and close the gaps. Each goes from the middle of the pause before it to " +
                         "just before the take that counts. Locked tracks are left as they are. " + undoHint(timeline.host),
                ok: "Remove",
                danger: true
            }).then(function (yes) {
                if (!yes || lastRetakes !== known) return null;
                return removeFromTimeline(timeline, cuts, []);
            });
        });
    }

    el.btnRetakes.addEventListener("click", function () { removeRetakes(); });

    // ============================================================
    // LAZYPASTE ENGINE (Clipboard Image to Timeline)
    // ============================================================

    /**
     * What is on the clipboard, in order of preference:
     *  1. a PNG (keeps transparency, which the plain bitmap copy loses)
     *  2. an image file copied in Explorer
     *  3. any other picture (screenshots, most apps)
     * Sent as -EncodedCommand, so no quoting passes through cmd.exe.
     */
    function clipboardScriptWindows(targetPath) {
        var literal = "'" + targetPath.replace(/'/g, "''") + "'";
        var exts = PASTE_FILE_EXTS.map(function (e) { return "'" + e + "'"; }).join(",");
        return [
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
            "$ErrorActionPreference = 'Stop'",
            "try {",
            "  Add-Type -AssemblyName System.Windows.Forms",
            "  Add-Type -AssemblyName System.Drawing",
            "  $target = " + literal,
            "  $exts = @(" + exts + ")",
            "  $data = [System.Windows.Forms.Clipboard]::GetDataObject()",
            "  if ($data -eq $null) { 'NO_IMAGE'; return }",
            "  if ($data.GetDataPresent('PNG')) {",
            "    $png = $data.GetData('PNG')",
            "    if ($png -is [System.IO.MemoryStream]) { [System.IO.File]::WriteAllBytes($target, $png.ToArray()); 'OK'; return }",
            "  }",
            "  if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {",
            "    foreach ($f in [System.Windows.Forms.Clipboard]::GetFileDropList()) {",
            "      if ($exts -contains [System.IO.Path]::GetExtension($f).ToLower()) { 'FILE:' + $f; return }",
            "    }",
            "  }",
            "  $img = [System.Windows.Forms.Clipboard]::GetImage()",
            "  if ($img -ne $null) { $img.Save($target, [System.Drawing.Imaging.ImageFormat]::Png); $img.Dispose(); 'OK'; return }",
            "  'NO_IMAGE'",
            "} catch { 'ERROR:' + $_.Exception.Message }"
        ].join("\n");
    }

    function clipboardScriptMac(targetPath) {
        var literal = '"' + targetPath.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        return [
            "try",
            "  set png_data to (the clipboard as «class PNGf»)",
            "  set fp to open for access POSIX file " + literal + " with write permission",
            "  set eof of fp to 0",
            "  write png_data to fp",
            "  close access fp",
            "  return \"OK\"",
            "on error",
            "  try",
            "    close access POSIX file " + literal,
            "  end try",
            "end try",
            "try",
            "  set copied_file to (the clipboard as «class furl»)",
            "  return \"FILE:\" & POSIX path of copied_file",
            "on error",
            "  return \"NO_IMAGE\"",
            "end try"
        ].join("\n");
    }

    /** Resolves { kind: "saved" | "file" | "none" | "error", path?, message? }. */
    function readClipboardImage(tempPath) {
        return new Promise(function (resolve) {
            function interpret(err, stdout) {
                var lines = String(stdout || "").trim().split(/\r?\n/);
                var out = lines[lines.length - 1].trim();
                if (out === "OK") {
                    resolve(fs.existsSync(tempPath) ? { kind: "saved", path: tempPath } : { kind: "none" });
                } else if (out.indexOf("FILE:") === 0) {
                    var filePath = out.substring(5);
                    var ok = PASTE_FILE_EXTS.indexOf(path.extname(filePath).toLowerCase()) !== -1 && fs.existsSync(filePath);
                    resolve(ok ? { kind: "file", path: filePath } : { kind: "none" });
                } else if (out.indexOf("ERROR:") === 0) {
                    resolve({ kind: "error", message: out.substring(6) });
                } else if (err && !out) {
                    resolve({ kind: "error", message: err.message });
                } else {
                    resolve({ kind: "none" });
                }
            }

            if (process.platform === "win32") {
                var encoded = Buffer.from(clipboardScriptWindows(tempPath), "utf16le").toString("base64");
                childProcess.execFile("powershell.exe",
                    ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
                    { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 }, interpret);
            } else if (process.platform === "darwin") {
                childProcess.execFile("osascript", ["-e", clipboardScriptMac(tempPath)],
                    { timeout: 20000, maxBuffer: 1024 * 1024 }, interpret);
            } else {
                resolve({ kind: "error", message: "Clipboard images are supported on Windows and macOS only" });
            }
        });
    }

    /** A file already saved from these exact bytes in this folder, if any. */
    function findPastedCopy(hash, destDir) {
        var index = readJson(PASTE_INDEX_FILE, {});
        var known = index["h" + hash];
        if (!known || !fs.existsSync(known) || !samePath(path.dirname(known), destDir)) return Promise.resolve(null);
        return fileMd5(known).then(function (h) { return h === hash ? known : null; });
    }

    function rememberPastedCopy(hash, filePath) {
        var index = readJson(PASTE_INDEX_FILE, {});
        delete index["h" + hash];
        index["h" + hash] = filePath;
        var keys = Object.keys(index);
        for (var i = 0; i < keys.length - MAX_PASTE_INDEX; i++) delete index[keys[i]];
        writeJson(PASTE_INDEX_FILE, index);
    }

    function pasteBinName() {
        return sanitizeRelativePath(appState.settings.targetFolder, DEFAULT_PASTE_FOLDER);
    }

    function importPastedFile(filePath) {
        var script = "importPastedImage(" + JSON.stringify(normPath(filePath)) + ", " +
            (!!appState.settings.guideLayer) + ", " + (!!appState.settings.autoFit) + ", " +
            JSON.stringify(pasteBinName()) + ")";
        return evalScriptP(script);
    }

    function removeQuietly(p) {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
    }

    var pasteBtnTimer = null;

    function setPasteBtnState(state, text) {
        var btn = el.lazyPasteBtn;
        var label = btn.querySelector(".btn-text");
        clearTimeout(pasteBtnTimer);
        btn.className = "btn-lazy-paste" + (state ? " " + state : "");
        label.textContent = text;
        btn.disabled = state === "processing";
        if (state && state !== "processing") {
            pasteBtnTimer = setTimeout(function () {
                btn.className = "btn-lazy-paste";
                label.textContent = "Paste Image";
            }, 2500);
        }
    }

    function pasteFolderFor(projectFolder) {
        if (!projectFolder) return path.join(os.homedir(), "LazyKick_Pasted_Images");
        return path.join.apply(path, [projectFolder].concat(pasteBinName().split("/")));
    }

    function currentProjectFolder() {
        return evalScriptRaw("getProjectFolder()").then(function (res) {
            return (res && res !== "NO_PROJECT" && res !== "EvalScript error.") ? String(res) : null;
        });
    }

    function handleLazyPaste() {
        if (appState.pasteBusy) return Promise.resolve();
        appState.pasteBusy = true;
        setPasteBtnState("processing", "Reading Clipboard...");

        var tempPath = null;
        return currentProjectFolder().then(function (projectFolder) {
            var destDir = pasteFolderFor(projectFolder);
            mkdirp(destDir);
            tempPath = path.join(destDir, ".lazykick_clipboard_" + Date.now() + ".png");

            return readClipboardImage(tempPath).then(function (clip) {
                if (clip.kind === "none") {
                    removeQuietly(tempPath);
                    setPasteBtnState("error", "No Image in Clipboard!");
                    setStatus("No image found on the clipboard. Copy a picture or an image file first.", 3000);
                    return;
                }
                if (clip.kind === "error") {
                    removeQuietly(tempPath);
                    setPasteBtnState("error", "Clipboard Error");
                    setStatus("Could not read the clipboard: " + clip.message, 5000);
                    return;
                }

                return fileMd5(clip.path).then(function (hash) {
                    return (hash ? findPastedCopy(hash, destDir) : Promise.resolve(null)).then(function (existing) {
                        var finalPath;
                        if (existing) {
                            finalPath = existing; // same picture pasted again: reuse file and bin item
                        } else if (clip.kind === "file" && samePath(path.dirname(clip.path), destDir)) {
                            finalPath = clip.path;
                        } else {
                            var ext = clip.kind === "file" ? path.extname(clip.path).toLowerCase() : ".png";
                            finalPath = uniqueFilePath(destDir, makeTimestampFilename(ext));
                            if (clip.kind === "saved") {
                                try {
                                    fs.renameSync(clip.path, finalPath);
                                } catch (eRename) {
                                    fs.copyFileSync(clip.path, finalPath);
                                }
                            } else {
                                fs.copyFileSync(clip.path, finalPath);
                            }
                        }
                        removeQuietly(tempPath);
                        if (hash) rememberPastedCopy(hash, finalPath);

                        setPasteBtnState("processing", "Placing on timeline...");
                        return importPastedFile(finalPath).then(function (r) {
                            if (r && r.ok) {
                                addRecentPaste(finalPath);
                                setPasteBtnState("success", r.placedOnTimeline ? "Placed on Timeline!" : "Added to Project");
                                setStatus(r.msg + " (" + path.basename(finalPath) + ")", 4000);
                            } else {
                                setPasteBtnState("error", "Import Failed");
                                setStatus("Error: " + ((r && r.msg) || "the host did not answer"), 4000);
                            }
                        });
                    });
                });
            });
        }).catch(function (err) {
            removeQuietly(tempPath);
            setPasteBtnState("error", "Paste Failed");
            setStatus("Paste failed: " + (err && err.message ? err.message : err), 5000);
        }).then(function () {
            appState.pasteBusy = false;
        });
    }

    function loadRecentPastes() {
        var list = readJson(RECENT_PASTES_FILE, []);
        appState.recentPastes = (list instanceof Array ? list : []).filter(function (p) {
            return typeof p === "string" && fs.existsSync(p);
        }).slice(0, MAX_RECENT_PASTES);
    }

    function addRecentPaste(filePath) {
        appState.recentPastes = appState.recentPastes.filter(function (p) { return !samePath(p, filePath); });
        appState.recentPastes.unshift(filePath);
        if (appState.recentPastes.length > MAX_RECENT_PASTES) appState.recentPastes.length = MAX_RECENT_PASTES;
        writeJson(RECENT_PASTES_FILE, appState.recentPastes);
        renderRecentPastes();
    }

    function renderRecentPastes() {
        if (!el.recentPastesGallery) return;
        el.recentPastesGallery.innerHTML = "";

        var existing = appState.recentPastes.filter(function (p) { return fs.existsSync(p); });
        if (existing.length === 0) {
            el.recentPastesGallery.appendChild(makeEl("div", "empty-pastes", "No recent clipboard pastes yet."));
            return;
        }

        existing.forEach(function (fp) {
            var item = makeEl("div", "paste-thumb-item");
            item.title = fp + "\nClick to place it again";

            var img = document.createElement("img");
            img.src = fileUrl(fp);
            item.appendChild(img);

            item.addEventListener("click", function () {
                importPastedFile(fp).then(function (r) {
                    setStatus((r && r.ok) ? r.msg + " (" + path.basename(fp) + ")" : "Error: " + ((r && r.msg) || "could not re-import"), 3000);
                });
            });

            el.recentPastesGallery.appendChild(item);
        });
    }

    el.lazyPasteBtn.addEventListener("click", function () { handleLazyPaste(); });

    // Ctrl+V (Cmd+V) anywhere in the panel except while typing.
    document.addEventListener("keydown", function (e) {
        var isPaste = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.keyCode === 86 || e.key === "v" || e.key === "V");
        if (!isPaste || isEditableTarget(e.target) || isModalOpen()) return;
        e.preventDefault();
        handleLazyPaste();
    });

    function registerPasteShortcut() {
        // Ask the host to hand Ctrl/Cmd+V (and +Shift, paste without
        // formatting in the notes) to the panel while it has focus.
        var keys = process.platform === "darwin"
            ? [{ keyCode: 9, metaKey: true }, { keyCode: 9, metaKey: true, shiftKey: true }]
            : [{ keyCode: 86, ctrlKey: true }, { keyCode: 86, ctrlKey: true, shiftKey: true }];
        try { cs.registerKeyEventsInterest(JSON.stringify(keys)); } catch (e) {}
    }

    el.btnClearPastesHistory.addEventListener("click", function () {
        appState.recentPastes = [];
        writeJson(RECENT_PASTES_FILE, []);
        renderRecentPastes();
    });

    if (el.btnOpenPasteFolder) {
        el.btnOpenPasteFolder.addEventListener("click", function () {
            currentProjectFolder().then(function (projectFolder) {
                var dir = pasteFolderFor(projectFolder);
                if (!fs.existsSync(dir)) {
                    setStatus("Nothing pasted into " + dir + " yet", 3000);
                    return;
                }
                openInOS(dir);
            });
        });
    }

    el.optGuideLayer.addEventListener("change", function () {
        appState.settings.guideLayer = el.optGuideLayer.checked;
        saveGeneralSettings();
    });
    el.optAutoFit.addEventListener("change", function () {
        appState.settings.autoFit = el.optAutoFit.checked;
        saveGeneralSettings();
    });
    el.optTargetFolder.addEventListener("input", function () {
        appState.settings.targetFolder = sanitizeRelativePath(el.optTargetFolder.value, DEFAULT_PASTE_FOLDER);
        saveGeneralSettings();
    });
    el.optTargetFolder.addEventListener("change", function () {
        el.optTargetFolder.value = appState.settings.targetFolder;
    });

    // ============================================================
    // WATCH BINS ENGINE (Folder-to-Bin Media Sync)
    // ============================================================
    function loadBinsForProject() {
        var data = readJson(binsFileFor(appState.projectId), null);
        appState.bins = (data && data.bins instanceof Array) ? data.bins : [];
        el.binCountBadge.textContent = appState.bins.length;
    }

    /** Written to the project the bins belong to, even if another is open now. */
    function writeBins(projectId, bins) {
        if (!projectId) return;
        writeJson(binsFileFor(projectId), { bins: bins });
        if (isUnsavedId(projectId)) appState.touchedUnsaved = true;
    }

    function saveBinsForProject() {
        writeBins(appState.projectId, appState.bins);
        el.binCountBadge.textContent = appState.bins.length;
    }

    function skippedNames(bin) {
        return Object.keys(bin.skipped || {}).map(function (p) { return path.basename(p); });
    }

    function renderBinCards() {
        el.binCardsList.innerHTML = "";
        el.binCountBadge.textContent = appState.bins.length;
        if (!appState.bins || appState.bins.length === 0) {
            el.binsEmptyHint.style.display = "flex";
            return;
        }

        el.binsEmptyHint.style.display = "none";

        // Built node by node: folder names come from disk and must never be
        // parsed as HTML in a panel that can run Node.
        appState.bins.forEach(function (b) {
            var card = makeEl("div", "bin-card");

            var top = makeEl("div", "bin-card-top");
            top.appendChild(makeEl("div", "bin-target-title", "📁 " + (b.binPath || "Root")));

            var actions = makeEl("div", "bin-card-actions");
            var syncBtn = makeEl("button", "btn-tool btn-sync-single", "⚡ Sync");
            syncBtn.title = "Sync this folder now: imports new files, sorts the bin to match the folder's subfolders and retries skipped files";
            var openBtn = makeEl("button", "btn-tool btn-open-os", "📂");
            openBtn.title = "Open in Explorer/Finder";
            var editBtn = makeEl("button", "btn-tool btn-edit-bin", "✎");
            editBtn.title = "Edit: change the folder, bin name or filters";
            var resetBtn = makeEl("button", "btn-tool btn-reset-bin", "↺");
            resetBtn.title = "Reset: forget what was synced and sync again. Files still in the project are not imported twice.";
            var removeBtn = makeEl("button", "btn-tool btn-danger btn-remove-bin", "✕");
            removeBtn.title = "Unlink bin";
            actions.appendChild(syncBtn);
            actions.appendChild(openBtn);
            actions.appendChild(editBtn);
            actions.appendChild(resetBtn);
            actions.appendChild(removeBtn);
            top.appendChild(actions);
            card.appendChild(top);

            var source = makeEl("div", "bin-source-path", b.folderPath);
            source.title = b.folderPath;
            card.appendChild(source);

            var bottom = makeEl("div", "bin-card-bottom");
            var badges = makeEl("div", "bin-filters-badges");
            if (b.filterVideo) badges.appendChild(makeEl("span", "chip-tag", "Video"));
            if (b.filterAudio) badges.appendChild(makeEl("span", "chip-tag", "Audio"));
            if (b.filterImage) badges.appendChild(makeEl("span", "chip-tag", "Image"));
            if (b.recursive) badges.appendChild(makeEl("span", "chip-tag", "Subfolders"));
            bottom.appendChild(badges);

            var status = makeEl("div", "bin-sync-status", (b.importedCount || 0) + " items synced");
            var skipped = skippedNames(b);
            if (skipped.length) {
                var skippedTag = makeEl("span", "bin-skipped", " · " + skipped.length + " skipped");
                skippedTag.title = "Could not be imported (unsupported or damaged):\n" + skipped.slice(0, 15).join("\n") +
                    (skipped.length > 15 ? "\n..." : "") + "\nFix or replace them, then click Sync to retry.";
                status.appendChild(skippedTag);
            }
            bottom.appendChild(status);
            card.appendChild(bottom);

            syncBtn.addEventListener("click", function () {
                runExclusive(function () { return syncBin(b, { retrySkipped: true }); });
            });
            openBtn.addEventListener("click", function () { openInOS(b.folderPath); });
            editBtn.addEventListener("click", function () { openBinModal(b); });
            resetBtn.addEventListener("click", function () { resetBin(b); });
            removeBtn.addEventListener("click", function () {
                showDialog({
                    title: "Unlink watch bin",
                    message: "Stop watching \"" + (b.binPath || "Root") + "\"?\n\nFiles already imported stay in the project.",
                    ok: "Unlink",
                    danger: true
                }).then(function (ok) {
                    var at = appState.bins.indexOf(b);
                    if (!ok || at === -1) return; // gone already, or another project is open now
                    appState.bins.splice(at, 1);
                    saveBinsForProject();
                    renderBinCards();
                });
            });

            el.binCardsList.appendChild(card);
        });
    }

    /**
     * Forget which files were synced from this folder, then sync it again.
     * Files still in the project count as synced without a second import, so
     * this brings back only what was removed from the project.
     */
    function resetBin(bin) {
        var label = bin.binPath || "Root";
        var projectId = appState.projectId;
        var binsRef = appState.bins;
        return showDialog({
            title: "Reset watch bin",
            message: "Reset \"" + label + "\"?\n\nLazyKick forgets which files it synced from this folder and syncs it again. " +
                     "Files that are no longer in the project come back; files still in it are not imported twice.",
            ok: "Reset"
        }).then(function (ok) {
            if (!ok) return null;
            return runExclusive(function () {
                if (appState.bins !== binsRef || binsRef.indexOf(bin) === -1) return null;
                bin.history = {};
                bin.skipped = {};
                bin.importedCount = 0;
                writeBins(projectId, binsRef);
                renderBinCards();
                return syncBin(bin, { retrySkipped: true });
            });
        });
    }

    function readdirP(dir) {
        return new Promise(function (resolve) {
            fs.readdir(dir, function (err, names) { resolve(err ? [] : names); });
        });
    }

    function lstatP(p) {
        return new Promise(function (resolve) {
            fs.lstat(p, function (err, st) { resolve(err ? null : st); });
        });
    }

    function statP(p) {
        return new Promise(function (resolve) {
            fs.stat(p, function (err, st) { resolve(err ? null : st); });
        });
    }

    /** Dotfiles include macOS "._clip.mp4" resource forks, which are not media. */
    function isJunkName(name) {
        return name.charAt(0) === "." || name.indexOf("~$") === 0;
    }

    function allowedExtensions(bin) {
        var allowed = {};
        if (bin.filterVideo) EXT_GROUPS.video.forEach(function (e) { allowed[e] = true; });
        if (bin.filterAudio) EXT_GROUPS.audio.forEach(function (e) { allowed[e] = true; });
        if (bin.filterImage) EXT_GROUPS.image.forEach(function (e) { allowed[e] = true; });
        return allowed;
    }

    function isSkippedFolder(name) {
        var lower = name.toLowerCase();
        return WIN_HIDDEN_FOLDERS.hasOwnProperty(lower) || ADOBE_CACHE_FOLDERS.hasOwnProperty(lower);
    }

    /** "Day 2" before "Day 10", ignoring case, as Explorer and Finder sort names. */
    function naturalCompare(a, b) {
        var x = String(a).toLowerCase().match(/\d+|\D+/g) || [];
        var y = String(b).toLowerCase().match(/\d+|\D+/g) || [];
        for (var i = 0; i < x.length && i < y.length; i++) {
            if (x[i] === y[i]) continue;
            if (/^\d/.test(x[i]) && /^\d/.test(y[i])) {
                // Compared as digit strings, so long numbers keep their order.
                var nx = x[i].replace(/^0+(?=\d)/, "");
                var ny = y[i].replace(/^0+(?=\d)/, "");
                if (nx.length !== ny.length) return nx.length < ny.length ? -1 : 1;
                if (nx !== ny) return nx < ny ? -1 : 1;
                return x[i].length < y[i].length ? -1 : 1;
            }
            return x[i] < y[i] ? -1 : 1;
        }
        if (x.length !== y.length) return x.length < y.length ? -1 : 1;
        return a < b ? -1 : (a > b ? 1 : 0);
    }

    /** Explorer's order: folder by folder, subfolders before the files next to them. */
    function compareScanned(a, b) {
        var x = a.parts;
        var y = b.parts;
        for (var i = 0; i < x.length && i < y.length; i++) {
            if (x[i] === y[i]) continue;
            var xFolder = i < x.length - 1;
            var yFolder = i < y.length - 1;
            if (xFolder !== yFolder) return xFolder ? -1 : 1;
            return naturalCompare(x[i], y[i]);
        }
        return x.length - y.length;
    }

    /**
     * Every matching media file under the bin's folder, in Explorer's order,
     * as { path, size, mtimeMs, sub, parts }. `sub` is the subfolder the file
     * sits in ("Day 1/Cam A", "" for the folder itself): the bin it belongs
     * in, inside the watch bin. Asynchronous, so a big library does not
     * freeze the panel; linked folders are not followed, so a loop cannot
     * trap it.
     */
    function scanFolder(bin) {
        var allowed = allowedExtensions(bin);
        var results = [];

        function walk(dir, folders) {
            return readdirP(dir).then(function (names) {
                return Promise.all(names.map(function (name) {
                    if (isJunkName(name)) return null;
                    var full = path.join(dir, name);
                    return lstatP(full).then(function (lst) {
                        if (!lst) return null;
                        var statPromise = lst.isSymbolicLink() ? statP(full) : Promise.resolve(lst);
                        return statPromise.then(function (st) {
                            if (!st) return null;
                            if (st.isDirectory()) {
                                if (bin.recursive && !lst.isSymbolicLink() && !isSkippedFolder(name)) return walk(full, folders.concat([name]));
                                return null;
                            }
                            if (st.isFile() && allowed[path.extname(name).toLowerCase()]) {
                                results.push({
                                    path: full, size: st.size, mtimeMs: st.mtime.getTime(),
                                    sub: sanitizeRelativePath(folders.join("/"), ""),
                                    parts: folders.concat([name])
                                });
                            }
                            return null;
                        });
                    });
                }));
            });
        }

        return walk(bin.folderPath, []).then(function () {
            results.sort(compareScanned);
            return results;
        });
    }

    /** Sync jobs run one at a time, so two of them never import the same file twice. */
    function runExclusive(task) {
        appState.syncPending++;
        var run = syncChain.then(task);
        syncChain = run.then(function () {}, function () {});
        return run.then(function (value) {
            appState.syncPending--;
            return value;
        }, function (err) {
            appState.syncPending--;
            setStatus("Sync error: " + (err && err.message ? err.message : err), 4000);
            return null;
        });
    }

    function pathKey(p) {
        var s = normPath(p);
        return process.platform === "win32" ? s.toLowerCase() : s;
    }

    /** Drop a file from a bin's history, whatever case or slashes the host wrote it with. */
    function forgetHistory(bin, filePath) {
        var key = pathKey(filePath);
        Object.keys(bin.history).forEach(function (k) {
            if (pathKey(k) === key) delete bin.history[k];
        });
    }

    // Watch bins sorted to match their folders this session, so Auto-Sync
    // does it once per bin and then only calls the host for new files.
    var arrangedBins = {};

    function arrangeKey(projectId, bin) {
        return projectId + "|" + pathKey(bin.folderPath) + "|" + bin.binPath;
    }

    /**
     * Bring one watch folder into its bin. Subfolders become bins of the
     * same name inside it, and media already in the watch bin is moved to
     * match the folders on disk; a file moved to another folder keeps its
     * clip (relinked) instead of being imported twice.
     * opts.quiet         only report when something changed or failed
     * opts.auto          an Auto-Sync pass: sorts the bin once a session,
     *                    then calls the host only for new files
     * opts.requireStable only import files whose size held since the last scan
     * opts.retrySkipped  try files that failed before, even if unchanged
     */
    function syncBin(bin, opts) {
        opts = opts || {};
        var outcome = { imported: 0, failed: 0, waiting: 0, existing: 0, relinked: 0, moved: 0, merged: 0 };
        var projectId = appState.projectId;
        var binsRef = appState.bins;
        var label = bin.binPath || "Root";

        if (!hasOpenProject()) return Promise.resolve(outcome);
        // Queued before a project switch: this bin belongs to the other project.
        if (binsRef.indexOf(bin) === -1) return Promise.resolve(outcome);
        if (!fs.existsSync(bin.folderPath)) {
            if (!opts.quiet) setStatus("Folder not found: " + bin.folderPath, 3000);
            return Promise.resolve(outcome);
        }
        if (!bin.history) bin.history = {};
        if (!bin.skipped) bin.skipped = {};

        return scanFolder(bin).then(function (files) {
            if (projectId !== appState.projectId) return outcome;

            var batch = [];
            var isNew = {};
            files.forEach(function (file) {
                var norm = normPath(file.path);
                if (bin.history[norm] || file.size === 0) return;
                var signature = file.size + ":" + Math.round(file.mtimeMs);
                if (!opts.retrySkipped && bin.skipped[norm] === signature) return;
                if (opts.requireStable && stableSizes[norm] !== file.size) {
                    stableSizes[norm] = file.size;
                    outcome.waiting++;
                    return;
                }
                batch.push({ norm: norm, signature: signature });
                isNew[norm] = true;
            });

            var key = arrangeKey(projectId, bin);
            var arrange = !opts.auto || !arrangedBins[key];
            if (batch.length === 0 && (!arrange || files.length === 0)) {
                if (!opts.quiet) setStatus(label + ": no new files", 2000);
                return outcome;
            }
            if (!opts.quiet) {
                setStatus(batch.length ? "Importing " + batch.length + " new item(s) into " + label + "..." : "Sorting " + label + "...");
            }

            // Sorting needs every file; an Auto-Sync import only the new ones.
            var entries = [];
            files.forEach(function (file) {
                var norm = normPath(file.path);
                if (!arrange && !isNew[norm]) return;
                var entry = { p: norm, s: file.sub };
                if (isNew[norm]) entry.n = true;
                entries.push(entry);
            });
            var payload = { folder: normPath(bin.folderPath), arrange: arrange, files: entries };
            var script = "syncWatchBin(" + JSON.stringify(bin.binPath) + ", " +
                JSON.stringify(JSON.stringify(payload)) + ", " + JSON.stringify(projectId) + ")";

            return evalScriptP(script).then(function (r) {
                if (!r || !r.ok) {
                    if (!(r && r.projectChanged)) {
                        setStatus("Sync failed for " + label + ": " + ((r && r.msg) || "no reply from the host"), 4000);
                    }
                    return outcome;
                }
                if (arrange) arrangedBins[key] = true;

                var failedSet = {};
                var existingSet = {};
                var relinkedSet = {};
                (r.failedFiles || []).forEach(function (p) { failedSet[normPath(p)] = true; });
                (r.existingFiles || []).forEach(function (p) { existingSet[normPath(p)] = true; });
                (r.relinkedFiles || []).forEach(function (pair) {
                    // The clip now points at the new place; the old one is gone.
                    forgetHistory(bin, pair.from);
                    relinkedSet[normPath(pair.to)] = true;
                });
                batch.forEach(function (item) {
                    delete stableSizes[item.norm];
                    if (failedSet[item.norm]) {
                        // Remembered with its size and date: tried again only
                        // once the file changes, or on a manual Sync.
                        bin.skipped[item.norm] = item.signature;
                        outcome.failed++;
                    } else {
                        // Already in the project counts as synced: it is there,
                        // and importing it again would only make a duplicate.
                        bin.history[item.norm] = true;
                        delete bin.skipped[item.norm];
                        if (existingSet[item.norm]) outcome.existing++;
                        else if (relinkedSet[item.norm]) outcome.relinked++;
                        else outcome.imported++;
                    }
                });
                outcome.moved = r.moved || 0;
                outcome.merged = r.merged || 0;
                // The host used a bin the project already had for this folder:
                // the watch bin is that bin from now on.
                var tookOver = typeof r.rootPath === "string" && r.rootPath !== "" && r.rootPath !== bin.binPath;
                if (tookOver) {
                    bin.binPath = r.rootPath;
                    label = r.rootPath;
                    arrangedBins[arrangeKey(projectId, bin)] = true;
                }
                bin.importedCount = Object.keys(bin.history).length;
                writeBins(projectId, binsRef);
                if (projectId === appState.projectId) renderBinCards();

                if (outcome.imported || outcome.failed || outcome.existing || outcome.relinked || outcome.moved || outcome.merged || tookOver) {
                    setStatus((tookOver ? "Using the existing bin " + label + ". " : "") + "Synced " + label + ": " + describeOutcome(outcome), tookOver ? 5000 : 3000);
                } else if (!opts.quiet) {
                    setStatus(label + ": no new files", 2000);
                }
                return outcome;
            });
        });
    }

    /** "3 imported, 1 relinked (moved on disk), 12 sorted into subfolder bins, 2 already in the project, 1 could not be imported" */
    function describeOutcome(o) {
        var msg = o.imported + " imported";
        if (o.relinked) msg += ", " + o.relinked + " relinked (moved on disk)";
        if (o.moved) msg += ", " + o.moved + " sorted into subfolder bins";
        if (o.merged) msg += ", " + o.merged + " duplicate bin" + (o.merged === 1 ? "" : "s") + " merged";
        if (o.existing) msg += ", " + o.existing + " already in the project";
        if (o.failed) msg += ", " + o.failed + " could not be imported";
        return msg;
    }

    function syncBins(bins, opts) {
        var total = { imported: 0, failed: 0, waiting: 0, existing: 0, relinked: 0, moved: 0, merged: 0 };
        return bins.reduce(function (chain, bin) {
            return chain.then(function () {
                return syncBin(bin, opts).then(function (o) {
                    Object.keys(total).forEach(function (k) { total[k] += o[k]; });
                });
            });
        }, Promise.resolve()).then(function () { return total; });
    }

    el.btnSyncAll.addEventListener("click", function () {
        if (!appState.bins.length) {
            setStatus("No watch bins to sync yet", 2000);
            return;
        }
        if (!hasOpenProject()) {
            setStatus("Open a project first", 2000);
            return;
        }
        var bins = appState.bins.slice();
        runExclusive(function () {
            return syncBins(bins, { retrySkipped: true, quiet: true });
        }).then(function (total) {
            if (!total) return;
            setStatus("Sync All complete: " + describeOutcome(total), 3000);
        });
    });

    function autoSyncTick() {
        if (appState.syncPending > 0 || !appState.bins.length || !hasOpenProject()) return;
        el.autoSyncDot.className = "status-dot syncing";
        var bins = appState.bins.slice();
        runExclusive(function () {
            return syncBins(bins, { quiet: true, requireStable: true, auto: true });
        }).then(function () {
            el.autoSyncDot.className = appState.autoSync ? "status-dot active" : "status-dot";
        });
    }

    function updateAutoSyncState() {
        if (appState.autoSync) {
            el.autoSyncDot.className = "status-dot active";
            if (!appState.autoSyncTimer) {
                appState.autoSyncTimer = setInterval(autoSyncTick, AUTO_SYNC_INTERVAL_MS);
            }
        } else {
            el.autoSyncDot.className = "status-dot";
            if (appState.autoSyncTimer) {
                clearInterval(appState.autoSyncTimer);
                appState.autoSyncTimer = null;
            }
        }
    }

    el.autoSyncToggle.addEventListener("change", function () {
        appState.autoSync = el.autoSyncToggle.checked;
        saveGeneralSettings();
        updateAutoSyncState();
    });

    // ============================================================
    // Add / Edit Watch Bin Modal
    // ============================================================
    var editingBin = null;

    /** The watch-bin dialog: empty for a new bin, or filled in to edit `bin`. */
    function openBinModal(bin) {
        if (!hasOpenProject()) {
            showMessage("Watch Bins", "Open or create a project first. Watch bins belong to a project.");
            return;
        }
        editingBin = bin || null;
        el.binModalTitle.textContent = bin ? "Edit Watch Bin" : "Link Folder to Bin";
        el.btnModalSaveBin.textContent = bin ? "Save Changes" : "Save Watch Bin";
        el.modalFolderInput.value = bin ? bin.folderPath : "";
        el.modalBinNameInput.value = bin ? (bin.binPath || "") : "";
        el.filterVideo.checked = bin ? !!bin.filterVideo : true;
        el.filterAudio.checked = bin ? !!bin.filterAudio : true;
        el.filterImage.checked = bin ? !!bin.filterImage : true;
        el.modalRecursiveCheck.checked = bin ? !!bin.recursive : true;
        el.binModalOverlay.classList.remove("hidden");
    }

    el.btnAddBin.addEventListener("click", function () { openBinModal(null); });

    function closeBinModal() {
        el.binModalOverlay.classList.add("hidden");
        editingBin = null;
    }

    el.btnModalClose.addEventListener("click", closeBinModal);
    el.btnModalCancel.addEventListener("click", closeBinModal);

    /** Whether a synced file is one this bin still looks at (folder, depth, filters). */
    function inBinScope(bin, filePath) {
        var folder = normPath(path.resolve(bin.folderPath)).replace(/\/+$/, "") + "/";
        var file = normPath(filePath);
        if (process.platform === "win32") {
            folder = folder.toLowerCase();
            file = file.toLowerCase();
        }
        if (file.indexOf(folder) !== 0) return false;
        var rest = file.substring(folder.length);
        if (!bin.recursive && rest.indexOf("/") !== -1) return false;
        return !!allowedExtensions(bin)[path.extname(rest).toLowerCase()];
    }

    /** After an edit, drop what was synced from a folder or filter the bin no longer uses. */
    function pruneToScope(bin) {
        ["history", "skipped"].forEach(function (key) {
            var kept = {};
            Object.keys(bin[key] || {}).forEach(function (p) {
                if (inBinScope(bin, p)) kept[p] = bin[key][p];
            });
            bin[key] = kept;
        });
        bin.importedCount = Object.keys(bin.history).length;
    }

    el.btnModalSaveBin.addEventListener("click", function () {
        var folderPath = el.modalFolderInput.value.trim();
        var isFolder = false;
        try { isFolder = !!folderPath && fs.statSync(folderPath).isDirectory(); } catch (e) { isFolder = false; }
        if (!isFolder) {
            showMessage("Watch Bins", "Please choose a folder that exists on your computer.");
            return;
        }
        if (!el.filterVideo.checked && !el.filterAudio.checked && !el.filterImage.checked) {
            showMessage("Watch Bins", "Turn on at least one media filter (Video, Audio or Image).");
            return;
        }

        var editing = editingBin;
        var binPath = sanitizeRelativePath(el.modalBinNameInput.value, sanitizeRelativePath(path.basename(folderPath), "Media"));
        var duplicate = appState.bins.some(function (b) {
            return b !== editing && samePath(b.folderPath, folderPath) && b.binPath === binPath;
        });
        if (duplicate) {
            showMessage("Watch Bins", "This folder is already linked to the '" + binPath + "' bin.");
            return;
        }

        var settings = {
            folderPath: folderPath,
            binPath: binPath,
            filterVideo: el.filterVideo.checked,
            filterAudio: el.filterAudio.checked,
            filterImage: el.filterImage.checked,
            recursive: el.modalRecursiveCheck.checked
        };

        if (editing) {
            var projectId = appState.projectId;
            var binsRef = appState.bins;
            closeBinModal();
            if (binsRef.indexOf(editing) === -1) {
                setStatus("The project changed while the dialog was open; the watch bin was not edited", 4000);
                return;
            }
            // Applied in the sync queue, so a sync still running for the old
            // folder cannot write its results over the new settings.
            runExclusive(function () {
                if (binsRef.indexOf(editing) === -1) return null;
                Object.keys(settings).forEach(function (k) { editing[k] = settings[k]; });
                pruneToScope(editing);
                writeBins(projectId, binsRef);
                if (appState.bins === binsRef) renderBinCards();
                return syncBin(editing, {});
            });
            return;
        }

        var bin = settings;
        bin.history = {};
        bin.skipped = {};
        bin.importedCount = 0;
        appState.bins.push(bin);

        saveBinsForProject();
        renderBinCards();
        closeBinModal();
        runExclusive(function () { return syncBin(bin, {}); });
    });

    // ============================================================
    // Custom In-Panel Folder Browser
    // ============================================================
    function openFolderBrowser(initialPath, callback) {
        fb.callback = callback;
        var start = initialPath && fs.existsSync(initialPath) ? initialPath : (process.platform === "win32" ? "C:\\" : os.homedir());
        fb.selectedPath = start;
        el.fbOverlay.classList.remove("hidden");
        loadDrives();
        navigateFB(start);
    }

    function closeFolderBrowser() {
        el.fbOverlay.classList.add("hidden");
        fb.callback = null;
    }

    function addDriveButton(label, target) {
        var btn = makeEl("button", "fb-drive-btn", label);
        btn.title = target;
        btn.addEventListener("click", function () { navigateFB(target); });
        el.fbDrivesBar.appendChild(btn);
    }

    function loadDrives() {
        el.fbDrivesBar.innerHTML = "";
        if (process.platform === "win32") {
            "CDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach(function (ltr) {
                var p = ltr + ":\\";
                if (fs.existsSync(p)) addDriveButton(ltr + ":", p);
            });
        } else {
            addDriveButton("Home", os.homedir());
            addDriveButton("Desktop", path.join(os.homedir(), "Desktop"));
            if (fs.existsSync("/Volumes")) addDriveButton("Volumes", "/Volumes");
        }
    }

    /** Visible subfolder names, sorted. Node 10.10+ answers without a stat per entry. */
    function listSubfolders(dir) {
        var names = [];
        try {
            var entries = fs.readdirSync(dir, { withFileTypes: true });
            names = entries.map(function (entry) {
                if (typeof entry === "string") {
                    // Node 8 ignores withFileTypes and returns plain names.
                    try { return fs.statSync(path.join(dir, entry)).isDirectory() ? entry : null; } catch (e) { return null; }
                }
                return entry.isDirectory() ? entry.name : null;
            });
        } catch (e) {
            names = [];
        }
        return names.filter(function (name) {
            return name && !isJunkName(name) && !WIN_HIDDEN_FOLDERS[name.toLowerCase()];
        }).sort(function (a, b) {
            return a.toLowerCase() < b.toLowerCase() ? -1 : (a.toLowerCase() > b.toLowerCase() ? 1 : 0);
        });
    }

    function navigateFB(targetPath) {
        fb.currentPath = targetPath;
        fb.selectedPath = targetPath;
        el.fbPathInput.value = targetPath;
        el.fbSelectedHint.textContent = targetPath;
        el.fbList.innerHTML = "";

        listSubfolders(targetPath).forEach(function (name) {
            var full = path.join(targetPath, name);
            var div = makeEl("div", "fb-item", "📁 " + name);
            div.addEventListener("click", function () {
                el.fbList.querySelectorAll(".fb-item").forEach(function (node) { node.classList.remove("selected"); });
                div.classList.add("selected");
                fb.selectedPath = full;
                el.fbSelectedHint.textContent = full;
            });
            div.addEventListener("dblclick", function () { navigateFB(full); });
            el.fbList.appendChild(div);
        });
    }

    el.fbUpBtn.addEventListener("click", function () {
        var up = path.dirname(fb.currentPath);
        if (up && up !== fb.currentPath) navigateFB(up);
    });

    el.fbGoBtn.addEventListener("click", function () {
        var p = el.fbPathInput.value.trim();
        if (fs.existsSync(p)) navigateFB(p);
    });

    el.fbPathInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
            var p = el.fbPathInput.value.trim();
            if (fs.existsSync(p)) navigateFB(p);
        }
    });

    el.fbCloseBtn.addEventListener("click", closeFolderBrowser);
    el.fbCancelBtn.addEventListener("click", closeFolderBrowser);

    el.fbSelectBtn.addEventListener("click", function () {
        var chosen = fb.selectedPath || fb.currentPath;
        if (fb.callback) fb.callback(chosen);
        closeFolderBrowser();
    });

    el.btnBrowseFolder.addEventListener("click", function () {
        openFolderBrowser(el.modalFolderInput.value || appState.lastPickerPath, function (chosen) {
            el.modalFolderInput.value = chosen;
            if (!el.modalBinNameInput.value) {
                el.modalBinNameInput.value = path.basename(chosen) || "Media";
            }
            // Remembered across restarts: the next Browse opens here.
            appState.lastPickerPath = chosen;
            saveGeneralSettings();
        });
    });

    el.refreshBtn.addEventListener("click", function () {
        pollProject();
        setStatus("Refreshed project info", 1500);
    });

    if (el.devLink) {
        el.devLink.addEventListener("click", function (e) {
            e.preventDefault();
            openExternal(el.devLink.getAttribute("href"));
        });
    }

    window.addEventListener("beforeunload", function () {
        if (appState.notesSaveTimer) saveCurrentNote();
    });

    // ============================================================
    // Initialization
    // ============================================================
    if (el.brandTag) el.brandTag.textContent = "LazyKick v" + PANEL_VERSION.replace(/\.0$/, "");
    loadGeneralSettings();
    loadRecentPastes();
    renderRecentPastes();
    updateAutoSyncState();
    registerPasteShortcut();
    pollProject();
    setInterval(pollProject, PROJECT_POLL_MS);
    scheduleFollow(1000);

})();
