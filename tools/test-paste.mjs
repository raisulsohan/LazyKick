/*
 * LazyKick — clean rich paste tests (client/paste.js).
 *
 *   node tools/test-paste.mjs
 *
 * Feeds paste.js the HTML that Google Docs, Word and web pages put on the
 * clipboard (parsed by tools/mini-html.mjs, standing in for the browser's
 * DOMParser) and checks what reaches the notes: headings, paragraphs, bold,
 * italic, underline, list items and side notes, and nothing else — no
 * colours, fonts, links, images, scripts or attributes. Also a guard that
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
  check("docs: no colours, fonts or styles", !/style|color|font|Arial|#000/i.test(r.html), r.html);
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
  eq("web: structure kept, everything dangerous gone", r.html,
    "<h2>Why the <i>sky</i> is blue</h2><p>Sunlight scatters in the air.</p>" +
    "<p class=\"note-li\">• Short waves</p><p class=\"note-li\">• Long waves</p><p class=\"note-li\">stay longer</p>" +
    "<p class=\"note-li\">1. First</p><p class=\"note-li\">2. Second</p><p>Colour | Wavelength</p><p>&lt;tag&gt; &amp; — done</p>");
  check("web: no attributes but LazyKick classes", !/\s(?!class=")[a-z-]+=/i.test(r.html.replace(/class="note-(li|muted)"/g, "")), r.html);
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

console.log("LazyKick - paste.js tests\n");
for (const f of failures) console.log(`  FAIL ${f}`);
console.log(`${failures.length ? "" : "  "}${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
