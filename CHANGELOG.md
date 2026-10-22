# Changelog

All notable changes to LazyKick. Versions follow `package.json`.

## 1.10.0

### ✂️ Cut the timeline from the script
- **Select words in a timed note and right-click.** **✂️ Cut the timeline here** cuts every unlocked track where the selected words start and where they end; nothing is taken out. **✂️ Remove from the timeline** takes them out of every unlocked track and closes the gap, after a question that names the stretch, the timeline and how to undo it.
- When 🎙️ Time to Audio heard that timeline, every cut falls in the middle of the pause next to the words (`LazyAlign.quietCut`: a pause within 0.25 s, else a breath), so no word is clipped and a removal keeps half of the pause on each side. Without it, the word times are used. Every cut is rounded to a whole frame.
- In the note, removed words are struck through (`span.note-cut`) and are no longer timed or put in subtitles; a line with nothing left loses its timecode. Every time after the stretch moves earlier to match: line starts, word times, pins, and timecodes in side notes and checklists. **Bring back the struck words** in the right-click menu lifts the strike again, for after you undo the cut on the timeline.
- **✂️ Retakes:** when 🎙️ Time to Audio left retakes out, an amber button with the count appears next to it. It takes every earlier take off the timeline at once, after a question: each from the middle of the pause before it to just before the take that counts, so the pause left is as long as the reader's own (`LazyAlign.outtakeCuts`). Restarts one after another, with nothing kept between them, go as one stretch.
- **Premiere Pro:** its scripting has no razor, so each track is cut with Premiere's QE razor at Premiere's own timecode for that frame, and the cut is checked on the timeline (a sequence that starts at 01:00:00:00 is tried with its start timecode too). The picture and sound pieces are linked again. A removal cuts both ends, removes the pieces inside and moves every later clip left, earliest first; when a cut does not take, nothing is removed. Premiere keeps each step as its own undo step.
- **After Effects:** a layer is split by duplicating it and trimming both copies (the later piece on top, as *Edit › Split Layer* leaves it), and later layers move by their start time, all in one undo step.
- Locked tracks and layers are left as they are, and the status bar says how many. Nothing is cut when another sequence or composition became active while the question was open.
- New host functions `cutTimeline(payloadJson)` and `removeTimeline(payloadJson)`.
- Not moved by a removal: Premiere Pro caption tracks, and sequence or composition markers. An After Effects composition keeps its length.

## 1.9.1

### Fixed
- **A pin always moved the line's first timecode**, so in a script pasted as paragraphs a retake inside a paragraph could not be pinned. Pins now go on the word you right-click: **📌 Start this word at the playhead** (the menu item's new name). Right-click the first word of the sentence where it is really said.
- The pinned word starts with the voice at or just after the playhead. The paragraph is cut there, both parts are timed on their own and joined again, so it keeps one timecode and a time for every word; everything else is timed again around it at once.
- A pinned word is kept in a small `span.note-pin` around it, marked with a 📌 and an amber underline, so the pin stays with the word when text before it is edited. A pin on a line's first word stays on its timecode tag (amber, as in 1.9.0), and pins from 1.9.0 still work.
- **Unpin this line** removes every pin in the line.
- After timing, a word's pin was also copied onto the line's timecode, pinning the line's start as well; it no longer is.

## 1.9.0

### 🎙️ Retakes in an unedited recording
- **Time to Audio leaves the earlier take of a retake out** and times the line to the later take. Before, every bit of speech had to belong to a line, so a passage said twice pushed the sentences after it onto the wrong takes, and 👁 Follow and 💬 Subtitles drifted from the voice for the rest of the paragraph.
- A stretch of speech can be left out when it ends at a wait three times the reader's usual pause and at least 1.5 s long (a knock or a click inside the wait does not break it). Leaving speech out has a small cost, so it only happens when the rest fits far better; and because the stretch must end at the wait, it is the earlier take that goes.
- A retake starts with the same words as the take after the wait, so the loudness rhythm of its first moments is alike: a stretch that starts like the speech after the wait is left out more readily. This tells a restart of the same sentence from a sentence that only happens to end before a long pause.
- The pace of the script no longer counts left-out speech as reading.
- The status bar says how many retakes were left out. A read without retakes leaves nothing out, and its timing is unchanged.
- Measured on a new test read with four kinds of retake (`tools/fixtures/tts-retakes.json`, built by `tools/make-tts-fixture.mjs --retakes`): every line within 0.1 s of its later take, where it was off by more than 8 s. On a real unedited 19-minute recording, sentences off by more than 3 s fell from 8 to 2 (both where the reference itself picked the wrong take).

### 📌 Pin a line to the playhead
- **Right-click a line › 📌 Start this line at the playhead**: the line starts with the voice at or just after the playhead, and every other line is timed again around it. For a retake the timing could not tell by itself, such as a quick restart with no wait.
- The script and the speech are cut at every pin and each section is timed on its own; a retake just before a pinned line can still be left out.
- Re-timing after a pin uses the audio already heard from the same timeline, so Premiere Pro does not export it again; a timeline that changed (another length, another sequence) is listened to again.
- A pinned timecode is amber with a 📌, and the pin (`data-anchor` on the tag) stays when 🎙️ Time to Audio runs again. **Unpin this line** in the same menu lets the line be timed freely again.

## 1.8.0

### 🎯 Jump to a word
- **Click a line's timecode** and the playhead moves to the start of that line (the measured start, or the time written in a tag you typed or edited).
- **Ctrl+click a word** (Cmd+click on macOS) and the playhead moves to the moment that word is said, from the same word times 👁 Follow uses. A click between words takes the nearest word on that row. With 👁 Follow on, the word lights up at once, and the highlight does not glide on from the jump, since a jump is not playback.
- A plain click on a word still only places the caret, so editing never moves the timeline. While Ctrl (Cmd) is held over the note, and over any timecode, the pointer is a hand.
- A line with no timecode says to click 🎙️ Time to Audio first; with no sequence or composition open, the status bar says so too. The status bar shows where the playhead went, in the timeline's own timecode.
- New host function `setPlayhead(seconds)`: After Effects sets the composition's time (kept inside the comp), Premiere Pro calls `setPlayerPosition` in ticks; never before the timeline's start.
- Roadmap item "timecode stamps you can click to jump the playhead" is done.

## 1.7.3

### Fixed
- **👁 Follow: the word being said could not be seen on a pasted highlight.** Its see-through blue glow mixed with an orange or cyan mark, so the word looked muddy and the highlight did not stand out. The word now gets a ring: on a highlight, a dark and a white ring with no fill, so the word keeps its own colours and the ring shows on any mark colour; on plain text, a white and dark ring with a light blue fill. The blue haze around it is gone.

## 1.7.2

### 🔠 Titles: time the title the voiceover reads
- **New 🔠 Titles switch** next to 🎙️ Time to Audio, **on by default** and remembered in `lazykick_settings.json`. On: titles and headings are spoken lines, so 🎙️ Time to Audio gives them a timecode, 💬 Subtitles makes them subtitles and 👁 Follow lights them up, while they keep looking like headings. Off: they are left out, as before 1.7.2, for section labels such as *HOOK* that nobody says. A voiceover often reads the video's title first; since 1.5 that title was skipped and every line after it could only be timed around it.
- Grey side notes, checklist items and lines with no words are still always left out.

### Fixed
- **Paste without formatting into an emptied note made the text a heading.** Select all and Delete keeps the first line's heading (an empty `<h2>`), and Ctrl+Shift+V or the menu's Paste without formatting put the pasted text into it; Chromium then gave every line split from it the heading's size on a `<span style>` (`font-size: 21.875px`), so the whole script looked large. An empty heading at the caret now becomes a plain line before anything is pasted, and a plain paste is tidied like a rich one, so no size or style copied from a heading stays.

## 1.7.1

### Fixed
- **A title pasted from Word came in as a normal line** (not bold, not a heading, and 🎙️ Time to Audio timed it as speech) when it was only made larger by hand. Word writes the body's 11pt in the page's own `<style>` (`p.MsoNormal`), not on the text, so the body had no size and the title's 15pt was taken for the body size. Pasting now reads the page's class rules (`.Class` and `tag.Class`: size, bold, italic, decoration, colour, highlight, hidden), so Word's paragraph styles count, a paragraph in Word's *Title* style included. Text with no size anywhere counts as 12pt body text, so a larger title is still found without a `<style>`.
- **Paste in the right-click menu** now reads the whole page from the clipboard, `<style>` included, as Ctrl+V does; it read only the copied part before.

## 1.7.0

### 🖍️ Pasted notes keep their highlights and colours
- **Highlighted (marked) text keeps its highlight colour** when pasted into 📝 Notes from Google Docs (*Highlight colour*), Word (highlights and shading, `background` / `mso-highlight`) or a web page (`<mark>`, inline backgrounds). The text on a highlight keeps its own colour when it reads there, else it is dark (or white on a dark highlight).
- **Coloured text keeps its colour.** The note is dark, so black text takes the note's own light colour, and a colour too dark to read on it (dark blue, dark red) is mixed with white until it reaches a 4.5:1 contrast, keeping its hue.
- **Strikethrough** (`<s>`, `<del>`, `text-decoration: line-through`) is kept too.
- A web page's own white or dark background, which Chromium writes on every span copied from a page, is not taken for a highlight; nor are table cell and block backgrounds.
- Colours are read as numbers and written back as `#rrggbb` on LazyKick's own `span.note-color`; after every paste the panel rebuilds each colour span's style from its own `data-fg` / `data-bg`, so nothing else from the clipboard reaches a style attribute. Fonts, sizes, links, images and scripts are still left behind.
- 🎙️ Time to Audio, 💬 Subtitles and 👁 Follow read through the colour spans; subtitles carry no colour.

### Paste or Paste without formatting
- **Right-click the note** for a menu like Google Docs': **Cut**, **Copy**, **Paste**, **Paste without formatting** and **Select all** (Cut and Copy are greyed without a selection). CEP showed no menu at all on a right-click before.
- **Paste** keeps the source's look, as Ctrl+V does. **Paste without formatting** puts in the text only, as Ctrl+Shift+V does.
- Menu Paste uses Chromium's own paste where CEP allows it; otherwise it reads the clipboard through PowerShell (Windows) or AppleScript (macOS). On Windows the HTML is read through WPF, which decodes it as UTF-8: Windows Forms on .NET Framework reads it in the ANSI code page, which garbled Bengali and curly quotes. Nothing is pasted if another note came up while the clipboard was read.
- **Ctrl+Shift+V** (Cmd+Shift+V) is now registered with After Effects and Premiere Pro as well, so the host hands it to the panel.

## 1.6.0

### 💬 Choose how the subtitles look
- **💬 Subtitles now opens a *Create subtitles* window first**, with the choices of Premiere Pro's *Create captions*:
  - **Layout**: **Single Line**, **Double Line** (default) or **Single Word**. Single Word makes every word a subtitle, on screen from when it is said until the next word is; a lone dash or ellipsis stays with its word. The three settings below do not apply to it and are greyed out.
  - **Maximum length in characters** per line, 10 to 80 (default 42). Lines are filled one after another, so a Double Line subtitle holds what fits in two lines of that length.
  - **Minimum duration in seconds**, 0.5 to 10 (default 3.0): a short subtitle stays up that long, but never into the next one.
  - **Gap between subtitles (frames)**, 0 to 30 (default 0).
  - **Remove punctuation**: full stops, commas, question and exclamation marks, colons, quotes, brackets, dashes, ellipses and the Bengali dari (।) come off the ends of words; inside a word they stay (*don't*, *3.5*, *well-known*), and symbols such as `$`, `%` and `#` are kept.
- Each setting has a slider and a number box; a typed number is brought into range when you leave the box.
- A **preview** shows the number of subtitles and the first three with their timecodes, worked out by the same code that makes them, and follows every change.
- The choices are remembered in `lazykick_settings.json`. Enter creates, Esc or Cancel makes nothing. If the project or note changes while the window is open, nothing is placed.

### Changed
- The defaults follow Premiere Pro: a short subtitle is now held for 3 seconds when nothing follows it straight away (it used to disappear the moment the line was said), and subtitles follow each other with no gap (it used to be 0.04 s).
- A two-line subtitle breaks at a sentence end or comma near the middle when there is one, and both lines always stay within the maximum length (before, a split at the middle could leave one line over 42).

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
