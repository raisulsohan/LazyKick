/*
========================================================================
  LazyKick — Script-to-Audio Alignment (align.js)
  Developed By: RaisulSohan
  Website: https://raisulsohan.com
  Description: Times the lines of a note to a voiceover, and turns timed
               lines into subtitles.
  Copyright (c) 2026 Raisul Sohan. Free and open source under the MIT License.
========================================================================

  No speech recognition and no downloads: the voiceover's pauses are found
  from its loudness, and the lines are laid over the speech between them in
  proportion to how long each line takes to say. That works for any language
  (Bengali included) as long as the audio follows the script, which is what a
  read voiceover does. Every function is pure, so tools/test-align.mjs runs
  them in plain Node; the panel loads this file before main.js.

  Same rules as main.js: plain ES5 for CEP 9's Chromium 61 / Node 8.
*/

(function (root, factory) {
    var api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.LazyAlign = api;
})(this, function () {
    "use strict";

    // ============================================================
    // WAV loudness envelope (streamed, so a long mix never sits in memory)
    // ============================================================

    /**
     * Feed a WAV file chunk by chunk (Node Buffers or Uint8Arrays), then call
     * finish() for { step, values, duration }: the RMS loudness of each
     * `windowSeconds` slice, all channels mixed. PCM 8/16/24/32-bit and
     * 32/64-bit float, including WAVE_FORMAT_EXTENSIBLE, as Premiere writes.
     */
    function WavEnvelope(windowSeconds) {
        this.windowSeconds = windowSeconds || 0.01;
        this.head = null;       // bytes kept until the header is complete
        this.format = null;
        this.carry = null;      // part of a sample frame split across chunks
        this.remaining = 0;     // data bytes still expected (Infinity if unknown)
        this.values = [];
        this.sum = 0;
        this.count = 0;
        this.error = "";
    }

    function concatBytes(a, b) {
        if (!a || !a.length) return b;
        var out = new Uint8Array(a.length + b.length);
        out.set(a, 0);
        out.set(b, a.length);
        return out;
    }

    function ascii(bytes, at, n) {
        var s = "";
        for (var i = 0; i < n; i++) s += String.fromCharCode(bytes[at + i]);
        return s;
    }

    function u16(bytes, at) { return bytes[at] | (bytes[at + 1] << 8); }
    function u32(bytes, at) { return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)) + bytes[at + 3] * 16777216; }

    /** Reads the header once the "data" chunk starts; returns the offset of the first sample, or -1 for "need more". */
    WavEnvelope.prototype.readHeader = function (bytes) {
        if (bytes.length < 12) return -1;
        var riff = ascii(bytes, 0, 4);
        if ((riff !== "RIFF" && riff !== "RF64") || ascii(bytes, 8, 4) !== "WAVE") {
            this.error = "Not a WAV file";
            return -2;
        }
        var at = 12;
        while (at + 8 <= bytes.length) {
            var id = ascii(bytes, at, 4);
            var size = u32(bytes, at + 4);
            if (id === "data") {
                if (!this.format) {
                    this.error = "WAV data before its format";
                    return -2;
                }
                this.remaining = (size === 0 || size === 0xFFFFFFFF || riff === "RF64") ? Infinity : size;
                return at + 8;
            }
            if (at + 8 + size > bytes.length) return -1;
            if (id === "fmt ") {
                var tag = u16(bytes, at + 8);
                var bits = u16(bytes, at + 22);
                if (tag === 0xFFFE && size >= 26) tag = u16(bytes, at + 32); // extensible: sub-format
                this.format = {
                    tag: tag,
                    channels: u16(bytes, at + 10),
                    rate: u32(bytes, at + 12),
                    bits: bits,
                    frameBytes: u16(bytes, at + 20)
                };
                if (!this.format.channels || !this.format.rate || (tag !== 1 && tag !== 3)) {
                    this.error = "Unsupported WAV format";
                    return -2;
                }
                if (!this.format.frameBytes) this.format.frameBytes = this.format.channels * (bits >> 3);
                this.windowFrames = Math.max(1, Math.round(this.format.rate * this.windowSeconds));
            }
            at += 8 + size + (size & 1);
        }
        return -1;
    };

    WavEnvelope.prototype.push = function (chunk) {
        if (this.error) return;
        var bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
        if (!this.format || this.head) {
            this.head = concatBytes(this.head, bytes);
            var start = this.readHeader(this.head);
            if (start === -1) return;
            if (start < 0) {
                this.head = null;
                return;
            }
            bytes = this.head.subarray(start);
            this.head = null;
        }
        // Count only new bytes against the data size, then join the part
        // frame left over from the last chunk.
        if (this.remaining !== Infinity) {
            if (this.remaining <= 0) return;
            if (bytes.length > this.remaining) bytes = bytes.subarray(0, this.remaining);
            this.remaining -= bytes.length;
        }
        if (this.carry) {
            bytes = concatBytes(this.carry, bytes);
            this.carry = null;
        }

        var f = this.format;
        var frame = f.frameBytes;
        var usable = bytes.length - (bytes.length % frame);
        if (usable < bytes.length) this.carry = bytes.slice(usable);
        var view = new DataView(bytes.buffer, bytes.byteOffset, usable);
        var width = f.bits >> 3;
        var channels = f.channels;
        var perWindow = this.windowFrames;
        for (var off = 0; off < usable; off += frame) {
            var mix = 0;
            for (var c = 0; c < channels; c++) {
                var p = off + c * width;
                var v;
                if (f.tag === 3) {
                    v = width === 8 ? view.getFloat64(p, true) : view.getFloat32(p, true);
                } else if (width === 2) {
                    v = view.getInt16(p, true) / 32768;
                } else if (width === 3) {
                    var n = bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16);
                    v = (n & 0x800000 ? n - 0x1000000 : n) / 8388608;
                } else if (width === 4) {
                    v = view.getInt32(p, true) / 2147483648;
                } else {
                    v = (bytes[p] - 128) / 128;
                }
                mix += v;
            }
            mix /= channels;
            this.sum += mix * mix;
            if (++this.count === perWindow) {
                this.values.push(Math.sqrt(this.sum / this.count));
                this.sum = 0;
                this.count = 0;
            }
        }
    };

    WavEnvelope.prototype.finish = function () {
        if (this.count > 0) {
            this.values.push(Math.sqrt(this.sum / this.count));
            this.sum = 0;
            this.count = 0;
        }
        var step = this.format ? this.windowFrames / this.format.rate : this.windowSeconds;
        return { step: step, values: this.values, duration: this.values.length * step, error: this.error || (this.format ? "" : "No audio in the file") };
    };

    // ============================================================
    // Speech and pauses
    // ============================================================

    function percentile(sorted, q) {
        if (!sorted.length) return 0;
        var i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
        return sorted[i];
    }

    function toDb(values, step, smoothSeconds) {
        var db = new Array(values.length);
        for (var i = 0; i < values.length; i++) db[i] = 20 * Math.log(Math.max(values[i], 1e-7)) / Math.LN10;
        var half = Math.max(0, Math.round((smoothSeconds / step - 1) / 2));
        if (!half) return db;
        var out = new Array(db.length);
        var sum = 0;
        var lo = 0;
        var hi = -1;
        for (var k = 0; k < db.length; k++) {
            while (hi < Math.min(db.length - 1, k + half)) sum += db[++hi];
            while (lo < k - half) sum -= db[lo++];
            out[k] = sum / (hi - lo + 1);
        }
        return out;
    }

    /**
     * Where the voice is. envelope: { step, values, start? } (values are
     * linear loudness, any scale). Returns { segments: [{ s, e }],
     * dips: [seconds] } in seconds from the envelope's start. Dips are the
     * quietest moments inside long stretches of speech: breaths too short to
     * count as pauses, used only when there are more lines than pauses.
     */
    function findSpeech(envelope, opts) {
        opts = opts || {};
        var step = envelope.step;
        var t0 = envelope.start || 0;
        var minPause = opts.minPause || 0.12;
        var minSpeech = opts.minSpeech || 0.08;
        var db = toDb(envelope.values || [], step, opts.smooth || 0.05);
        var result = { segments: [], dips: [], floor: 0, peak: 0 };
        if (!db.length) return result;

        var sorted = db.slice().sort(function (a, b) { return a - b; });
        var floor = percentile(sorted, 0.1);
        var peak = percentile(sorted, 0.95);
        result.floor = floor;
        result.peak = peak;
        if (peak - floor < 6) {
            // No real dynamics: one stretch over everything above the floor.
            var first = -1;
            var last = -1;
            for (var q = 0; q < db.length; q++) {
                if (db[q] > floor + 1) {
                    if (first < 0) first = q;
                    last = q;
                }
            }
            if (first >= 0) result.segments.push({ s: t0 + first * step, e: t0 + (last + 1) * step });
            return result;
        }

        var on = floor + 0.38 * (peak - floor);
        var off = floor + 0.28 * (peak - floor);
        var raw = [];
        var inSpeech = false;
        var begin = 0;
        for (var i = 0; i < db.length; i++) {
            if (!inSpeech && db[i] >= on) {
                inSpeech = true;
                begin = i;
            } else if (inSpeech && db[i] < off) {
                inSpeech = false;
                raw.push([begin, i]);
            }
        }
        if (inSpeech) raw.push([begin, db.length]);

        // Close gaps too short to be a pause, then drop clicks.
        var merged = [];
        for (var r = 0; r < raw.length; r++) {
            var prev = merged[merged.length - 1];
            if (prev && (raw[r][0] - prev[1]) * step < minPause) prev[1] = raw[r][1];
            else merged.push([raw[r][0], raw[r][1]]);
        }
        for (var m = 0; m < merged.length; m++) {
            var a = merged[m][0];
            var b = merged[m][1];
            if ((b - a) * step < minSpeech) continue;
            result.segments.push({ s: t0 + a * step, e: t0 + b * step });

            // Breaths inside long speech: local minima well below its level.
            if ((b - a) * step < 1.0) continue;
            var inside = db.slice(a, b).sort(function (x, y) { return x - y; });
            var level = percentile(inside, 0.5);
            var edge = Math.round(0.25 / step);
            var gap = Math.round(0.35 / step);
            var lastDip = -Infinity;
            for (var k = a + edge; k < b - edge; k++) {
                if (db[k] > level - 6 || db[k] > db[k - 1] || db[k] > db[k + 1]) continue;
                if (k - lastDip < gap) continue;
                result.dips.push(t0 + k * step);
                lastDip = k;
            }
        }
        return result;
    }

    // ============================================================
    // How long a line takes to say
    // ============================================================

    function inRange(code, ranges) {
        for (var i = 0; i < ranges.length; i += 2) {
            if (code >= ranges[i] && code <= ranges[i + 1]) return true;
        }
        return false;
    }

    // Indic scripts: vowel signs and marks ride on a letter; a virama joins
    // two consonants into one sound. Bengali and Devanagari are listed.
    var INDIC_MARKS = [0x0900, 0x0903, 0x093A, 0x094F, 0x0951, 0x0957, 0x0962, 0x0963,
                       0x0981, 0x0983, 0x09BC, 0x09BC, 0x09BE, 0x09CC, 0x09D7, 0x09D7, 0x09E2, 0x09E3];
    var INDIC_VIRAMA = [0x094D, 0x094D, 0x09CD, 0x09CD];
    var INDIC_LETTERS = [0x0904, 0x0939, 0x0958, 0x0961, 0x0972, 0x097F,
                         0x0985, 0x09B9, 0x09CE, 0x09CE, 0x09DC, 0x09DF, 0x09F0, 0x09F1];
    var INDIC_DIGITS = [0x0966, 0x096F, 0x09E6, 0x09EF];
    var CJK = [0x3040, 0x30FF, 0x3400, 0x9FFF, 0xAC00, 0xD7AF];

    /**
     * A rough spoken length, in "Latin letters": English runs about 14
     * letters a second. An Indic syllable (a letter with its vowel sign) or a
     * CJK character is one syllable, about 2.8 letters; a digit is said as a
     * word. Punctuation counts nothing: pauses are measured, not guessed.
     */
    function lineWeight(text) {
        var s = String(text || "");
        var w = 0;
        for (var i = 0; i < s.length; i++) {
            var code = s.charCodeAt(i);
            if (inRange(code, INDIC_MARKS)) continue;
            if (inRange(code, INDIC_VIRAMA)) {
                w -= 2.8; // the next consonant joins this one
                continue;
            }
            if (inRange(code, INDIC_LETTERS) || inRange(code, CJK)) w += 2.8;
            else if ((code >= 48 && code <= 57) || inRange(code, INDIC_DIGITS)) w += 4;
            else if (/[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF\u0600-\u06FF]/.test(s.charAt(i))) w += 1;
        }
        return Math.max(1, w);
    }

    /** Whether a line has anything to say (not just "---" or a lone symbol). */
    function isSpoken(text) {
        return String(text || "").replace(/[\s\u00A0\u2000-\u206F\u2E00-\u2E7F\u3000-\u303F\u0964\u0965!-\/:-@\[-\x60{-~]/g, "").length > 0;
    }

    // ============================================================
    // Lines over speech
    // ============================================================

    /**
     * Split the speech into pieces at every pause and dip. A piece boundary is
     * a place a line may end: { gap: pause length (0 for a dip), end: where
     * the speech before it stops, start: where the speech after it starts }.
     */
    function speechPieces(speech) {
        var segs = speech.segments;
        var dips = speech.dips.slice().sort(function (a, b) { return a - b; });
        var pieces = [];
        var d = 0;
        for (var k = 0; k < segs.length; k++) {
            var from = segs[k].s;
            while (d < dips.length && dips[d] <= from) d++;
            for (; d < dips.length && dips[d] < segs[k].e; d++) {
                pieces.push({ s: from, e: dips[d], cutAfter: { gap: 0, dip: true } });
                from = dips[d];
            }
            var next = segs[k + 1];
            pieces.push({ s: from, e: segs[k].e, cutAfter: next ? { gap: next.s - segs[k].e, dip: false } : null });
        }
        return pieces;
    }

    /** Evenly by weight over the whole span, for when there is too little to go on. */
    function proportional(weights, start, end) {
        var total = 0;
        for (var i = 0; i < weights.length; i++) total += weights[i];
        var out = [];
        var t = start;
        for (var j = 0; j < weights.length; j++) {
            var len = (end - start) * weights[j] / total;
            out.push({ start: t, end: t + len });
            t += len;
        }
        return out;
    }

    /**
     * Times for each line: [{ start, end }] in seconds from the envelope's
     * start. weights: lineWeight() of each line, in reading order.
     *
     * Dynamic programming over the speech pieces picks where each line ends so
     * that every line's share of the speech matches its expected share (the
     * log of the ratio, squared), with a reward for ending on a long pause and
     * a cost for ending on a breath. Lines stay in order and cover the speech
     * exactly once.
     */
    function alignLines(weights, envelope, opts) {
        opts = opts || {};
        var n = weights.length;
        if (!n) return [];
        var speech = envelope.segments ? envelope : findSpeech(envelope, opts);
        var segs = speech.segments;
        if (!segs.length) return null;
        var pieces = speechPieces(speech);
        var K = pieces.length;
        var first = segs[0].s;
        var lastEnd = segs[segs.length - 1].e;
        if (K < n) return proportional(weights, first, lastEnd);

        var cum = [0];
        for (var p = 0; p < K; p++) cum.push(cum[p] + (pieces[p].e - pieces[p].s));
        var totalSpeech = cum[K];
        var totalWeight = 0;
        for (var w = 0; w < n; w++) totalWeight += weights[w];

        // Weights picked from the middle of the range that timed every
        // voiceover in tools/fixtures to within a few frames (see test-align).
        var FIT = opts.fit !== undefined ? opts.fit : 4;          // how much a wrong share costs
        var PAUSE = opts.pause !== undefined ? opts.pause : 0.6;  // how much ending on a pause is worth
        var BREATH = opts.breath !== undefined ? opts.breath : 1.5; // how much ending on a breath costs
        // How much drifting from the script's pace costs: a line boundary
        // should fall about where that much of the script has been read.
        var DRIFT = opts.drift !== undefined ? opts.drift : 2;
        var driftScale = Math.max(1, 0.05 * totalSpeech);
        var readBefore = [0];
        for (var rb = 0; rb < n; rb++) readBefore.push(readBefore[rb] + weights[rb] / totalWeight * totalSpeech);
        function cutCost(piece) {
            var cut = piece.cutAfter;
            if (!cut) return 0;
            if (cut.dip) return BREATH;
            return -PAUSE * Math.log(1 + cut.gap / 0.25);
        }

        // best[i][k]: lowest cost for lines 0..i-1 over pieces 0..k-1.
        var INF = Infinity;
        var best = [];
        var from = [];
        for (var i = 0; i <= n; i++) {
            best.push(new Array(K + 1));
            from.push(new Array(K + 1));
            for (var z = 0; z <= K; z++) best[i][z] = INF;
        }
        best[0][0] = 0;
        for (var line = 1; line <= n; line++) {
            var expected = totalSpeech * weights[line - 1] / totalWeight;
            var maxK = K - (n - line);
            for (var k = line; k <= maxK; k++) {
                var tail = 0;
                if (line < n) {
                    var off = (cum[k] - readBefore[line]) / driftScale;
                    tail = cutCost(pieces[k - 1]) + DRIFT * off * off;
                }
                for (var j = k - 1; j >= line - 1; j--) {
                    var d = cum[k] - cum[j];
                    if (d > expected * 6 && j < k - 1) break; // far too long already
                    if (best[line - 1][j] === INF) continue;
                    var r = Math.log(Math.max(d, 0.02) / Math.max(expected, 0.02));
                    var cost = best[line - 1][j] + FIT * r * r + tail;
                    if (cost < best[line][k]) {
                        best[line][k] = cost;
                        from[line][k] = j;
                    }
                }
            }
        }
        if (best[n][K] === INF) return proportional(weights, first, lastEnd);

        var spans = [];
        var at = K;
        for (var back = n; back >= 1; back--) {
            var j0 = from[back][at];
            spans.unshift({ start: pieces[j0].s, end: pieces[at - 1].e });
            at = j0;
        }
        return spans;
    }

    // ============================================================
    // Timecodes and subtitles
    // ============================================================

    function pad(n, size) {
        var s = String(n);
        while (s.length < size) s = "0" + s;
        return s;
    }

    /** HH:MM:SS:FF, counting whole frames of the nominal rate (as non-drop timecode does). */
    function formatTimecode(seconds, fps) {
        var nominal = Math.round(fps) || 30;
        var frames = Math.max(0, Math.round(seconds * (fps || 30)));
        var ff = frames % nominal;
        var total = Math.floor(frames / nominal);
        return pad(Math.floor(total / 3600), 2) + ":" + pad(Math.floor(total / 60) % 60, 2) + ":" + pad(total % 60, 2) + ":" + pad(ff, 2);
    }

    /**
     * Seconds from a timecode as people type or LazyKick writes them:
     * HH:MM:SS:FF (also ;FF), HH:MM:SS.mmm, HH:MM:SS, MM:SS, with or without
     * brackets. null when it is not one.
     */
    function parseTimecode(text, fps) {
        var s = String(text || "").replace(/[\[\]\s]/g, "");
        var m = /^(\d{1,2})[:;](\d{1,2})[:;](\d{1,2})[:;](\d{1,3})$/.exec(s); // ";" too: drop-frame display
        var rate = fps || 30;
        // The inverse of formatTimecode: frames of the nominal rate, played at the real one.
        if (m) return (((+m[1] * 60 + +m[2]) * 60 + +m[3]) * (Math.round(rate) || 30) + +m[4]) / rate;
        m = /^(?:(\d{1,2}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s);
        if (m) return ((+(m[1] || 0) * 60 + +m[2]) * 60 + +m[3]) + (m[4] ? +("0." + m[4]) : 0);
        return null;
    }

    /** About how long a line is on screen when nothing else says: reading speed, at least 1.2 s. */
    function readingTime(text) {
        return Math.max(1.2, lineWeight(text) / 15 + 0.3);
    }

    /** One line, or two at the space nearest the middle when it is longer than `max`. */
    function wrapSubtitle(text, max) {
        var s = String(text || "").replace(/\s+/g, " ").replace(/^ | $/g, "");
        max = max || 42;
        if (s.length <= max) return s;
        var mid = Math.floor(s.length / 2);
        var bestAt = -1;
        for (var i = 0; i < s.length; i++) {
            if (s.charAt(i) === " " && (bestAt < 0 || Math.abs(i - mid) < Math.abs(bestAt - mid))) bestAt = i;
        }
        return bestAt < 0 ? s : s.substr(0, bestAt) + "\n" + s.substr(bestAt + 1);
    }

    /**
     * Subtitle cues from timed lines [{ start, end?, text }] (seconds): each
     * ends where it was measured to end, but never runs into the next one,
     * and a line without a measured end stays up for its reading time.
     */
    function makeCues(lines) {
        var sorted = lines.filter(function (l) { return l && typeof l.start === "number" && isFinite(l.start) && isSpoken(l.text); })
            .sort(function (a, b) { return a.start - b.start; });
        var cues = [];
        for (var i = 0; i < sorted.length; i++) {
            var l = sorted[i];
            var next = sorted[i + 1];
            var end = (typeof l.end === "number" && l.end > l.start + 0.1) ? l.end : l.start + readingTime(l.text);
            if (next) end = Math.min(end, next.start - 0.04);
            if (next && end - l.start < 0.5) end = Math.max(end, Math.min(l.start + 0.5, next.start));
            if (end <= l.start) continue;
            cues.push({ start: Math.max(0, l.start), end: end, text: wrapSubtitle(l.text) });
        }
        return cues;
    }

    function srtTime(seconds) {
        var ms = Math.max(0, Math.round(seconds * 1000));
        return pad(Math.floor(ms / 3600000), 2) + ":" + pad(Math.floor(ms / 60000) % 60, 2) + ":" +
               pad(Math.floor(ms / 1000) % 60, 2) + "," + pad(ms % 1000, 3);
    }

    function buildSrt(cues) {
        var out = [];
        for (var i = 0; i < cues.length; i++) {
            out.push(String(i + 1), srtTime(cues[i].start) + " --> " + srtTime(cues[i].end), cues[i].text.replace(/\r?\n/g, "\r\n"), "");
        }
        return out.join("\r\n");
    }

    return {
        WavEnvelope: WavEnvelope,
        findSpeech: findSpeech,
        lineWeight: lineWeight,
        isSpoken: isSpoken,
        alignLines: alignLines,
        formatTimecode: formatTimecode,
        parseTimecode: parseTimecode,
        readingTime: readingTime,
        wrapSubtitle: wrapSubtitle,
        makeCues: makeCues,
        srtTime: srtTime,
        buildSrt: buildSrt
    };
});
