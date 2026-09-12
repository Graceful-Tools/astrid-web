/**
 * AWTD-857: an MCP attachment is a LINK. It must never become a hosted file.
 *
 * Jon, 2026-09-10: "mcp links to urls should not store in our blob store. they
 * should continue to point to the external link UNLESS they were stored by us
 * (e.g. user uploaded a file in Astrid)."
 *
 * This file exists because that decision kept getting re-litigated. The task
 * asking for the opposite — "consolidate MCP attachment writes onto SecureFile
 * and retire the legacy Attachment model" — consumed three sessions. Two of
 * them correctly stopped and handed it back rather than guessing; the third
 * would have been a fourth, because nothing in the code said which model was
 * right, and the read path called a link `source: 'legacy'`, which reads as
 * "temporary, finish removing it".
 *
 * So the decision is a check now instead of a paragraph.
 *
 * ## The two models, and why they cannot merge
 *
 * - `Attachment` — an EXTERNAL LINK. `{ name, url, type, size }`, all supplied
 *   by the agent. No bytes are uploaded anywhere in `mcp/` or `app/api/mcp/`,
 *   and `size` is whatever the caller claims.
 * - `SecureFile` — a BLOB WE HOST. `blobUrl` is `@unique`, and
 *   `GET /api/v1/secure-files/{id}` access-checks and then redirects to it.
 *
 * Moving a link into `SecureFile` breaks two things that are not migration
 * details:
 *
 * 1. **It changes working behaviour.** `Attachment.url` has no constraint;
 *    `SecureFile.blobUrl` is unique GLOBALLY. Attaching one shared doc to two
 *    tasks succeeds today and would start failing.
 * 2. **It creates an open redirect we do not have.** Our own domain would
 *    redirect to an agent-supplied url. A link is rendered by the client
 *    directly — the browser never passes through us — which is exactly why
 *    `collectTaskAttachments` discriminates on `source`.
 *
 * Ingesting the bytes instead is also already ruled out by policy:
 * `lib/security/remote-image.ts` refuses any host outside
 * `REMOTE_IMAGE_ALLOWED_HOSTS`, which is empty by default and documented in
 * `lib/env.ts` as disabling remote imports.
 *
 * ## If this is ever meant to change
 *
 * Change it here first. This test failing is the conversation, and the schema
 * comment plus the rename are what stop the next reader assuming the answer.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), 'utf8')

/** Both MCP surfaces that accept an attachment from an agent. */
const MCP_ATTACHMENT_WRITERS = [
  'mcp/handlers/tasks.ts',
  'app/api/mcp/operations/handlers/task-operations.ts',
]

describe('AWTD-857: MCP attachments stay links (Jon, 2026-09-10)', () => {
  for (const path of MCP_ATTACHMENT_WRITERS) {
    describe(path, () => {
      const source = read(path)

      it('writes the link model', () => {
        expect(
          source,
          `${path} no longer calls prisma.attachment.create. An MCP attachment is a ` +
            `link and Attachment is the model for links — see this file's header.`
        ).toMatch(/prisma\.attachment\.create/)
      })

      it('never creates a SecureFile', () => {
        expect(
          source,
          `${path} creates a SecureFile. SecureFile is for blobs WE host: blobUrl is ` +
            `@unique (so the same url on two tasks would start failing) and the ` +
            `secure-files route redirects to it (so our domain would become an open ` +
            `redirector for an agent-supplied url). Jon decided on 2026-09-10 that ` +
            `MCP links stay external.`
        ).not.toMatch(/prisma\.secureFile\.create/)
      })

      it('does not fetch the agent-supplied url server-side', () => {
        // Ingesting the bytes is the other way to "consolidate", and it is
        // ruled out by the remote-image host allowlist being empty by default.
        expect(
          source,
          `${path} appears to fetch an attachment url server-side. That is an SSRF ` +
            `surface the repo has already decided against (lib/security/remote-image.ts).`
        ).not.toMatch(/storeRemoteImageForUser|fetchRemoteImage/)
      })
    })
  }

  it('documents in the schema that Attachment is the external-link model', () => {
    const schema = read('prisma/schema.prisma')
    const model = schema.slice(schema.indexOf('model Attachment {'))
    const docBlock = schema.slice(
      Math.max(0, schema.lastIndexOf('\n\n', schema.indexOf('model Attachment {'))),
      schema.indexOf('model Attachment {')
    )

    expect(model, 'prisma/schema.prisma has no Attachment model').not.toBe('')
    expect(
      docBlock.toLowerCase(),
      `The Attachment model carries no explanation of what it is FOR. Without one, ` +
        `every reader has to guess whether it is the link model or a leftover — and ` +
        `three sessions guessed "leftover". Document it above the model.`
    ).toContain('link')
  })

  it('calls a link a link in the read path, not "legacy"', () => {
    const view = read('lib/task-attachments.ts')

    expect(
      view,
      `lib/task-attachments.ts still labels a link row source: 'legacy'. "Legacy" ` +
        `means "going away", which is the opposite of the decision, and it is the ` +
        `single word most responsible for this task being attempted three times.`
    ).not.toMatch(/source: 'legacy'/)

    expect(
      view,
      `lib/task-attachments.ts should discriminate a link row as source: 'link'.`
    ).toMatch(/source: 'link'/)
  })
})
