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
        var hostFile = new File(new File($.fileName).parent.parent.fsName + "/host/host.jsx");
        $.evalFile(hostFile);
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

        // ---- watch bins mirror subfolders (1.3)
        function sub(parent, name) {
            var f = new Folder(parent.fsName + "/" + name);
            if (!f.exists) f.create();
            return f;
        }
        function footageFor(file) {
            var want = file.fsName.toLowerCase();
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof FootageItem && it.file && it.file.fsName.toLowerCase() === want) return it;
            }
            return null;
        }
        function where(item) {
            var names = [];
            for (var f = item.parentFolder; f && f !== app.project.rootFolder && f.id !== app.project.rootFolder.id; f = f.parentFolder) names.unshift(f.name);
            return names.join("/");
        }
        var shootDir = sub(dir, "শুটিং");
        var day1 = sub(shootDir, "Day 1");
        var camA = sub(day1, "Cam A");
        var day2 = sub(shootDir, "Day 2");
        var sa = writeBinary(new File(shootDir.fsName + "/a.wav"), wavBytes(300));
        var sb = writeBinary(new File(day1.fsName + "/still.bmp"), bmpBytes(8, 8));
        var sc = writeBinary(new File(camA.fsName + "/c.wav"), wavBytes(350));
        var sd = writeBinary(new File(day2.fsName + "/d.wav"), wavBytes(400));
        var entry = function (file, subPath, isNew) {
            var e = { p: fwd(file), s: subPath };
            if (isNew) e.n = true;
            return e;
        };
        var mirror = parse(syncWatchBin("Shoot", JSON.stringify({ folder: fwd(shootDir), arrange: true, files: [
            entry(sc, "Day 1/Cam A", true), entry(sb, "Day 1", true), entry(sa, "", true)
        ] }), id));
        check("mirror: three imported", mirror.ok && mirror.imported === 3 && mirror.failed === 0, mirror.msg);
        check("mirror: c.wav in Shoot/Day 1/Cam A", footageFor(sc) && where(footageFor(sc)) === "Shoot/Day 1/Cam A", footageFor(sc) && where(footageFor(sc)));
        check("mirror: still.bmp in Shoot/Day 1", footageFor(sb) && where(footageFor(sb)) === "Shoot/Day 1", footageFor(sb) && where(footageFor(sb)));
        check("mirror: a.wav in Shoot", footageFor(sa) && where(footageFor(sa)) === "Shoot", footageFor(sa) && where(footageFor(sa)));

        // d.wav as a 1.2 sync left it: straight in Shoot. One Sync sorts it.
        var flatItem = app.project.importFile(new ImportOptions(sd));
        flatItem.parentFolder = footageFor(sa).parentFolder;
        var everything = [entry(sc, "Day 1/Cam A"), entry(sb, "Day 1"), entry(sd, "Day 2"), entry(sa, "")];
        var sorted = parse(syncWatchBin("Shoot", JSON.stringify({ folder: fwd(shootDir), arrange: true, files: everything }), id));
        check("arrange: one moved, nothing imported", sorted.moved === 1 && sorted.imported === 0, sorted.moved + " moved, " + sorted.imported + " imported");
        check("arrange: d.wav now in Shoot/Day 2", where(flatItem) === "Shoot/Day 2", where(flatItem));
        var sortedAgain = parse(syncWatchBin("Shoot", JSON.stringify({ folder: fwd(shootDir), arrange: true, files: everything }), id));
        check("arrange again: nothing to move", sortedAgain.moved === 0, sortedAgain.moved);

        // ---- the folder's existing bin (1.4)
        function rootFoldersNamed(name) {
            var n = 0;
            for (var i = 1; i <= app.project.numItems; i++) {
                var it = app.project.item(i);
                if (it instanceof FolderItem && it.name === name && it.parentFolder.id === app.project.rootFolder.id) n++;
            }
            return n;
        }
        var twinDir = sub(dir, "Twin Shoot");
        var twinDay = sub(twinDir, "Day 1");
        var t1 = writeBinary(new File(twinDay.fsName + "/t1.wav"), wavBytes(500));
        var t2 = writeBinary(new File(twinDay.fsName + "/t2.wav"), wavBytes(520));
        var t3 = writeBinary(new File(twinDir.fsName + "/t3.wav"), wavBytes(540));
        var usersFolder = app.project.items.addFolder("Twin Shoot");        // the user's, flat
        app.project.importFile(new ImportOptions(t1)).parentFolder = usersFolder;
        var twinComp = app.project.items.addComp("Twin Comp", 32, 32, 1, 2, 25);
        twinComp.parentFolder = usersFolder;
        var copyFolder = app.project.items.addFolder("Twin Shoot");         // a copy with its own sub-folder
        var copyDay = app.project.items.addFolder("Day 1");
        copyDay.parentFolder = copyFolder;
        app.project.importFile(new ImportOptions(t2)).parentFolder = copyDay;
        var twinSync = parse(syncWatchBin("Twin Shoot", JSON.stringify({ folder: fwd(twinDir), arrange: true, files: [
            entry(t1, "Day 1"), entry(t2, "Day 1"), entry(t3, "", true)
        ] }), id));
        check("twins: one 'Twin Shoot' folder left", twinSync.ok && rootFoldersNamed("Twin Shoot") === 1, twinSync.msg + " / " + rootFoldersNamed("Twin Shoot"));
        check("twins: reported one merge", twinSync.merged === 1 && twinSync.rootPath === "Twin Shoot", twinSync.merged + " / " + twinSync.rootPath);
        check("twins: both clips in Twin Shoot/Day 1", footageFor(t1) && where(footageFor(t1)) === "Twin Shoot/Day 1" && where(footageFor(t2)) === "Twin Shoot/Day 1",
              footageFor(t1) && where(footageFor(t1)) + " | " + where(footageFor(t2)));
        check("twins: new file imported at its root", footageFor(t3) && where(footageFor(t3)) === "Twin Shoot", footageFor(t3) && where(footageFor(t3)));
        check("twins: the comp kept in the folder", where(twinComp) === "Twin Shoot", where(twinComp));

        var nestDir = sub(dir, "Nested Shoot");
        var n1 = writeBinary(new File(nestDir.fsName + "/n1.wav"), wavBytes(560));
        var assetsFolder = app.project.items.addFolder("Assets");
        var nestedFolder = app.project.items.addFolder("Nested Shoot");
        nestedFolder.parentFolder = assetsFolder;
        app.project.importFile(new ImportOptions(n1)).parentFolder = nestedFolder;
        var adopt = parse(syncWatchBin("Nested Shoot", JSON.stringify({ folder: fwd(nestDir), arrange: true, files: [entry(n1, "")] }), id));
        check("adopt: the nested folder becomes the watch bin", adopt.ok && adopt.adopted === true && adopt.rootPath === "Assets/Nested Shoot" && rootFoldersNamed("Nested Shoot") === 0,
              adopt.rootPath + " / " + rootFoldersNamed("Nested Shoot"));

        // still.bmp is used in a comp; it is moved on disk further down.
        app.project.items.addComp("Relink Comp", 32, 32, 1, 5, 25).layers.add(footageFor(sb));

        // ---- script to audio (1.4): Convert Audio to Keyframes, selection, subtitles
        /** 8 kHz mono: a tone during each [start, end] burst, silence (or a quiet bed) elsewhere. */
        function burstWav(bursts, seconds, pitch, bed) {
            var rate = 8000;
            var n = Math.round(seconds * rate);
            var parts = ["RIFF", u32(36 + n * 2), "WAVE", "fmt ", u32(16), u16(1), u16(1), u32(rate), u32(rate * 2), u16(2), u16(16), "data", u32(n * 2)];
            var block = [];
            for (var i = 0; i < n; i++) {
                var t = i / rate;
                var on = false;
                for (var b = 0; b < bursts.length; b++) if (t >= bursts[b][0] && t < bursts[b][1]) on = true;
                var v = Math.round(Math.sin(2 * Math.PI * pitch * t) * (on ? 12000 : bed));
                block.push(u16(v < 0 ? v + 65536 : v));
            }
            parts.push(block.join(""));
            return parts.join("");
        }
        var voiceBursts = [[1.0, 2.2], [2.7, 5.1], [5.8, 7.3]];
        var voFile = writeBinary(new File(dir.fsName + "/voiceover.wav"), burstWav(voiceBursts, 8.5, 220, 0));
        var bedFile = writeBinary(new File(dir.fsName + "/music bed.wav"), burstWav([], 8.5, 330, 2500));
        var voComp = app.project.items.addComp("Script Comp", 1920, 1080, 1, 10, 25);
        var voLayer = voComp.layers.add(app.project.importFile(new ImportOptions(voFile)));
        var bedLayer = voComp.layers.add(app.project.importFile(new ImportOptions(bedFile)));
        // Added layers come selected; start like a user who last clicked a text layer.
        var titleLayer = voComp.layers.addText("Title");
        voLayer.selected = false;
        bedLayer.selected = false;
        titleLayer.selected = true;
        voComp.workAreaStart = 2;
        voComp.workAreaDuration = 3;
        voComp.openInViewer();
        function levelAt(r, t) { return r.values[Math.round((t - r.start) / r.step)]; }

        var heardAll = parse(getTimelineAudio(""));
        check("audio: levels from Convert Audio to Keyframes", heardAll.ok && heardAll.kind === "levels" && heardAll.values.length >= 240, heardAll.msg || heardAll.values.length);
        check("audio: one value a frame from the comp start", heardAll.ok && Math.abs(heardAll.step - 0.04) < 1e-6 && Math.abs(heardAll.start) < 1e-6, heardAll.step + " / " + heardAll.start);
        check("audio: voice louder than the pause, music under both", heardAll.ok && levelAt(heardAll, 1.5) > levelAt(heardAll, 2.45) && levelAt(heardAll, 2.45) > 0,
              heardAll.ok ? levelAt(heardAll, 1.5) + " / " + levelAt(heardAll, 2.45) : "");
        check("audio: a text layer selected still means everything is heard", heardAll.used === "all", heardAll.used);
        check("audio: helper layer removed", voComp.numLayers === 3, voComp.numLayers);
        check("audio: the user's selection put back", titleLayer.selected === true && voLayer.selected === false && bedLayer.selected === false,
              titleLayer.selected + " " + voLayer.selected + " " + bedLayer.selected);
        check("audio: work area put back", voComp.workAreaStart === 2 && voComp.workAreaDuration === 3, voComp.workAreaStart + " + " + voComp.workAreaDuration);

        titleLayer.selected = false;
        bedLayer.selected = false;
        voLayer.selected = true;
        var heardVoice = parse(getTimelineAudio(""));
        check("audio: only the selected voice heard", heardVoice.ok && heardVoice.used === "selected" && levelAt(heardVoice, 2.45) < levelAt(heardAll, 2.45) / 4,
              heardVoice.ok ? heardVoice.used + " " + levelAt(heardVoice, 2.45) + " vs " + levelAt(heardAll, 2.45) : heardVoice.msg);
        check("audio: the music's audio switched back on", bedLayer.audioEnabled === true);
        check("audio: still three layers, voice still selected", voComp.numLayers === 3 && voLayer.selected === true && bedLayer.selected === false, voComp.numLayers);
        // For the Node side: time three lines against what After Effects measured.
        var levelsOut = new File(Folder.temp.fsName + "/lazykick-ae-levels.json");
        levelsOut.encoding = "UTF-8";
        levelsOut.open("w");
        levelsOut.write(JSON.stringify({ step: heardVoice.step, start: heardVoice.start, values: heardVoice.values, bursts: voiceBursts }));
        levelsOut.close();

        var subs = parse(placeSubtitles(JSON.stringify({ cues: [
            { s: 1.0, e: 2.2, t: "Hello from After Effects." },
            { s: 2.7, e: 5.1, t: "বাংলা লেখা ঠিকমতো জোড়া লাগে কিনা, দেখা যাক।" },
            { s: 5.8, e: 7.3, t: "Last line of the script" }
        ] })));
        check("subtitles: three text layers", subs.ok && subs.count === 3 && voComp.numLayers === 6, subs.msg);
        var sub1 = voComp.layer(1);
        var sub2 = voComp.layer(2);
        var doc1 = sub1.property("ADBE Text Properties").property("ADBE Text Document").value;
        var doc2 = sub2.property("ADBE Text Properties").property("ADBE Text Document").value;
        check("subtitles: first cue on top, timed", doc1.text === "Hello from After Effects." && Math.abs(sub1.inPoint - 1) < 0.001 && Math.abs(sub1.outPoint - 2.2) < 0.041,
              doc1.text + " " + sub1.inPoint + "-" + sub1.outPoint);
        check("subtitles: Bengali cue has a Bengali font", doc2.font === subs.font && subs.font !== "", doc2.font + " / " + subs.font);
        try { check("subtitles: Bengali cue uses the Universal Type Engine", doc2.composerEngine === ComposerEngine.UNIVERSAL_TYPE_ENGINE, doc2.composerEngine); } catch (eCE) {}
        var rect = sub1.sourceRectAtTime(1.5, false);
        var rectPos = sub1.property("ADBE Transform Group").property("ADBE Position").value;
        var anchor = sub1.property("ADBE Transform Group").property("ADBE Anchor Point").value;
        var centreX = rectPos[0] - anchor[0] + rect.left + rect.width / 2;
        var bottom = rectPos[1] - anchor[1] + rect.top + rect.height;
        check("subtitles: text centred", Math.abs(centreX - 960) < 40, centreX);
        check("subtitles: text in the lower third, inside the frame", bottom > 1080 * 0.66 && bottom < 1080, bottom);
        var framePng = new File(Folder.temp.fsName + "/lazykick-subtitle-frame.png");
        try { if (framePng.exists) framePng.remove(); } catch (eOldPng) {}
        try { voComp.saveFrameToPng(3.0, framePng); } catch (ePng) {}
        for (var waitPng = 0; waitPng < 50 && !framePng.exists; waitPng++) $.sleep(100);
        check("subtitles: a frame with the Bengali line saved for a look", framePng.exists, framePng.fsName);

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

        // ---- a file moved on disk while the project was closed (1.3): the
        // same item follows it. After Effects keeps footage in use open, so it
        // cannot be moved while the project is open (Windows locks it).
        app.project.save();
        app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES);
        var day3 = sub(shootDir, "Day 3");
        var movedStill = new File(day3.fsName + "/still.bmp");
        var movedOnDisk = sb.copy(movedStill.fsName) && sb.remove();
        check("relink: still.bmp moved on disk", movedOnDisk && movedStill.exists && !new File(sb.fsName).exists, sb.error);
        app.open(aep);
        // An installed LazyKick panel loads its own host.jsx into the same
        // engine when a project opens; load this one again on top.
        $.evalFile(hostFile);
        check("reopened: this host.jsx loaded again", LazyKickHost.VERSION === infoSaved.version && typeof LazyKickHost.syncWatchBin === "function", LazyKickHost.VERSION);
        var reopenedId = getProjectPath();
        var stillItem = footageFor(sb);
        check("relink: reopened, still.bmp missing", stillItem && stillItem.footageMissing === true, stillItem ? stillItem.footageMissing : "not found");
        if (stillItem) {
            var itemsBefore = app.project.numItems;
            var relinked = parse(syncWatchBin("Shoot", JSON.stringify({ folder: fwd(shootDir), arrange: false, files: [entry(movedStill, "Day 3", true)] }), reopenedId));
            check("relink: counted, not imported", relinked.relinked === 1 && relinked.imported === 0, relinked.relinked + " relinked, " + relinked.imported + " imported, " + relinked.msg);
            check("relink: same item points at the new file", stillItem.file && stillItem.file.fsName === movedStill.fsName, stillItem.file && stillItem.file.fsName);
            check("relink: no longer missing", stillItem.footageMissing === false, stillItem.footageMissing);
            check("relink: item moved to Shoot/Day 3", where(stillItem) === "Shoot/Day 3", where(stillItem));
            var relinkComp = null;
            for (var ci = 1; ci <= app.project.numItems; ci++) {
                if (app.project.item(ci) instanceof CompItem && app.project.item(ci).name === "Relink Comp") relinkComp = app.project.item(ci);
            }
            check("relink: the comp layer still uses it", relinkComp && relinkComp.layer(1).source.id === stillItem.id);
            check("relink: only the Day 3 folder was added", app.project.numItems === itemsBefore + 1, app.project.numItems - itemsBefore);
        }
    } catch (fatal) {
        check("test stopped", false, fatal.toString() + " (line " + fatal.line + ")");
    }

    flush(true);
    try { app.project.close(CloseOptions.DO_NOT_SAVE_CHANGES); } catch (eClose) {}
    try { app.quit(); } catch (eQuit) {}
})();
