/*
 * LazyKick — host.jsx inside the real After Effects (developer tool).
 *
 *   Close After Effects, then run (Windows):
 *   "C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.com" -r "<repo>\tools\ae-smoke-host.jsx"
 *
 * Uses After Effects with its UI (a composition has to be open in the viewer
 * for paste placement). Makes its own media in a temp folder with Bengali
 * letters in the name, runs the watch-bin import and the paste against the
 * real scripting API, writes %TEMP%\lazykick-ae-smoke-results.txt and quits
 * without saving. Needs "Allow Scripts to Write Files and Access Network".
 */
(function () {
    var lines = [];
    var failures = 0;
    var out = new File(Folder.temp.fsName + "/lazykick-ae-smoke-results.txt");
    function flush(done) {
        out.encoding = "UTF-8";
        out.open("w");
        out.write(lines.join("\n") + "\n" + (done ? "DONE " + (failures ? "FAILED " + failures : "ALL PASSED") : "RUNNING") + "\n");
        out.close();
    }
    function check(name, ok, detail) {
        if (!ok) failures++;
        lines.push((ok ? "PASS " : "FAIL ") + name + (detail !== undefined ? "  [" + detail + "]" : ""));
        flush(false);
    }

    function u16(v) { return String.fromCharCode(v & 255, (v >> 8) & 255); }
    function u32(v) { return String.fromCharCode(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255); }
    function writeBinary(file, data) {
        file.encoding = "BINARY";
        file.open("w");
        file.write(data);
        file.close();
        return file;
    }
    /** One second of a quiet 8 kHz tone, so each file is valid audio. */
    function wavBytes(pitch) {
        var rate = 8000;
        var parts = ["RIFF", u32(36 + rate * 2), "WAVE", "fmt ", u32(16), u16(1), u16(1), u32(rate), u32(rate * 2), u16(2), u16(16), "data", u32(rate * 2)];
        var block = [];
        for (var s = 0; s < rate; s++) {
            var sample = Math.round(Math.sin(2 * Math.PI * pitch * s / rate) * 3000);
            block.push(u16(sample < 0 ? sample + 65536 : sample));
        }
        parts.push(block.join(""));
        return parts.join("");
    }
    /** A w×h 24-bit BMP, which After Effects imports without any dialog. */
    function bmpBytes(w, h) {
        var pad = (4 - (w * 3) % 4) % 4;
        var size = (w * 3 + pad) * h;
        var parts = ["BM", u32(54 + size), u32(0), u32(54), u32(40), u32(w), u32(h), u16(1), u16(24), u32(0), u32(size), u32(2835), u32(2835), u32(0), u32(0)];
        var row = [];
        for (var x = 0; x < w; x++) row.push(String.fromCharCode(40, 120, 220));
        for (var p = 0; p < pad; p++) row.push(String.fromCharCode(0));
        var rowText = row.join("");
        for (var y = 0; y < h; y++) parts.push(rowText);
        return parts.join("");
    }
    function fwd(file) { return file.fsName.replace(/\\/g, "/"); }
    function childFolder(parent, name) {
        for (var i = 1; i <= parent.numItems; i++) {
            var it = parent.item(i);
            if (it instanceof FolderItem && it.name === name) return it;
        }
        return null;
    }
    function footageCount(pattern) {
        var n = 0;
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof FootageItem && it.file && (!pattern || pattern.test(it.file.fsName))) n++;
        }
        return n;
    }
    function parse(text) { return JSON.parse(text); }

    try {
        app.beginSuppressDialogs();
        lines.push("After Effects " + app.version + " (with UI)");
        $.evalFile(new File(new File($.fileName).parent.parent.fsName + "/host/host.jsx"));
        check("host.jsx loaded", typeof LazyKickHost === "object", LazyKickHost && LazyKickHost.VERSION);

        var dir = new Folder(Folder.temp.fsName + "/lazykick smoke পরীক্ষা");
        if (!dir.exists) dir.create();
        var a = writeBinary(new File(dir.fsName + "/a.wav"), wavBytes(330));
        var b = writeBinary(new File(dir.fsName + "/ধ্বনি.wav"), wavBytes(440));
        var c = writeBinary(new File(dir.fsName + "/manual.wav"), wavBytes(550));
        var d = writeBinary(new File(dir.fsName + "/new.wav"), wavBytes(660));
        var big = writeBinary(new File(dir.fsName + "/big.bmp"), bmpBytes(64, 64));

        var info = parse(getProjectInfo());
        check("info: After Effects, unsaved project", info.ok && info.host === "ae" && info.saved === false, info.fullId);
        var id = info.fullId;

        // ---- watch-bin import
        var r1 = parse(importFilesToBin("Watch/SFX", JSON.stringify([fwd(a), fwd(b), fwd(dir) + "/missing.wav"]), id));
        check("sync: two imported (one with a Bengali name)", r1.imported === 2 && r1.existing === 0, r1.importedFiles && r1.importedFiles.join(" | "));
        check("sync: the missing file failed", r1.failed === 1, r1.failedFiles && r1.failedFiles.join(" | "));
        var watch = childFolder(app.project.rootFolder, "Watch");
        var sfx = watch ? childFolder(watch, "SFX") : null;
        check("sync: nested Watch/SFX folder holds both", sfx && sfx.numItems === 2, sfx ? sfx.numItems : "no folder");

        var manual = app.project.importFile(new ImportOptions(c)); // imported by hand
        var before = footageCount();
        var upper = fwd(a).toUpperCase();
        var r2 = parse(importFilesToBin("Watch/SFX", JSON.stringify([upper, fwd(c), fwd(d)]), id));
        check("existing: synced and hand-imported files reported", r2.existing === 2, r2.existingFiles && r2.existingFiles.join(" | "));
        check("existing: path compared without case", r2.existingFiles && r2.existingFiles[0] === upper, r2.existingFiles && r2.existingFiles[0]);
        check("existing: only new.wav imported", r2.imported === 1 && /new\.wav$/i.test(r2.importedFiles[0]), r2.importedFiles && r2.importedFiles.join(" | "));
        check("existing: one footage item added", footageCount() === before + 1, footageCount() + " vs " + before);
        check("existing: the hand import stays where it was", manual.parentFolder === app.project.rootFolder, manual.parentFolder.name);
        check("existing: no duplicate of a.wav", footageCount(/[\\\/]a\.wav$/i) === 1, footageCount(/[\\\/]a\.wav$/i));

        var r3 = parse(importFilesToBin("Never Made", JSON.stringify([fwd(a), fwd(d)]), id));
        check("all existing: nothing imported", r3.imported === 0 && r3.existing === 2 && r3.failed === 0, r3.msg);
        check("all existing: no empty folder made", !childFolder(app.project.rootFolder, "Never Made"));

        var wrong = parse(importFilesToBin("Watch/SFX", JSON.stringify([fwd(d)]), "ae|saved|C:\\Elsewhere\\Other.aep"));
        check("sync into another project refused", wrong.ok === false && wrong.projectChanged === true, wrong.msg);

        // ---- paste
        var comp = app.project.items.addComp("Paste Comp", 32, 32, 1, 5, 25);
        comp.openInViewer();
        comp.time = 2;
        var p1 = parse(importPastedImage(fwd(big), true, true, "Refs/Screens"));
        check("paste: placed on the open comp", p1.ok === true && p1.placedOnTimeline === true, p1.msg);
        var layer = comp.numLayers ? comp.layer(1) : null;
        if (layer) {
            check("paste: starts at the playhead", Math.abs(layer.startTime - 2) < 0.001, layer.startTime);
            check("paste: guide layer", layer.guideLayer === true);
            var scale = layer.property("ADBE Transform Group").property("ADBE Scale").value;
            check("paste: 64 px image shrunk into a 32 px comp", Math.abs(scale[0] - 50) < 0.01, scale.join(","));
            var folder = layer.source.parentFolder;
            check("paste: footage in Refs/Screens", folder.name === "Screens" && folder.parentFolder.name === "Refs", folder.name);
            var p2 = parse(importPastedImage(fwd(big), false, false, "Refs/Screens"));
            check("paste again: reuses the footage", p2.reused === true && comp.layer(1).source === layer.source, p2.msg);
            check("paste again: still one footage item", footageCount(/big\.bmp$/i) === 1, footageCount(/big\.bmp$/i));
        } else {
            check("paste: layer added", false, "comp has no layers");
        }

        var tc = parse(getCurrentTimecode());
        check("timecode read from the active comp", tc.ok === true && !!tc.timecode, tc.timecode || tc.msg);

        // ---- saved project
        var aep = new File(dir.fsName + "/Smoke প্রজেক্ট.aep");
        app.project.save(aep);
        check("saved: project id", getProjectPath() === "ae|saved|" + aep.fsName, getProjectPath());
        check("saved: project folder", getProjectFolder() === dir.fsName, getProjectFolder());
        var infoSaved = parse(getProjectInfo());
        check("saved: name decoded", infoSaved.name === "Smoke প্রজেক্ট.aep", infoSaved.name);
    } catch (fatal) {
        check("test stopped", false, fatal.toString() + " (line " + fatal.line + ")");
    }

    flush(true);
    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (eClose) {}
    try { app.quit(); } catch (eQuit) {}
})();
