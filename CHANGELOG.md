# Changelog

All notable changes to LazyKick. Versions follow `package.json`.

## Unreleased
- LazyKick is free and open source under the MIT License (`LICENSE` added; README, `package.json`, source headers and the install guide updated).

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
