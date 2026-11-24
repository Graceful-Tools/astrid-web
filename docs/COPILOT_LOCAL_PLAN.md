# Copilot Local: Copilot working Astrid tasks on your own computer

**Status (2026-11-24):** for later. Decided by Jon on 2026-11-24: start locally, on Jon's Macs, in
December, and extend to Windows and other users only if it proves useful. Nothing is built.
The December start is the task "Copilot Local: spike the Rust SDK on a Mac".

This is the source of truth for the plan. The first investigation, which proposed Swift speaking
the runtime protocol directly, is `astrid-ios/docs/archive/MAC_LOCAL_COPILOT_2026-11-24.md`; this
file supersedes it. For server-run Copilot (the hosted gateway), see
[COPILOT_SDK_INTEGRATION_PLAN.md](./COPILOT_SDK_INTEGRATION_PLAN.md).

## What it is

GitHub Copilot running on the user's own Mac or Windows PC as its own Astrid agent,
`copilot-local@`. You assign it a task, it works in that list's folder on your computer, and when
it needs permission you tap the answer on your phone.

It is for people who already pay for Copilot and want it working their Astrid tasks on their own
machine, including local builds, simulators, private networks and folders that aren't on GitHub.
It costs Astrid nothing to run: it uses the user's machine and their Copilot plan.

What already exists, for comparison: server-run Copilot (no builds or tests), Copilot in GitHub
Actions (GitHub repos only), the Claude Code loop (local, set up by hand), and GitHub's own Copilot
app with remote control from GitHub Mobile. The case for ours is the Astrid side: the board,
decisions on the task, BYOK, and a partner's own build.

## How it works

```
Phone · web · desktop ──▶ Astrid server ──▶ Mac or Windows app ──▶ astrid-copilot (Rust) ──▶ repo folder
 assign, reply, tap        queue, events      settings, folders      claims, sessions,
                                                                     approvals; runtime as
                                                                     a child process
```

1. You assign a task to `copilot-local@`. The mailbox is in polling mode
   ([AGENT_POLLING_MODE.md](./AGENT_POLLING_MODE.md)), so the server sends nothing out and the
   computer picks the task up. Cloud Copilot (`copilot@`) stays separate.
2. The app claims the task, heartbeats the claim while it works, opens or resumes a Copilot
   session in the list's folder, and posts a short "Goal" comment.
3. When Copilot needs permission, a question answered or a plan approved, the app posts a
   `**Decision:**` comment ([DECISIONS.md](./DECISIONS.md)): Allow once, Allow for this task, Deny.
4. The reply answers that request by its id, and Copilot carries on. A reply in words becomes the
   next prompt.
5. When it finishes, it posts the result and moves the task to Review or Done, as the list's rules
   say.

Approvals follow the rules the Claude Code loop already uses
(`scripts/lib/permission-decision.mjs`, ADEV-249), ported once to Rust and shared by both apps.
Only the list's owner and admins can answer, and an unanswered request hands the task back instead
of waiting forever.

## The SDK

- **An official Rust SDK.** `copilot-sdk` on crates.io is one of six first-party SDKs (Node,
  Python, Go, .NET, Java, Rust) in `github.com/microsoft/copilot-sdk`. It needs Rust 1.94 or
  later; astrid-core is on 1.98.1.
- **One crate, both apps.** A new `astrid-copilot` crate in the astrid-core workspace holds the
  runner. The Mac app links it through `astrid-uniffi` and the Windows app through `astrid-ffi`.
  The `astrid-core` crate itself only gains an "agent" callback trait, so it keeps its
  no-platform-dependency rule.
- **Desktop only.** The runtime is built for macOS, Windows and Linux. There is none for iOS or
  Android, which is another reason it stays out of the core crate those apps build.
- **A child process.** v2 loads the runtime into the app by default, and a crash there takes the
  app down. Use `RuntimeConnection::SpawnedStdio`, so a runtime crash only ends the session.
- **Sessions:** create, resume and list; pick the model; set the working directory; add tools and
  MCP servers; stream events. Every permission request has an id that can be answered later.
- **Sign-in:** the user's GitHub login, counted against their Copilot plan, or their own OpenAI,
  Anthropic or Microsoft Foundry key (BYOK). Models always run in a cloud; there is no offline
  mode.
- **Licence:** the SDK is MIT. The runtime's licence allows shipping it unmodified inside an app
  that does more than run it, with its notices.
- **Version:** 2.0.2 was published 2026-11-24. Pin an exact version that has been out two weeks,
  so the earliest is the one current around 2026-12-08.

## Size

Measured from `@microsoft/copilot-sdk-darwin-arm64` 2.0.2:

| Part | Size | Notes |
|---|---|---|
| Native runtime (`runtime.node`) | 189 MB | Already stripped; about 130 MB is compiled code. About 87 MB compressed. This is the floor. |
| Extras: search tools, computer-use and browser plugins, schemas | ~55 MB | Not all needed for coding tasks |
| Whole package installed | 245 MB | 110 MB as a download |

**Download the runtime on first use** (about 90 MB), checked against a pinned hash, through the
crate's `local-runtime` feature. The alternatives are the user's own Copilot CLI (`default-features
= false`; nearly free, but only for people who installed it) or bundling, the crate's default, which
adds about 190 MB to every Mac and Windows build.

## Phases

Working days for one agent; estimates, not commitments.

**December, on Jon's Macs (9–14 days)**

| Phase | Delivers | Where | Size |
|---|---|---|---|
| 0 · Spike | A Rust example starts the runtime as a child process in a folder, streams one answer, and answers a permission request after a delay. | astrid-core (throwaway) | 1–2 d |
| 1 · Runner | The `astrid-copilot` crate and the `copilot-local@` mailbox in polling mode: a folder per list, claim with heartbeats, resume, session lifecycle, progress comments (Goal, Result, Needs you, Stopped). | astrid-core, astrid-web | 4–6 d |
| 2 · Approvals | Permission requests, questions and plan approvals become decision comments; replies answer them. ADEV-249's rules ported to Rust. | astrid-core, DECISIONS.md | 2–3 d |
| 3 · Mac edition | A Mac "Agent" configuration: own bundle id, no sandbox, hardened runtime, runtime downloaded on first use, Developer ID notarisation, Sparkle feed, DMG. | astrid-ios | 2–3 d |

**Later, if it proves useful**

| Phase | Delivers | Where | Size |
|---|---|---|---|
| 4 · Windows | The Windows app links the same crate through `astrid-ffi`: settings, first-use download, code signing, outside the Microsoft Store. | astrid-windows | 2–4 d |
| 5 · Targeting | Which computer is online, "Run on my computer" on a task, Stop, an optional live activity line. | astrid-web, astrid-core, iOS, web | 4–6 d |

## Risks

- **SDK churn.** v2 changed the protocol and the SDK is mid-rename from GitHub to Microsoft. Pin an
  exact version and upgrade deliberately.
- **The Rust SDK is the least travelled.** It has API docs but no cookbook yet. The spike tests it
  first.
- **An agent with shell access on someone's computer.** Approvals are the safeguard: only list
  owners and admins answer, and anything outside the allowed set waits for a tap or is denied.
- **Download size.** Show a clear message before the first-use download.
- **Notarising a downloaded binary** on the Mac, and code signing on Windows.

## Decisions

| # | Question | Answer |
|---|---|---|
| 1 | When? | **Decided (Jon, 2026-11-24):** later; start locally in December, extend if it makes sense. |
| 2 | Reuse `copilot@` or a new mailbox? | **Decided (Jon, 2026-11-24):** a separate `copilot-local@` agent. |
| 3 | How do the apps talk to Copilot? | Recommended: the Rust SDK in a shared `astrid-copilot` crate, runtime as a child process. |
| 4 | How does the runtime reach the user? | Recommended: download on first use, checked against a pinned hash. |
| 5 | Who is it for? | Recommended: Jon's Macs in December, then Windows, then a public Developer ID download. Never in either app store. |
