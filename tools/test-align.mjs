/*
 * LazyKick — script-to-audio alignment tests (client/align.js).
 *
 *   node tools/test-align.mjs
 *
 * The WAV reader against WAVs built here in every format Premiere can write,
 * the pause finder and line timing against real speech (Windows voices, with
 * true line times: tools/fixtures/tts-voiceover.json, made by
 * tools/make-tts-fixture.mjs), and the timecode and subtitle helpers. Also a
 * guard that align.js stays within CEP 9's Chromium 61 / Node 8.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(root, "client", "align.js"), "utf8");
const A = createRequire(import.meta.url)(join(root, "client", "align.js"));
const fixture = JSON.parse(readFileSync(join(root, "tools", "fixtures", "tts-voiceover.json"), "utf8"));

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) passed++;
  else failures.push(`${name}${detail !== undefined ? `  [${detail}]` : ""}`);
}
function eq(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}
function near(name, actual, expected, tolerance) {
  check(name, Math.abs(actual - expected) <= tolerance, `got ${actual}, expected ${expected} ± ${tolerance}`);
}
function section(name, fn) {
  try { fn(); } catch (e) { failures.push(`${name}: threw ${e && e.stack ? e.stack : e}`); }
}

/* ------------------------------------------------------------ static guard */
section("ES5 guard", () => {
  const banned = [
    [/\?\.[a-zA-Z_(\[]/, "optional chaining"], [/\?\?/, "nullish coalescing"], [/catch\s*\{/, "optional catch binding"],
    [/\.finally\(/, "Promise.prototype.finally"], [/\.flat(Map)?\(/, "Array.prototype.flat"], [/\\p\{/, "Unicode property escapes"],
    [/\bconst\b|\blet\b|=>|`/, "ES2015 syntax"], [/\.padStart\(|\.padEnd\(|\.includes\(|Object\.values|Object\.entries/, "ES2017 library calls"],
  ];
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n")
    .map((line) => line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\/\/.*$/, ""));
  code.forEach((line, n) => {
    for (const [re, what] of banned) if (re.test(line)) failures.push(`align.js:${n + 1} uses ${what}: ${SRC.split("\n")[n].trim()}`);
  });
  eq("align.js is ASCII (escapes, not literal characters)", /[^\x00-\x7e]/.test(code.join("\n")), false);
});

/* ---------------------------------------------------------------- WAV reader */
function wav({ rate = 48000, channels = 2, bits = 16, float = false, extensible = false, extraChunk = false, frames, sample }) {
  const width = bits / 8;
  const data = Buffer.alloc(frames * channels * width);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const v = sample(f, c);
      const at = (f * channels + c) * width;
      if (float && bits === 32) data.writeFloatLE(v, at);
      else if (float) data.writeDoubleLE(v, at);
      else if (bits === 8) data.writeUInt8(Math.round(v * 127 + 128), at);
      else if (bits === 16) data.writeInt16LE(Math.round(v * 32767), at);
      else if (bits === 24) data.writeIntLE(Math.round(v * 8388607), at, 3);
      else data.writeInt32LE(Math.round(v * 2147483647), at);
    }
  }
  const fmtSize = extensible ? 40 : 16;
  const fmt = Buffer.alloc(8 + fmtSize);
  fmt.write("fmt ", 0); fmt.writeUInt32LE(fmtSize, 4);
  fmt.writeUInt16LE(extensible ? 0xFFFE : (float ? 3 : 1), 8); fmt.writeUInt16LE(channels, 10);
  fmt.writeUInt32LE(rate, 12); fmt.writeUInt32LE(rate * channels * width, 16);
  fmt.writeUInt16LE(channels * width, 20); fmt.writeUInt16LE(bits, 22);
  if (extensible) { fmt.writeUInt16LE(22, 24); fmt.writeUInt16LE(bits, 26); fmt.writeUInt32LE(3, 28); fmt.writeUInt16LE(float ? 3 : 1, 32); }
  const extra = extraChunk ? Buffer.concat([Buffer.from("LIST"), Buffer.from([5, 0, 0, 0]), Buffer.from("INFOx"), Buffer.from([0])]) : Buffer.alloc(0);
  const head = Buffer.alloc(12); head.write("RIFF", 0); head.write("WAVE", 8);
  const dataHead = Buffer.alloc(8); dataHead.write("data", 0); dataHead.writeUInt32LE(data.length, 4);
  const all = Buffer.concat([head, fmt, extra, dataHead, data]);
  all.writeUInt32LE(all.length - 8, 4);
  return all;
}
function envelopeOf(buffer, chunkSize) {
  const env = new A.WavEnvelope(0.01);
  for (let i = 0; i < buffer.length; i += chunkSize) env.push(buffer.subarray(i, i + chunkSize));
  return env.finish();
}

section("WAV reader", () => {
  // 0.5 s silence, then 0.5 s of a square wave at half scale: RMS 0.5.
  const square = (f, rate) => (f < rate / 2 ? 0 : ((Math.floor(f / 24) % 2) ? 0.5 : -0.5));
  const cases = [
    ["16-bit stereo", { bits: 16 }], ["24-bit mono", { bits: 24, channels: 1 }], ["32-bit int", { bits: 32 }],
    ["8-bit", { bits: 8, channels: 1 }], ["32-bit float", { bits: 32, float: true }], ["64-bit float", { bits: 64, float: true, channels: 1 }],
    ["extensible 24-bit", { bits: 24, extensible: true }], ["extra chunk before data", { bits: 16, extraChunk: true }],
  ];
  for (const [name, opts] of cases) {
    const rate = 48000;
    const buf = wav({ rate, frames: rate, sample: (f) => square(f, rate), ...opts });
    for (const chunk of [1, 7, 4096]) {
      const e = envelopeOf(buf, chunk);
      eq(`${name} (chunks of ${chunk}): no error`, e.error, "");
      eq(`${name} (chunks of ${chunk}): 100 windows of 10 ms`, e.values.length, 100);
      near(`${name} (chunks of ${chunk}): silence`, e.values[10], 0, 0.01);
      near(`${name} (chunks of ${chunk}): loud part`, e.values[80], 0.5, 0.01);
    }
  }
  const stereoMix = envelopeOf(wav({ frames: 4800, sample: (f, c) => (c === 0 ? 0.4 : -0.4) }), 999);
  near("stereo channels mixed before measuring (opposite phase cancels)", stereoMix.values[5], 0, 0.001);
  eq("not a WAV: says so", envelopeOf(Buffer.from("hello world, not audio at all"), 5).error, "Not a WAV file");
  eq("empty: says so", new A.WavEnvelope(0.01).finish().error, "No audio in the file");
});

/* ------------------------------------------------------------ speech finder */
section("speech finder", () => {
  const step = 0.01;
  const values = [];
  const burst = (s, len, level) => { for (let i = 0; i < len; i++) values.push(level * (0.8 + 0.2 * Math.sin(i))); };
  burst(0, 50, 0.001);      // 0.0-0.5 room tone
  burst(0, 120, 0.3);       // 0.5-1.7 speech
  burst(0, 30, 0.001);      // 1.7-2.0 pause
  burst(0, 200, 0.25);      // 2.0-4.0 speech
  burst(0, 8, 0.001);       // 4.0-4.08 too short to be a pause
  burst(0, 92, 0.28);       // 4.08-5.0 speech
  burst(0, 40, 0.001);
  const sp = A.findSpeech({ step, values });
  eq("two segments (a 80 ms dip is not a pause)", sp.segments.length, 2);
  near("first starts at 0.5 s", sp.segments[0].s, 0.5, 0.03);
  near("first ends at 1.7 s", sp.segments[0].e, 1.7, 0.03);
  near("second starts at 2.0 s", sp.segments[1].s, 2.0, 0.03);
  near("second ends at 5.0 s", sp.segments[1].e, 5.0, 0.03);
  const shifted = A.findSpeech({ step, values, start: 10 });
  near("envelope start offset honoured", shifted.segments[0].s, 10.5, 0.03);
  eq("silence: no speech", A.findSpeech({ step, values: new Array(300).fill(0.0001) }).segments.length, 0);
  eq("nothing: no speech", A.findSpeech({ step, values: [] }).segments.length, 0);
});

/* -------------------------------------------------------------- line weight */
section("line weight", () => {
  const en = A.lineWeight("Hello world");
  eq("English: letters", en, 10);
  eq("punctuation counts nothing", A.lineWeight("Hello, world!!!"), 10);
  // "আমি বাংলায় কথা বলি": আ ম | ব ল য় | ক থ | ব ল — nine letters, the vowel signs and ং ride on them.
  const bn = A.lineWeight("আমি বাংলায় কথা বলি");
  near("Bengali: letters, with vowel signs riding along", bn, 9 * 2.8, 0.01);
  // "বন্ধু": ব ন ্ ধ ু = two syllables (ন্ধ is one conjunct)
  near("Bengali conjunct counts once", A.lineWeight("বন্ধু"), 2 * 2.8, 0.01);
  eq("digits are said as words", A.lineWeight("1990"), 16);
  eq("never below one", A.lineWeight("..."), 1);
  eq("spoken: words", A.isSpoken("Next one."), true);
  eq("spoken: Bengali", A.isSpoken("হ্যাঁ"), true);
  eq("not spoken: a divider", A.isSpoken("-----"), false);
  eq("not spoken: a danda", A.isSpoken(" । "), false);
  eq("not spoken: empty", A.isSpoken("  "), false);
});

/* ------------------------------------------------------ timing real speech */
section("timing real speech", () => {
  for (const [name, v] of Object.entries(fixture.variants)) {
    const env = { step: fixture.step, values: v.values };
    const sets = [["one line per subtitle", v.lines], ["two lines joined", []]];
    for (let i = 0; i < v.lines.length; i += 2) {
      const b = v.lines[i + 1];
      sets[1][1].push(b ? { text: `${v.lines[i].text} ${b.text}`, start: v.lines[i].start, end: b.end } : v.lines[i]);
    }
    for (const [label, lines] of sets) {
      const spans = A.alignLines(lines.map((l) => A.lineWeight(l.text)), env);
      eq(`${name}, ${label}: a time for every line`, spans && spans.length, lines.length);
      if (!spans) continue;
      let worst = 0;
      let worstEnd = 0;
      let sum = 0;
      spans.forEach((s, i) => {
        const e = Math.abs(s.start - lines[i].start);
        sum += e;
        worst = Math.max(worst, e);
        worstEnd = Math.max(worstEnd, Math.abs(s.end - lines[i].end));
      });
      check(`${name}, ${label}: starts within 0.05 s on average`, sum / spans.length <= 0.05, (sum / spans.length).toFixed(3));
      check(`${name}, ${label}: every start within 0.2 s`, worst <= 0.2, worst.toFixed(3));
      check(`${name}, ${label}: every end within 0.25 s`, worstEnd <= 0.25, worstEnd.toFixed(3));
      check(`${name}, ${label}: in order, never overlapping`, spans.every((s, i) => s.end > s.start && (i === 0 || s.start >= spans[i - 1].end - 1e-9)));
    }
  }

  const v = fixture.variants["story-natural"];
  const env = { step: fixture.step, values: v.values };
  const many = A.alignLines(new Array(200).fill(10), env);
  eq("more lines than speech pieces: still one time each", many.length, 200);
  check("more lines than speech pieces: spread over the speech in order", many.every((s, i) => i === 0 || s.start >= many[i - 1].start));
  eq("no lines: nothing", A.alignLines([], env).length, 0);
  eq("no speech: null", A.alignLines([5, 5], { step: 0.01, values: new Array(500).fill(0.00001) }), null);
  const one = A.alignLines([30], env);
  near("one line: from the first word", one[0].start, v.lines[0].start, 0.05);
  near("one line: to the last word", one[0].end, v.lines[v.lines.length - 1].end, 0.05);
});

/* ---------------------------------------------------- timecodes & subtitles */
section("timecodes and subtitles", () => {
  eq("format 25 fps", A.formatTimecode(3661.48, 25), "01:01:01:12");
  eq("format rounds to the frame", A.formatTimecode(1.9999, 30), "00:00:02:00");
  for (const fps of [23.976, 24, 25, 29.97, 30, 50, 59.94]) {
    for (const t of [0, 1.5, 59.96, 3599.9, 4000.04]) {
      const back = A.parseTimecode(A.formatTimecode(t, fps), fps);
      near(`round trip ${t} s at ${fps} fps`, back, t, 1 / fps / 2 + 1e-6);
    }
  }
  near("parse [HH:MM:SS:FF]", A.parseTimecode("[00:00:10:12]", 25), 10.48, 1e-9);
  near("parse ;FF", A.parseTimecode("00:01:00;15", 30), 60.5, 1e-9);
  near("parse HH:MM:SS.mmm", A.parseTimecode("00:00:04.250"), 4.25, 1e-9);
  near("parse MM:SS", A.parseTimecode("1:05"), 65, 1e-9);
  eq("parse rejects words", A.parseTimecode("soon"), null);

  eq("short subtitle stays on one line", A.wrapSubtitle("Short and sweet."), "Short and sweet.");
  eq("long subtitle splits at the middle space", A.wrapSubtitle("This line is far too long to fit on a single subtitle row"),
    "This line is far too long to\nfit on a single subtitle row");

  const cues = A.makeCues([
    { start: 5, end: 7.5, text: "Second" },
    { start: 1, end: 5.2, text: "First runs into the next" },
    { start: 7.5, text: "Third, no measured end" },
    { start: 20, text: "-----" },
  ]);
  eq("cues: sorted, dividers dropped", cues.map((c) => c.text.split(" ")[0]).join(","), "First,Second,Third,");
  near("cues: end pulled back before the next start", cues[0].end, 4.96, 1e-9);
  near("cues: measured end kept when it fits", cues[1].end, 7.46, 1e-9);
  near("cues: no end, reading time", cues[2].end, 7.5 + A.readingTime("Third, no measured end"), 1e-9);
  eq("srt time", A.srtTime(3725.0456), "01:02:05,046");
  eq("srt", A.buildSrt([{ start: 1, end: 2.5, text: "One" }, { start: 3, end: 4, text: "Two\nlines" }]),
    "1\r\n00:00:01,000 --> 00:00:02,500\r\nOne\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nTwo\r\nlines\r\n");
});

console.log("LazyKick - align.js tests\n");
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`${failures.length ? "" : "  "}${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
