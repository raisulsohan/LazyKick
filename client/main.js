/*
========================================================================
  LazyKick — Frontend Controller (main.js)
  Developed By: RaisulSohan
  Website: https://raisulsohan.com
  Description: Unified frontend for Notes, Watch Bins, and QuickPaste.
  Copyright (c) 2026 Raisul Sohan. All rights reserved.
========================================================================
*/

(function () {
    "use strict";

    console.log("%c ⚡ LazyKick v1.0 • Developed By RaisulSohan (raisulsohan.com) ", 
                "background: #18181a; color: #3ca9ff; font-weight: bold; font-size: 13px; padding: 4px 8px; border-radius: 4px; border: 1px solid #3ca9ff;");

    // ============================================================
    // Node.js & Host Interface Modules
    // ============================================================
    var fs        = require("fs");
    var path      = require("path");
    var os        = require("os");
    var execSync  = require("child_process").execSync;
    var cs        = new CSInterface();

    // ============================================================
    // Storage Directory & Constants
    // ============================================================
    function getStorageDir() {
        var base;
        if (process.platform === "win32") {
            base = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
        } else if (process.platform === "darwin") {
            base = path.join(os.homedir(), "Library", "Application Support");
        } else {
            base = path.join(os.homedir(), ".config");
        }
        var dir = path.join(base, "AdobeProjectNotepad");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    var STORAGE_DIR = getStorageDir();
    var NONE_ID = "__none__";

    var EXT_GROUPS = {
        video: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".mpg", ".mpeg", ".mxf", ".prores"],
        audio: [".mp3", ".wav", ".aac", ".flac", ".m4a", ".ogg", ".aif", ".aiff", ".wma"],
        image: [".jpg", ".jpeg", ".png", ".tif", ".tiff", ".exr", ".dpx", ".tga", ".bmp", ".psd", ".ai", ".gif", ".webp", ".heic", ".raw", ".arw", ".cr2", ".nef", ".svg"]
    };

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

        // Notes State
        notesData: { tabs: [{ name: "Note 1", content: "" }], activeTabId: "0" },
        globalNote: "",
        notesSaveTimer: null,

        // Watch Bins State
        bins: [],
        autoSync: false,
        autoSyncTimer: null,
        autoSyncBusy: false,
        lastPickerPath: "",

        // QuickPaste & Tools Settings
        settings: {
            guideLayer: true,
            autoFit: false,
            targetFolder: "Pasted Images"
        },
        recentPastes: []
    };

    // Folder Browser State
    var fb = {
        currentPath: "",
        selectedPath: "",
        callback: null,
        drives: []
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
            if (duration) {
                clearTimeout(setStatus._t);
                setStatus._t = setTimeout(function () {
                    el.globalStatus.textContent = "Ready";
                }, duration);
            }
        }
    }

    function padZero(n) { return n < 10 ? "0" + n : "" + n; }

    function makeTimestampFilename() {
        var d = new Date();
        return "pasted_" + d.getFullYear() + padZero(d.getMonth() + 1) + padZero(d.getDate()) +
               "_" + padZero(d.getHours()) + padZero(d.getMinutes()) + padZero(d.getSeconds()) + ".png";
    }

    // ============================================================
    // Persistence: Settings & Global Notes
    // ============================================================
    function loadGeneralSettings() {
        var f = path.join(STORAGE_DIR, "lazykick_settings.json");
        if (fs.existsSync(f)) {
            try {
                var s = JSON.parse(fs.readFileSync(f, "utf8"));
                if (s.guideLayer !== undefined) appState.settings.guideLayer = s.guideLayer;
                if (s.autoFit !== undefined) appState.settings.autoFit = s.autoFit;
                if (s.targetFolder) appState.settings.targetFolder = s.targetFolder;
                if (s.autoSync !== undefined) appState.autoSync = s.autoSync;
            } catch (e) {}
        }
        el.optGuideLayer.checked = appState.settings.guideLayer;
        el.optAutoFit.checked = appState.settings.autoFit;
        el.optTargetFolder.value = appState.settings.targetFolder;
        el.autoSyncToggle.checked = appState.autoSync;
    }

    function saveGeneralSettings() {
        var f = path.join(STORAGE_DIR, "lazykick_settings.json");
        try {
            fs.writeFileSync(f, JSON.stringify({
                guideLayer: appState.settings.guideLayer,
                autoFit: appState.settings.autoFit,
                targetFolder: appState.settings.targetFolder,
                autoSync: appState.autoSync
            }, null, 2), "utf8");
        } catch (e) {}
    }

    function loadGlobalNote() {
        var f = path.join(STORAGE_DIR, "global_scratchpad.txt");
        if (fs.existsSync(f)) {
            try { return fs.readFileSync(f, "utf8"); } catch (e) { return ""; }
        }
        return "";
    }

    function saveGlobalNote(content) {
        var f = path.join(STORAGE_DIR, "global_scratchpad.txt");
        try { fs.writeFileSync(f, content, "utf8"); } catch (e) {}
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
    function pollProject() {
        cs.evalScript("getProjectInfo()", function (res) {
            try {
                var info = (typeof res === "string") ? JSON.parse(res) : res;
                if (!info) return;

                var host = (info.host || "none").toUpperCase();
                el.hostBadge.textContent = host;

                var id = info.fullId || NONE_ID;
                if (id !== appState.projectId) {
                    appState.projectId = id;
                    appState.projectPath = info.path || null;
                    appState.projectHost = info.host || "none";
                    appState.isSaved = !!info.saved;
                    appState.projectName = info.name || "Untitled";

                    el.projectName.textContent = appState.projectName;
                    el.projectName.title = appState.projectPath || appState.projectName;

                    onProjectChanged();
                }
            } catch (err) {
                // Ignore parse errors during app startup
            }
        });
    }

    function onProjectChanged() {
        loadNotesForProject();
        loadBinsForProject();
        renderNotesTabBar();
        renderActiveNoteContent();
        renderBinCards();
        setStatus("Loaded project: " + appState.projectName, 2000);
    }

    // ============================================================
    // NOTES & TASKS ENGINE
    // ============================================================
    function notesFileFor(projId) {
        return path.join(STORAGE_DIR, hashPath(projId) + ".json");
    }

    function loadNotesForProject() {
        appState.globalNote = loadGlobalNote();
        var fallback = { tabs: [{ name: "Note 1", content: "" }], activeTabId: "0" };
        var f = notesFileFor(appState.projectId);
        if (!fs.existsSync(f)) {
            appState.notesData = fallback;
            return;
        }
        try {
            var d = JSON.parse(fs.readFileSync(f, "utf8"));
            if (!d.tabs || !d.tabs.length) d.tabs = [{ name: "Note 1", content: "" }];
            if (!d.activeTabId) d.activeTabId = "0";
            appState.notesData = d;
        } catch (e) {
            appState.notesData = fallback;
        }
    }

    function saveCurrentNote() {
        var currentTab = appState.notesData.activeTabId;
        var content = el.noteEditor.innerHTML;

        if (currentTab === "global") {
            appState.globalNote = content;
            saveGlobalNote(content);
        } else {
            var idx = parseInt(currentTab, 10);
            if (appState.notesData.tabs[idx]) {
                appState.notesData.tabs[idx].content = content;
            }
            try {
                fs.writeFileSync(notesFileFor(appState.projectId), JSON.stringify(appState.notesData, null, 2), "utf8");
            } catch (e) {}
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
        var globalBtn = document.createElement("button");
        globalBtn.className = "sub-tab" + (appState.notesData.activeTabId === "global" ? " active" : "");
        globalBtn.setAttribute("data-tab-id", "global");
        globalBtn.textContent = "🌐 Global";
        globalBtn.addEventListener("click", function () { switchNoteTab("global"); });
        el.notesTabBar.appendChild(globalBtn);

        // Project Tabs
        appState.notesData.tabs.forEach(function (tab, idx) {
            var tabBtn = document.createElement("button");
            var strIdx = String(idx);
            tabBtn.className = "sub-tab" + (appState.notesData.activeTabId === strIdx ? " active" : "");
            tabBtn.setAttribute("data-tab-id", strIdx);
            tabBtn.textContent = tab.name || ("Note " + (idx + 1));
            tabBtn.addEventListener("click", function () { switchNoteTab(strIdx); });

            // Double click to rename tab
            tabBtn.addEventListener("dblclick", function () {
                var newName = prompt("Rename note tab:", tab.name);
                if (newName && newName.trim()) {
                    tab.name = newName.trim();
                    saveCurrentNote();
                    renderNotesTabBar();
                }
            });

            el.notesTabBar.appendChild(tabBtn);
        });
    }

    function switchNoteTab(tabId) {
        saveCurrentNote();
        appState.notesData.activeTabId = tabId;
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
        attachTodoListeners();
    }

    function attachTodoListeners() {
        var checkboxes = el.noteEditor.querySelectorAll(".todo-checkbox");
        checkboxes.forEach(function (cb) {
            cb.onchange = function () {
                var parent = cb.closest(".todo-item");
                if (parent) {
                    if (cb.checked) {
                        parent.classList.add("completed");
                        cb.setAttribute("checked", "checked");
                    } else {
                        parent.classList.remove("completed");
                        cb.removeAttribute("checked");
                    }
                    debouncedSaveNote();
                }
            };
        });
    }

    // Notes Action Buttons
    el.noteEditor.addEventListener("input", function () {
        debouncedSaveNote();
    });

    el.btnAddNoteTab.addEventListener("click", function () {
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
            var idx = parseInt(appState.notesData.activeTabId, 10);
            appState.notesData.tabs.splice(idx, 1);
            appState.notesData.activeTabId = "0";
            saveCurrentNote();
            renderNotesTabBar();
            renderActiveNoteContent();
        }
    });

    el.btnInsertTask.addEventListener("click", function () {
        el.noteEditor.focus();
        var html = '<div class="todo-item"><input type="checkbox" class="todo-checkbox"><span class="todo-text">New Task</span></div><div><br></div>';
        document.execCommand("insertHTML", false, html);
        attachTodoListeners();
        debouncedSaveNote();
    });

    el.btnInsertTimecode.addEventListener("click", function () {
        cs.evalScript("getCurrentTimecode()", function (res) {
            try {
                var data = (typeof res === "string") ? JSON.parse(res) : res;
                var tc = (data && data.ok && data.timecode) ? data.timecode : "00:00:00:00";
                el.noteEditor.focus();
                var html = '<span class="timecode-tag">[' + tc + ']</span>&nbsp;';
                document.execCommand("insertHTML", false, html);
                debouncedSaveNote();
                setStatus("Inserted timecode: " + tc, 2000);
            } catch (e) {
                setStatus("Could not get timeline timecode", 2000);
            }
        });
    });

    el.btnCopyNote.addEventListener("click", function () {
        var text = el.noteEditor.innerText;
        navigator.clipboard.writeText(text).then(function () {
            setStatus("Note copied to clipboard!", 2000);
        });
    });

    el.btnExportNote.addEventListener("click", function () {
        var text = el.noteEditor.innerText;
        var defaultFolder = appState.projectPath ? path.dirname(appState.projectPath) : os.homedir();
        var filename = "Note_" + (appState.projectName.replace(/[^\w]/g, "_")) + ".txt";
        var targetFile = path.join(defaultFolder, filename);

        try {
            fs.writeFileSync(targetFile, text, "utf8");
            setStatus("Exported note to: " + filename, 3000);
            alert("Note successfully exported to:\n" + targetFile);
        } catch (e) {
            alert("Failed to export note:\n" + e.message);
        }
    });

    // ============================================================
    // QUICKPASTE ENGINE (Clipboard Image to Timeline)
    // ============================================================
    function saveClipboardImageWindows(targetPath) {
        var safePath = targetPath.replace(/'/g, "''").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var ps = "Add-Type -AssemblyName System.Windows.Forms; " +
                 "Add-Type -AssemblyName System.Drawing; " +
                 "$img = [System.Windows.Forms.Clipboard]::GetImage(); " +
                 "if ($img -ne $null) { " +
                 "$img.Save('" + safePath + "', [System.Drawing.Imaging.ImageFormat]::Png); " +
                 "Write-Output 'OK' " +
                 "} else { Write-Output 'NO_IMAGE' }";
        try {
            var out = execSync('powershell -NoProfile -ExecutionPolicy Bypass -Command "' + ps + '"',
                               { windowsHide: true }).toString().trim();
            return out.indexOf("OK") !== -1;
        } catch (e) { return false; }
    }

    function saveClipboardImageMac(targetPath) {
        var safePath = targetPath.replace(/"/g, '\\"');
        var script =
            'try\n' +
            '  set png_data to (the clipboard as «class PNGf»)\n' +
            '  set fp to open for access POSIX file "' + safePath + '" with write permission\n' +
            '  set eof of fp to 0\n' +
            '  write png_data to fp\n' +
            '  close access fp\n' +
            '  return "OK"\n' +
            'on error\n' +
            '  try\n' +
            '    close access fp\n' +
            '  end try\n' +
            '  return "NO_IMAGE"\n' +
            'end try';
        try {
            var out = execSync("osascript -e " + JSON.stringify(script)).toString().trim();
            return out === "OK";
        } catch (e) { return false; }
    }

    function saveClipboardImage(targetPath) {
        if (process.platform === "win32") return saveClipboardImageWindows(targetPath);
        if (process.platform === "darwin") return saveClipboardImageMac(targetPath);
        return false;
    }

    var crypto    = require("crypto");

    function getFileMd5(filePath) {
        try {
            var buf = fs.readFileSync(filePath);
            return crypto.createHash("md5").update(buf).digest("hex");
        } catch (e) { return null; }
    }

    var lastClipboardHash = null;
    var lastSavedImagePath = null;

    function handleQuickPaste() {
        var btn = el.quickPasteBtn;
        var origText = btn.querySelector(".btn-text").textContent;

        function setPasteBtnState(state, text) {
            btn.className = "btn-quick-paste " + (state || "");
            btn.querySelector(".btn-text").textContent = text;
            if (state === "processing") {
                btn.disabled = true;
            } else {
                btn.disabled = false;
                setTimeout(function () {
                    btn.className = "btn-quick-paste";
                    btn.querySelector(".btn-text").textContent = origText;
                }, 2500);
            }
        }

        setPasteBtnState("processing", "Reading Clipboard...");

        cs.evalScript("getProjectFolder()", function (folderResult) {
            var destDir;
            if (!folderResult || folderResult === "NO_PROJECT" || folderResult === "EvalScript error.") {
                // Fallback to desktop/pictures if project is unsaved
                var baseHome = (process.platform === "win32") ? os.homedir() : os.tmpdir();
                destDir = path.join(baseHome, "LazyKick_Pasted_Images");
            } else {
                var subName = appState.settings.targetFolder || "Pasted Images";
                destDir = path.join(folderResult, subName);
            }

            if (!fs.existsSync(destDir)) {
                try { fs.mkdirSync(destDir, { recursive: true }); } catch (e) {}
            }

            // Save to temp file first to verify and hash
            var tempFileName = "temp_clipboard_" + Date.now() + ".png";
            var tempFilePath = path.join(destDir, tempFileName);

            var saved = saveClipboardImage(tempFilePath);
            if (!saved || !fs.existsSync(tempFilePath)) {
                if (fs.existsSync(tempFilePath)) try { fs.unlinkSync(tempFilePath); } catch (e) {}
                setPasteBtnState("error", "No Image in Clipboard!");
                setStatus("No image found on clipboard to paste.", 3000);
                return;
            }

            var currentHash = getFileMd5(tempFilePath);
            var targetFilePath;

            // If this is identical to the last pasted image and that file still exists, reuse it!
            if (currentHash && currentHash === lastClipboardHash && lastSavedImagePath && fs.existsSync(lastSavedImagePath)) {
                try { fs.unlinkSync(tempFilePath); } catch (eU) {}
                targetFilePath = lastSavedImagePath;
            } else {
                var filename = makeTimestampFilename();
                targetFilePath = path.join(destDir, filename);
                try {
                    fs.renameSync(tempFilePath, targetFilePath);
                } catch (eR) {
                    targetFilePath = tempFilePath;
                }
                lastClipboardHash = currentHash;
                lastSavedImagePath = targetFilePath;
            }

            setPasteBtnState("processing", "Placing on timeline...");

            var guideFlag = !!appState.settings.guideLayer;
            var fitFlag = !!appState.settings.autoFit;
            var safePathArg = targetFilePath.replace(/\\/g, "/");

            var scriptCall = "importPastedImage(" + JSON.stringify(safePathArg) + ", " + guideFlag + ", " + fitFlag + ")";
            cs.evalScript(scriptCall, function (evalRes) {
                try {
                    var r = (typeof evalRes === "string") ? JSON.parse(evalRes) : evalRes;
                    if (r && r.ok) {
                        setPasteBtnState("success", "Placed on Timeline!");
                        setStatus("Image placed on timeline: " + path.basename(targetFilePath), 3000);
                        addRecentPaste(targetFilePath);
                    } else {
                        setPasteBtnState("error", (r && r.msg) || "Import Failed");
                        setStatus("Error: " + ((r && r.msg) || "Could not place image"), 3000);
                    }
                } catch (err) {
                    setPasteBtnState("success", "Placed!");
                    addRecentPaste(targetFilePath);
                }
            });
        });
    }

    function addRecentPaste(filePath) {
        appState.recentPastes.unshift(filePath);
        if (appState.recentPastes.length > 8) appState.recentPastes.pop();
        renderRecentPastes();
    }

    function renderRecentPastes() {
        if (!el.recentPastesGallery) return;
        el.recentPastesGallery.innerHTML = "";

        if (appState.recentPastes.length === 0) {
            el.recentPastesGallery.innerHTML = '<div class="empty-pastes">No recent clipboard pastes yet.</div>';
            return;
        }

        appState.recentPastes.forEach(function (fp) {
            var item = document.createElement("div");
            item.className = "paste-thumb-item";
            item.title = fp;

            var img = document.createElement("img");
            img.src = "file:///" + fp.replace(/\\/g, "/");
            item.appendChild(img);

            // Re-paste on click
            item.addEventListener("click", function () {
                var guideFlag = !!appState.settings.guideLayer;
                var fitFlag = !!appState.settings.autoFit;
                var scriptCall = "importPastedImage(" + JSON.stringify(fp.replace(/\\/g, "/")) + ", " + guideFlag + ", " + fitFlag + ")";
                cs.evalScript(scriptCall, function () {
                    setStatus("Re-imported: " + path.basename(fp), 2000);
                });
            });

            el.recentPastesGallery.appendChild(item);
        });
    }

    el.quickPasteBtn.addEventListener("click", handleQuickPaste);

    el.btnClearPastesHistory.addEventListener("click", function () {
        appState.recentPastes = [];
        renderRecentPastes();
    });

    el.optGuideLayer.addEventListener("change", function () {
        appState.settings.guideLayer = el.optGuideLayer.checked;
        saveGeneralSettings();
    });
    el.optAutoFit.addEventListener("change", function () {
        appState.settings.autoFit = el.optAutoFit.checked;
        saveGeneralSettings();
    });
    el.optTargetFolder.addEventListener("input", function () {
        appState.settings.targetFolder = el.optTargetFolder.value.trim() || "Pasted Images";
        saveGeneralSettings();
    });

    // ============================================================
    // WATCH BINS ENGINE (Folder-to-Bin Media Sync)
    // ============================================================
    function binsFileFor(projId) {
        return path.join(STORAGE_DIR, "bins_" + hashPath(projId) + ".json");
    }

    function loadBinsForProject() {
        var f = binsFileFor(appState.projectId);
        if (fs.existsSync(f)) {
            try {
                var data = JSON.parse(fs.readFileSync(f, "utf8"));
                appState.bins = data.bins || [];
            } catch (e) { appState.bins = []; }
        } else {
            appState.bins = [];
        }
        el.binCountBadge.textContent = appState.bins.length;
    }

    function saveBinsForProject() {
        try {
            fs.writeFileSync(binsFileFor(appState.projectId), JSON.stringify({ bins: appState.bins }, null, 2), "utf8");
        } catch (e) {}
        el.binCountBadge.textContent = appState.bins.length;
    }

    function renderBinCards() {
        el.binCardsList.innerHTML = "";
        if (!appState.bins || appState.bins.length === 0) {
            el.binsEmptyHint.style.display = "flex";
            return;
        }

        el.binsEmptyHint.style.display = "none";

        appState.bins.forEach(function (b, index) {
            var card = document.createElement("div");
            card.className = "bin-card";

            var filters = [];
            if (b.filterVideo) filters.push("Video");
            if (b.filterAudio) filters.push("Audio");
            if (b.filterImage) filters.push("Image");
            var filterTagsHtml = filters.map(function(t){ return '<span class="chip-tag">' + t + '</span>'; }).join(" ");

            card.innerHTML =
                '<div class="bin-card-top">' +
                    '<div class="bin-target-title">📁 ' + (b.binPath || "Root") + '</div>' +
                    '<div class="bin-card-actions">' +
                        '<button class="btn-tool btn-sync-single" data-idx="' + index + '" title="Sync this folder">⚡ Sync</button>' +
                        '<button class="btn-tool btn-open-os" data-idx="' + index + '" title="Open in Explorer/Finder">📂</button>' +
                        '<button class="btn-tool btn-danger btn-remove-bin" data-idx="' + index + '" title="Unlink bin">✕</button>' +
                    '</div>' +
                '</div>' +
                '<div class="bin-source-path" title="' + b.folderPath + '">' + b.folderPath + '</div>' +
                '<div class="bin-card-bottom">' +
                    '<div class="bin-filters-badges">' + filterTagsHtml + (b.recursive ? ' <span class="chip-tag">Recursive</span>' : '') + '</div>' +
                    '<div class="bin-sync-status">' + (b.importedCount || 0) + ' items synced</div>' +
                '</div>';

            card.querySelector(".btn-sync-single").addEventListener("click", function () {
                syncSingleBin(index);
            });

            card.querySelector(".btn-open-os").addEventListener("click", function () {
                openInOS(b.folderPath);
            });

            card.querySelector(".btn-remove-bin").addEventListener("click", function () {
                if (confirm("Unlink this folder from Watch Bins?")) {
                    appState.bins.splice(index, 1);
                    saveBinsForProject();
                    renderBinCards();
                }
            });

            el.binCardsList.appendChild(card);
        });
    }

    function openInOS(folderPath) {
        if (!folderPath || !fs.existsSync(folderPath)) {
            alert("Folder path does not exist on disk:\n" + folderPath);
            return;
        }
        try {
            if (process.platform === "win32") {
                execSync('explorer.exe "' + folderPath.replace(/\//g, "\\") + '"');
            } else if (process.platform === "darwin") {
                execSync('open "' + folderPath + '"');
            }
        } catch (e) {}
    }

    function scanFolderForFiles(dirPath, recursive, filterV, filterA, filterI) {
        var allowedExts = {};
        if (filterV) EXT_GROUPS.video.forEach(function (e) { allowedExts[e] = true; });
        if (filterA) EXT_GROUPS.audio.forEach(function (e) { allowedExts[e] = true; });
        if (filterI) EXT_GROUPS.image.forEach(function (e) { allowedExts[e] = true; });

        var results = [];

        function walk(current) {
            try {
                var entries = fs.readdirSync(current, { withFileTypes: true });
                for (var i = 0; i < entries.length; i++) {
                    var entry = entries[i];
                    var full = path.join(current, entry.name);
                    if (entry.isDirectory()) {
                        if (recursive && !WIN_HIDDEN_FOLDERS[entry.name.toLowerCase()]) {
                            walk(full);
                        }
                    } else if (entry.isFile()) {
                        var ext = path.extname(entry.name).toLowerCase();
                        if (allowedExts[ext]) {
                            results.push(full);
                        }
                    }
                }
            } catch (e) {}
        }

        walk(dirPath);
        return results;
    }

    function syncSingleBin(index, callback) {
        var bin = appState.bins[index];
        if (!bin) { if (callback) callback(); return; }

        if (!fs.existsSync(bin.folderPath)) {
            setStatus("Folder not found: " + bin.folderPath, 3000);
            if (callback) callback();
            return;
        }

        if (!bin.history) bin.history = {};

        var allFiles = scanFolderForFiles(bin.folderPath, bin.recursive, bin.filterVideo, bin.filterAudio, bin.filterImage);
        var newFiles = [];

        allFiles.forEach(function (fp) {
            var norm = fp.replace(/\\/g, "/");
            if (!bin.history[norm]) {
                newFiles.push(norm);
            }
        });

        if (newFiles.length === 0) {
            setStatus("Bin " + bin.binPath + ": No new files", 2000);
            if (callback) callback();
            return;
        }

        setStatus("Importing " + newFiles.length + " new items into " + bin.binPath + "...");

        var scriptCall = "importFilesToBin(" + JSON.stringify(bin.binPath) + ", " + JSON.stringify(JSON.stringify(newFiles)) + ")";
        cs.evalScript(scriptCall, function (res) {
            try {
                var r = (typeof res === "string") ? JSON.parse(res) : res;
                if (r && r.ok) {
                    newFiles.forEach(function (fp) { bin.history[fp] = true; });
                    bin.importedCount = Object.keys(bin.history).length;
                    saveBinsForProject();
                    renderBinCards();
                    setStatus("Synced " + (r.imported || newFiles.length) + " items to " + bin.binPath, 3000);
                }
            } catch (e) {}
            if (callback) callback();
        });
    }

    function syncAllBins() {
        if (!appState.bins || appState.bins.length === 0) return;
        var idx = 0;
        function next() {
            if (idx < appState.bins.length) {
                syncSingleBin(idx, function () {
                    idx++;
                    next();
                });
            } else {
                setStatus("Sync All complete!", 3000);
            }
        }
        next();
    }

    el.btnSyncAll.addEventListener("click", syncAllBins);

    // Auto-Sync background loop
    function updateAutoSyncState() {
        if (appState.autoSync) {
            el.autoSyncDot.className = "status-dot active";
            if (!appState.autoSyncTimer) {
                appState.autoSyncTimer = setInterval(function () {
                    if (!appState.autoSyncBusy && appState.bins.length > 0) {
                        appState.autoSyncBusy = true;
                        el.autoSyncDot.className = "status-dot syncing";
                        var idx = 0;
                        function step() {
                            if (idx < appState.bins.length) {
                                syncSingleBin(idx, function () {
                                    idx++;
                                    step();
                                });
                            } else {
                                appState.autoSyncBusy = false;
                                el.autoSyncDot.className = "status-dot active";
                            }
                        }
                        step();
                    }
                }, 6000);
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
        var binPath = el.modalBinNameInput.value.trim() || path.basename(folderPath) || "Media";

        if (!folderPath || !fs.existsSync(folderPath)) {
            alert("Please select a valid folder on your computer.");
            return;
        }

        appState.bins.push({
            folderPath: folderPath,
            binPath: binPath,
            filterVideo: el.filterVideo.checked,
            filterAudio: el.filterAudio.checked,
            filterImage: el.filterImage.checked,
            recursive: el.modalRecursiveCheck.checked,
            history: {},
            importedCount: 0
        });

        saveBinsForProject();
        renderBinCards();
        closeBinModal();
        syncSingleBin(appState.bins.length - 1);
    });

    // ============================================================
    // Custom In-Panel Folder Browser
    // ============================================================
    function openFolderBrowser(initialPath, callback) {
        fb.callback = callback;
        fb.selectedPath = initialPath || (process.platform === "win32" ? "C:\\" : os.homedir());
        el.fbOverlay.classList.remove("hidden");
        loadDrives();
        navigateFB(fb.selectedPath);
    }

    function closeFolderBrowser() {
        el.fbOverlay.classList.add("hidden");
        fb.callback = null;
    }

    function loadDrives() {
        el.fbDrivesBar.innerHTML = "";
        if (process.platform === "win32") {
            var letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
            letters.forEach(function (ltr) {
                var p = ltr + ":\\";
                if (fs.existsSync(p)) {
                    var btn = document.createElement("button");
                    btn.className = "fb-drive-btn";
                    btn.textContent = ltr + ":";
                    btn.addEventListener("click", function () { navigateFB(p); });
                    el.fbDrivesBar.appendChild(btn);
                }
            });
        }
    }

    function navigateFB(targetPath) {
        fb.currentPath = targetPath;
        el.fbPathInput.value = targetPath;
        el.fbSelectedHint.textContent = targetPath;
        el.fbList.innerHTML = "";

        try {
            var items = fs.readdirSync(targetPath, { withFileTypes: true });
            items.forEach(function (it) {
                if (it.isDirectory() && !WIN_HIDDEN_FOLDERS[it.name.toLowerCase()]) {
                    var div = document.createElement("div");
                    div.className = "fb-item";
                    div.innerHTML = "📁 " + it.name;

                    div.addEventListener("click", function () {
                        el.fbList.querySelectorAll(".fb-item").forEach(function (e) { e.classList.remove("selected"); });
                        div.classList.add("selected");
                        fb.selectedPath = path.join(targetPath, it.name);
                        el.fbSelectedHint.textContent = fb.selectedPath;
                    });

                    div.addEventListener("dblclick", function () {
                        navigateFB(path.join(targetPath, it.name));
                    });

                    el.fbList.appendChild(div);
                }
            });
        } catch (e) {}
    }

    el.fbUpBtn.addEventListener("click", function () {
        var up = path.dirname(fb.currentPath);
        if (up && up !== fb.currentPath) navigateFB(up);
    });

    el.fbGoBtn.addEventListener("click", function () {
        var p = el.fbPathInput.value.trim();
        if (fs.existsSync(p)) navigateFB(p);
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

    // ============================================================
    // Initialization
    // ============================================================
    loadGeneralSettings();
    updateAutoSyncState();
    renderRecentPastes();
    pollProject();
    setInterval(pollProject, 2500);

})();
