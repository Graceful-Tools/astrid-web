#!/usr/bin/env npx tsx
/**
 * Pull user feedback from two sources, triage with Claude, file actionable items
 * to the Astrid iOS to-do list. Read-only on the source lists.
 *
 *   1. App Store reviews (newer than last run)
 *   2. The "user feedback" Astrid list (id: ASTRID_FEEDBACK_LIST_ID)
 *
 * Required .env.local vars:
 *   ASTRID_OAUTH_CLIENT_ID, ASTRID_OAUTH_CLIENT_SECRET
 *   ASTRID_IOS_LIST_ID                 destination list (where filed tasks land)
 *   ASTRID_FEEDBACK_LIST_ID            source feedback list to triage
 *   APPLE_ASC_KEY_ID                   App Store Connect API key ID (e.g. "ABC123DEF4")
 *   APPLE_ASC_ISSUER_ID                Issuer UUID from App Store Connect → Users and Access → Keys
 *   APPLE_ASC_PRIVATE_KEY              Contents of the .p8 file (use \n for newlines or quoted multi-line)
 *   APPLE_APP_STORE_APP_ID             Numeric app ID (verify in App Store Connect)
 *   ANTHROPIC_API_KEY                  For Claude triage
 *
 * Flags:
 *   --dry-run                         triage but don't file tasks
 *   --source=reviews|feedback|all     default: all
 *
 * State file: ~/.config/astrid/user-feedback-state.json
 *   - lastRunAt             ISO; only App Store reviews newer than this are considered
 *   - seenReviewIds         rolling dedupe window for App Store reviews
 *   - seenFeedbackTaskIds   rolling dedupe window for feedback-list tasks
 */

import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import os from 'os'
import crypto from 'crypto'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const ASTRID_API_BASE = 'https://astrid.cc'
const ASC_API_BASE = 'https://api.appstoreconnect.apple.com'
const STATE_DIR = path.join(os.homedir(), '.config', 'astrid')
const STATE_FILE = path.join(STATE_DIR, 'user-feedback-state.json')
const DEDUPE_WINDOW = 500

interface State {
  lastRunAt: string
  seenReviewIds: string[]
  seenFeedbackTaskIds: string[]
}

interface Review {
  id: string
  rating: number
  title: string
  body: string
  reviewer: string
  territory: string
  createdAt: string
}

interface FeedbackTask {
  id: string
  title: string
  description: string
  recentComments: string[]
  createdAt: string
}

interface Triage {
  category: 'bug' | 'feature_request' | 'praise' | 'noise'
  summary: string
  severity: 1 | 2 | 3
  actionable: boolean
  reasoning: string
}

function loadState(): State {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      lastRunAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      seenReviewIds: [],
      seenFeedbackTaskIds: [],
    }
  }
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<State>
  return {
    lastRunAt: raw.lastRunAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    seenReviewIds: raw.seenReviewIds ?? [],
    seenFeedbackTaskIds: raw.seenFeedbackTaskIds ?? [],
  }
}

function saveState(state: State): void {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function signAscJwt(): string {
  const keyId = process.env.APPLE_ASC_KEY_ID
  const issuerId = process.env.APPLE_ASC_ISSUER_ID
  let privateKeyPem = process.env.APPLE_ASC_PRIVATE_KEY

  if (!keyId || !issuerId || !privateKeyPem) {
    throw new Error('Missing APPLE_ASC_KEY_ID / APPLE_ASC_ISSUER_ID / APPLE_ASC_PRIVATE_KEY')
  }

  privateKeyPem = privateKeyPem.replace(/\\n/g, '\n')

  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const payload = { iss: issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' }

  const b64url = (b: Buffer) => b.toString('base64url')
  const headerB64 = b64url(Buffer.from(JSON.stringify(header)))
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  const signingInput = `${headerB64}.${payloadB64}`

  const signature = crypto.sign('sha256', Buffer.from(signingInput), {
    key: privateKeyPem,
    dsaEncoding: 'ieee-p1363',
  })

  return `${signingInput}.${b64url(signature)}`
}

async function fetchReviews(jwt: string, appId: string, since: Date): Promise<Review[]> {
  const reviews: Review[] = []
  let url: string | null = `${ASC_API_BASE}/v1/apps/${appId}/customerReviews?sort=-createdDate&limit=200`

  while (url) {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } })
    if (!res.ok) {
      throw new Error(`App Store Connect ${res.status}: ${await res.text()}`)
    }
    const data = (await res.json()) as {
      data?: Array<{ id: string; attributes: any }>
      links?: { next?: string }
    }

    let stop = false
    for (const item of data.data || []) {
      const a = item.attributes
      if (new Date(a.createdDate) <= since) {
        stop = true
        break
      }
      reviews.push({
        id: item.id,
        rating: a.rating,
        title: a.title || '',
        body: a.body || '',
        reviewer: a.reviewerNickname || 'Anonymous',
        territory: a.territory || '',
        createdAt: a.createdDate,
      })
    }
    if (stop) break
    url = data.links?.next || null
  }
  return reviews
}

async function fetchFeedbackTasks(token: string, listId: string): Promise<FeedbackTask[]> {
  const url = `${ASTRID_API_BASE}/api/v1/tasks?listId=${listId}&completed=false&includeComments=true`
  const res = await fetch(url, {
    headers: { 'X-OAuth-Token': token, 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Astrid feedback fetch ${res.status}: ${await res.text()}`)

  const data = (await res.json()) as {
    tasks?: Array<{
      id: string
      title: string
      description?: string
      createdAt?: string
      comments?: Array<{ content: string; createdAt: string }>
    }>
  }

  return (data.tasks || []).map(t => ({
    id: t.id,
    title: t.title || '',
    description: t.description || '',
    createdAt: t.createdAt || '',
    recentComments: (t.comments || [])
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5)
      .map(c => c.content),
  }))
}

async function callTriage(prompt: string): Promise<Triage> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('Missing ANTHROPIC_API_KEY')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`)

  const data = (await res.json()) as { content?: Array<{ text?: string }> }
  const text = data.content?.[0]?.text || ''
  const json = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
  return JSON.parse(json) as Triage
}

const TRIAGE_RULES = `Respond with JSON only, no prose:
{
  "category": "bug" | "feature_request" | "praise" | "noise",
  "summary": "one-line problem statement, max 80 chars",
  "severity": 1 | 2 | 3,
  "actionable": true | false,
  "reasoning": "one sentence explaining the call"
}

Rules:
- "bug" = something broken, crashing, or behaving unexpectedly
- "feature_request" = user is asking for new functionality
- "praise" = positive feedback with no actionable item
- "noise" = vague, spam, off-topic, or not actionable
- "actionable" = true ONLY if a developer could plausibly act on this. Vague "doesn't work" with no detail = false.
- severity 3 = crash / data loss / can't use the app
- severity 2 = significant feature broken or strongly-requested feature
- severity 1 = minor / cosmetic / one-off`

const APP_CONTEXT = 'Astrid is an iOS to-do / task manager with offline support, shared lists, AI agents, repeating tasks, attachments, and per-list chat.'

function triageReview(review: Review): Promise<Triage> {
  return callTriage(`Triage this App Store review for ${APP_CONTEXT}

Review:
- Rating: ${review.rating}/5
- Territory: ${review.territory}
- Title: ${review.title}
- Body: ${review.body}

${TRIAGE_RULES}`)
}

function triageFeedbackTask(task: FeedbackTask): Promise<Triage> {
  const commentsBlock =
    task.recentComments.length > 0
      ? `\n\nRecent comments:\n${task.recentComments.map(c => `- ${c}`).join('\n')}`
      : ''
  return callTriage(`Triage this user feedback item for ${APP_CONTEXT}

Item:
- Title: ${task.title}
- Description: ${task.description || '(none)'}${commentsBlock}

${TRIAGE_RULES}`)
}

async function getAstridToken(): Promise<string> {
  const clientId = process.env.ASTRID_OAUTH_CLIENT_ID
  const clientSecret = process.env.ASTRID_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error('Missing ASTRID_OAUTH_CLIENT_ID / ASTRID_OAUTH_CLIENT_SECRET')
  }
  const res = await fetch(`${ASTRID_API_BASE}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  })
  if (!res.ok) throw new Error(`Astrid OAuth ${res.status}: ${await res.text()}`)
  return ((await res.json()) as { access_token: string }).access_token
}

async function createAstridTask(
  token: string,
  listId: string,
  title: string,
  description: string,
  priority: number
): Promise<void> {
  const res = await fetch(`${ASTRID_API_BASE}/api/v1/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OAuth-Token': token },
    body: JSON.stringify({ title, description, listIds: [listId], priority }),
  })
  if (!res.ok) throw new Error(`Astrid create-task ${res.status}: ${await res.text()}`)
}

function fileTitle(triage: Triage, sourceTag: string): string {
  const cat = triage.category === 'bug' ? '[Bug]' : '[Feature]'
  return `${cat}${sourceTag} ${triage.summary}`
}

function reviewDescription(review: Review, triage: Triage): string {
  return [
    `**Source:** App Store review (${review.territory})`,
    `**Rating:** ${review.rating}/5`,
    `**Reviewer:** ${review.reviewer}`,
    `**Posted:** ${review.createdAt}`,
    `**Triage:** ${triage.category} / severity ${triage.severity}`,
    `**Why:** ${triage.reasoning}`,
    '',
    '---',
    review.title ? `**${review.title}**` : '',
    review.body || '(no body)',
    '',
    '---',
    '_Filed automatically by `pull-user-feedback`. Review and decide before fixing._',
  ]
    .filter(line => line !== '')
    .join('\n')
}

function feedbackDescription(task: FeedbackTask, triage: Triage, feedbackListId: string): string {
  const commentsBlock =
    task.recentComments.length > 0
      ? `\n**Recent comments:**\n${task.recentComments.map(c => `- ${c}`).join('\n')}`
      : ''
  return [
    `**Source:** Astrid feedback list`,
    `**Source task:** ${task.id}`,
    `**Source URL:** ${ASTRID_API_BASE}/lists/${feedbackListId}`,
    `**Triage:** ${triage.category} / severity ${triage.severity}`,
    `**Why:** ${triage.reasoning}`,
    '',
    '---',
    `**${task.title}**`,
    task.description || '(no description)',
    commentsBlock,
    '',
    '---',
    '_Filed automatically by `pull-user-feedback`. Review and decide before fixing._',
  ]
    .filter(line => line !== '')
    .join('\n')
}

function parseSource(): 'reviews' | 'feedback' | 'all' {
  const arg = process.argv.find(a => a.startsWith('--source='))
  if (!arg) return 'all'
  const v = arg.slice('--source='.length)
  if (v === 'reviews' || v === 'feedback' || v === 'all') return v
  throw new Error(`Invalid --source: ${v} (expected reviews|feedback|all)`)
}

async function processReviews(
  state: State,
  iosListId: string,
  dryRun: boolean
): Promise<{ filed: number; newSeen: string[] }> {
  const appId = process.env.APPLE_APP_STORE_APP_ID
  if (!appId) {
    console.log('⏭️  Skipping reviews: APPLE_APP_STORE_APP_ID not set')
    return { filed: 0, newSeen: state.seenReviewIds }
  }

  const jwt = signAscJwt()
  console.log('🔑 Signed App Store Connect JWT')

  const since = new Date(state.lastRunAt)
  const reviews = await fetchReviews(jwt, appId, since)
  console.log(`📥 [reviews] ${reviews.length} newer than ${state.lastRunAt}`)

  const fresh = reviews.filter(r => !state.seenReviewIds.includes(r.id))
  console.log(`🆕 [reviews] ${fresh.length} unseen`)

  let filed = 0
  let token: string | null = null
  for (const review of fresh) {
    try {
      const triage = await triageReview(review)
      const flag = triage.actionable ? '✅' : '⏭️ '
      console.log(`  ${flag} ${review.rating}⭐ [${triage.category}/${triage.severity}] ${triage.summary}`)
      if (!triage.actionable) continue
      if (triage.category !== 'bug' && triage.category !== 'feature_request') continue
      if (dryRun) continue

      if (!token) token = await getAstridToken()
      await createAstridTask(
        token,
        iosListId,
        fileTitle(triage, '[App Store]'),
        reviewDescription(review, triage),
        triage.severity
      )
      filed++
    } catch (e) {
      console.error(`  ❌ review ${review.id}: ${e instanceof Error ? e.message : e}`)
    }
  }

  return {
    filed,
    newSeen: [...state.seenReviewIds, ...fresh.map(r => r.id)].slice(-DEDUPE_WINDOW),
  }
}

async function processFeedback(
  state: State,
  iosListId: string,
  dryRun: boolean
): Promise<{ filed: number; newSeen: string[] }> {
  const feedbackListId = process.env.ASTRID_FEEDBACK_LIST_ID
  if (!feedbackListId) {
    console.log('⏭️  Skipping feedback list: ASTRID_FEEDBACK_LIST_ID not set')
    return { filed: 0, newSeen: state.seenFeedbackTaskIds }
  }

  const token = await getAstridToken()
  const tasks = await fetchFeedbackTasks(token, feedbackListId)
  console.log(`📥 [feedback] ${tasks.length} open tasks on feedback list`)

  const fresh = tasks.filter(t => !state.seenFeedbackTaskIds.includes(t.id))
  console.log(`🆕 [feedback] ${fresh.length} unseen`)

  let filed = 0
  for (const task of fresh) {
    try {
      const triage = await triageFeedbackTask(task)
      const flag = triage.actionable ? '✅' : '⏭️ '
      console.log(`  ${flag} [${triage.category}/${triage.severity}] ${triage.summary}`)
      if (!triage.actionable) continue
      if (triage.category !== 'bug' && triage.category !== 'feature_request') continue
      if (dryRun) continue

      await createAstridTask(
        token,
        iosListId,
        fileTitle(triage, '[Feedback]'),
        feedbackDescription(task, triage, feedbackListId),
        triage.severity
      )
      filed++
    } catch (e) {
      console.error(`  ❌ feedback ${task.id}: ${e instanceof Error ? e.message : e}`)
    }
  }

  return {
    filed,
    newSeen: [...state.seenFeedbackTaskIds, ...fresh.map(t => t.id)].slice(-DEDUPE_WINDOW),
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const source = parseSource()
  const iosListId = process.env.ASTRID_IOS_LIST_ID
  if (!iosListId) throw new Error('Missing ASTRID_IOS_LIST_ID')

  const state = loadState()
  console.log(`📅 Last run: ${state.lastRunAt} | source: ${source}${dryRun ? ' | dry-run' : ''}`)

  let nextSeenReviews = state.seenReviewIds
  let nextSeenFeedback = state.seenFeedbackTaskIds
  let totalFiled = 0

  if (source === 'reviews' || source === 'all') {
    const r = await processReviews(state, iosListId, dryRun)
    nextSeenReviews = r.newSeen
    totalFiled += r.filed
  }

  if (source === 'feedback' || source === 'all') {
    const r = await processFeedback(state, iosListId, dryRun)
    nextSeenFeedback = r.newSeen
    totalFiled += r.filed
  }

  console.log(`\n🎯 Filed ${totalFiled} task${totalFiled === 1 ? '' : 's'} to iOS list`)

  if (!dryRun) {
    saveState({
      lastRunAt: new Date().toISOString(),
      seenReviewIds: nextSeenReviews,
      seenFeedbackTaskIds: nextSeenFeedback,
    })
  }
  console.log('✨ Done')
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}

export { main }
