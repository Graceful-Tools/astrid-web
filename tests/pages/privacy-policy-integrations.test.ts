/**
 * AWTD-938 — the privacy policy must describe every integration that touches
 * personal data, not just the ones it happened to describe first.
 *
 * The page named only "Google and Apple for authentication" under External
 * Services, while the app also mirrors lists to GitHub Issues and imports
 * contacts. Found while reading the policy for a Microsoft Store submission,
 * whose listing asserts a GitHub sharing relationship the linked policy did
 * not describe — the kind of mismatch store certification catches.
 *
 * Two things here are sharper than the task recorded, and both are asserted:
 *
 *  1. GitHub is a GitHub APP INSTALLATION (installationId/appId/privateKey),
 *     not a personal OAuth token. Describing it as an OAuth token would state
 *     a mechanism we do not use.
 *  2. Contacts arrive from TWO places, and one is Google: the app requests
 *     `contacts.readonly` and reads people.googleapis.com. That makes them
 *     Google user data, so the Google User Data section — the one that closes
 *     by invoking the Limited Use requirements — has to cover the scope too,
 *     or the page claims Limited Use over a scope it never mentions.
 *
 * Asserted against the page source rather than a render: this is about what
 * the document SAYS, and a source check stays honest if the markup changes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'app/[locale]/privacy/page.tsx'), 'utf8')

/**
 * Collapse whitespace before matching prose.
 *
 * JSX wraps sentences across lines at arbitrary points, so `email addresses are
 * not encrypted` is really `email\n              addresses are not encrypted`
 * in the file. Asserting on the raw source makes a passing test depend on where
 * the formatter happened to break the line, which is not what any of these
 * cases are about.
 */
const page = source.replace(/\s+/g, ' ')

describe('the privacy policy describes the GitHub integration (AWTD-938)', () => {
  it('names GitHub at all', () => {
    expect(page).toMatch(/GitHub/)
  })

  it('names GitHub under External Services, beside Google and Apple', () => {
    const externalServices = page.slice(page.indexOf('External Services'))
    expect(externalServices).toMatch(/GitHub/)
  })

  it('says a scheduled job drives the sync, which a reader cannot infer', () => {
    // The difference between the GitHub and Google descriptions: Google sync is
    // client-driven, GitHub is a cron. So GitHub access continues while the
    // integration is connected even with no client running, and someone reading
    // this to understand what we touch and when needs to be told.
    expect(page).toMatch(/every 15 minutes/)
    expect(page).toMatch(/without .{0,40}(client|app|device)|even when|while connected/i)
  })

  it('does not call the GitHub credential an OAuth token', () => {
    // GitHubIntegration stores installationId/appId/privateKey — a GitHub App
    // installation. "OAuth token" would describe a mechanism we do not use.
    const githubSection = page.slice(page.indexOf('GitHub Issues'))
    expect(githubSection).not.toMatch(/GitHub OAuth token/i)
  })

  it('states that the credential is encrypted and removed on disconnect', () => {
    expect(page).toMatch(/encrypt/i)
    expect(page).toMatch(/disconnect/i)
  })
})

describe('the privacy policy describes imported contacts (AWTD-938)', () => {
  it('lists contacts in What We Collect', () => {
    const whatWeCollect = page.slice(page.indexOf('What We Collect'), page.indexOf('How We Use It'))
    expect(whatWeCollect).toMatch(/contact/i)
  })

  it('says contacts are imported only when the user asks', () => {
    expect(page).toMatch(/only when you|at your request|choose to import/i)
  })

  it('names both import routes, since one of them is Google', () => {
    // Device upload and Google Contacts. Naming only the upload would leave the
    // Google scope undisclosed.
    expect(page).toMatch(/Google Contacts/)
  })

  it('is honest about WHICH contact fields are encrypted', () => {
    // name and phoneNumber go through encryptField; email is normalized
    // lowercase and used as a unique key, so it is NOT encrypted. Implying
    // blanket encryption would overclaim.
    expect(page).toMatch(/email addresses are not|email is not encrypted|except.{0,30}email/i)
  })

  it('names the deletion route that exists (DELETE /api/v1/contacts)', () => {
    expect(page).toMatch(/clear|delete/i)
  })
})

describe('the Google User Data section covers every Google scope requested (AWTD-938)', () => {
  it('covers Google Contacts, not only Google Tasks', () => {
    // The section closes by invoking the Google API Services User Data Policy
    // and its Limited Use requirements. Claiming that while omitting the
    // contacts.readonly scope would make the assertion untrue of that scope.
    const googleSection = page.slice(
      page.indexOf('id="google-user-data"'),
      page.indexOf('Infrastructure'),
    )
    expect(googleSection).toMatch(/Contacts/)
    expect(googleSection).toMatch(/Limited Use/)
  })
})

describe('the policy says what absence means (AWTD-938)', () => {
  it('tells a user who connected neither that none of this is stored', () => {
    // The case most readers are in, and the one that gets left unsaid.
    expect(page).toMatch(/never connected|have not connected|do not use (these|this)/i)
  })
})
