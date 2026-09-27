# If something goes wrong

Find the symptom, or the message the status bar shows. *Written for
LazyKick 1.5.1.* The status bar at the bottom of the panel always says what
just happened or why something did not; hover it to read a long message in
full.

**Contents**

- [Installing and opening the panel](#installing-and-opening-the-panel)
- [Paste Image](#paste-image)
- [Notes](#notes)
- [Time to Audio](#time-to-audio)
- [Subtitles](#subtitles)
- [Follow](#follow)
- [Watch bins](#watch-bins)
- [Status bar messages](#status-bar-messages)
- [Reporting a problem](#reporting-a-problem)

---

## Installing and opening the panel

### LazyKick is not in Window › Extensions

- Restart the app completely. Adobe only looks for panels while the app
  starts.
- Check the panel is there:
  `%APPDATA%\Adobe\CEP\extensions\com.sohan.LazyKick\CSXS\manifest.xml`
  (Windows) or
  `~/Library/Application Support/Adobe/CEP/extensions/com.sohan.LazyKick/CSXS/manifest.xml`
  (macOS). If not, run the installer again with the apps closed.
- Your app must be After Effects CC 2019 (16.0) / Premiere Pro 2020 (14.0) or
  newer.

### Two LazyKicks, or an old version keeps showing

Only one copy may be installed. The installer moves a LazyKick 1.0 copy
aside by itself, but a copy installed **for all users** is only reported.
Delete it from an administrator PowerShell, with the apps closed:

```powershell
Remove-Item -LiteralPath "C:\Program Files (x86)\Common Files\Adobe\CEP\extensions\LazyKick" -Recurse -Force
```

A developer copy linked into the extensions folder shares the same ID too;
keep either it or the installed panel.

### The panel opens blank

On some computers Adobe's signature check fails even for a correctly signed
panel. Run **`Fix a blank panel.bat`** from the download (Windows), or on
macOS run this in Terminal, then restart the app:

```bash
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

It turns on Adobe's own *PlayerDebugMode* for your user account, which lets
the app load the panel anyway. If it is still blank, see
[Reporting a problem](#reporting-a-problem).

### The panel shows the wrong project, or "(No project)"

Click **↻** in the header. The panel checks every 2.5 seconds, so it also
catches up by itself.

---

## Paste Image

### "No Image in Clipboard!"

- Copy an actual picture (`Win+Shift+S`, *Copy Image* in a browser), or an
  image **file** in Explorer or Finder: `.png .jpg .jpeg .gif .bmp .tif .tiff
  .webp .psd`.
- A file path copied as text is not an image.
- macOS: if asked, allow the app to control your Mac; the clipboard is read
  with AppleScript.

### "Clipboard Error" / "Could not read the clipboard"

Windows reads the clipboard with PowerShell. Another program holding the
clipboard open (some clipboard managers do) can refuse it for a moment:
copy the picture again and paste. If PowerShell is blocked on your computer
by a company policy, pasting images cannot work.

### Premiere Pro: "No free video track at the playhead"

Every unlocked video track has a clip at the playhead, or not enough empty
room after it for the still's duration. Add an empty video track (or unlock
one) and paste again; the image is already in the bin. LazyKick never pushes
or covers existing clips on purpose.

### After Effects: the pasted image does not render

It is a **guide layer** by default: visible while you work, left out of
renders. Turn off *Paste as Guide Layer* in 🛠️ Paste & Tools, or right-click
the layer › *Guide Layer*.

### "No composition open" / "No sequence open"

The image was saved and imported but not placed, because no timeline was
open. It is in the paste bin; open the composition or sequence and click it
in **Recent Pastes** to place it.

---

## Notes

### My notes disappeared after saving a new project

Notes typed in an unsaved project move to the project when it is saved for
the first time (within two minutes of saving). If you opened a *different*
existing project instead, the notes stay with the untitled project: use
**File › New Project** and they are there.

### The same project shows different notes in After Effects and Premiere Pro

That is by design: notes belong to the project file, and an `.aep` and a
`.prproj` are different files. The 🌐 Global tab is shared everywhere.

### Pasted text lost its formatting, or kept too much

- **Ctrl+Shift+V** pastes plain text on purpose; use **Ctrl+V** to keep the
  headings and bold.
- Colours, fonts, sizes and links are dropped deliberately; see
  [Pasting text](manual.md#pasting-text) for what is kept.
- Something pasted as one heading that should be a paragraph: a short line
  (up to five words) that is entirely bold with no full stop is read as a
  heading, as documents write them. Add a full stop or un-bold it.

### "Images go to the timeline"

You pasted an image file into the notes. Images are placed with
**📋 Paste Image** or **Ctrl+V** outside the notes.

---

## Time to Audio

### A line got the wrong time

- **The script must match the recording**: same sentences, same order,
  nothing left out. Remove what the voiceover skips, add what was
  ad-libbed.
- **Music or effects under the voice** hide the pauses. Select the
  voiceover clip (Premiere) or layer (After Effects) first, so only it is
  heard.
- **Timed with a version before 1.5.1?** Paragraphs were then matched by
  their length alone; click 🎙️ once more to re-time every sentence.
- Fix a single line by editing its timecode. 💬 Subtitles and 👁 Follow use
  what you typed.

[How script timing works](script-timing.md#getting-the-best-result) has more.

### "Write the script first"

The note has no spoken lines. Headings, grey side notes, checklist items and
lines without words are skipped, so a note made only of those has nothing
to time. The message still says *one line per subtitle*, but paragraphs are
fine.

### "No speech found in the timeline audio of '…'"

The audio is silent, or so flat (constant music at one level) that no voice
stands out. Check the right sequence or composition is open, its audio is
not muted, and select the voiceover clip or layer.

### "Premiere's WAV export preset (Waveform Audio 48kHz 16-bit) was not found"

LazyKick uses the WAV preset that comes with Premiere Pro, in its
`MediaIO/systempresets` folder. A damaged or trimmed installation can miss
it: repair or reinstall Premiere Pro.

### "Premiere did not export the sequence audio"

The export was refused, usually because the sequence is empty or the temp
folder is not writable. Try again with a sequence that plays audio.

### After Effects: "This composition has no audio to listen to" / "could not measure the audio"

The composition has no layer with audio switched on (or none of the selected
layers has audio). Switch a voiceover layer's audio on, or select one that
has audio, and click again.

### "The note changed while listening; nothing was changed"

You switched project or tab, or edited the lines, while the audio was being
read. Click 🎙️ again.

---

## Subtitles

### "No timed lines yet"

Click **🎙️ Time to Audio** first, or start lines with a timecode
(**⏱️ Timecode** inserts one).

### "None of the timecodes fall on '…'"

The tags are before the start of the open sequence or composition, usually
because they were made on another timeline. Open the one they belong to, or
time the script again.

### Premiere Pro: subtitles are only in the "Subtitles" bin

That Premiere version cannot create caption tracks from a script. Drag the
subtitle item from the *Subtitles* bin onto the sequence.

### After Effects: Bengali letters do not join

LazyKick sets a Bengali font and the Universal Type Engine when a subtitle
has Bengali text. If no Bengali font is installed (Nirmala UI, Vrinda,
Shonar Bangla, Kohinoor Bangla, Bangla Sangam MN, Noto Sans Bengali), the
default font is kept: install one, or set the font yourself in the Character
panel with *Universal Type Engine* on (*Preferences › Type*).

### Where is the .srt?

In `LazyKick Subtitles` next to the project, named after the sequence or
composition (for an unsaved project, in your home folder). The status bar
shows the name.

---

## Follow

### Nothing lights up

- 👁 Follow must be on (blue).
- The note needs timed lines.
- The Notes tab must be showing, and no dialog open.
- The open sequence or composition must be the one the script was timed on.

### The highlight is on the wrong word

The word times come from the timing; fix the line's timecode or re-time the
script. After you add or remove words in a line, its word times are spread by
length until you time it again.

### After Effects: the highlight only moves when playback stops

During some previews After Effects may not report the playhead to panels.
The highlight catches up as soon as playback stops or you scrub.

---

## Watch bins

### Files are not importing

- The filter (Video, Audio, Image) for that file type must be on, and the
  extension must be in the [supported list](manual.md#file-types).
- With Auto-Sync, a new file is imported on the scan **after** its size
  stopped changing: allow about 12 seconds.
- A project must be open; watch bins belong to a project.
- **· N skipped** on the card: the app refused those files. Hover for the
  names, fix or convert them and click **⚡ Sync**.
- A file that is **already in the project** (in any bin) is not imported
  again; it counts as synced (*N already in the project*).
- Files you deleted from the project and want back: **↺** (Reset) on the
  card.

### A second bin with the same name appeared

From 1.4 on, LazyKick uses the bin the project already has for a folder. A
project where an older version made a copy: click **⚡ Sync** once and the
copies are merged, then the emptied copy is removed.

### My own arrangement was undone

⚡ Sync sorts what is **inside the watch bin** to match the folders on disk.
Keep your own arrangement outside it: drag clips into another bin (such as
*Selects*) and LazyKick leaves them alone.

### A moved file was imported again instead of relinked

Relinking happens only when the match is certain: the same file name, and
the folder names tell it apart from every other missing clip and new file.
When two candidates fit equally well, LazyKick imports rather than guess.
On Windows a file the app is using cannot be moved while the project is
open: reorganise folders with the project closed, then open it and click
⚡ Sync.

### "Folder not found"

The linked folder was moved, renamed or is on a drive that is not connected.
Reconnect the drive, or click **✎** and choose the folder again.

---

## Status bar messages

The messages you may see, and what they mean. `…` stands for a name.

### Paste Image

| Message | Meaning |
| --- | --- |
| Layer added to '…' | After Effects: placed in that composition. |
| Clip placed on V2 | Premiere Pro: placed on that video track. |
| No composition open / No sequence open: image is in the '…' folder/bin | Saved and imported, not placed. |
| No free video track at the playhead: image is in the '…' bin | Every track is busy at the playhead. |
| Could not place the clip: image is in the '…' bin | Premiere Pro refused the edit; the image is in the bin. |
| Premiere Pro did not import the image | The import itself failed. |
| No image found on the clipboard | See [No Image in Clipboard](#no-image-in-clipboard). |
| Nothing pasted into … yet | 📂 found no paste folder for this project. |

### Notes

| Message | Meaning |
| --- | --- |
| Inserted timecode: … | ⏱️ Timecode worked. |
| No active composition found / No active sequence found | ⏱️ needs an open timeline. |
| Note copied to clipboard! | 📋 worked. |
| Exported note to: … | 📥 worked (a dialog shows the full path). |
| Notes text size: … px | A− / A+. |

### Time to Audio and Subtitles

| Message | Meaning |
| --- | --- |
| Listening to the timeline audio… | Reading the audio; the buttons wait. |
| Timed N lines to the (selected / timeline) audio of '…' | Done. |
| Subtitles placed on a new caption track in '…' | Premiere Pro: done. |
| N subtitle layers added to '…' | After Effects: done (with a count of any past the end of the composition). |
| Open a sequence first / Open a composition first | No timeline open. |
| Others | See [Time to Audio](#time-to-audio) and [Subtitles](#subtitles). |

### Watch bins

| Message | Meaning |
| --- | --- |
| Importing N new item(s) into … / Sorting … | A sync is running. |
| Synced …: 3 imported, 1 relinked (moved on disk), 12 sorted into subfolder bins, 1 duplicate bin merged, 2 already in the project, 1 could not be imported | What the sync did; only the parts that happened are listed. |
| Using the existing bin … | The project already had a bin for this folder; it is the watch bin now. |
| …: no new files | Nothing to do. |
| Sync failed for …: … | The host reported an error; the reason follows. |
| Sync All complete: … | Totals for every card. |
| The project changed while the dialog was open; the watch bin was not edited | You switched project with ✎ open. |

---

## Reporting a problem

Email **lettertosohan@gmail.com** or
[open an issue](https://github.com/raisulsohan/LazyKick/issues) with:

1. The app and its version (After Effects or Premiere Pro, *Help › About*).
2. Windows or macOS, and its version.
3. The LazyKick version (bottom right of the panel).
4. What you did, what you expected, and the exact status bar message.
5. For a timing problem: a few lines of the script and roughly where it goes
   wrong. For a watch-bin problem: how the folder is laid out on disk.

LazyKick never sends anything by itself, so there is nothing to look up on
the other end: the details in your message are all there is.
