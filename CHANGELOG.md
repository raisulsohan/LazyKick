# Changelog

All notable changes to LazyKick. Versions follow `package.json`.

## 1.5.2

- 🎙️ Time to Audio on a note with nothing to time now says *Write or paste the script first: lines or whole paragraphs, in the order they are spoken*. It used to ask for one line per subtitle, which has not been needed since whole paragraphs are timed sentence by sentence.
- **Documentation:** new `docs/` folder with the manual, how script timing works, troubleshooting (including every status bar message) and building from source, with screenshots of the panel. The README links to it.
- `Read me first.txt` in the download now covers script to subtitles, 👁 Follow and pasting from documents.

## 1.5.1

### Fixed
- **🎙️ Time to Audio and 💬 Subtitles did nothing in the real panel since 1.4.** CEP's `--mixed-context` puts Node's `module` and `exports` on the page, so `client/align.js` took the panel for Node, exported itself there and never set `LazyAlign`; every click stopped on a missing name. The tests ran it without CEP's `module`, so they passed. Now the page global is always set, and the panel tests run with `module` and `exports` on the page like CEP does. The same fix covers the new `client/paste.js`.
- A paste can no longer be lost: if the clean-up of a rich paste fails for any reason, the plain text is pasted instead.

### Notes look like the document you copied from
- **Pasting from Google Docs, Word or a web page keeps the layout**: titles and headings, paragraphs, **bold**, *italic*, underline, list items (as `• ` / `1. ` lines) and small grey side notes. Everything else is dropped: fonts, colours, sizes, links, images, tables (cells are joined with ` | `), hidden text, scripts and every attribute. The HTML is read by the browser's `DOMParser` (which runs nothing) and rebuilt from a short whitelist in the new `client/paste.js`, so nothing from the clipboard reaches the note as it came.
- Headings are recognised the way Docs and Word write them: by tag, or by size against the body text (1.6× = title, 1.25× = heading), or a short all-bold line without an end stop. Grey or small text becomes a side note. Docs' `<b style="font-weight:normal">` wrapper no longer turns a whole paste bold.
- A phrase pastes into the current line; the space at its end is kept.
- **Ctrl+Shift+V** (Cmd+Shift+V) still pastes plain text.
- Nested blocks left in older notes (a heading inside a line) are lifted out when the note is edited, and inline `style` attributes are removed.
- **Bigger note text, with A− / A+.** The default is 14 px (was 12.5 px); the buttons change it from 10 to 24 px and it is remembered. Headings scale with it.

### 👁 Follow the playhead
- While the timeline plays (or you scrub), the line being spoken gets a faint blue band with a bar on its left and the word being said a soft blue glow, and the note scrolls to keep them in view. It pauses scrolling for a few seconds when you scroll, click or type yourself.
- Needs timed lines (🎙️ Time to Audio, or ⏱️ Timecode tags). The highlight is drawn over the note and never saved into it. Click **👁 Follow** to switch it off (remembered).
- The panel asks the host for the playhead five times a second while it moves and about once a second when it stands still, and glides the highlight between readings. Nothing is polled while the Notes tab is hidden, a dialog is open, the project is closed or the note has no timecodes.

### Time to Audio and Subtitles
- **Paragraphs are timed sentence by sentence.** A script pasted from a document has whole paragraphs as lines, and a reader often pauses longer between two short sentences ("Not reduce it. Not manage it.") than between two paragraphs. Timed by paragraph length alone, a paragraph could end one sentence early and hand its last sentence to the next one, so the timecodes and the 👁 Follow highlight ran seconds ahead. Now every sentence of the script is laid over the speech as its own unit (`alignScript`), and a paragraph starts with its first sentence and ends with its last. On a real 9.5-minute voiceover read from a Google Doc, the 93 sentence starts that Windows' speech recognizer could pin down all landed within 0.21 s (median 0.02 s); timing by paragraph had missed 15 of them by more than half a second, up to 5 s. With more sentences than pauses to cut at (a rushed read), whole lines are timed as before.
- **Headings and grey side notes are not spoken lines**: 🎙️ Time to Audio and 💬 Subtitles skip them, so a pasted script with a title, "HOOK" and a meta line times correctly.
- **Word timing**: every timed line now also keeps when each of its words is said (`data-w`, seconds from the line start). Inside each sentence the clauses are laid over its own pauses, then the words are spread over the speech with the clock stopped in the pauses. On the real-speech fixtures every sentence inside a line starts within 0.15 s of the truth.
- **Long paragraphs become several subtitles**: a line longer than 84 characters or 6.5 seconds is split at a sentence end (else a comma, else between words), each piece timed from its first word.

### Internals
- New host call `getPlayhead()` (After Effects: `comp.time`; Premiere Pro: `getPlayerPosition()`), with fps and the timeline's start offset.
- `client/align.js` gains `alignScript` (what 🎙️ Time to Audio now runs), `wordTimes`, `followAt`, `chunkWords` and `makeCues`; new `client/paste.js` (loaded before `main.js`).
- Tests: new `tools/test-paste.mjs` (Docs, Word and web clipboard HTML, including injection attempts, parsed by the small `tools/mini-html.mjs`); a third real-speech fixture, *paragraphs* (a document read with longer pauses inside the paragraphs than between them, built by `tools/make-tts-fixture.mjs`), where every sentence must land within 0.15 s, plus word timing, follow and cue splitting in `test-align.mjs`; the speech tests now run `alignScript`, as the panel does; paste, text size, skipped headings, the follow highlight (position, pause, scroll, off, hidden tab) in `test-panel.mjs`; `getPlayhead` for both hosts in `test-host.js`.

## 1.4.1

- **Messages and confirmations now look like the panel.** CEP showed `alert()` / `confirm()` as white Windows boxes titled "JavaScript Confirm - file:///…", often with the text cut off. They are now an in-panel dialog in the panel's dark theme: blue for the normal choice, red for things that cannot be undone (Unlink, Delete tab), where Cancel has the focus so Enter is safe. Enter confirms, Esc or ✕ cancels, and messages wait their turn instead of stacking.
- Deleting a note tab, unlinking and resetting a watch bin do nothing if another project opens while the dialog is up.
- Tests: the panel may not call `alert`, `confirm` or `prompt` at all; the dialog's keys, focus, queueing and project-switch guards are covered.

## 1.4.0

### Script to audio and subtitles (Notes)
- **🎙️ Time to Audio**: times every line of the note to the voiceover on the open sequence or composition and starts the line with its timecode tag (`[HH:MM:SS:FF]`, in the timeline's own timecode). The tag keeps the measured start and end (`data-t`, `data-e`); running it again replaces the tags, never doubles them.
- **💬 Subtitles**: turns the timed lines into subtitles. Premiere Pro: the SRT is imported into a *Subtitles* bin and placed with `createCaptionTrack` as a subtitle track (older versions: left in the bin with a hint). After Effects: one box-text layer per line, lower third, white with an outline, first line on top, trimmed to its time; Bengali lines get a Bengali font (Nirmala UI and others) and the Universal Type Engine. An `.srt` (UTF-8 with BOM) is always saved in `LazyKick Subtitles` next to the project, never overwriting.
- **How the timing works (client/align.js)**: no speech recognition and no download, so it works for any language. Premiere exports the sequence mix to a temporary WAV with its own *Waveform Audio 48kHz 16-bit* preset; After Effects measures each frame with *Convert Audio to Keyframes*. The panel finds speech and pauses from the loudness (adaptive thresholds, breaths inside long speech as fallback cut points) and lays the lines over the speech with dynamic programming: each line's share of the speech should match its spoken length (Bengali and other Indic scripts counted by syllable), line ends prefer longer pauses, and the pace may not drift from the script's.
- Tested on real speech (Windows voices, two scripts, natural and rushed pauses, and a music bed): every line within 0.1 s, mostly within a frame, on the held-out script too. In the real After Effects, lines landed within a frame of the truth.
- Selected audio only: with audio clips (Premiere) or layers (After Effects) selected, only those are heard; other tracks are muted or audio switches turned off for the moment and restored after, as are the user's layer selection and work area. After Effects' command measures only selected layers, so LazyKick selects exactly the layers to hear.
- Hand-edited timecodes and those from ⏱️ Timecode (including drop-frame `;`) are read from their text.

### Watch Bins: the folder's existing bin is used, never copied
- **Fixed: linking a folder the project already had made a second bin of the same name** (1.3 looked only at one exact place; the existing bin was elsewhere or spelled differently, and its clips were left where they were). Now a bin that carries the folder's name (or the watch bin's) and holds the folder's media becomes the watch bin, wherever it is and however it is capitalised or spaced. The card switches to that bin, and it is sorted like the folder on disk.
- **Copies are folded in**: on a full sync (⚡ Sync, Sync All, Edit, Reset, a new link, Auto-Sync's first pass), bins of the same name beside the watch bin are merged into it whatever they hold, and same-named bins elsewhere are merged when they hold nothing but this folder's media. Their sub-bins, clips, sequences and comps move across, then the emptied copy is deleted; a bin is only ever deleted once the host reports it empty. Twin sub-bins inside the watch bin become one too. A project that 1.3 left with two "03. Videos" bins becomes one on the next Sync.
- Premiere Pro: bin identities no longer depend on `nodeId` (import detection falls back to name and media path when Premiere gives none).

### Internals
- New host calls `getTimelineInfo()`, `getTimelineAudio(wavPath)`, `placeSubtitles(payloadJson)`; new `client/align.js` (loaded before `main.js`). `syncWatchBin` also returns `rootPath`, `adopted` and `merged`.
- Tests: `tools/test-align.mjs` (WAV formats, pause finder, line lengths, real-speech timing from `tools/fixtures/tts-voiceover.json`, built by `tools/make-tts-fixture.mjs`), host mocks for both hosts, panel tests for both buttons; `tools/ae-smoke-host.jsx` covers the audio reading, selection and subtitles in the real After Effects and saves a frame to check the Bengali text.

## 1.3.0

### Watch Bins mirror their folders
- **Subfolders become bins.** With *Include subfolders* on, each subfolder is imported into a bin of the same name inside the watch bin, nested the same way (After Effects folders and Premiere Pro bins alike). Until now every file went flat into the one bin. Bins are made only for folders that contain media.
- **Existing bins are sorted to match the folders.** A manual **Sync**, **Sync All**, **Edit**, **Reset** or a new link moves media that is already inside the watch bin into the bin its folder maps to, so a bin synced flat by 1.2 is rearranged with one click. Auto-Sync does this once per bin per session and afterwards only calls the host for new files. Media outside the watch bin is never moved; nothing is ever deleted.
- **Files moved on disk keep their clip.** When a file shows up in a new folder and its old clip has gone missing, the clip is relinked (Premiere: *Change Media Path*; After Effects: *Replace Footage*) and moved to the matching bin instead of a second copy being imported, so sequences and comps keep working. Only unambiguous matches relink: the same file name, and the longest shared run of folder names unique for both the new file and the missing clip. A whole shoot moved to another drive relinks too.
- Existing bins are matched ignoring capitals, so `day 1` is reused rather than joined by `Day 1`.
- Files are sent in Explorer's order: subfolders before files, numbers by value (`Day 2` before `Day 10`).
- Adobe's own folders inside a project folder (*Adobe Premiere Pro Auto-Save*, *Video Previews*, *Audio Previews*, *Adobe After Effects Auto-Save*) are skipped, so a watched project folder never imports render previews.
- The status bar reports relinked and sorted clips; the card shows a *Subfolders* chip.

### Internals
- New host call `syncWatchBin(binPath, payloadJson, expectedProjectId)`; one engine for both hosts works on a model of the project built once per sync. `importFilesToBin` stays as the flat 1.2 call.
- Tests: mirrored import, sorting, case-insensitive bin reuse, relinking (including ambiguous cases and a drive move), `createBin` returning 0, Explorer ordering, Auto-Sync sorting once. `tools/ae-smoke-host.jsx` covers mirroring, sorting and relinking in the real After Effects.
- `tools/package-zxp.mjs` finds the renamed `00. Install from here` folder.

## 1.2.0

### Watch Bins
- **Fixed: linking a folder whose files were already in the project imported them again** as duplicates. The host now checks the whole project (any bin, any folder; path compared the way the file system does) and leaves those files alone. They count as synced, and the status says how many were already there.
- **✎ Edit** on a bin card: change the folder, bin name, filters or subfolder scan without unlinking. What was synced from a folder or file type the bin no longer uses is forgotten, and the bin syncs straight away.
- **↺ Reset** on a bin card: forget what was synced and sync again. Only files that are no longer in the project come back.
- An empty bin or folder is no longer created when every file is already in the project.
- Fixed: a Sync clicked in one project and still waiting in the queue when another project opened could import into the new project.
- **Browse…** opens at the last folder you picked, also after a restart.
- Bin names that don't fit are shortened with "…" so the card buttons stay visible.
- These features came from QuickBinSync, which LazyKick replaces.

### LazyPaste
- QuickPaste is now called **LazyPaste**, like the other LazySuite tools. Settings and Recent Pastes carry over.

### Other
- LazyKick is free and open source under the MIT License (`LICENSE` added; README, `package.json`, source headers and the install guide updated).
- `tools/ae-smoke-host.jsx` runs `host.jsx` inside the real After Effects: watch-bin import with Bengali file names, media already in the project, paste placement, timecode and project identity.

## 1.1.0

### Install
- Signed, timestamped `.zxp` release with installers for Windows (`Install LazyKick.bat`) and macOS (`Install LazyKick (macOS).command`), uninstallers that ask before deleting notes, `Fix a blank panel.bat` and a `Read me first.txt`.
- The installer moves a 1.0 manual copy (`extensions/LazyKick`) aside, since it shares the extension ID.
- Manifest schema lowered from 11.0 to 9.0 to match the minimum runtime (CSXS 9).
- `ENABLE_DEBUG_MODE.bat` now covers CSXS 9–14.

### QuickPaste
- Premiere Pro: overwrite into verified empty space on the lowest free unlocked track instead of `insertClip`, which rippled later clips. No free track: image stays in the bin with a clear message.
- Premiere Pro imports run with `suppressUI`.
- Clipboard PNG kept with transparency; image files copied in Explorer/Finder can be pasted.
- Duplicate detection by MD5 index across all pastes in a folder (was: only the previous paste).
- Unique file names: pastes within the same second no longer overwrite each other.
- The folder setting also names the project bin; nested names supported; `..` and illegal characters removed.
- Ctrl/Cmd+V shortcut; Recent Pastes persisted; thumbnail URLs escaped; 📂 open paste folder.
- Windows clipboard read is asynchronous (UI no longer freezes) and uses `-STA -EncodedCommand`.
- Unsaved-project fallback folder on macOS moved from the temp folder (cleaned by the OS) to the home folder.
- Status reports what actually happened (placed, bin only, which track).

### Notes & Tasks
- Fixed: deleting a tab could overwrite another tab's content.
- Fixed: the last keystrokes before a project switch were saved into the new project.
- Fixed: unsaved After Effects projects got a new identity after every import, hiding notes and bins.
- Notes and bins made before a project's first save move to the saved project.
- In-place tab rename (CEP has no `window.prompt`).
- Caret position kept for Timecode/Task insertion; failed timecode reads show the reason.
- After Effects timecode follows the project's display format and the comp's start time; frame rounding fixed.
- Plain-text paste in the editor; copy fallback for CEP 9; checklists exported as `[ ]`/`[x]`; exports never overwrite.

### Watch Bins
- Fixed: files that failed to import were recorded as imported. Now shown as *skipped* and retried when changed or on manual Sync.
- Auto-Sync imports a file only after its size held between two scans (copies in progress).
- Sync jobs serialized: no double imports from overlapping syncs.
- Host refuses imports if the open project changed since the scan; bin state is saved to the project it belongs to.
- After Effects sync is one undo step; Premiere reports per-file results.
- Asynchronous scanning; symlinked folders not followed; hidden, `._`, `~$` and empty files ignored; camera raw removed from the image filter; `.mts`, `.m2ts`, `.wmv` added.
- Duplicate folder→bin links refused; unlinking is index-safe.

### Safety & internals
- Bin cards, folder browser and gallery built with DOM APIs; nothing from disk is parsed as HTML.
- Explorer/Finder launched without a shell.
- Footer link opens the default browser.
- Tests: `tools/check-extendscript.js`, `tools/test-host.js`, `tools/test-panel.mjs` (`npm test`).
- Release tooling: `tools/package-zxp.mjs`, `tools/zip.mjs`, `tools/get-zxpsigncmd.mjs` (`npm run release`).

## 1.0.0
- First release: QuickPaste, Notes & Tasks with Global scratchpad and timecodes, Watch Bins with auto-sync, for After Effects and Premiere Pro.
