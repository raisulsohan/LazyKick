/*
========================================================================
  LazyKick - Clean Rich Paste (paste.js)
  Developed By: RaisulSohan
  Website: https://raisulsohan.com
  Description: Turns HTML from the clipboard (Google Docs, Word, web pages)
               into tidy note markup: headings, paragraphs, bold, italic,
               underline and list items, in the panel's own colours.
  Copyright (c) 2026 Raisul Sohan. Free and open source under the MIT License.
========================================================================

  Nothing from the clipboard is inserted as it came: the HTML is read into
  blocks of plain text runs, and new markup is written from a short list of
  tags with no attributes (the only class names are LazyKick's own). Colours,
  fonts, sizes, links, images and scripts never reach the panel, which runs
  with Node. Styles are read the way Docs and Word write them: a bold span,
  a 20pt title, grey 10pt notes.

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

    function parseColor(value) {
        var v = String(value || "").replace(/\s+/g, "").toLowerCase();
        var m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
        if (m) {
            var h = m[1].length === 3 ? m[1].replace(/(.)/g, "$1$1") : m[1];
            return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
        }
        m = /^rgba?\((\d+),(\d+),(\d+)/.exec(v);
        if (m) return [+m[1], +m[2], +m[3]];
        var named = { black: [0, 0, 0], white: [255, 255, 255], gray: [128, 128, 128], grey: [128, 128, 128],
                      darkgray: [169, 169, 169], darkgrey: [169, 169, 169], dimgray: [105, 105, 105], dimgrey: [105, 105, 105],
                      silver: [192, 192, 192], lightgray: [211, 211, 211], lightgrey: [211, 211, 211] };
        return named.hasOwnProperty(v) ? named[v] : null;
    }

    /** The parts of an inline style that matter here, on top of `base`. */
    function readStyle(node, base) {
        var s = { b: base.b, i: base.i, u: base.u, size: base.size, color: base.color, pre: base.pre, hidden: false };
        var tag = node.nodeName;
        if (tag === "B" || tag === "STRONG") s.b = true;
        if (tag === "I" || tag === "EM" || tag === "CITE") s.i = true;
        if (tag === "U" || tag === "INS") s.u = true;
        if (tag === "PRE" || tag === "CODE") s.pre = tag === "PRE" || s.pre;
        var style = attr(node, "style").split(";");
        for (var k = 0; k < style.length; k++) {
            var colon = style[k].indexOf(":");
            if (colon < 0) continue;
            var prop = style[k].substr(0, colon).replace(/\s+/g, "").toLowerCase();
            var val = style[k].substr(colon + 1).replace(/^\s+|\s+$/g, "").toLowerCase().replace(/\s*!important$/, "");
            if (prop === "font-weight") s.b = val === "bold" || val === "bolder" || parseInt(val, 10) >= 600;
            else if (prop === "font-style") s.i = val === "italic" || val === "oblique";
            else if (prop === "text-decoration" || prop === "text-decoration-line") s.u = val.indexOf("underline") !== -1;
            else if (prop === "font-size") {
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
     * [{ kind: "h1".."h6" | "p", list: "" | "ul" | "ol", n, runs: [{ text, b, i, u, size, color }],
     *    tag: { t, e, w } for a LazyKick timecode tag at its start }]
     */
    function readBlocks(rootNode) {
        var blocks = [];
        var current = null;
        var lists = [];

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
            current.runs.push({ text: text, b: !!style.b, i: !!style.i, u: !!style.u, size: style.size, color: style.color });
        }

        function walk(node, style) {
            if (node.nodeType === 3) {
                addText(node.nodeValue, style);
                return;
            }
            if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) return;
            var tag = node.nodeName ? String(node.nodeName).toUpperCase() : "";
            if (SKIP[tag] || /^(O|V|W|ST1):/.test(tag) && tag !== "O:P") return;
            var s = node.nodeType === 1 ? readStyle(node, style) : style;
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

        walk(rootNode, { b: false, i: false, u: false, size: 0, color: null, pre: false });

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
        var sizes = [];
        for (var i = 0; i < blocks.length; i++) {
            if (blocks[i].kind !== "p") continue;
            for (var r = 0; r < blocks[i].runs.length; r++) {
                var run = blocks[i].runs[r];
                if (run.size) for (var c = 0; c < Math.min(200, run.text.length); c++) sizes.push(run.size);
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

    function runsHtml(runs, plainBold) {
        var html = "";
        for (var i = 0; i < runs.length; i++) {
            var r = runs[i];
            if (r.tag) {
                html += "<span class=\"timecode-tag\"" + (r.tag.t ? " data-t=\"" + r.tag.t + "\"" : "") + (r.tag.e ? " data-e=\"" + r.tag.e + "\"" : "") +
                        (r.tag.w ? " data-w=\"" + r.tag.w + "\"" : "") + ">" + escapeHtml(r.text) + "</span>";
                continue;
            }
            var t = escapeHtml(r.text);
            if (r.u) t = "<u>" + t + "</u>";
            if (r.i) t = "<i>" + t + "</i>";
            if (r.b && !plainBold) t = "<b>" + t + "</b>";
            html += t;
        }
        // Neighbouring runs with the same look become one.
        return html.replace(/<\/b><b>/g, "").replace(/<\/i><i>/g, "").replace(/<\/u><u>/g, "");
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
        parseColor: parseColor
    };
});
