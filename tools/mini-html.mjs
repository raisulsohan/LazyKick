/*
 * A small HTML parser for the tests: enough of the browser's DOMParser to
 * read what Google Docs, Word and web pages put on the clipboard (tags,
 * quoted and bare attributes, entities, comments, raw <script>/<style>).
 * Nodes expose what client/paste.js reads: nodeType, nodeName, childNodes,
 * getAttribute, nodeValue and textContent.
 */
const VOID = new Set(["br", "img", "meta", "hr", "input", "link", "col", "area", "base", "wbr", "source", "embed"]);
const RAW = new Set(["script", "style"]);

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }[e.toLowerCase()] ?? m;
  });
}

function text(value) {
  return { nodeType: 3, nodeName: "#text", nodeValue: value, get textContent() { return this.nodeValue; } };
}

function element(name, attrs, parent) {
  return {
    nodeType: 1, nodeName: name.toUpperCase(), childNodes: [], attrs, parent,
    getAttribute: (k) => (k.toLowerCase() in attrs ? attrs[k.toLowerCase()] : null),
    get textContent() { return this.childNodes.map((c) => c.textContent).join(""); },
  };
}

export function parseHtml(html) {
  const doc = element("#document", {}, null);
  doc.nodeType = 9;
  let cur = doc;
  const re = /<!--[\s\S]*?-->|<!\[[\s\S]*?\]>|<!DOCTYPE[^>]*>|<\/\s*([a-zA-Z0-9:]+)\s*>|<([a-zA-Z0-9:]+)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[5] !== undefined) {
      cur.childNodes.push(text(decode(m[5])));
    } else if (m[1]) {
      const name = m[1].toUpperCase();
      let n = cur;
      while (n && n.nodeName !== name) n = n.parent;
      if (n && n.parent) cur = n.parent;
    } else if (m[2]) {
      const attrs = {};
      (m[3] || "").replace(/([^\s=>/]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (a, k, v, d, s, u) => { attrs[k.toLowerCase()] = decode(d ?? s ?? u ?? ""); });
      const node = element(m[2], attrs, cur);
      cur.childNodes.push(node);
      const lower = m[2].toLowerCase();
      if (RAW.has(lower)) {
        const end = html.toLowerCase().indexOf(`</${lower}`, re.lastIndex);
        node.childNodes.push(text(html.slice(re.lastIndex, end < 0 ? html.length : end)));
        re.lastIndex = end < 0 ? html.length : end;
      } else if (!VOID.has(lower) && !m[4]) {
        cur = node;
      }
    }
  }
  doc.body = doc;
  return doc;
}

/** Stand-in for window.DOMParser. */
export class MiniDOMParser {
  parseFromString(html) { return parseHtml(html); }
}
