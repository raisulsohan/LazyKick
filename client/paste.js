/*
========================================================================
  LazyKick - Clean Rich Paste (paste.js)
  Developed By: RaisulSohan
  Website: https://raisulsohan.com
  Description: Turns HTML from the clipboard (Google Docs, Word, web pages)
               into note markup that looks like the source: headings,
               paragraphs, bold, italic, underline, strikethrough, list
               items, highlights and coloured text.
  Copyright (c) 2026 Raisul Sohan. Free and open source under the MIT License.
========================================================================

  Nothing from the clipboard is inserted as it came: the HTML is read into
  blocks of plain text runs, and new markup is written from a short list of
  tags with no attributes of their own (the only class names are LazyKick's
  own). Highlight and text colours are read as numbers and written back as
  #rrggbb, fitted to the dark note: black text takes the note's colour, a
  colour too dark to read is lightened, and highlighted text is dark or
  light so it reads on its highlight. Fonts, sizes, links, images and
  scripts never reach the panel, which runs with Node. Styles are read the
  way Docs and Word write them: a bold span, a 20pt title, grey 10pt notes,
  a yellow background-color or mso-highlight.

  Works on any DOM-like tree (nodeType, nodeName, childNodes, getAttribute,
  nodeValue), so tools/test-paste.mjs can feed it without a browser.
  Plain ES5, like main.js.
*/

(function (root, factory) {
    var api = factory();
    // Always the page global: CEP's mixed Node context defines module and
    // exports on the page as well, so they cannot tell a panel from Node.
    if (root) root.LazyPaste = api;
    if (typeof module === "object" && module && module.exports) module.exports = api;
})(this, function () {
    "use strict";

    var BLOCKS = {
        P: true, DIV: true, H1: true, H2: true, H3: true, H4: true, H5: true, H6: true, LI: true, BLOCKQUOTE: true,
        PRE: true, SECTION: true, ARTICLE: true, HEADER: true, FOOTER: true, ASIDE: true, NAV: true, MAIN: true,
        FIGCAPTION: true, DT: true, DD: true, TR: true, TABLE: true, UL: true, OL: true, HR: true, ADDRESS: true
    };
    var SKIP = {
        SCRIPT: true, STYLE: true, HEAD: true, META: true, TITLE: true, LINK: true, NOSCRIPT: true, TEMPLATE: true,
        IMG: true, SVG: true, VIDEO: true, AUDIO: true, CANVAS: true, IFRAME: true, OBJECT: true, EMBED: true,
        BUTTON: true, INPUT: true, SELECT: true, TEXTAREA: true, MATH: true
    };

    function attr(node, name) {
        try { return node.getAttribute ? (node.getAttribute(name) || "") : ""; } catch (e) { return ""; }
    }

    // Table parts and the page itself: a background there is the page's, not a highlight.
    var BOXES = { TD: true, TH: true, TBODY: true, THEAD: true, TFOOT: true, BODY: true, HTML: true };

    // CSS names Word and web pages use for text colours and highlights
    // (Word writes highlights as background:yellow;mso-highlight:yellow).
    var NAMED = {
        black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128],
        darkgray: [169, 169, 169], darkgrey: [169, 169, 169], dimgray: [105, 105, 105], dimgrey: [105, 105, 105],
        silver: [192, 192, 192], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
        red: [255, 0, 0], darkred: [139, 0, 0], maroon: [128, 0, 0], brown: [165, 42, 42], orange: [255, 165, 0],
        gold: [255, 215, 0], yellow: [255, 255, 0], olive: [128, 128, 0], lime: [0, 255, 0], green: [0, 128, 0],
        darkgreen: [0, 100, 0], lightgreen: [144, 238, 144], aqua: [0, 255, 255], cyan: [0, 255, 255],
        teal: [0, 128, 128], darkcyan: [0, 139, 139], blue: [0, 0, 255], navy: [0, 0, 128], darkblue: [0, 0, 139],
        lightblue: [173, 216, 230], fuchsia: [255, 0, 255], magenta: [255, 0, 255], darkmagenta: [139, 0, 139],
        purple: [128, 0, 128], pink: [255, 192, 203]
    };
    var MARK_YELLOW = [255, 255, 0];
    var UNSIZED_PT = 12;

    /** [r, g, b] for a CSS colour, or null (unknown, or fully transparent). */
    function parseColor(value) {
        var v = String(value || "").replace(/\s+/g, "").toLowerCase();
        var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
        if (m) {
            var h = m[1].length === 3 ? m[1].replace(/(.)/g, "$1$1") : m[1];
            return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
        }
        // Chromium writes "no colour" as rgba(0, 0, 0, 0).
        m = /^rgba?\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:[,\/](\d*\.?\d+)(%?))?\)?/.exec(v);
        if (m) {
            if (m[4] !== undefined && parseFloat(m[4]) / (m[5] ? 100 : 1) < 0.1) return null;
            return [Math.min(255, Math.round(+m[1])), Math.min(255, Math.round(+m[2])), Math.min(255, Math.round(+m[3]))];
        }
        return NAMED.hasOwnProperty(v) ? NAMED[v].slice() : null;
    }

    function isNeutral(c) {
        return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) <= 24;
    }

    /**
     * A background's colour: [r, g, b]; null for none (a page's own white or
     * near-black, which every span copied from a web page carries); undefined
     * when it names no colour (transparent), so the one behind it shows.
     */
    function readBackground(value) {
        var parts = String(value).replace(/url\([^)]*\)/g, "").match(/rgba?\([^)]*\)|#[0-9a-f]+|[a-z]+/g) || [];
        for (var i = 0; i < parts.length; i++) {
            var c = parseColor(parts[i]);
            if (!c) continue;
            var max = Math.max(c[0], c[1], c[2]);
            var min = Math.min(c[0], c[1], c[2]);
            return isNeutral(c) && (min >= 0xF0 || max <= 0x40) ? null : c;
        }
        return undefined;
    }

    /**
     * Class rules from the page's own <style>, as { "p.msonormal": "declarations" }.
     * Word writes the look of its paragraph styles there, not on the text:
     * the body's 11pt is p.MsoNormal, a Title is p.MsoTitle. Only selectors
     * that are a class, or a tag with a class, are kept.
     */
    function readClassRules(rootNode) {
        var css = "";
        (function find(node) {
            if (String(node.nodeName).toUpperCase() === "STYLE") {
                css += " " + (node.textContent !== undefined ? String(node.textContent) : "");
                return;
            }
            var kids = node.childNodes || [];
            for (var i = 0; i < kids.length; i++) find(kids[i]);
        })(rootNode);
        css = css.replace(/<!--|-->/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
        var rules = {};
        var re = /([^{}]+)\{([^{}]*)\}/g;
        var m;
        while ((m = re.exec(css))) {
            var selectors = m[1].split(",");
            for (var k = 0; k < selectors.length; k++) {
                var sel = selectors[k].replace(/^\s+|\s+$/g, "").toLowerCase();
                if (/^[a-z0-9]*\.[\w-]+$/.test(sel)) rules[sel] = (rules.hasOwnProperty(sel) ? rules[sel] + ";" : "") + m[2];
            }
        }
        return rules;
    }

    /** The parts of an element's look that matter here, on top of `base`: its class rules, then its inline style. */
    function readStyle(node, base, rules) {
        var s = { b: base.b, i: base.i, u: base.u, s: base.s, size: base.size, color: base.color, bg: base.bg, pre: base.pre, hidden: false };
        var tag = node.nodeName;
        var inline = !BLOCKS[tag] && !BOXES[tag];
        if (tag === "B" || tag === "STRONG") s.b = true;
        if (tag === "I" || tag === "EM" || tag === "CITE") s.i = true;
        if (tag === "U" || tag === "INS") s.u = true;
        if (tag === "S" || tag === "STRIKE" || tag === "DEL") s.s = true;
        if (tag === "MARK") s.bg = MARK_YELLOW;
        if (tag === "FONT") {
            var fontColor = parseColor(attr(node, "color"));
            if (fontColor) s.color = fontColor;
        }
        if (tag === "PRE" || tag === "CODE") s.pre = tag === "PRE" || s.pre;
        var fromClasses = "";
        var classes = attr(node, "class").toLowerCase().split(/\s+/);
        for (var n = 0; n < classes.length && rules; n++) {
            if (!classes[n]) continue;
            var own = String(tag).toLowerCase() + "." + classes[n];
            if (rules.hasOwnProperty("." + classes[n])) fromClasses += rules["." + classes[n]] + ";";
            if (rules.hasOwnProperty(own)) fromClasses += rules[own] + ";";
        }
        var style = (fromClasses + attr(node, "style")).split(";");
        for (var k = 0; k < style.length; k++) {
            var colon = style[k].indexOf(":");
            if (colon < 0) continue;
            var prop = style[k].substr(0, colon).replace(/\s+/g, "").toLowerCase();
            var val = style[k].substr(colon + 1).replace(/^\s+|\s+$/g, "").toLowerCase().replace(/\s*!important$/, "");
            if (prop === "font-weight") s.b = val === "bold" || val === "bolder" || parseInt(val, 10) >= 600;
            else if (prop === "font-style") s.i = val === "italic" || val === "oblique";
            else if (prop === "text-decoration" || prop === "text-decoration-line") {
                s.u = val.indexOf("underline") !== -1;
                s.s = val.indexOf("line-through") !== -1;
            } else if ((prop === "background-color" || prop === "background" || prop === "mso-highlight") && inline) {
                var bg = readBackground(val);
                if (bg !== undefined) s.bg = bg;
            } else if (prop === "font-size") {
                var num = parseFloat(val);
                if (/pt$/.test(val) && num > 0) s.size = num;
                else if (/px$/.test(val) && num > 0) s.size = num * 0.75;
            } else if (prop === "color") {
                var c = parseColor(val);
                if (c) s.color = c;
            } else if (prop === "display" && val === "none") s.hidden = true;
            else if (prop === "white-space" && /pre/.test(val)) s.pre = true;
            else if (prop === "mso-hide" && val === "all") s.hidden = true;
        }
        return s;
    }

    /**
     * The clipboard tree as blocks:
     * [{ kind: "h1".."h6" | "p", list: "" | "ul" | "ol", n, runs: [{ text, b, i, u, s, size, color, bg }],
     *    tag: { t, e, w } for a LazyKick timecode tag at its start }]
     */
    function readBlocks(rootNode) {
        var blocks = [];
        var current = null;
        var lists = [];
        var rules = readClassRules(rootNode);

        function open(kind, list, n) {
            current = { kind: kind, list: list || "", n: n || 0, runs: [], tag: null };
            blocks.push(current);
        }
        function close() { current = null; }

        function addText(text, style) {
            if (!text) return;
            // Docs marks every span pre-wrap and pads with no-break spaces; in a
            // note, a run of spaces reads as one either way.
            text = text.replace(/[\s\u00A0]+/g, " ");
            if (!current) open("p");
            current.runs.push({ text: text, b: !!style.b, i: !!style.i, u: !!style.u, s: !!style.s, size: style.size, color: style.color, bg: style.bg });
        }

        function walk(node, style) {
            if (node.nodeType === 3) {
                addText(node.nodeValue, style);
                return;
            }
            if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
            var tag = node.nodeName ? String(node.nodeName).toUpperCase() : "";
            if (SKIP[tag] || /^(O|V|W|ST1):/.test(tag) && tag !== "O:P") return;
            var s = node.nodeType === 1 ? readStyle(node, style, rules) : style;
            if (s.hidden) return;

            // LazyKick's own timecode tags survive a copy inside the notes.
            if (tag === "SPAN" && /(^|\s)timecode-tag(\s|$)/.test(attr(node, "class"))) {
                if (!current) open("p");
                var num = function (name) { var v = attr(node, name); return /^-?\d+(\.\d+)?(,-?\d+(\.\d+)?)*$/.test(v) ? v : ""; };
                current.runs.push({ text: node.textContent !== undefined ? String(node.textContent) : "", tag: { t: num("data-t"), e: num("data-e"), w: num("data-w") } });
                return;
            }
            if (tag === "BR") {
                var keep = current;
                close();
                if (keep && keep.list) open("p", keep.list, 0);
                return;
            }
            if (tag === "UL" || tag === "OL") {
                close();
                lists.push({ type: tag.toLowerCase(), n: 0 });
                walkKids(node, s);
                lists.pop();
                close();
                return;
            }
            if (tag === "LI") {
                close();
                var list = lists.length ? lists[lists.length - 1] : { type: "ul", n: 0 };
                list.n++;
                open("p", list.type, list.n);
                walkKids(node, s);
                close();
                return;
            }
            if (tag === "TD" || tag === "TH") {
                if (current && current.runs.length) addText(" | ", s);
                walkKids(node, s);
                return;
            }
            if (BLOCKS[tag]) {
                close();
                if (/^H[1-6]$/.test(tag)) open(tag.toLowerCase());
                walkKids(node, s);
                close();
                return;
            }
            walkKids(node, s);
        }
        function walkKids(node, style) {
            var kids = node.childNodes || [];
            for (var i = 0; i < kids.length; i++) walk(kids[i], style);
        }

        walk(rootNode, { b: false, i: false, u: false, s: false, size: 0, color: null, bg: null, pre: false });

        // Trim, and drop blocks with nothing to show (Docs spacing paragraphs).
        // Whether a block began or ended with a space is kept: a phrase pasted
        // into a line keeps the space that separates it from its neighbours.
        var out = [];
        for (var bI = 0; bI < blocks.length; bI++) {
            var runs = blocks[bI].runs;
            var whole = runs.map(function (r) { return r.text; }).join("");
            blocks[bI].lead = /^ /.test(whole);
            blocks[bI].trail = / $/.test(whole);
            while (runs.length && !runs[0].tag && !runs[0].text.replace(/^ +/, "")) runs.shift();
            if (runs.length && !runs[0].tag) runs[0].text = runs[0].text.replace(/^ +/, "");
            while (runs.length && !runs[runs.length - 1].tag && !runs[runs.length - 1].text.replace(/ +$/, "")) runs.pop();
            if (runs.length && !runs[runs.length - 1].tag) runs[runs.length - 1].text = runs[runs.length - 1].text.replace(/ +$/, "");
            var text = runs.map(function (r) { return r.text; }).join("");
            if (text.replace(/\s+/g, "")) out.push(blocks[bI]);
        }
        return out;
    }

    function textOf(block) {
        return block.runs.map(function (r) { return r.text; }).join("");
    }

    /** The value (size or colour) that covers the most characters of a block. */
    function dominant(block, key) {
        var weight = {};
        var value = {};
        var best = null;
        for (var i = 0; i < block.runs.length; i++) {
            var r = block.runs[i];
            if (r.tag || r[key] === undefined || r[key] === null || r[key] === 0) continue;
            var k = "v" + String(r[key]);
            weight[k] = (weight[k] || 0) + r.text.replace(/\s+/g, "").length;
            value[k] = r[key];
            if (best === null || weight[k] > weight[best]) best = k;
        }
        return best === null ? null : value[best];
    }

    function isGrey(c) {
        if (!c) return false;
        var max = Math.max(c[0], c[1], c[2]);
        var min = Math.min(c[0], c[1], c[2]);
        return max - min <= 24 && max >= 0x55 && max <= 0xD0;
    }

    /**
     * Decides what each block is. Headings are kept; a paragraph set much
     * larger than the text around it is a heading too (Docs' Title style is
     * a big paragraph), and a short, all-bold line without a sentence mark
     * ("HOOK", "THE PROBLEM") is a section heading. Grey or small text is a
     * side note ("Series: ... | Target: 8-12 min").
     */
    function classify(blocks) {
        // Text with no size of its own is body text at the size a page has
        // when nothing sets one (12pt, a browser's 16px): a title set larger
        // than unsized body text is still a title.
        var sizes = [];
        for (var i = 0; i < blocks.length; i++) {
            if (blocks[i].kind !== "p") continue;
            for (var r = 0; r < blocks[i].runs.length; r++) {
                var run = blocks[i].runs[r];
                if (run.tag) continue;
                for (var c = 0; c < Math.min(200, run.text.length); c++) sizes.push(run.size || UNSIZED_PT);
            }
        }
        sizes.sort(function (a, b) { return a - b; });
        var base = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;

        for (var k = 0; k < blocks.length; k++) {
            var bl = blocks[k];
            bl.muted = false;
            if (bl.kind !== "p" || bl.list) continue;
            var size = dominant(bl, "size");
            var text = textOf(bl).replace(/^\s+|\s+$/g, "");
            var allBold = bl.runs.every(function (x) { return x.tag || x.b || !x.text.replace(/\s+/g, ""); });
            if (base && size && size >= base * 1.6) bl.kind = "h1";
            else if (base && size && size >= base * 1.25) bl.kind = "h2";
            else if (allBold && text.length <= 40 && text.split(/\s+/).length <= 5 && !/[.!?\u0964\u2026,;:]["')\]]*$/.test(text)) bl.kind = "h3";
            else if (isGrey(dominant(bl, "color")) || (base && size && size <= base * 0.85)) bl.muted = true;
        }
        return blocks;
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    var NOTE_BACKGROUND = [0x15, 0x15, 0x17]; // .rich-editor in style.css
    var DARK_TEXT = [0x11, 0x11, 0x11];
    var LIGHT_TEXT = [0xFF, 0xFF, 0xFF];

    /** WCAG contrast ratio of two [r, g, b] colours (1 to 21). */
    function contrast(a, b) {
        function lum(c) {
            var l = [];
            for (var i = 0; i < 3; i++) {
                var v = c[i] / 255;
                l.push(v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
            }
            return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
        }
        var x = lum(a);
        var y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    }

    function hex(c) {
        var out = "";
        for (var i = 0; i < 3; i++) {
            var h = Math.round(Math.max(0, Math.min(255, c[i]))).toString(16);
            out += h.length < 2 ? "0" + h : h;
        }
        return out;
    }

    /**
     * How a run shows on the dark note: { fg, bg } as "rrggbb", or "" for
     * the note's own. A highlight keeps its colour, with the text's own
     * colour on it when that reads, else black or white. Without one, black,
     * white and grey text take the note's colour, and a colour too dark to
     * read on the note is mixed with white until it reads.
     */
    function noteColours(run) {
        if (run.bg) {
            var on = run.color && contrast(run.color, run.bg) >= 3 ? run.color
                   : contrast(DARK_TEXT, run.bg) >= contrast(LIGHT_TEXT, run.bg) ? DARK_TEXT : LIGHT_TEXT;
            return { fg: hex(on), bg: hex(run.bg) };
        }
        if (!run.color || isNeutral(run.color)) return { fg: "", bg: "" };
        var c = run.color;
        for (var k = 1; k <= 20 && contrast(c, NOTE_BACKGROUND) < 4.5; k++) {
            var t = k / 20;
            c = [run.color[0] + (255 - run.color[0]) * t, run.color[1] + (255 - run.color[1]) * t, run.color[2] + (255 - run.color[2]) * t];
        }
        return { fg: hex(c), bg: "" };
    }

    /** The inline style of a colour span, from "rrggbb" values only (main.js rebuilds pasted spans with it). */
    function colourStyle(fg, bg) {
        var parts = [];
        if (/^[0-9a-f]{6}$/.test(fg || "")) parts.push("color:#" + fg);
        if (/^[0-9a-f]{6}$/.test(bg || "")) parts.push("background-color:#" + bg);
        return parts.join(";");
    }

    function runsHtml(runs, plainBold) {
        // Neighbouring runs with the same look become one.
        var looks = [];
        for (var i = 0; i < runs.length; i++) {
            var r = runs[i];
            if (r.tag) {
                looks.push(r);
                continue;
            }
            var c = noteColours(r);
            var look = { text: r.text, b: r.b && !plainBold, i: r.i, u: r.u, s: r.s, fg: c.fg, bg: c.bg };
            var last = looks.length ? looks[looks.length - 1] : null;
            if (last && !last.tag && last.b === look.b && last.i === look.i && last.u === look.u && last.s === look.s &&
                last.fg === look.fg && last.bg === look.bg) last.text += look.text;
            else looks.push(look);
        }
        var html = "";
        for (var k = 0; k < looks.length; k++) {
            var l = looks[k];
            if (l.tag) {
                html += "<span class=\"timecode-tag\"" + (l.tag.t ? " data-t=\"" + l.tag.t + "\"" : "") + (l.tag.e ? " data-e=\"" + l.tag.e + "\"" : "") +
                        (l.tag.w ? " data-w=\"" + l.tag.w + "\"" : "") + ">" + escapeHtml(l.text) + "</span>";
                continue;
            }
            var t = escapeHtml(l.text);
            // The colour sits innermost, so the note's white bold does not cover it.
            if (l.fg || l.bg) {
                t = "<span class=\"note-color\"" + (l.fg ? " data-fg=\"" + l.fg + "\"" : "") + (l.bg ? " data-bg=\"" + l.bg + "\"" : "") +
                    " style=\"" + colourStyle(l.fg, l.bg) + "\">" + t + "</span>";
            }
            if (l.s) t = "<s>" + t + "</s>";
            if (l.u) t = "<u>" + t + "</u>";
            if (l.i) t = "<i>" + t + "</i>";
            if (l.b) t = "<b>" + t + "</b>";
            html += t;
        }
        return html.replace(/<\/b><b>/g, "").replace(/<\/i><i>/g, "").replace(/<\/u><u>/g, "").replace(/<\/s><s>/g, "");
    }

    /**
     * Note markup for the clipboard tree: { html, blocks, inline }. One
     * plain paragraph comes back inline, so pasting a phrase into a line
     * does not break the line; anything more is one block per line.
     */
    function toNoteHtml(rootNode) {
        var blocks = classify(readBlocks(rootNode));
        if (blocks.length === 1 && blocks[0].kind === "p" && !blocks[0].list && !blocks[0].muted) {
            // A no-break space at the edges: the browser drops plain ones there.
            return { html: (blocks[0].lead ? "&nbsp;" : "") + runsHtml(blocks[0].runs, false) + (blocks[0].trail ? "&nbsp;" : ""), blocks: 1, inline: true };
        }
        var out = [];
        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            if (/^h[1-6]$/.test(b.kind)) {
                var level = Math.min(3, parseInt(b.kind.substr(1), 10));
                out.push("<h" + level + ">" + runsHtml(b.runs, true) + "</h" + level + ">");
            } else if (b.list) {
                var bullet = b.list === "ol" ? (b.n ? b.n + ". " : "") : (b.n ? "\u2022 " : "");
                out.push("<p class=\"note-li\">" + escapeHtml(bullet) + runsHtml(b.runs, false) + "</p>");
            } else {
                out.push("<p" + (b.muted ? " class=\"note-muted\"" : "") + ">" + runsHtml(b.runs, false) + "</p>");
            }
        }
        return { html: out.join(""), blocks: blocks.length, inline: false };
    }

    return {
        readBlocks: readBlocks,
        classify: classify,
        toNoteHtml: toNoteHtml,
        parseColor: parseColor,
        contrast: contrast,
        colourStyle: colourStyle
    };
});
