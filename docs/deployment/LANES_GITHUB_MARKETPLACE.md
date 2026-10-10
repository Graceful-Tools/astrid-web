# Lanes for GitHub Projects — the GitHub App and its Marketplace listing

What to type into GitHub when registering the App behind
`brands/github-projects.brand.json` and publishing its listing (AWTD-1121; spec
docs/specs/GITHUB_PROJECTS_WHITELABEL.md §8.6, §12).

**Status: draft copy. Nothing here is registered or published.** The App slug in the
profile, `lanes-for-github-projects`, is a placeholder until step 1 is done.

The generic checklist for any GitHub-backed brand is
[WHITELABELING.md §8](../WHITELABELING.md#a-github-projects-partner). This file holds only
what is specific to Lanes.

## 1. Register the App

Under the **Graceful Tools** organisation: Settings → Developer settings → GitHub Apps →
New GitHub App.

| Field | Value |
|---|---|
| GitHub App name | `Lanes for GitHub Projects` |
| Homepage URL | `https://projects.gracefultools.com` |
| Callback URLs | `https://projects.gracefultools.com/api/auth/callback/github` and `https://projects.gracefultools.com/api/github/setup` |
| Request user authorization (OAuth) during installation | on |
| Expire user authorization tokens | on |
| Setup URL | `https://projects.gracefultools.com/api/github/setup` |
| Webhook URL | `https://projects.gracefultools.com/api/github/webhooks` |
| Webhook secret | generate one; it becomes `GITHUB_WEBHOOK_SECRET` |
| Where can this App be installed | Any account |

**Permissions.** The coding agent is off for this brand, so it asks for no write access
to code.

| Permission | Access | Why the listing says it is needed |
|---|---|---|
| Organization → Projects | Read and write | Show a project as a board, and write an edit made in Lanes back to it |
| Repository → Issues | Read and write | Titles, descriptions, comments, assignees and state of the issues on a board |
| Repository → Pull requests | Read-only | Pull requests that sit on a board as items |
| Repository → Metadata | Read-only | Required by GitHub for every App |
| Organization → Members | Read-only | Decide who may see a board from their GitHub access, never from a claim |
| Account → Email addresses | Read-only | Sign in with the user's verified primary address |

**Events:** Installation · Projects v2 · Projects v2 item · Issues · Issue comment ·
Sub issues · Label · Milestone · Pull request · Member · Membership · Organization.

If the slug GitHub assigns is not `lanes-for-github-projects`, change
`NEXT_PUBLIC_BRAND_GITHUB_APP_SLUG` in the profile **and** `expect.githubAppSlug` beside
it, and re-run `npm run check:brands`.

## 2. Listing copy

GitHub's rules for a listing name are the same trademark rule `check:brands` enforces:
the name may end with "for GitHub Projects" and may not start with "GitHub".

**Name:** Lanes for GitHub Projects

**Very short description:**

> A fast, focused client for the GitHub Projects you already run.

**Primary category:** Project management.

**Introductory description:**

> Lanes is a fast, focused client for the GitHub Projects your team already runs. Sign
> in with GitHub, pick a project, and it opens as a board you can work from any browser.

The profile's tagline is "Your GitHub Projects, on every device". The listing does not
say that yet, on purpose: the branded iPhone and Mac apps are not built
([AITD-465](https://astrid.cc/t/AITD-465), [AITD-466](https://astrid.cc/t/AITD-466)).
Add "iPhone and Mac" and the Mobile category when they ship.

**Detailed description:**

> **GitHub stays the source of truth.** Lanes mirrors your organisation's projects and
> writes every change straight back: move a card, edit a title, reassign an issue or
> leave a comment in Lanes and it is on GitHub, attributed to you. There is nothing to
> migrate and nothing to keep in sync by hand.
>
> **Your GitHub permissions are the permissions.** What you can see and change in Lanes
> is what you can see and change on GitHub. Lanes reads access from GitHub; it has no
> separate sharing model to configure or to get wrong.
>
> **Built for the work between the meetings.** A personal Today view across every
> project you are on, due dates and reminders, and private lists for the things that are
> not issues yet.
>
> **Single sign-on** for organisations that require it.

**What it does not do**, stated on the listing so nobody installs it expecting otherwise:
it does not read or write repository contents, and it does not replace GitHub Issues —
it is a client for them.

**Support:** `support@projects.gracefultools.com` · **Privacy policy** and **Terms:**
the brand's `/privacy` and `/terms` pages.

**Pricing:** not decided. The platform takes no position (spec §15 C4): a free listing
needs nothing further, and a paid one needs a `marketplace_purchase` webhook handler
that does not exist yet.

## 3. Still to supply

- A logo and feature card. The profile reuses the GitHub-styled whitelabel artwork until
  the brand has its own, and a listing cannot be submitted without them.
- Screenshots, which need the preview deployment from WHITELABELING §8 step 5.
- GitHub requires a publisher-verified organisation before a listing can be published.
