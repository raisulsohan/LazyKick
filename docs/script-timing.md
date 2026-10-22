# How script timing works

What **🎙️ Time to Audio** does between the click and the timecodes, how
accurate it is, and how to get the best result. *Written for LazyKick
1.6.0.* The steps for using it are in [the manual](manual.md#5-time-a-script-to-the-voiceover).

## The idea

LazyKick does not recognise speech. It does not need to: you already have
the script, and a read voiceover follows it. What is missing is only
**where** each sentence is in the audio, and that can be found from two
things any recording has:

- **the pauses** in the voice, and
- **how long each sentence takes to say**, which can be estimated from its
  text.

Because nothing listens for words, it works the same for English, Bengali
or any other language, runs entirely on your computer, downloads nothing
and sends nothing anywhere.

## Step by step

### 1. Getting the audio

- **Premiere Pro** exports the open sequence's audio mix to a temporary WAV
  with its own *Waveform Audio 48kHz 16-bit* export preset. The panel reads
  the file in pieces, measuring the loudness of every 10 ms, and deletes it.
- **After Effects** cannot export audio from a script without the render
  queue, so it measures instead: its own *Convert Audio to Keyframes* gives
  the loudness of every frame. LazyKick removes the helper layer and puts
  your selection and work area back.

With audio clips or layers **selected**, only those are heard. That is how
you keep a music bed out of the measurement.

### 2. Finding the speech

The loudness is turned into decibels and smoothed a little. LazyKick then
looks at how loud the recording is overall (its quiet floor and its loud
peaks) and sets two thresholds between them, so it adapts to quiet and loud
recordings alike:

- speech **starts** when the level rises above about 38 % of the way from
  the floor to the peak, and **stops** when it falls below about 28 %;
- a drop shorter than **0.12 s** is not a pause (it is between two words),
  and a burst shorter than 0.08 s is a click, not speech.

That gives a list of stretches of speech with pauses between them. Inside
long stretches it also notes **breaths**: short, clearly quieter moments
that are not long enough to count as pauses. They are only used as a last
resort, when there are more sentences than pauses.

### 3. How long each sentence takes to say

Each sentence gets a **spoken length** from its text:

- a Latin (or Greek, Cyrillic, Arabic) letter counts 1;
- a Bengali or Devanagari syllable (a letter with its vowel sign; a
  conjunct counts once) or a CJK character counts about 2.8;
- a digit counts 4, since numbers are said as words;
- punctuation counts nothing: pauses are measured, not guessed.

Only the **proportions** matter. If one sentence is twice as long as
another, it should take about twice as much of the speech.

### 4. Matching every sentence to the speech

The script is split into **sentences** (at `.` `!` `?` `…` and the Bengali
danda `।`), across all lines. LazyKick then chooses where each sentence
ends, among the places the speech can be cut, with dynamic programming: it
tries every arrangement and keeps the one with the lowest total cost.

- **Fit:** a sentence's share of the speech should match its spoken length.
  Too short or too long costs, the more the further off.
- **Pauses:** ending a sentence on a pause is rewarded, a longer pause more.
  Ending on a breath costs.
- **Pace:** by any point in the audio, about that much of the script should
  have been read. Drifting far ahead or behind costs.
- Sentences stay in order. Every bit of speech belongs to a sentence, except
  a **retake** (below).

### Retakes in an unedited recording

A reader who stumbles stops, waits, and says the passage again. In the
recording the passage is there twice; in the script once. LazyKick takes
**the later take**:

- A stretch of speech that ends in a **long wait** can be left out. "Long"
  means three times this reader's usual pause and at least 1.5 s; a knock or
  a click in the middle of the wait does not break it.
- Leaving speech out costs a little, so it only happens when the rest then
  fits far better. Because the left-out stretch must end at the wait, it is
  the earlier take that goes.
- A retake starts with the same words as the take after the wait, so the
  **rhythm of its loudness** in those first moments is alike. A stretch that
  starts like the speech after the wait is left out more readily. This is
  what tells a restart of the same sentence from a sentence that only
  happens to end before a long pause.
- Left-out speech does not count as script read when the pace is measured.

The status bar tells how many retakes were left out.

### Pinned words

When the timing still gets a sentence wrong, **pin** it: put the playhead
where it is really said, right-click its first word and choose **📌 Start
this word at the playhead**. The pinned word starts with the voice at or
just after that point, and the script and the speech are cut there into
sections that are timed on their own; a pin inside a paragraph cuts the
paragraph in two, and the paragraph keeps one start and a time for every
word. A retake just before the pinned word can be left out of the section
before it. Pins stay until you unpin them, also when 🎙️ Time to Audio runs
again.

A line (or pasted paragraph) then **starts with its first sentence and ends
with its last**.

Why sentences and not whole lines? Readers often pause **longer between two
short sentences** ("Not reduce it. Not manage it.") than between two
paragraphs. Matched by paragraph length alone, a paragraph could end one
sentence early and hand its last sentence to the next paragraph, and all its
timecodes would run seconds ahead. The sentences and their pauses pin a
paragraph down far better than its total length.

If a reading is so rushed that there are **more sentences than places to
cut**, whole lines are matched instead.

### 5. Words

Inside each sentence, the clauses (split at commas, semicolons, colons and
dashes) are laid over the sentence's own pauses the same way, and then the
**words** are spread over the speech by their spoken length, with the clock
**stopped during pauses**. So a word after a breath starts after the breath.

Every word's time is kept in the line's tag. It is used by
[👁 Follow](manual.md#7-follow-the-voiceover-while-it-plays) to light up the
word being said, and by [💬 Subtitles](manual.md#6-make-subtitles) to start
each piece of a long paragraph when its first word is spoken.

## Cuts from the script

The word times also say where to cut the timeline. Select words in the note
and right-click: **✂️ Cut the timeline here** cuts every unlocked track where
they start and end, and **✂️ Remove from the timeline** takes them out and
closes the gap. **✂️ Retakes** takes out every earlier take that 🎙️ Time to
Audio left out.

- **Where a cut goes.** The start is the first selected word's time; the end
  is the time of the word after the last one, or the end of the line. When
  the voice of that timeline was heard, each end moves to the **middle of the
  pause** within 0.25 s of it, or else to a breath within reach. A removal so
  keeps half of the pause before the words and half of the pause after them.
- **A retake** goes from the middle of the pause before it to just before
  the take that counts, so the silence left before that take is as long as
  the one the reader left before the retake. A retake that starts at a
  breath, with no pause, is cut at the breath and keeps the reader's usual
  pause. Restarts one after another, with nothing kept between them, go as
  one stretch.
- **Whole frames.** Every cut is rounded to a frame of the timeline.
- **The note follows.** Every time after a removed stretch moves earlier by
  its length: line starts, word times, pins, and timecodes in side notes and
  checklists. A time inside a removed stretch moves to where the stretch was.
  Removed words are struck through and no longer timed; a line with nothing
  left loses its timecode.

Premiere Pro's scripting has no razor of its own, so each track is cut with
Premiere's QE razor and checked; the picture and sound pieces are linked
again; the pieces inside are removed and every later clip moves left,
earliest first. If a cut does not take, nothing is removed. In After Effects
a layer is split by duplicating it and trimming both copies (the later piece
on top, as *Edit › Split Layer* leaves it), and the later layers move by
their start time, all in one undo step.

## How accurate it is

On the test voiceovers (Windows' own voices reading three scripts, with
natural pauses, rushed pauses and a music bed underneath), **every line
starts within 0.2 s** of the truth, and in practice within a frame or two.
One script was used to tune the weights; the other two were never tuned on.
The third reads whole paragraphs and pauses longer inside them than between
them. There, every sentence lands within 0.15 s, where matching by paragraph
alone was off by more than 3 seconds.

On a real 9½-minute voiceover read from a Google Doc (33 paragraphs,
147 sentences), Windows' speech recogniser was used as an independent
reference. Of the 93 sentence starts it could pin down, **all landed within
0.21 s, most within 0.02 s**. Matching by paragraph alone had missed 15 of
them by more than half a second, up to 5 seconds.

In the real After Effects, lines landed within a frame of the truth.

**Retakes.** A test read with four retakes (a restart after the first
words, a whole sentence twice with a knock in the wait, a restart from the
sentence before, a restart after a shorter wait) lands **every line within
0.1 s of its later take**; without leaving takes out, a line was off by more
than 8 seconds. Pinning any one line at its true start keeps the others in
place (21 of 22 pins). On a real unedited 19-minute recording with retakes
(the speech recogniser as the reference again), sentences off by more than
3 seconds fell from 8 to 2, and both of those were places where the
recogniser itself picked the wrong take.

## Getting the best result

- **The script must match the recording.** Same sentences, same order.
  Remove what the voiceover skips; add what was ad-libbed. A missing or extra
  sentence shifts the lines around it until the next clear pause. Retakes
  are fine when the reader waits before saying the passage again; for a
  quick restart with no wait, pin the line.
- **Keep music out of the measurement.** Select the voiceover clip or layer
  before clicking. A music bed fills the pauses, and the pauses are what the
  timing relies on.
- **Headings and notes are fine.** Grey side notes and checklists are
  skipped, so a pasted document works as it is. Titles and headings are
  timed while **🔠 Titles** is on (the default), because a voiceover often
  reads the title first; switch it off when the headings are section labels
  nobody says. Keep directions like *[pause]* or *(B-roll here)* in a grey
  note, not in a spoken line.
- **Punctuate sentences.** The sentence ends are what the timing hangs on.
  A paragraph with no full stops is matched as one long sentence.
- **Long numbers:** every digit counts about as much as a short word, so
  `2,500,000` is counted like seven words though it is said as three
  ("two and a half million"). In a line full of big numbers, write them the
  way they are said.
- **Fix a line by editing its tag.** A tag you edit is read from its text,
  and 💬 Subtitles and 👁 Follow use what you typed.

## Limits

- It times a **read** voiceover. Interviews, overlapping voices or speech
  that does not follow a script cannot be matched this way.
- A voiceover under constant loud music with no selectable voice clip has
  no pauses to find; the lines are then spread by length only.
- Very long silences in the middle (a music break) are fine; a section of
  the script that is not in the audio is not.
