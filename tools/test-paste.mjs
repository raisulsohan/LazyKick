/*
 * LazyKick — clean rich paste tests (client/paste.js).
 *
 *   node tools/test-paste.mjs
 *
 * Feeds paste.js the HTML that Google Docs, Word and web pages put on the
 * clipboard (parsed by tools/mini-html.mjs, standing in for the browser's
 * DOMParser) and checks what reaches the notes: headings, paragraphs, bold,
 * italic, underline, strikethrough, list items, side notes, highlights and
 * coloured text (fitted to the dark note), and nothing else — no fonts,
 * links, images, scripts or attributes but LazyKick's own. Also a guard that
 * paste.js stays within CEP 9's Chromium 61.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parseHtml } from "./mini-html.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = readFileSync(join(root, "client", "paste.js"), "utf8");
const P = createRequire(import.meta.url)(join(root, "client", "paste.js"));

let passed = 0;
const failures = [];
function check(name, condition, detail) {
  if (condition) passed++;
  else failures.push(`${name}${detail !== undefined ? `  [${detail}]` : ""}`);
}
function eq(name, actual, expected) {
  check(name, actual === expected, `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

const paste = (html) => P.toNoteHtml(parseHtml(html));

// The only attributes paste.js may write: LazyKick's classes, and colour spans built from hex values.
const SAFE_COLOUR_SPAN = /<span class="note-color"( data-fg="[0-9a-f]{6}")?( data-bg="[0-9a-f]{6}")? style="color:#[0-9a-f]{6}(;background-color:#[0-9a-f]{6})?">/g;
const strayAttributes = (html) => /\s(?!class=")[a-z-]+=/i.test(html.replace(SAFE_COLOUR_SPAN, "<span>").replace(/class="note-(li|muted)"/g, ""));
const NOTE = [0x15, 0x15, 0x17];
/** The colours of the span around `words`: { fg, bg } as [r, g, b] (null when absent). */
function coloursOf(html, words) {
  const m = new RegExp(`<span class="note-color"(?: data-fg="([0-9a-f]{6})")?(?: data-bg="([0-9a-f]{6})")?[^>]*>${words}</span>`).exec(html);
  const rgb = (h) => (h ? [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16)) : null);
  return m ? { fg: rgb(m[1]), bg: rgb(m[2]) } : null;
}

/* ------------------------------------------------------ ES5 guard */
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " ")).split("\n")
    .map((line) => line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""').replace(/\/\/.*$/, ""));
  code.forEach((line, n) => {
    for (const [re, what] of [[/\?\.[a-zA-Z_(\[]/, "optional chaining"], [/\?\?/, "nullish coalescing"], [/\bconst\b|\blet\b|=>|`/, "ES2015 syntax"],
      [/\.includes\(|\.padStart\(|Object\.entries|\.flat\(/, "newer library calls"], [/innerHTML|eval\(|new Function/, "HTML or code evaluation"]]) {
      if (re.test(line)) failures.push(`paste.js:${n + 1} uses ${what}: ${SRC.split("\n")[n].trim()}`);
    }
  });
  eq("paste.js is ASCII", /[^\x00-\x7e]/.test(code.join("\n")), false);
}

/* ----------------------------------------------------- Google Docs */
const DOCS = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-3f2a1b7c-7fff-1234-abcd-0123456789ab">' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:700;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">#1 &nbsp;|&nbsp; Prohibition: The Law That Built the Mob</span></p>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:10pt;font-family:Arial,sans-serif;color:#666666;font-weight:400;white-space:pre-wrap;">Series: Nomolos &nbsp;| &nbsp;Category: History / Political &nbsp;| &nbsp;Target: 8-12 min</span></p>' +
  '<br><h2 dir="ltr" style="line-height:1.38;margin-top:18pt;margin-bottom:6pt;"><span style="font-size:16pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;white-space:pre-wrap;">HOOK</span></h2>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;white-space:pre-wrap;">In 1920, a country decided to delete a problem. Not reduce it. </span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;white-space:pre-wrap;">Delete it.</span></p>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:400;white-space:pre-wrap;"></span></p>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-style:italic;white-space:pre-wrap;">This is the story</span><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;white-space:pre-wrap;"> of how a war on alcohol created </span><span style="font-size:11pt;color:#000000;text-decoration:underline;-webkit-text-decoration-skip:none;white-space:pre-wrap;">Al Capone</span><span style="font-size:11pt;color:#000000;white-space:pre-wrap;">.</span></p>' +
  '<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;font-weight:700;white-space:pre-wrap;">THE PROBLEM</span></p>' +
  '<p dir="ltr"><span style="font-size:11pt;color:#000000;white-space:pre-wrap;">আমি বাংলায় কথা বলি।</span></p></b><br class="Apple-interchange-newline">';
{
  const r = paste(DOCS);
  eq("docs: one block per line", r.inline, false);
  eq("docs: the whole script, nothing lost or added", r.html,
    "<h1>#1 | Prohibition: The Law That Built the Mob</h1>" +
    "<p class=\"note-muted\">Series: Nomolos | Category: History / Political | Target: 8-12 min</p>" +
    "<h2>HOOK</h2>" +
    "<p>In 1920, a country decided to delete a problem. Not reduce it. <b>Delete it.</b></p>" +
    "<p><i>This is the story</i> of how a war on alcohol created <u>Al Capone</u>.</p>" +
    "<h3>THE PROBLEM</h3>" +
    "<p>আমি বাংলায় কথা বলি।</p>");
  check("docs: the guid wrapper does not make everything bold", !/<b>#1|<b>In 1920/.test(r.html), r.html);
  check("docs: black text and no highlight bring no colour, font or style", !/style|color|font|Arial|#000/i.test(r.html), r.html);
}

/* ------------------------------------------------------------ Word */
{
  const WORD = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><style><!-- p.MsoNormal {margin:0cm;} --></style></head><body lang=EN-US>' +
    "<!--StartFragment--><p class=MsoTitle><span style='font-size:28.0pt;font-family:\"Calibri Light\"'>Chapter One<o:p></o:p></span></p>" +
    "<p class=MsoNormal><span style='font-size:11.0pt'>It began with a <b>single</b> law, <i>written</i> in haste.<o:p></o:p></span></p>" +
    "<p class=MsoNormal><span style='font-size:11.0pt;mso-hide:all'>hidden field code</span><span style='font-size:11.0pt'>Visible text.</span></p>" +
    "<p class=MsoNormal><o:p>&nbsp;</o:p></p><!--EndFragment--></body></html>";
  eq("word: title, bold/italic body, hidden text dropped", paste(WORD).html,
    "<h1>Chapter One</h1><p>It began with a <b>single</b> law, <i>written</i> in haste.</p><p>Visible text.</p>");
}

/* ------------------------------------------------------- web page */
{
  const WEB = '<h2 class="title" id="x" onclick="steal()">Why the <em>sky</em> is blue</h2>' +
    '<p>Sunlight <a href="javascript:alert(1)" style="color:red">scatters</a> in the air.<img src="x" onerror="require(\'child_process\').exec(\'calc\')"></p>' +
    '<script>alert("no")</script><style>p{color:red}</style>' +
    '<ul><li>Short waves</li><li>Long waves<br>stay longer</li></ul><ol><li>First</li><li>Second</li></ol>' +
    '<table><tr><td>Colour</td><td>Wavelength</td></tr></table><div style="display:none">secret</div><p>&lt;tag&gt; &amp; &#8212; done</p>';
  const r = paste(WEB);
  eq("web: structure and the link's red kept, everything dangerous gone", r.html,
    "<h2>Why the <i>sky</i> is blue</h2><p>Sunlight <span class=\"note-color\" data-fg=\"ff0000\" style=\"color:#ff0000\">scatters</span> in the air.</p>" +
    "<p class=\"note-li\">• Short waves</p><p class=\"note-li\">• Long waves</p><p class=\"note-li\">stay longer</p>" +
    "<p class=\"note-li\">1. First</p><p class=\"note-li\">2. Second</p><p>Colour | Wavelength</p><p>&lt;tag&gt; &amp; — done</p>");
  check("web: no attributes but LazyKick's own", !strayAttributes(r.html), r.html);
  check("web: no script, image, link or handler", !/script|img|onerror|onclick|href|javascript|child_process|secret/i.test(r.html), r.html);
}

/* --------------------------------------------- small pastes & tags */
{
  const inline = paste('<meta charset="utf-8"><span style="font-weight:700;color:#000">Delete</span><span> it now</span>');
  eq("a phrase pastes inline, keeping bold", `${inline.inline}|${inline.html}`, "true|<b>Delete</b> it now");
  const spaced = paste('<span style="font-weight:700">BOLD</span><span> words </span>');
  eq("a phrase keeps the space at its end (as a no-break space the browser keeps)", spaced.html, "<b>BOLD</b> words&nbsp;");
  const plain = paste("just words, no markup");
  eq("plain text through the same path", `${plain.inline}|${plain.html}`, "true|just words, no markup");
  const own = paste('<div><span class="timecode-tag" data-t="1.500" data-e="3.200" data-w="0,0.5,1.1" onclick="x()">[00:00:01:12]</span>&nbsp;Hello there</div>' +
    '<div><span class="timecode-tag" data-t="4.2&quot;><img src=x>">[00:00:04:05]</span>&nbsp;World</div>');
  eq("LazyKick's own timecode tags survive a copy inside the notes", own.html,
    "<p><span class=\"timecode-tag\" data-t=\"1.500\" data-e=\"3.200\" data-w=\"0,0.5,1.1\">[00:00:01:12]</span> Hello there</p>" +
    "<p><span class=\"timecode-tag\">[00:00:04:05]</span> World</p>");
  eq("a paragraph set in bold stays a paragraph", paste("<p><b>This is said out loud.</b></p><p>And this.</p>").html,
    "<p><b>This is said out loud.</b></p><p>And this.</p>");
  eq("nothing to paste", paste("<p> </p><br><p>&nbsp;</p>").html, "");
}

/* ------------------------------------------ highlights & coloured text */
{
  // Google Docs: Highlight colour is the span's background-color, Text colour its color.
  const DOCS_MARKED = '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-9">' +
    '<p dir="ltr"><span style="font-size:11pt;color:#000000;background-color:transparent;">Say this </span>' +
    '<span style="font-size:11pt;color:#000000;background-color:#ffff00;">slowly</span>' +
    '<span style="font-size:11pt;color:#000000;background-color:transparent;"> and </span>' +
    '<span style="font-size:11pt;color:#ff0000;background-color:transparent;font-weight:700;">loud</span>' +
    '<span style="font-size:11pt;color:#000000;background-color:transparent;">.</span></p>' +
    '<p dir="ltr"><span style="font-size:11pt;color:#1155cc;">Dark blue words</span>' +
    '<span style="font-size:11pt;color:#ffffff;background-color:#0000ff;"> on blue</span>' +
    '<span style="font-size:11pt;color:#000000;background-color:#ffff00;"> marked</span>' +
    '<span style="font-size:11pt;color:#000000;background-color:#ffff00;"> twice</span></p></b>';
  const r = paste(DOCS_MARKED);
  check("docs highlight: the marked word keeps its yellow, with the Doc's black text on it", r.html.startsWith(
    "<p>Say this <span class=\"note-color\" data-fg=\"000000\" data-bg=\"ffff00\" style=\"color:#000000;background-color:#ffff00\">slowly</span> and " +
    "<b><span class=\"note-color\" data-fg=\"ff0000\" style=\"color:#ff0000\">loud</span></b>.</p>"), r.html);
  const blue = coloursOf(r.html, "Dark blue words");
  check("docs colour: dark blue is lightened until it reads on the dark note", blue && blue.fg && P.contrast(blue.fg, NOTE) >= 4.5 &&
    P.contrast([0x11, 0x55, 0xcc], NOTE) < 4.5, JSON.stringify(blue));
  check("docs colour: ... and stays blue", blue && blue.fg && blue.fg[2] > blue.fg[0] && blue.fg[2] > blue.fg[1], JSON.stringify(blue));
  const onBlue = coloursOf(r.html, " on blue");
  eq("docs highlight: white text on a blue highlight stays white", JSON.stringify(onBlue), JSON.stringify({ fg: [255, 255, 255], bg: [0, 0, 255] }));
  check("docs highlight: two marked runs side by side become one", r.html.includes(">&nbsp;marked twice</span>") || r.html.includes("> marked twice</span>"), r.html);
  check("docs highlight: only LazyKick's own attributes", !strayAttributes(r.html), r.html);

  // Word: background:yellow + mso-highlight, named and hex text colours, <s>.
  const WORD_MARKED = "<p class=MsoNormal><span style='font-size:11.0pt'>Keep <span style='background:yellow;mso-highlight:yellow'>this part</span> and " +
    "<span style='color:#C00000'>this red</span> and <s>that</s>.<o:p></o:p></span></p>";
  const w = paste(WORD_MARKED);
  check("word highlight: yellow, with dark text where the source sets none", w.html.includes(
    "<span class=\"note-color\" data-fg=\"111111\" data-bg=\"ffff00\" style=\"color:#111111;background-color:#ffff00\">this part</span>"), w.html);
  const red = coloursOf(w.html, "this red");
  check("word colour: dark red lightened, still red", red && red.fg && P.contrast(red.fg, NOTE) >= 4.5 && red.fg[0] > red.fg[1] && red.fg[0] > red.fg[2], JSON.stringify(red));
  check("word: strikethrough kept", w.html.includes(" and <s>that</s>."), w.html);

  // Web pages: <mark>, <del>, line-through; and the page's own white or dark background is not a highlight.
  const WEB_MARKED = '<p>Read the <mark>marked words</mark>, not <del>these</del> <span style="text-decoration:line-through">or these</span>.</p>' +
    '<p><span style="color: rgb(32, 33, 36); font-family: Roboto; background-color: rgb(255, 255, 255);">Page text</span></p>' +
    '<p><span style="color: rgb(230, 230, 230); background-color: rgb(30, 30, 30);">Dark page text</span></p>' +
    '<p><span style="background-color: rgba(0, 0, 0, 0)">Clear</span></p>' +
    '<table><tr><td style="background-color:#fff2cc">Cell</td></tr></table>' +
    '<h2><span style="background-color:#ffff00">Marked heading</span></h2>' +
    '<p><span style="background-color:#00ff00">Green <span style="background-color:transparent">all through</span></span></p>';
  eq("web: mark, strikethrough, page backgrounds left out, highlights in headings", paste(WEB_MARKED).html,
    "<p>Read the <span class=\"note-color\" data-fg=\"111111\" data-bg=\"ffff00\" style=\"color:#111111;background-color:#ffff00\">marked words</span>, not <s>these</s> <s>or these</s>.</p>" +
    "<p>Page text</p><p>Dark page text</p><p>Clear</p><p>Cell</p>" +
    "<h2><span class=\"note-color\" data-fg=\"111111\" data-bg=\"ffff00\" style=\"color:#111111;background-color:#ffff00\">Marked heading</span></h2>" +
    "<p><span class=\"note-color\" data-fg=\"111111\" data-bg=\"00ff00\" style=\"color:#111111;background-color:#00ff00\">Green all through</span></p>");

  const one = paste('<span style="background-color:#ffff00;color:#000">just this</span>');
  eq("a marked phrase pastes inline, marked", `${one.inline}|${one.html}`,
    "true|<span class=\"note-color\" data-fg=\"000000\" data-bg=\"ffff00\" style=\"color:#000000;background-color:#ffff00\">just this</span>");

  // Nothing but numbers reaches a style attribute, whatever the source says.
  const HOSTILE = '<p><span style="color:red;background-color:#00ff00;background-image:url(javascript:alert(1))" onclick="x()">hack</span> ' +
    '<span class="note-color" data-fg="&quot; onclick=&quot;x()" data-bg="zz" style="color: expression(alert(1)); background: url(red.png)">own</span> ' +
    '<font color="#00ff00" face="Comic Sans">font</font></p>';
  const h = paste(HOSTILE);
  eq("hostile colours: rebuilt from numbers only", h.html,
    "<span class=\"note-color\" data-fg=\"111111\" data-bg=\"00ff00\" style=\"color:#111111;background-color:#00ff00\">hack</span> own " +
    "<span class=\"note-color\" data-fg=\"00ff00\" style=\"color:#00ff00\">font</span>");
  check("hostile colours: no script, url, handler or font", !/javascript|expression|url|onclick|zz|Comic/i.test(h.html), h.html);

  eq("colourStyle: both", P.colourStyle("ff0000", "ffff00"), "color:#ff0000;background-color:#ffff00");
  eq("colourStyle: anything but six hex digits is dropped", P.colourStyle('x" onclick="y', "00ff00"), "background-color:#00ff00");
  eq("colourStyle: nothing", P.colourStyle(null, ""), "");
  eq("parseColor: rgba(0, 0, 0, 0) is no colour", P.parseColor("rgba(0, 0, 0, 0)"), null);
  eq("parseColor: Word's names", JSON.stringify(["yellow", "lime", "aqua", "fuchsia", "navy", "teal"].map(P.parseColor)),
    JSON.stringify([[255, 255, 0], [0, 255, 0], [0, 255, 255], [255, 0, 255], [0, 0, 128], [0, 128, 128]]));
}

console.log("LazyKick - paste.js tests\n");
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`${failures.length ? "" : "  "}${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
