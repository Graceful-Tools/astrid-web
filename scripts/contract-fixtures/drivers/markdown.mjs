// Runs astrid-web's markdown renderer over a case table and prints what it draws, as blocks.
// Invoked by scripts/export-contract-fixtures.ts; not useful on its own.
//
// The renderer runs in a jsdom window, so it takes its browser path: DOMPurify with the rich-text
// allowlist, exactly what a page shows. The HTML is read back into astrid-core's blocks by
// ../markdown-blocks.mjs, which says exactly how. Every case agrees with the core since AWTD-1064
// (astrid-core docs/CONTRACTS.md D38, resolved toward iOS): none is disputed.
//
// Usage: node scripts/contract-fixtures/drivers/markdown.mjs <path-to-astrid-web>

import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { registerWebAliases } from './alias-loader.mjs'
import { partition } from './disputed.mjs'
import { blocksOfHtml } from '../markdown-blocks.mjs'

const webRoot = process.argv[2]
if (!webRoot) {
  console.error('usage: node scripts/contract-fixtures/drivers/markdown.mjs <path-to-astrid-web>')
  process.exit(2)
}

// A browser window before anything imports DOMPurify, which binds to `window` at load.
const requireFromWeb = createRequire(join(webRoot, 'package.json'))
const { JSDOM } = requireFromWeb('jsdom')
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://astrid.cc/' })
globalThis.window = dom.window
globalThis.document = dom.window.document

registerWebAliases(webRoot)

const { renderMarkdownWithLinks } = await import(pathToFileURL(join(webRoot, 'lib/markdown.ts')).href)

function render(text, identifiers) {
  const html = renderMarkdownWithLinks(text, identifiers ? { identifiers } : undefined)
  return { html, blocks: blocksOfHtml(dom.window.document, html) }
}

// ── Cases ─────────────────────────────────────────────────────────────────────────────────

const CASES = [
  // Text and breaks
  ['plain', 'Buy oat milk'],
  ['newline-is-a-break', 'first line\nsecond line\nthird'],
  ['blank-line-is-a-paragraph', 'one\n\ntwo'],
  ['trailing-spaces-break', 'a  \nb'],
  ['backslash-break', 'a\\\nb'],
  ['unicode', 'Café ☕ — naïve 日本語 🎉'],
  ['entities', 'Fish &amp; chips &lt;3 & 5 > 4'],
  ['escapes', '\\*not italic\\* and 1\\. not a list'],
  ['reported-description', '##title\n**bold**\n*italics*\n(link)[https://google.com]'],
  // Emphasis
  ['bold', 'a **bold** word'],
  ['bold-underscore', 'a __bold__ word'],
  ['italic', 'an *italic* word'],
  ['italic-underscore', 'an _italic_ word'],
  ['bold-italic', '***both*** at once'],
  ['nested-emphasis', '**bold with *italic* inside**'],
  ['intraword-underscore', 'snake_case_name stays'],
  ['strike-double', 'was ~~wrong~~ right'],
  ['strike-single', 'was ~wrong~ right'],
  ['unclosed-emphasis', 'a *dangling star'],
  // Code
  ['inline-code', 'run `npm test` now'],
  ['inline-code-with-stars', 'literally `**not bold**`'],
  ['inline-code-double-backtick', 'a `` code with ` tick `` here'],
  ['fenced-code', '```\nconst x = 1\n```'],
  ['fenced-code-language', '```ts\nconst x: number = 1\n```'],
  ['fenced-code-tilde', '~~~\nplain\n~~~'],
  ['fenced-code-two-lines', '```\nline one\nline two\n```'],
  ['fenced-code-trailing-blank', '```\ncode\n\n```'],
  ['fenced-code-two-trailing-blanks', '```\ncode\n\n\n```'],
  ['fenced-code-empty', '```\n```'],
  ['indented-code-trailing-blank', '    x = 1\n\n\nafter'],
  ['indented-code-one-line', '    x = 1'],
  ['indented-code', '    indented code\n    more'],
  // Headings
  ['headings', '# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six'],
  ['heading-needs-space', '##title'],
  ['heading-then-body', '### Deeper\nbody'],
  ['setext-heading', 'Title\n====='],
  ['heading-with-emphasis', '## Plan for **today**'],
  // Lists
  ['bullets-dash', '- one\n- two\n- three'],
  ['bullets-star', '* one\n* two'],
  ['bullets-plus', '+ one\n+ two'],
  ['ordered', '1. one\n2. two'],
  ['ordered-start', '3. three\n4. four'],
  ['nested-list', '- outer\n  - inner\n- next'],
  ['loose-list', '- one\n\n- two'],
  ['task-list', '- [ ] todo\n- [x] done'],
  ['task-list-uppercase', '- [X] done'],
  ['list-after-paragraph', 'Groceries:\n- milk\n- eggs'],
  ['list-item-two-lines', '- first line\n  continues'],
  ['list-with-emphasis', '- **bold** item\n- `code` item'],
  // Quotes and rules
  ['quote', '> quoted'],
  ['quote-two-lines', '> line one\n> line two'],
  ['nested-quote', '> outer\n>> inner'],
  ['quote-with-list', '> - a\n> - b'],
  ['rule-dashes', 'above\n\n---\n\nbelow'],
  ['rule-stars', '***'],
  // Tables
  ['table', '| a | b |\n|---|---|\n| 1 | 2 |'],
  ['table-aligned', '| l | c | r |\n|:--|:-:|--:|\n| 1 | 2 | 3 |'],
  ['table-inline', '| name | note |\n|---|---|\n| **Jo** | `x` |'],
  // Links
  ['link', 'see [the docs](https://example.com/docs)'],
  ['link-mailto', '[write](mailto:a@example.com)'],
  ['link-javascript', '[click](javascript:alert(1))'],
  ['link-relative', '[home](/lists/abc)'],
  ['link-http-www-upgraded', '[site](http://www.example.com/a)'],
  ['link-unparseable-host', '[bad](https://exa]mple.com/x)'],
  ['link-port', '[local](http://localhost:3000/x)'],
  ['link-bold-text', '[**bold link**](https://example.com)'],
  ['angle-autolink', '<https://example.com/a>'],
  ['bare-https', 'go to https://example.com/path?q=1 now'],
  ['bare-http', 'http://example.com'],
  ['bare-www', 'visit www.example.com today'],
  ['bare-http-www-upgraded', 'http://www.example.com/x'],
  ['bare-trailing-period', 'See https://example.com.'],
  ['bare-trailing-comma', 'https://example.com, then'],
  ['bare-in-parens', '(https://example.com/a)'],
  ['bare-with-parens', 'https://en.wikipedia.org/wiki/Foo_(bar)'],
  ['bare-email', 'mail jon@example.com please'],
  ['bare-domain-only', 'example.com is not a link'],
  // References
  ['mention', 'Ask @[Jon Paris](user-1) about it'],
  ['list-reference', 'Filed in #[Groceries](list-1)'],
  ['task-reference', 'Blocked by ![Buy milk](task-1)'],
  ['three-references', '@[Ann](u1) #[Home](l1) ![Fix sink](t1)'],
  ['reference-in-bold', '**ask @[Ann](u1)**'],
  ['reference-in-code-span', '`@[Ann](u1)`'],
  ['reference-in-code-block', '```\n@[Ann](u1)\n```'],
  ['reference-label-markdown', '@[*Ann*](u1)'],
  ['reference-id-needs-encoding', '![Plan](a b/c)'],
  ['reference-then-link', '@[Ann](u1) [docs](https://example.com)'],
  ['reference-at-line-start', '@[Ann](u1)\nsecond line'],
  ['not-a-reference-empty-label', '@[](u1)'],
  ['email-like-reference', 'a@[b](c)'],
  ['image-syntax-empty', '![](https://example.com/x.png)'],
  // HTML
  ['html-inline-allowed', 'a <strong>strong</strong> word'],
  ['html-inline-disallowed', 'a <b>bold</b> word'],
  ['html-script', '<script>alert(1)</script>'],
  ['html-block-div', '<div>block text</div>'],
  ['html-img', 'x <img src="y" onerror="alert(1)"> z'],
  ['html-comment', 'a <!-- hidden --> b'],
  ['html-inline-script', 'a <script>alert(1)</script> b'],
  ['html-style-block', '<style>p { color: red }</style>\n\nafter'],
  // Sanitisation. Every one of these must reach a reader as text or as nothing: no script, no
  // handler, no frame, no address other than http, https, mailto or the app's own pages
  // (tests/lib/core-rules-markdown-parity.test.ts checks the HTML itself as well as the blocks).
  ['xss-link-javascript-upper', '[x](JAVASCRIPT:alert(1))'],
  ['xss-link-javascript-entity', '[x](javascript&#58;alert(1))'],
  ['xss-link-data', '[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)'],
  ['xss-link-vbscript', '[x](vbscript:msgbox(1))'],
  ['xss-autolink-javascript', '<javascript:alert(1)>'],
  ['xss-link-title-quote', '[x](https://example.com "a\\" onmouseover=\\"alert(1)")'],
  ['xss-html-anchor-javascript', '<a href="javascript:alert(1)">x</a>'],
  ['xss-html-anchor-onclick', 'see <a href="https://example.com" onclick="alert(1)">x</a>'],
  ['xss-html-iframe', '<iframe src="https://evil.example"></iframe>'],
  ['xss-html-svg-onload', 'a <svg onload="alert(1)"><circle/></svg> b'],
  ['xss-html-img-bare', '<img src=x onerror=alert(1)>'],
  ['xss-html-form', '<form action="https://evil.example"><input type="submit" value="go"></form>'],
  ['xss-html-style-attr', '<p style="background:url(javascript:alert(1))">styled</p>'],
  ['xss-html-object-embed', '<object data="x"></object><embed src="x">'],
  ['xss-html-meta-refresh', '<meta http-equiv="refresh" content="0;url=https://evil.example">'],
  ['xss-html-input', 'a <input type="checkbox" checked> typed box'],
  ['xss-mention-label-quote', '@[x" onmouseover="alert(1)](u1)'],
  ['xss-mention-id-quote', '@[Ann](u1" onclick="alert(1))'],
  ['xss-task-id-javascript', '![Plan](javascript:alert(1))'],
  ['xss-list-label-script', '#[<script>alert(1)</script>](l1)'],
  ['xss-entity-script', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['xss-code-span-html', '`<img src=x onerror=alert(1)>`'],
  ['xss-html-in-table', '| a |\n|---|\n| <img src=x onerror=alert(1)> |'],
  // Empties
  ['empty', ''],
  ['whitespace-only', '   \n  '],
]

// Task identifiers (`AWTD-12`, `#12`) link only with a reader context (task 5f3453e2).
const CONTEXT = { projectKey: 'AWTD', keys: ['AWTD', 'OPS'], hidden: ['OPS-9'] }
const IDENTIFIER_CASES = [
  ['ids-with-context', 'Fixed by AWTD-12 and #4; see OPS-3', CONTEXT],
  ['ids-hidden-one', 'OPS-9 is hidden, OPS-8 is not', CONTEXT],
  ['ids-unknown-key', 'UTF-8 and COVID-19 stay prose', CONTEXT],
  ['ids-inside-task-pill', '![Follow up AWTD-12](t1)', CONTEXT],
  ['ids-in-code', '`AWTD-12`', CONTEXT],
  ['ids-without-context', 'AWTD-12 and #4', null],
]

const cases = [
  ...CASES.map(([id, text]) => ({ id, text, context: null, ...render(text, null) })),
  ...IDENTIFIER_CASES.map(([id, text, context]) => ({ id, text, context, ...render(text, context) })),
]

const result = partition(cases, [])

process.stdout.write(JSON.stringify({
  generatedFrom: 'lib/markdown.ts (renderMarkdownWithLinks, browser path), read back into blocks',
  ...result,
}))
