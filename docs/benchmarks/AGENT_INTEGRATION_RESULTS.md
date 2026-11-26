# Agent integration benchmark: results (AWTD-1551)

Method: [AGENT_INTEGRATION.md](./AGENT_INTEGRATION.md). Each run appends a section here, newest
first. Numbers are wall clock from the benchmarking machine, so they include the network.

## Run 1: 2026-11-26, preview, three passes

### Headline

- **Hosted MCP costs about 110–150 ms more per tool call than local stdio MCP for the same tool
  and the same response.** p50 on the same task: `get_task` 278 vs 152 ms, `get_task_comments`
  314 vs 160 ms, `get_agent_queue` 308 vs 194 ms. Local stdio calls the REST API directly from
  the agent's machine. Hosted `/mcp` receives the call and then reaches the REST API over HTTP
  through `fetchMCPBackend` (`lib/security/mcp-backend.ts`), which builds a new undici `Agent`
  per call. That second hop is the likely source of the difference. The benchmark points to it
  but does not prove it.
- **A queue read costs about 0.2–0.3 s**: REST `GET /api/v1/agent-queue` p50 212 ms, hosted MCP
  `get_agent_queue` p50 308 ms.
- **`add_comment` is the slowest call**: p50 592 ms, p95 979 ms over hosted MCP.
- **Responses grow with comments, by about 1 KB per comment.** `get_task` is 3.3 KB on a task with
  no comments and 32.9 KB with 31 one-line comments (about 8,200 tokens).
  `get_task_comments` grows from 0.8 KB to 30.4 KB. Every comment carries its author object and
  metadata. That costs an agent's context more than it costs time.
- **`tools/list` is 24.4 KB (about 6,100 tokens)**, paid once per session by every hosted-MCP
  client.
- **Scenario d (Claude Code / Codex run directly, with no Astrid) was not measured.** See *Limits*.

### Conditions

| | |
|---|---|
| Target | preview `https://awtd-1551-first-numbers.astrid.cc` (Vercel preview of this branch, built from `origin/main` 7fd15d27 plus harness-only changes; Cloudflare-proxied; function region pdx1; preview database `astrid_preview`) |
| Board | a throwaway private board and one task the harness created on the preview (`--scratch-board`). No production board was read or written. |
| Auth | client-credentials token exchanged on the preview from the script OAuth client (`ASTRID_OAUTH_CLIENT_*`). No hand-minted token. |
| Client | Apple M5, 32 GB, macOS 27.2.1, Node v26.5.0, wired `en0`, from the US west coast. Calls run one at a time, never concurrently. Node `fetch` keep-alive, so connections are warm after the warm-up call. |
| N | 30 samples per call per pass, plus one warm-up call that is not counted |
| Agent | `claude` mailbox |
| Date | 2026-11-26, 05:50–05:54 UTC |

### Pass A: scoped to the throwaway board, with `--write` (task starts with no comments)

`--scratch-board --samples 30 --write`. Hosted `get_task` and `get_task_comments` ran before
`add_comment`, so they saw a task with no comments. The stdio rows ran after 31 comments existed,
so compare their sizes with pass B, not with the hosted rows here.

| Scenario | Call | n | p50 ms | p95 ms | mean ± sd ms | median bytes | ~tokens |
|---|---|---|---|---|---|---|---|
| REST | GET /api/v1/agent-queue | 30 | 216 | 254 | 220.8 ± 18.9 | 1435 | 359 |
| hosted MCP | initialize | 30 | 145 | 201 | 152.2 ± 21.2 | 178 | 45 |
| hosted MCP | tools/list | 30 | 149 | 171 | 148.8 ± 11.5 | 24371 | 6093 |
| hosted MCP | get_agent_queue | 30 | 313 | 378 | 318.4 ± 25.6 | 2692 | 673 |
| hosted MCP | get_task | 30 | 277 | 354 | 288.8 ± 35.9 | 3325 | 832 |
| hosted MCP | get_task_comments | 30 | 278 | 347 | 289.3 ± 30.2 | 844 | 211 |
| hosted MCP | add_comment | 30 | 592 | 979 | 624.9 ± 122.6 | 1016 | 254 |
| stdio MCP | get_agent_queue | 30 | 207 | 314 | 229.4 ± 44.2 | 2692 | 673 |
| stdio MCP | get_task | 30 | 163 | 237 | 178.8 ± 31.9 | 32929 | 8233 |
| stdio MCP | get_task_comments | 30 | 163 | 221 | 174.8 ± 24.6 | 30448 | 7612 |

### Pass B: same board and task (31 comments), read-only

`--list <board> --task <task> --samples 30`. Hosted and stdio read the same task, so this is the
fair hosted-versus-stdio comparison.

| Scenario | Call | n | p50 ms | p95 ms | mean ± sd ms | median bytes | ~tokens |
|---|---|---|---|---|---|---|---|
| REST | GET /api/v1/agent-queue | 30 | 212 | 311 | 233.7 ± 43.6 | 1435 | 359 |
| hosted MCP | initialize | 30 | 137 | 236 | 148 ± 36.3 | 178 | 45 |
| hosted MCP | tools/list | 30 | 148 | 308 | 158.1 ± 47.8 | 24371 | 6093 |
| hosted MCP | get_agent_queue | 30 | 308 | 424 | 329.7 ± 50.7 | 2692 | 673 |
| hosted MCP | get_task | 30 | 278 | 389 | 295.1 ± 48.5 | 32930 | 8233 |
| hosted MCP | get_task_comments | 30 | 314 | 414 | 329.4 ± 59.2 | 30449 | 7613 |
| stdio MCP | get_agent_queue | 30 | 194 | 332 | 222.8 ± 52.8 | 2692 | 673 |
| stdio MCP | get_task | 30 | 152 | 227 | 167.3 ± 28.6 | 32929 | 8233 |
| stdio MCP | get_task_comments | 30 | 160 | 219 | 174 ± 31.5 | 30448 | 7612 |

### Pass C: unscoped queue (every board the client's owner can see on the preview)

`--task <task> --samples 30`, no `--list`. The queue read scans the preview database's copy of
the owner's boards, so its cost is closer to what a real agent pays.

| Scenario | Call | n | p50 ms | p95 ms | mean ± sd ms | median bytes | ~tokens |
|---|---|---|---|---|---|---|---|
| REST | GET /api/v1/agent-queue | 30 | 183 | 308 | 200.9 ± 46.2 | 2809 | 703 |
| hosted MCP | initialize | 30 | 140 | 246 | 155.8 ± 32.5 | 178 | 45 |
| hosted MCP | tools/list | 30 | 142 | 279 | 153.7 ± 38.4 | 24371 | 6093 |
| hosted MCP | get_agent_queue | 30 | 289 | 445 | 309 ± 80.9 | 3813 | 954 |
| hosted MCP | get_task | 30 | 278 | 368 | 284.5 ± 39.1 | 32930 | 8233 |
| hosted MCP | get_task_comments | 30 | 253 | 368 | 270.4 ± 40.1 | 30449 | 7613 |
| stdio MCP | get_agent_queue | 30 | 241 | 349 | 276.2 ± 137 | 5544 | 1386 |
| stdio MCP | get_task | 30 | 168 | 226 | 173.4 ± 27.1 | 32929 | 8233 |
| stdio MCP | get_task_comments | 30 | 140 | 222 | 152.1 ± 31.1 | 30448 | 7612 |

The unscoped queue is a different size through each path: 3.8 KB over hosted MCP and 5.5 KB over
stdio. The two servers shape the same queue differently.

### Baseline for the hosted MCP fast path (AWTD-1553)

Hosted MCP, p50 / p95 in ms, and median response bytes. A fast-path change should be re-measured
with the same command against a preview of its branch and compared with this table.

| Tool | Condition | p50 | p95 | bytes | Range of p50 across passes |
|---|---|---|---|---|---|
| get_agent_queue | throwaway board | 308 | 424 | 2,692 | 308–313 |
| get_agent_queue | unscoped | 289 | 445 | 3,813 | one pass |
| get_task | no comments | 277 | 354 | 3,325 | one pass |
| get_task | 31 comments | 278 | 389 | 32,930 | 278 (B and C) |
| get_task_comments | no comments | 278 | 347 | 844 | one pass |
| get_task_comments | 31 comments | 314 | 414 | 30,449 | 253–314 |
| add_comment | one-line comment | 592 | 979 | 1,016 | one pass |

For reference, the same reads over local stdio MCP have p50 152–241 ms. A trivial hosted call
with no database work (`initialize`) has p50 137–145 ms, so about 140 ms of every hosted call is
network and function overhead before any tool runs.

### Variance

Across the three passes, p50 for the same call varied by up to 20% (`get_task_comments` hosted,
253–314 ms). Most calls varied by less than 10%. Sample deviation was 10–20% of the mean,
except `add_comment` (20%) and unscoped stdio `get_agent_queue` (50%, from a few slow outliers).
Treat differences under about 50 ms between single runs as noise. Re-run with the same command
before believing a smaller change.

### Limits

- **Scenario d (direct harness, no Astrid) is not measured.** It has no automated form. The
  manual protocol in AGENT_INTEGRATION.md needs the Astrid loop to work a Ready task on a
  throwaway board, and the loop works the live board on production, which this benchmark must
  not touch. This run therefore measures how fast Astrid's calls are, not what Astrid costs a
  whole run compared with Claude Code or Codex used directly. A rough upper bound for the calls:
  an agent that reads the queue, reads a task and its comments, and posts two comments spends
  about 0.3 + 0.3 + 0.3 + 2 × 0.6 ≈ 2 s on Astrid calls over hosted MCP, or about 1.7 s with the
  three reads over stdio (stdio `add_comment` was not timed). Most agent runs take minutes.
- **Start latency (assignment to first agent action) is not measured.** It is wake latency,
  which belongs to the event-wake canary (AWTD-1556), not this harness.
- **The SDK channel and webhooks are not timed separately.** The SDK reads the queue through
  REST (`GET /api/v1/agent-queue`, above). Webhook delivery latency belongs to the receiver.
- **stdio `add_comment` was not run.** The harness writes only through hosted MCP, so each run
  posts one set of comments.
- **One client, one network, one region.** The client was on the US west coast and the function
  in pdx1. An agent in another region pays more round-trip time on every call, and hosted MCP
  pays it on both hops.
- **The preview database is not production.** It is smaller and less loaded than production, so
  database-bound calls (the unscoped queue, `add_comment`) may be slower in production.
- **~tokens is bytes ÷ 4.** It is a rough guide, not a tokenizer count.

### Reproduce

```bash
./scripts/deploy-preview.sh                       # preview of the branch under test
npm run bench:agents -- --origin https://<branch>.astrid.cc --agent claude \
  --scratch-board --samples 30 --write --json     # pass A; prints the board and task ids on stderr
npm run bench:agents -- --origin https://<branch>.astrid.cc --agent claude \
  --list <board> --task <task> --samples 30       # pass B
npm run bench:agents -- --origin https://<branch>.astrid.cc --agent claude \
  --task <task> --samples 30                      # pass C
```

The stdio scenario needs `npm run build:mcp:oauth` first, because `dist/` is gitignored.
