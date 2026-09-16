/*
========================================================================
  LazyKick — Frontend Controller (main.js)
  Developed By: RaisulSohan
  Website: https://raisulsohan.com
  Description: Unified frontend for Notes, Watch Bins, and QuickPaste.
  Copyright (c) 2026 Raisul Sohan. All rights reserved.
========================================================================

  Runs in CEP's Chromium with Node enabled. The oldest supported hosts
  (CEP 9) ship Chromium 61 and Node 8.6, so this file sticks to what those
  have: no optional chaining, no fs.promises, no readdir withFileTypes, no
  recursive mkdir, no navigator.clipboard without a fallback.
  `tools/test-panel.mjs` drives it against a mocked DOM and host.
*/

(function () {
    "use strict";

    var PANEL_VERSION = "1.1.0";

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

        // QuickPaste & Tools Settings
        settings: {
            guideLayer: true,
            autoFit: false,
            targetFolder: DEFAULT_PASTE_FOLDER
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
        quickPasteBtn:         document.getElementById("quickPasteBtn"),
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
        return !el.binModalOverlay.classList.contains("hidden") || !el.fbOverlay.classList.contains("hidden");
    }

    function hasOpenProject() {
        var id = appState.projectId;
        return !!id && id !== NONE_ID && id.indexOf("error|") !== 0 && appState.projectHost !== "none";
    }

    function isUnsavedId(id) {
        return !!id && String(id).split("|")[1] === "unsaved";
    }

    function openInOS(folderPath) {
        if (!folderPath || !fs.existsSync(folderPath)) {
            alert("Folder path does not exist on disk:\n" + folderPath);
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

        el.optGuideLayer.checked = appState.settings.guideLayer;
        el.optAutoFit.checked = appState.settings.autoFit;
        el.optTargetFolder.value = appState.settings.targetFolder;
        el.autoSyncToggle.checked = appState.autoSync;
    }

    function saveGeneralSettings() {
        writeJson(SETTINGS_FILE, {
            guideLayer: appState.settings.guideLayer,
            autoFit: appState.settings.autoFit,
            targetFolder: appState.settings.targetFolder,
            autoSync: appState.autoSync
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

    // Paste text only: rich web pages bring fonts, colours and huge inline images.
    el.noteEditor.addEventListener("paste", function (e) {
        var data = e.clipboardData;
        if (!data) return;
        e.preventDefault();
        var text = data.getData("text/plain");
        if (text) {
            document.execCommand("insertText", false, text);
        } else if (data.types && Array.prototype.indexOf.call(data.types, "Files") !== -1) {
            setStatus("Images go to the timeline: click Paste Image, or press Ctrl/Cmd+V outside the notes", 4000);
        }
    });

    el.btnAddNoteTab.addEventListener("click", function () {
        saveCurrentNote();
        var newIdx = appState.notesData.tabs.length;
        appState.notesData.tabs.push({ name: "Note " + (newIdx + 1), content: "" });
        switchNoteTab(String(newIdx));
    });

    el.btnDeleteNoteTab.addEventListener("click", function () {
        if (appState.notesData.activeTabId === "global") {
            alert("The Global Scratchpad cannot be deleted.");
            return;
        }
        if (appState.notesData.tabs.length <= 1) {
            alert("You must keep at least one project note tab.");
            return;
        }
        if (confirm("Delete this note tab?")) {
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
        }
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
            alert("Note successfully exported to:\n" + targetFile);
        } catch (e) {
            alert("Failed to export note:\n" + e.message);
        }
    });

    // ============================================================
    // QUICKPASTE ENGINE (Clipboard Image to Timeline)
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
        var btn = el.quickPasteBtn;
        var label = btn.querySelector(".btn-text");
        clearTimeout(pasteBtnTimer);
        btn.className = "btn-quick-paste" + (state ? " " + state : "");
        label.textContent = text;
        btn.disabled = state === "processing";
        if (state && state !== "processing") {
            pasteBtnTimer = setTimeout(function () {
                btn.className = "btn-quick-paste";
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

    function handleQuickPaste() {
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

    el.quickPasteBtn.addEventListener("click", function () { handleQuickPaste(); });

    // Ctrl+V (Cmd+V) anywhere in the panel except while typing.
    document.addEventListener("keydown", function (e) {
        var isPaste = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.keyCode === 86 || e.key === "v" || e.key === "V");
        if (!isPaste || isEditableTarget(e.target) || isModalOpen()) return;
        e.preventDefault();
        handleQuickPaste();
    });

    function registerPasteShortcut() {
        // Ask the host to hand Ctrl/Cmd+V to the panel while it has focus.
        var keys = process.platform === "darwin"
            ? [{ keyCode: 9, metaKey: true }]
            : [{ keyCode: 86, ctrlKey: true }];
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
            syncBtn.title = "Sync this folder now (also retries skipped files)";
            var openBtn = makeEl("button", "btn-tool btn-open-os", "📂");
            openBtn.title = "Open in Explorer/Finder";
            var removeBtn = makeEl("button", "btn-tool btn-danger btn-remove-bin", "✕");
            removeBtn.title = "Unlink bin";
            actions.appendChild(syncBtn);
            actions.appendChild(openBtn);
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
            if (b.recursive) badges.appendChild(makeEl("span", "chip-tag", "Recursive"));
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
            removeBtn.addEventListener("click", function () {
                if (confirm("Unlink this folder from Watch Bins?\nFiles already imported stay in the project.")) {
                    var at = appState.bins.indexOf(b);
                    if (at !== -1) appState.bins.splice(at, 1);
                    saveBinsForProject();
                    renderBinCards();
                }
            });

            el.binCardsList.appendChild(card);
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

    /**
     * Every matching media file under the bin's folder, as
     * { path, size, mtimeMs }. Asynchronous, so a big library does not freeze
     * the panel; linked folders are not followed, so a loop cannot trap it.
     */
    function scanFolder(bin) {
        var allowed = allowedExtensions(bin);
        var results = [];

        function walk(dir) {
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
                                if (bin.recursive && !lst.isSymbolicLink() && !WIN_HIDDEN_FOLDERS[name.toLowerCase()]) return walk(full);
                                return null;
                            }
                            if (st.isFile() && allowed[path.extname(name).toLowerCase()]) {
                                results.push({ path: full, size: st.size, mtimeMs: st.mtime.getTime() });
                            }
                            return null;
                        });
                    });
                }));
            });
        }

        return walk(bin.folderPath).then(function () {
            results.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
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

    /**
     * Import what is new in one watch folder.
     * opts.quiet         only report when something was imported or failed
     * opts.requireStable only import files whose size held since the last scan
     * opts.retrySkipped  try files that failed before, even if unchanged
     */
    function syncBin(bin, opts) {
        opts = opts || {};
        var outcome = { imported: 0, failed: 0, waiting: 0 };
        var projectId = appState.projectId;
        var binsRef = appState.bins;
        var label = bin.binPath || "Root";

        if (!hasOpenProject()) return Promise.resolve(outcome);
        if (!fs.existsSync(bin.folderPath)) {
            if (!opts.quiet) setStatus("Folder not found: " + bin.folderPath, 3000);
            return Promise.resolve(outcome);
        }
        if (!bin.history) bin.history = {};
        if (!bin.skipped) bin.skipped = {};

        return scanFolder(bin).then(function (files) {
            if (projectId !== appState.projectId) return outcome;

            var batch = [];
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
            });

            if (batch.length === 0) {
                if (!opts.quiet) setStatus(label + ": no new files", 2000);
                return outcome;
            }
            if (!opts.quiet) setStatus("Importing " + batch.length + " new item(s) into " + label + "...");

            var paths = batch.map(function (item) { return item.norm; });
            var script = "importFilesToBin(" + JSON.stringify(bin.binPath) + ", " +
                JSON.stringify(JSON.stringify(paths)) + ", " + JSON.stringify(projectId) + ")";

            return evalScriptP(script).then(function (r) {
                if (!r || !r.ok) {
                    if (!(r && r.projectChanged)) {
                        setStatus("Sync failed for " + label + ": " + ((r && r.msg) || "no reply from the host"), 4000);
                    }
                    return outcome;
                }

                var failedSet = {};
                (r.failedFiles || []).forEach(function (p) { failedSet[normPath(p)] = true; });
                batch.forEach(function (item) {
                    delete stableSizes[item.norm];
                    if (failedSet[item.norm]) {
                        // Remembered with its size and date: tried again only
                        // once the file changes, or on a manual Sync.
                        bin.skipped[item.norm] = item.signature;
                        outcome.failed++;
                    } else {
                        bin.history[item.norm] = true;
                        delete bin.skipped[item.norm];
                        outcome.imported++;
                    }
                });
                bin.importedCount = Object.keys(bin.history).length;
                writeBins(projectId, binsRef);
                if (projectId === appState.projectId) renderBinCards();

                if (outcome.imported || outcome.failed || !opts.quiet) {
                    var msg = "Synced " + outcome.imported + " item(s) into " + label;
                    if (outcome.failed) msg += ", " + outcome.failed + " could not be imported";
                    setStatus(msg, 3000);
                }
                return outcome;
            });
        });
    }

    function syncBins(bins, opts) {
        var total = { imported: 0, failed: 0, waiting: 0 };
        return bins.reduce(function (chain, bin) {
            return chain.then(function () {
                return syncBin(bin, opts).then(function (o) {
                    total.imported += o.imported;
                    total.failed += o.failed;
                    total.waiting += o.waiting;
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
            var msg = "Sync All complete: " + total.imported + " imported";
            if (total.failed) msg += ", " + total.failed + " could not be imported";
            setStatus(msg, 3000);
        });
    });

    function autoSyncTick() {
        if (appState.syncPending > 0 || !appState.bins.length || !hasOpenProject()) return;
        el.autoSyncDot.className = "status-dot syncing";
        var bins = appState.bins.slice();
        runExclusive(function () {
            return syncBins(bins, { quiet: true, requireStable: true });
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
    el.btnAddBin.addEventListener("click", function () {
        if (!hasOpenProject()) {
            alert("Open or create a project first. Watch bins belong to a project.");
            return;
        }
        el.modalFolderInput.value = "";
        el.modalBinNameInput.value = "";
        el.filterVideo.checked = true;
        el.filterAudio.checked = true;
        el.filterImage.checked = true;
        el.modalRecursiveCheck.checked = true;
        el.binModalOverlay.classList.remove("hidden");
    });

    function closeBinModal() {
        el.binModalOverlay.classList.add("hidden");
    }

    el.btnModalClose.addEventListener("click", closeBinModal);
    el.btnModalCancel.addEventListener("click", closeBinModal);

    el.btnModalSaveBin.addEventListener("click", function () {
        var folderPath = el.modalFolderInput.value.trim();
        var isFolder = false;
        try { isFolder = !!folderPath && fs.statSync(folderPath).isDirectory(); } catch (e) { isFolder = false; }
        if (!isFolder) {
            alert("Please select a valid folder on your computer.");
            return;
        }
        if (!el.filterVideo.checked && !el.filterAudio.checked && !el.filterImage.checked) {
            alert("Turn on at least one media filter (Video, Audio or Image).");
            return;
        }

        var binPath = sanitizeRelativePath(el.modalBinNameInput.value, sanitizeRelativePath(path.basename(folderPath), "Media"));
        var duplicate = appState.bins.some(function (b) {
            return samePath(b.folderPath, folderPath) && b.binPath === binPath;
        });
        if (duplicate) {
            alert("This folder is already linked to the '" + binPath + "' bin.");
            return;
        }

        var bin = {
            folderPath: folderPath,
            binPath: binPath,
            filterVideo: el.filterVideo.checked,
            filterAudio: el.filterAudio.checked,
            filterImage: el.filterImage.checked,
            recursive: el.modalRecursiveCheck.checked,
            history: {},
            skipped: {},
            importedCount: 0
        };
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
            appState.lastPickerPath = chosen;
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

})();
