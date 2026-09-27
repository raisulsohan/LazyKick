# How script timing works

What **🎙️ Time to Audio** does between the click and the timecodes, how
accurate it is, and how to get the best result. *Written for LazyKick
1.5.2.* The steps for using it are in [the manual](manual.md#5-time-a-script-to-the-voiceover).

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
- Sentences stay in order and cover the speech exactly once.

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

## Getting the best result

- **The script must match the recording.** Same sentences, same order.
  Remove what the voiceover skips; add what was ad-libbed. A missing or extra
  sentence shifts the lines around it until the next clear pause.
- **Keep music out of the measurement.** Select the voiceover clip or layer
  before clicking. A music bed fills the pauses, and the pauses are what the
  timing relies on.
- **Headings and notes are fine.** Titles, headings, grey side notes and
  checklists are skipped, so a pasted document works as it is. Keep
  directions like *[pause]* or *(B-roll here)* in a grey note or a
  heading, not in a spoken line.
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
