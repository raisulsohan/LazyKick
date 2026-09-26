/*
 * LazyKick — builds tools/fixtures/tts-voiceover.json (developer tool, Windows).
 *
 *   node tools/make-tts-fixture.mjs
 *
 * Makes real voiceovers with Windows' own speech voices (System.Speech):
 * each line is spoken on its own, then the lines are joined with pauses of
 * different lengths, the way a person reads a script. Because the pieces are
 * joined here, the true start and end of every line is known to the sample.
 * Each voiceover is written as a WAV and read back through
 * LazyAlign.WavEnvelope (so the WAV reader is exercised on a real file), and
 * the loudness envelope plus the true times are saved for tools/test-align.mjs.
 *
 * Two scripts:
 *   explainer  one sentence per line, two voices, speed varied line by line;
 *              the alignment weights in client/align.js were tuned on it
 *   story      held out (never tuned on): one voice, sentences broken into
 *              subtitle-length lines at commas, so many line ends fall on a
 *              short breath rather than a sentence pause
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, createReadStream, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LazyAlign = createRequire(import.meta.url)(join(root, "client", "align.js"));
const RATE_HZ = 16000;
const ZIRA = "Microsoft Zira Desktop";
const DAVID = "Microsoft David Desktop";

const SCRIPTS = {
  explainer: {
    lines: [
      "Welcome back to the channel.",
      "Today we are looking at why the sky is blue, and why sunsets turn red.",
      "Sunlight looks white, but it is a mix of every colour.",
      "When it reaches the air, it hits tiny molecules of nitrogen and oxygen.",
      "Blue light has a short wavelength.",
      "So it bounces around far more than red light does, in every direction.",
      "That scattered blue light reaches your eyes from all over the sky.",
      "At sunset, the light travels through much more air.",
      "Most of the blue is scattered away before it arrives.",
      "What is left is orange and red.",
      "It is the same physics, just a longer path.",
      "Thanks for watching, and see you in the next one.",
    ],
    pauses: [650, 420, 800, 300, 550, 380, 900, 450, 280, 700, 500],
    rates: [0, 1, -1, 0, 2, 1, -1, 0, 1, -2, 0, 1],
    voices: [ZIRA, DAVID],
    variants: { natural: {}, tight: { tight: true }, music: { music: true } },
  },
  story: {
    // "," at a line end: the sentence goes on, so only a breath follows.
    lines: [
      "In the winter of nineteen ninety,",
      "a small probe was already far beyond Neptune.",
      "Its cameras had been switched off for years,",
      "to save power for the long trip ahead.",
      "Then one engineer asked a simple question.",
      "What if we turned it around,",
      "and took one last picture of home?",
      "The answer was a single pale dot,",
      "less than a pixel wide,",
      "floating in a beam of scattered sunlight.",
      "Every person you have ever known lived there.",
      "That is why the picture still matters.",
    ],
    pauses: [160, 520, 190, 610, 450, 150, 700, 200, 170, 560, 480],
    rates: [0, 0, 1, 0, 0, 1, 0, 0, 0, -1, 0, 0],
    voices: [ZIRA],
    variants: { natural: {}, music: { music: true } },
  },
};

function synthesize(dir, name, script) {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(" + RATE_HZ + ", [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    ...script.lines.map((text, i) => [
      `$s.SelectVoice('${script.voices[i % script.voices.length]}')`,
      `$s.Rate = ${script.rates[i]}`,
      "$ms = New-Object System.IO.MemoryStream",
      "$s.SetOutputToAudioStream($ms, $fmt)",
      `$s.Speak('${text.replace(/'/g, "''")}')`,
      "$s.SetOutputToNull()",
      `[System.IO.File]::WriteAllBytes('${join(dir, `${name}${i}.pcm`).replace(/'/g, "''")}', $ms.ToArray())`,
    ].join("\n")),
    "$s.Dispose()",
  ].join("\n");
  const encoded = Buffer.from(ps, "utf16le").toString("base64");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { stdio: ["ignore", "inherit", "inherit"] });
  return script.lines.map((_, i) => readFileSync(join(dir, `${name}${i}.pcm`)));
}

/** First and last sample louder than digital silence. */
function voiced(samples) {
  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) > 300) {
      if (first < 0) first = i;
      last = i;
    }
  }
  return [Math.max(first, 0), last + 1];
}

function wavHeader(dataBytes) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + dataBytes, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE_HZ, 24); h.writeUInt32LE(RATE_HZ * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(dataBytes, 40);
  return h;
}

/**
 * Joins the spoken lines into one voiceover and returns its samples and the
 * true time of every line.
 *   tight: cut each line to its voice and leave only 150–260 ms between
 *          lines, about the length of a breath at a comma (a fast read)
 *   music: add a music bed about 20 dB under the voice, so the pauses are
 *          quieter but never silent
 */
function joinLines(script, pcms, { tight = false, music = false } = {}) {
  const lead = new Int16Array(Math.round(RATE_HZ * 1.2));
  const parts = [lead];
  const truth = [];
  let at = lead.length;
  pcms.forEach((pcm, i) => {
    let samples = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    let [a, b] = voiced(samples);
    if (tight) {
      samples = samples.slice(a, b);
      b -= a;
      a = 0;
    }
    truth.push({ text: script.lines[i], start: +((at + a) / RATE_HZ).toFixed(3), end: +((at + b) / RATE_HZ).toFixed(3) });
    parts.push(samples);
    at += samples.length;
    if (i < pcms.length - 1) {
      const ms = tight ? 150 + ((i * 37) % 110) : script.pauses[i];
      const pause = new Int16Array(Math.round(RATE_HZ * ms / 1000));
      parts.push(pause);
      at += pause.length;
    }
  });
  parts.push(new Int16Array(RATE_HZ));
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  for (let i = 0; i < out.length; i++) {
    // Room noise, so the silence is never digital zero.
    let v = out[i] + (((i * 7919) % 997) / 997 - 0.5) * 40;
    if (music) {
      const t = i / RATE_HZ;
      const chord = Math.sin(2 * Math.PI * 220 * t) + 0.7 * Math.sin(2 * Math.PI * 277.2 * t) + 0.5 * Math.sin(2 * Math.PI * 329.6 * t);
      v += chord * (0.75 + 0.25 * Math.sin(2 * Math.PI * 0.5 * t)) * 700;
    }
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v)));
  }
  return { samples: out, truth };
}

async function envelopeOf(samples, dir, name) {
  const data = Buffer.from(samples.buffer, samples.byteOffset, samples.length * 2);
  const wav = join(dir, `${name}.wav`);
  writeFileSync(wav, Buffer.concat([wavHeader(data.length), data]));
  const env = new LazyAlign.WavEnvelope(0.01);
  await new Promise((done, fail) => {
    createReadStream(wav, { highWaterMark: 7777 }) // odd size: frames split across chunks
      .on("data", (chunk) => env.push(chunk))
      .on("end", done)
      .on("error", fail);
  });
  const envelope = env.finish();
  if (envelope.error) throw new Error(envelope.error);
  return envelope;
}

const work = mkdtempSync(join(tmpdir(), "lazykick-tts-"));
try {
  const variants = {};
  for (const [name, script] of Object.entries(SCRIPTS)) {
    const pcms = synthesize(work, name, script);
    for (const [variant, opts] of Object.entries(script.variants)) {
      const { samples, truth } = joinLines(script, pcms, opts);
      const envelope = await envelopeOf(samples, work, `${name}-${variant}`);
      variants[`${name}-${variant}`] = {
        duration: +envelope.duration.toFixed(3),
        values: envelope.values.map((v) => +v.toPrecision(3)),
        lines: truth,
      };
      console.log(`${name}-${variant}: ${envelope.values.length} values, ${envelope.duration.toFixed(1)} s`);
    }
  }
  const out = join(root, "tools", "fixtures", "tts-voiceover.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({
    about: "Windows System.Speech voiceovers with true line times measured from the joined samples. Built by tools/make-tts-fixture.mjs; see its header for the scripts and variants.",
    step: 0.01,
    variants,
  }) + "\n");
  console.log(`wrote ${out}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
