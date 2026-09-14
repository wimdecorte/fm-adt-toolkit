/** A small XML parser for FileMaker's Save as XML export. Node has no XML parser
 *  in core and the toolkit has no runtime dependencies, so this covers exactly
 *  what SaXML uses: a prolog, comments, elements with double-quoted attributes,
 *  self-closing tags, CDATA sections, text with the five predefined entities.
 *  It builds a tree; the largest catalog in the reference export is 5 MB, which
 *  fits comfortably. It is not a general XML parser: no DTD, no namespaces
 *  handling beyond keeping the prefix in the tag name, no processing instructions
 *  inside the body. A literal `>` inside a quoted attribute value (single or
 *  double) does not end the tag early; the tag-end scan tracks quote state. */
export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decode(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return e in ENTITIES ? ENTITIES[e] : m;
  });
}

const ATTR = /([^\s=\/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Finds the index of the `>` that ends the tag starting at `lt` (the index of its `<`),
 *  skipping over any `>` that falls inside a single- or double-quoted attribute value.
 *  Returns -1 if the text ends before the tag closes. */
function findTagEnd(text: string, lt: number): number {
  let quote = '';
  for (let j = lt + 1; j < text.length; j++) {
    const c = text[j];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j;
    }
  }
  return -1;
}

export function parseXml(text: string): XmlNode {
  const stack: XmlNode[] = [];
  let root: XmlNode | null = null;
  let i = 0;
  const n = text.length;
  const top = (): XmlNode => {
    if (stack.length === 0) throw new Error('text outside the document element');
    return stack[stack.length - 1];
  };
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;
    if (lt > i && stack.length) top().text += decode(text.slice(i, lt));
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) throw new Error('unterminated comment');
      i = end + 3; continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end === -1) throw new Error('unterminated CDATA');
      top().text += text.slice(lt + 9, end);
      i = end + 3; continue;
    }
    if (text.startsWith('<?', lt) || text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt);
      if (end === -1) throw new Error('unterminated declaration');
      i = end + 1; continue;
    }
    const gt = findTagEnd(text, lt);
    if (gt === -1) throw new Error('unterminated tag');
    const body = text.slice(lt + 1, gt);
    i = gt + 1;
    if (body[0] === '/') {
      const name = body.slice(1).trim();
      const node = stack.pop();
      if (!node) throw new Error(`unexpected </${name}>`);
      if (node.tag !== name) throw new Error(`expected </${node.tag}> but found </${name}>`);
      continue;
    }
    const selfClosing = body.endsWith('/');
    const head = selfClosing ? body.slice(0, -1) : body;
    const sp = head.search(/[\s]/);
    const tag = (sp === -1 ? head : head.slice(0, sp)).trim();
    const attrs: Record<string, string> = {};
    if (sp !== -1) {
      ATTR.lastIndex = 0;
      let m: RegExpExecArray | null;
      const rest = head.slice(sp);
      while ((m = ATTR.exec(rest)) !== null) attrs[m[1]] = decode(m[2] ?? m[3] ?? '');
    }
    const node: XmlNode = { tag, attrs, children: [], text: '' };
    if (stack.length) top().children.push(node); else root = node;
    if (!selfClosing) stack.push(node);
  }
  if (stack.length) throw new Error(`unclosed <${stack[stack.length - 1].tag}>`);
  if (!root) throw new Error('no document element');
  return root;
}
