// Reads astrid-web's rendered markdown HTML back into astrid-core's blocks and runs.
//
// Web renders to HTML (lib/markdown.ts `renderMarkdownWithLinks`: `marked` with GFM and `breaks:
// true`, Astrid's references swapped out first, then DOMPurify). astrid-core renders the same text
// to a tree of blocks and inline runs (`markdown::render`, the `renderMarkdown` rule), because a
// native shell draws paragraphs and runs, not markup. The contract is what a reader SEES, so the
// HTML is read back into the core's tree, in the browser's own terms:
//
//   - Blocks: p, h1–h6, pre>code (language from `language-*`), ul/ol (with `start`), li (a
//     checkbox `input` makes it a task item), blockquote, hr, table (alignment from the header
//     cells' `align`). Inline content outside any block — what DOMPurify leaves of a `<div>` —
//     is a paragraph, as it would flow on the page.
//   - Inlines: text with bold (strong), italic (em), strike (del), code and link; br is a line
//     break. Adjacent runs in the same style are one run, as the core writes them.
//   - An anchor whose href is /u/<id>, /lists/<id> or /?task=<id> and that is drawn as a pill (the
//     pill classes) is a reference: kind, label (its text without the sigil) and the decoded id.
//     Any other relative href is the app's own page, which the core writes absolute
//     (https://astrid.cc/…). An anchor DOMPurify stripped the href from is plain text.
//   - Renderer artefacts are not content and are dropped: the space marked prints after a task
//     checkbox, the newline that closes a raw-HTML block, and an empty <p>.
//
// Used by scripts/contract-fixtures/drivers/markdown.mjs (which writes contracts/fixtures/
// markdown.json) and tests/lib/core-rules-markdown-parity.test.ts (which holds the browser's
// renderer to the core). astrid-core's contracts/drivers/markdown.mjs carries the same reader.

const APP_ORIGIN = 'https://astrid.cc'
const PILLS = [
  ['/u/', 'user', '@'],
  ['/lists/', 'list', '#'],
  ['/?task=', 'task', '!'],
]

// ── HTML → blocks ─────────────────────────────────────────────────────────────────────────

const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'UL', 'OL', 'BLOCKQUOTE', 'HR', 'TABLE'])

function blocksOf(container, { skipCheckbox = false } = {}) {
  const blocks = []
  let pending = []
  const flush = () => {
    const inlines = inlinesOf(pending, {})
    trimEdges(inlines)
    if (inlines.length > 0) blocks.push({ kind: 'paragraph', inlines })
    pending = []
  }
  for (const node of container.childNodes) {
    if (skipCheckbox && isCheckbox(node)) continue
    if (node.nodeType === 1 && BLOCK_TAGS.has(node.tagName)) {
      flush()
      const b = block(node)
      if (b) blocks.push(b)
    } else {
      pending.push(node)
    }
  }
  flush()
  return blocks
}

// Newlines at the edge of loose inline content are HTML source formatting, not text.
function trimEdges(inlines) {
  const isText = (i) => i && i.kind === 'text'
  while (isText(inlines[0]) && /^\s*$/.test(inlines[0].text)) inlines.shift()
  while (isText(inlines.at(-1)) && /^\s*$/.test(inlines.at(-1).text)) inlines.pop()
  if (isText(inlines[0])) inlines[0].text = inlines[0].text.replace(/^\n+/, '')
  if (isText(inlines.at(-1))) inlines.at(-1).text = inlines.at(-1).text.replace(/\n+$/, '')
}

function isCheckbox(node) {
  return node.nodeType === 1 && node.tagName === 'INPUT' && node.getAttribute('type') === 'checkbox'
}

function block(node) {
  switch (node.tagName) {
    case 'P': {
      const inlines = inlinesOf(node.childNodes, {})
      // An empty <p> — what DOMPurify leaves of an image — draws nothing.
      return inlines.length ? { kind: 'paragraph', inlines } : null
    }
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
      return { kind: 'heading', level: Number(node.tagName[1]), inlines: inlinesOf(node.childNodes, {}) }
    case 'PRE': {
      const code = node.querySelector('code')
      const language = (code?.className.match(/language-(\S+)/) || [])[1] ?? null
      return { kind: 'code', language, text: (code ?? node).textContent }
    }
    case 'UL':
    case 'OL':
      return {
        kind: 'list',
        ordered: node.tagName === 'OL',
        start: node.tagName === 'OL' && node.hasAttribute('start') ? Number(node.getAttribute('start')) : 1,
        items: [...node.children].filter((li) => li.tagName === 'LI').map(item),
      }
    case 'BLOCKQUOTE':
      return { kind: 'quote', blocks: blocksOf(node) }
    case 'HR':
      return { kind: 'rule' }
    case 'TABLE': {
      const headCells = [...node.querySelectorAll('thead th')]
      const rows = [...node.querySelectorAll('tbody tr')].map((tr) =>
        [...tr.children].map((td) => inlinesOf(td.childNodes, {})))
      return {
        kind: 'table',
        alignments: headCells.map((th) => th.getAttribute('align') ?? 'none'),
        header: headCells.map((th) => inlinesOf(th.childNodes, {})),
        rows,
      }
    }
  }
  throw new Error(`unhandled block ${node.tagName}`)
}

function item(li) {
  // The checkbox is the item's first child, or its first paragraph's in a loose list.
  const holder = isCheckbox(li.firstChild) ? li : li.firstElementChild?.tagName === 'P' && isCheckbox(li.firstElementChild.firstChild) ? li.firstElementChild : null
  let checked = null
  if (holder) {
    const box = holder.firstChild
    checked = box.hasAttribute('checked')
    // marked prints `<input …> ` — the space is the renderer's, not the item's text.
    const after = box.nextSibling
    if (after && after.nodeType === 3) after.textContent = after.textContent.replace(/^ /, '')
    box.remove()
  }
  return { checked, blocks: blocksOf(li) }
}

function inlinesOf(nodes, style) {
  const out = []
  for (const node of nodes) inline(node, style, out)
  return out
}

function push(out, text, style) {
  if (text === '') return
  const run = {
    kind: 'text',
    text,
    bold: !!style.bold,
    italic: !!style.italic,
    strike: !!style.strike,
    code: !!style.code,
    link: style.link ?? null,
  }
  const last = out.at(-1)
  if (last && last.kind === 'text' && ['bold', 'italic', 'strike', 'code', 'link'].every((k) => last[k] === run[k])) {
    last.text += text
  } else {
    out.push(run)
  }
}

function inline(node, style, out) {
  if (node.nodeType === 3) return push(out, node.textContent, style)
  if (node.nodeType !== 1) return
  switch (node.tagName) {
    case 'BR':
      out.push({ kind: 'lineBreak' })
      return
    case 'STRONG':
      return node.childNodes.forEach((c) => inline(c, { ...style, bold: true }, out))
    case 'EM':
      return node.childNodes.forEach((c) => inline(c, { ...style, italic: true }, out))
    case 'DEL':
      return node.childNodes.forEach((c) => inline(c, { ...style, strike: true }, out))
    case 'CODE':
      return node.childNodes.forEach((c) => inline(c, { ...style, code: true }, out))
    case 'A': {
      const href = node.getAttribute('href')
      // A pill is drawn as one, not merely linked to the same page: `[home](/lists/x)` is an
      // ordinary link to a list, styled as a link.
      const pill = href && /\brounded\b/.test(node.getAttribute('class') ?? '') &&
        PILLS.find(([prefix]) => href.startsWith(prefix))
      if (pill) {
        const [prefix, reference, sigil] = pill
        const text = node.textContent
        out.push({
          kind: 'reference',
          reference,
          label: text.startsWith(sigil) ? text.slice(sigil.length) : text,
          id: decodeURIComponent(href.slice(prefix.length)),
        })
        return
      }
      const link = href == null ? null : href.startsWith('/') && !href.startsWith('//') ? APP_ORIGIN + href : href
      return node.childNodes.forEach((c) => inline(c, { ...style, link }, out))
    }
    default:
      // span, and whatever DOMPurify kept the text of.
      return node.childNodes.forEach((c) => inline(c, style, out))
  }
}

/**
 * The blocks a reader sees in `html`, read in `document`'s window.
 * @param {Document} document
 * @param {string} html
 */
export function blocksOfHtml(document, html) {
  const body = document.createElement('body')
  body.innerHTML = html
  return blocksOf(body)
}
