# Building from source

How LazyKick is put together, the rules its code keeps, how it is tested
and how a release is built. *Written for LazyKick 1.6.0.*

**Contents**

- [How it fits together](#how-it-fits-together)
- [Repository layout](#repository-layout)
- [Running it from the repository](#running-it-from-the-repository)
- [Rules the code keeps](#rules-the-code-keeps)
- [Host API](#host-api)
- [How each feature works](#how-each-feature-works)
- [Tests](#tests)
- [Building a release](#building-a-release)

---

## How it fits together

LazyKick is a standard **CEP extension**: an HTML/JavaScript panel running
in Adobe's embedded Chromium with Node.js enabled, talking to an
**ExtendScript** engine that runs inside the host app.

```
┌──────────────────── client/  (CEP Chromium + Node, mixed context) ────────────────────┐
│ index.html, style.css   the panel: header, three tabs, dialogs, folder browser       │
│ main.js                 state, saving (fs), clipboard (PowerShell / AppleScript),     │
│                         folder scanning, sync queue, Time to Audio, Follow           │
│ align.js                pure timing maths: WAV reader, speech finder, alignment, SRT  │
│ paste.js                pure clipboard-HTML clean-up for the notes                    │
└──────────────┬────────────────────────────────────────────────────────────────────────┘
               │ CSInterface.evalScript('syncWatchBin("…", "{…}", "…")')   lib/CSInterface.js
               ▼
┌──────────────────── host/host.jsx  (ExtendScript, ES3) ───────────────────────────────┐
│ detects AE / PPro · identifies the project · reads the playhead and the timeline audio│
│ imports into (nested) bins · places stills and subtitles · sorts and relinks media    │
│ every call returns a JSON string { ok, msg, … }                                       │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

The panel does all the thinking it can in JavaScript (scanning folders,
timing the script, cleaning pastes) and asks the host only for what needs
the app: reading or changing the project and the timeline. `align.js` and
`paste.js` are pure functions with no DOM or host access, so they are tested
in plain Node.

The manifest (`CSXS/manifest.xml`) targets **AEFT 16.0+** and **PPRO 14.0+**,
requires **CSXS 9**, and starts the panel with `--enable-nodejs
--mixed-context`. Default size 380 × 650, resizable from 280 × 350.

---

## Repository layout

```
LazyKick/
├── CSXS/manifest.xml         Extension ID, hosts, panel size, Node flags
├── client/
│   ├── index.html            Panel markup
│   ├── style.css             Adobe-style dark theme
│   ├── align.js              Voiceover timing: WAV reader, speech finder, sentence/word alignment, cues, SRT
│   ├── paste.js              Clipboard HTML to headings, paragraphs, bold, lists
│   └── main.js               Panel controller
├── host/host.jsx             ExtendScript engine for After Effects and Premiere Pro
├── lib/CSInterface.js        Adobe's CEP bridge (Adobe's licence, not MIT)
├── docs/                     This documentation and its screenshots
├── tools/
│   ├── installer/            Install/uninstall scripts, "Fix a blank panel.bat", "Read me first.txt"
│   ├── check-extendscript.js ES3 syntax and lint check of host.jsx (Windows Script Host)
│   ├── test-host.js          host.jsx against mocked After Effects and Premiere Pro (Windows Script Host)
│   ├── test-align.mjs        align.js: WAVs in every format, real-speech fixtures (Node)
│   ├── test-paste.mjs        paste.js: Google Docs, Word and web clipboard HTML (Node)
│   ├── test-panel.mjs        main.js in a VM with a fake DOM, fake host and real temp files (Node)
│   ├── mini-html.mjs         Small HTML parser standing in for DOMParser in the Node tests
│   ├── make-tts-fixture.mjs  Builds the real-speech fixtures with Windows' own voices
│   ├── fixtures/             tts-voiceover.json: loudness and true times of those voiceovers
│   ├── ae-smoke-host.jsx     host.jsx inside the real After Effects
│   ├── get-zxpsigncmd.mjs    Downloads Adobe's ZXPSignCmd into tools/vendor/
│   ├── package-zxp.mjs       Signs the panel and builds the release zip
│   └── zip.mjs               Small ZIP writer
├── ENABLE_DEBUG_MODE.bat     PlayerDebugMode for unsigned copies (developers)
├── CHANGELOG.md
├── LICENSE                   MIT
└── package.json              Version source and npm scripts
```

---

## Running it from the repository

1. Allow unsigned extensions once:
   - **Windows:** run `ENABLE_DEBUG_MODE.bat` (sets `PlayerDebugMode` for
     CSXS 9 to 14).
   - **macOS:**
     ```bash
     for v in 9 10 11 12 13 14; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
     ```
2. Link the repository into the CEP extensions folder, for example on
   Windows:
   ```bat
   mklink /J "%APPDATA%\Adobe\CEP\extensions\LazyKick" "D:\path\to\LazyKick"
   ```
   (macOS: `~/Library/Application Support/Adobe/CEP/extensions/LazyKick`.)
3. Restart the app and open **Window › Extensions › LazyKick**.

Do not keep a linked copy and the signed install side by side; they share one
extension ID. Reload the panel after a change by closing and reopening it; restart the
app if a change to `host.jsx` does not show.

---

## Rules the code keeps

**The host engine is ExtendScript (ES3).** No trailing commas, no
`Array.prototype.indexOf`, no reserved words as property names, and the file
stays **ASCII** (non-ASCII characters are written as `\uXXXX`).
`tools/check-extendscript.js` compiles it the way ExtendScript does and
rejects what real ExtendScript refuses.

**The panel runs on CEP 9's Chromium 61 and Node 8.6.** `main.js`,
`align.js` and `paste.js` are plain ES5: no `let`/`const`, arrow functions,
template strings, optional chaining or `??`, no `fs.promises`, no recursive
`mkdir`, no `readdir` with `withFileTypes` without a fallback, and
`navigator.clipboard` only with a fallback. The test suites fail on any of
these.

**CEP's mixed context puts Node's `module` and `exports` on the page.** A
script that decides "Node or browser?" by looking for `module` would export
itself into Node and never set its page global. `align.js` and `paste.js`
therefore always set `window.LazyAlign` / `window.LazyPaste`, and set
`module.exports` as well when it exists (for the tests). `test-panel.mjs`
defines `module` and `exports` on its fake page, as CEP does, so this cannot
come back unnoticed.

**Nothing from disk or the clipboard is parsed as HTML** in a panel that can
run Node. Folder and file names are set with `textContent`; clipboard HTML is
parsed by `DOMParser` (which runs nothing) and rebuilt from a whitelist
(`h1`–`h3`, `p`, `b`, `i`, `u`, LazyKick's own classes and numeric timecode
attributes).

**No shell.** Explorer and Finder are started with `spawn` and an argument
list. PowerShell gets its script as `-EncodedCommand` (with `-STA`, which the
clipboard API needs), so no path passes through `cmd.exe` quoting.
Arguments to `evalScript` are always built with `JSON.stringify`.

**A handler that stops the browser's default must not fail silently.** The
notes paste handler calls `preventDefault()` first; if the clean-up throws,
it pastes the plain text instead.

**The project is re-checked before any change.** Watch-bin syncs carry the
project ID they were scanned for, and the host refuses to import into another
one. Time to Audio and the dialogs check that the project, tab and lines are
still the ones they started with.

---

## Host API

Global functions in `host.jsx`, called with `CSInterface.evalScript`. Each
returns a JSON string `{ ok, msg, … }` unless noted.

| Function | Returns / does |
| :--- | :--- |
| `getProjectInfo()` | `host` (`ae` / `ppro`), `saved`, `path`, `name`, `fullId`, `version` |
| `getProjectPath()` | Plain string: `host\|saved\|path`, or `host\|unsaved\|id` (Premiere's `documentID`; After Effects' single untitled project) |
| `getProjectFolder()` | Plain string: the saved project's folder, or `NO_PROJECT` |
| `getCurrentTimecode()` | `timecode` at the playhead, formatted as the app displays it (After Effects: project display format plus the composition's start time; Premiere Pro: the sequence's format) |
| `importPastedImage(path, guide, fit, binName)` | Imports or reuses the item and places it. `placedOnTimeline`, `reused`, `track` (Premiere), `binPath` |
| `syncWatchBin(binPath, payloadJson, expectedProjectId)` | Payload `{ folder, arrange, files: [{ p, s, n }] }` (path, subfolder, new). Adopts an existing bin, merges copies, relinks moved files, imports new ones into the bin mirroring their subfolder, and with `arrange` sorts media already in the watch bin. Returns `importedFiles`, `failedFiles`, `existingFiles`, `relinkedFiles` (`{ from, to }`), `moved`, `merged`, `adopted`, `rootPath`; `projectChanged: true` if another project is open |
| `importFilesToBin(binPath, filesJson, expectedProjectId)` | The 1.2 call: straight into one bin, no subfolders or sorting |
| `getTimelineInfo()` | The open sequence or composition: `name`, `fps`, `offset` (the time its timecode starts at, seconds), `duration` |
| `getPlayhead()` | Kept tiny for polling: `t` (seconds from the timeline start), `fps`, `offset`, `name` |
| `getTimelineAudio(wavPath)` | Premiere Pro: exports the sequence mix to `wavPath` with *Waveform Audio 48kHz 16-bit* (`kind: "wav"`). After Effects: *Convert Audio to Keyframes* on the audible layers, one loudness value a frame (`kind: "levels"`, `step`, `start`, `values`). `used: "selected"` when only the selected clips or layers were heard |
| `placeSubtitles(payloadJson)` | `{ srtPath, cues: [{ s, e, t }] }`. Premiere Pro: imports the SRT into a *Subtitles* bin and calls `createCaptionTrack`. After Effects: one box-text layer per cue |

`LazyKickHost` also exports `sanitizeBinPath`, `formatFramesTimecode`,
`choosePremiereTrack` and `normalizeMediaPath` for the tests.

---

## How each feature works

### Project identity and saving

The panel polls `getProjectInfo()` every 2.5 s. Notes and watch bins are
stored per project in `%APPDATA%\AdobeProjectNotepad` (macOS:
`~/Library/Application Support/AdobeProjectNotepad`), in files named after a
hash of the project ID. Notes save 300 ms after the last keystroke, and a
pending save is written to the project it was typed in before the panel
switches projects. Data written while a project was unsaved is renamed to the
saved project's files when the project file turns out to be brand new (less
than two minutes old).

### Paste Image

The panel asks PowerShell (Windows) or AppleScript (macOS) for the
clipboard, preferring a PNG (keeps transparency), then a copied image file,
then any bitmap. The file's MD5 is looked up in `paste_index.json` (the last
500 pastes); an exact match in the same folder is reused. The host then
imports or reuses the item. In Premiere Pro, `choosePremiereTrack` picks the
lowest unlocked video track with no clip at the playhead and enough empty
room for the still's default duration, and places it with
`Track.overwriteClip`. `insertClip` is never used, because it ripples later
clips, sync-locked tracks included.

### Notes paste

`paste.js` walks the parsed clipboard document into blocks, reading each
run's font weight, style, decoration, size, colour and visibility. Blocks
are classified against the body text size: 1.6× or more is a title, 1.25× a
heading, a short all-bold line without an end stop a small heading, grey or
0.85× and smaller a side note. The result is rebuilt from the whitelist and
inserted with `execCommand("insertHTML")`, and `main.js` tidies what the
browser adds while pasting.

### Time to Audio

`main.js` collects the spoken lines (skipping headings, `.note-muted`,
checklist items and wordless lines), gets the audio from the host, and hands
the loudness envelope to `align.js`: `findSpeech` finds speech and pauses,
`alignScript` aligns every sentence with dynamic programming (`alignLines`)
and spreads the words (`wordTimes`). Each line then starts with a
`span.timecode-tag` carrying `data-t` / `data-e` (measured start and end,
seconds from the timeline start) and `data-w` (word offsets). A tag whose
text no longer matches `data-t` was edited by hand and is read from its text
(`parseTimecode`, drop-frame `;` included). [How script timing
works](script-timing.md) explains the maths in plain words.

### Subtitles

💬 first opens the *Create subtitles* dialog (`askSubtitleOptions` in
`main.js`), with Premiere Pro's choices: layout `single`, `double` or
`word`, `maxChars` per line, `minSeconds`, `gapFrames` and
`removePunctuation`. `cueOptions` in `align.js` holds the defaults and limits
and brings any value into range; the panel remembers the last choices as
`subtitles` in `lazykick_settings.json`. The dialog's preview runs the same
`makeCues` as the real thing.

`makeCues(lines, options)` turns timed lines into cues. `chunkWords` cuts a
line into pieces that fit one or two lines of `maxChars` (filled one after
another) and 6.5 seconds; `wordChunks` makes one piece per word for `word`,
keeping a lone mark with its word. Each piece starts on its first word; the
last piece of a line is held for `minSeconds`, never past the next line's
start less `gapFrames`. `wrapSubtitle` splits a Double Line cue at the space
nearest the middle that keeps both lines within the maximum, preferring a
sentence end or comma nearby. `buildSrt` writes the SRT (UTF-8 with a BOM,
CRLF), and the host places it.

### Follow

While the Notes tab shows a note with timecode tags, `followTick` calls
`getPlayhead()` every 200 ms while the playhead moves and every 900 ms while
it rests, and `followAt` picks the line and word. The highlight is an
absolutely positioned layer over the editor (`#followLayer`), sized from DOM
`Range` rectangles of each word, so it is never part of the note. Between two
answers it glides at the measured playback rate with `requestAnimationFrame`.
Auto-scroll pauses for 2.5 s after the user scrolls, clicks or types.

### Watch bins

The panel scans the folder asynchronously (no symlinked folders, no hidden
or Adobe cache folders), keeps a per-bin history of imported paths and a
list of skipped files with their size and date, and queues syncs so only one
runs at a time. Auto-Sync imports a file only after its size held still
between two scans. The host builds a small model of the project tree
(`projectTreeAE` / `projectTreePPRO`: bins, media with their paths, other
items) and runs the same logic for both apps: `watchRoot` finds or adopts
the watch bin and merges copies, `relinkMoved` relinks unambiguous moves
(`FootageItem.replace` in After Effects, `changeMediaPath` in Premiere Pro),
`importInto` imports per sub-bin, `mergeTwinsWithin` and `arrangeInto` sort.
A bin is deleted only when the host itself reports it empty (Premiere's
`deleteBin` takes its contents with it).

---

## Tests

```bash
npm test
```

Windows only, as two steps use Windows Script Host. In order:

1. **`check-extendscript.js`**: `host.jsx` compiles as ES3 and avoids what
   real ExtendScript rejects.
2. **`test-host.js`**: `host.jsx` against mocked After Effects and Premiere
   Pro. Track choice, no ripple edits, nested bins, duplicate reuse, media
   already in the project, subfolder mirroring, adoption and merging of
   existing bins, relinking, timecode formatting, audio reading and
   selection, subtitles, the playhead, partial import failures and the
   project-changed guard.
3. **`test-align.mjs`**: the WAV reader on every PCM and float layout (split
   at any byte), the speech finder, Bengali and English spoken lengths,
   timecodes, SRT, cues in every layout (single line, double line, single
   word, line length, minimum duration, gap, punctuation), the follower, and
   timing on real speech from
   `tools/fixtures/tts-voiceover.json`: three scripts read by Windows' voices
   with natural pauses, rushed pauses and a music bed. Every line must start
   within 0.2 s; in the *paragraphs* fixture every sentence within 0.15 s.
4. **`test-paste.mjs`**: the HTML Google Docs, Word and web pages put on the
   clipboard. Structure survives; styles, links, images, scripts, hidden
   text and attributes (including injection attempts) do not.
5. **`test-panel.mjs`**: the real `main.js` in a Node VM with a fake DOM
   (with CEP's `module` on the page), a fake host and fake PowerShell, on
   real temp files. Notes, tabs, project switches, unsaved-to-saved moves,
   paste duplicates and names, watch-bin syncs, races and edits, Time to
   Audio and Subtitles on both hosts, the Create subtitles dialog (defaults,
   preview, greyed-out rows, Enter, Cancel, Esc, remembered choices, a project
   switch while it is open), document paste, text size, Follow, the in-panel
   dialog, and the CEP 9 syntax guard.

`tools/make-tts-fixture.mjs` rebuilds the speech fixture with Windows'
System.Speech voices: each sentence is spoken on its own and joined with
known pauses, so the true times are exact to the sample.

The mocks follow the documented host APIs, but they are not the real apps.
`tools/ae-smoke-host.jsx` runs `host.jsx` inside After Effects itself (close
After Effects first; results in `%TEMP%\lazykick-ae-smoke-results.txt`):

```bat
"C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.com" -r "<repo>\tools\ae-smoke-host.jsx"
```

Premiere Pro has no such command line, so **try a release in Premiere Pro by
hand before publishing it.**

---

## Building a release

```bash
npm run release:cert   # once: creates the self-signed signing certificate
npm run release        # runs the tests, then signs and writes the zip
```

- **The version comes from `package.json`.** The release script copies it
  into the manifest, `main.js`, `host.jsx`, the panel footer and the README.
  `1.5.0` is shown as `1.5`; `1.5.1` stays `1.5.1`.
- **Signing:** Adobe's `ZXPSignCmd` (fetched into `tools/vendor/` by
  `get-zxpsigncmd.mjs`, or set `ZXPSIGNCMD`) signs with a certificate kept in
  `Signing key (do not share)/` inside the repository folder. That folder is
  **never committed** (`.gitignore` and `.git/info/exclude`); back it up
  privately, because every release must be signed with the same
  certificate. `LAZYKICK_KEY_DIR` and `LAZYKICK_CERT_PASSWORD` override where
  the key and its password come from.
- **Timestamped** (DigiCert, then Certum, then Sectigo), so the panel keeps
  loading after the certificate expires.
- **The zip** (`LazyKick-v<version>.zip`: the `.zxp`, the installers and
  `Read me first.txt`) is written to the nearest `00. Install from here`
  folder beside the repository or above it (override with
  `LAZYKICK_DOWNLOAD_DIR`). Only the newest LazyKick zip is kept there.
- Publish it as a GitHub release tagged `v<version>`, with the zip attached
  and its SHA-256 in the notes.
