# Agent integration benchmark (AWTD-1551)

**Goal:** know, rather than assume, what Astrid adds to an agent run compared with using Claude
Code or Codex directly, and where that overhead is. Nothing here claims parity until it is
measured.

**Status:** the harness exists and is tested. **First results (local server, scenarios a–c) are
below**; preview-network numbers and scenario d are still to do. This document is updated with
each run.

## What is measured

Per Astrid call, for each way an agent reaches Astrid:

| Measure | How |
|---|---|
| Latency p50 / p95, mean ± sample deviation | wall clock from this machine, one warm-up call excluded, N samples (default 20) |
| Response size | median bytes of the response body |
| Approximate tokens | median bytes / 4, a rough guide to what the call costs an agent's context |

Wall-clock time includes DNS, TLS and the network, so it is an upper bound on server time, the
same convention as `scripts/measure-api-latency.ts`.

## Scenarios

| | Scenario | What it exercises | Automated |
|---|---|---|---|
| a | **Hosted MCP** | `POST /mcp` JSON-RPC: `initialize`, `tools/list`, `get_agent_queue`, `get_task`, `get_task_comments`, and `add_comment` with `--write` | yes |
| b | **Local stdio MCP** | `mcp/astrid-mcp-launch.js` pointed at the target (`ASTRID_API_BASE_URL`): `get_agent_queue`, `get_task` | yes, when a client-credentials pair for the target is set |
| c | **REST (SDK / gate)** | `GET /api/v1/agent-queue`, the call a scheduled gate and the SDK channel make | yes |
| d | **Direct harness, no Astrid** | the same pinned task run straight in Claude Code / Codex | manual protocol below |

The webhook path is not timed by the harness: its latency is the receiving agent's, not
Astrid's. Wake latency (an event to the first queue read) is measured by the event-wake canary
(AWTD-1556), which feeds this document.

### Scenario d, the manual protocol

Pin a repository, a commit, a harness and model version, and a short plan (one task). Run it
N ≥ 5 times each way: (1) directly, `claude -p "<plan>"` in a clean checkout; (2) through
Astrid, the same plan as a Ready task on a throwaway board worked by the loop. Record wall time
start to finish and the harness's reported token usage. The difference is Astrid's overhead,
and scenarios a–c say which calls it comes from.

## Running it

**Never against production.** The harness refuses `astrid.cc`. Use a preview deployment (its
own `astrid_preview` database, docs/AGENT_FLEET.md) or a local dev server, and a throwaway
board.

```bash
# credentials for the TARGET, in the environment only (never printed):
#   ASTRID_BENCH_TOKEN                       access token on the target (REST + hosted MCP)
#   ASTRID_BENCH_CLIENT_ID / _CLIENT_SECRET   optional, enables the stdio scenario
npm run bench:agents -- --origin https://<preview>.vercel.app --agent claude \
  --list <throwaway board id> --task <task on it> --samples 20 [--write] [--json]
```

`--write` posts one comment per sample to `--task`, so use a task on the throwaway board only.

## Results

| Run | Target | Conditions | Result |
|---|---|---|---|
| 2026-11-26 | local production build (`next build` + `next start`) on a GitHub Actions runner, local Postgres, throwaway board and task | Node v26.13.1, 4 vCPU, loopback (no network or TLS), N = 20 per call after one warm-up, one run, `--write` | table below |

Seed the local target with `scripts/benchmarks/seed-local-bench.ts` (refuses any database that is
not on localhost); it prints the `ASTRID_BENCH_*` values and the
throwaway list and task ids.

**2026-11-26, local server (loopback):**

| Scenario | Call | n | p50 ms | p95 ms | mean ± sd ms | median bytes | ~tokens |
|---|---|---|---|---|---|---|---|
| REST | GET /api/v1/agent-queue | 20 | 5 | 13 | 6.3 ± 3 | 528 | 132 |
| hosted MCP | initialize | 20 | 4 | 6 | 4 ± 1 | 178 | 45 |
| hosted MCP | tools/list | 20 | 4 | 4 | 4.1 ± 0.2 | 24371 | 6093 |
| hosted MCP | get_agent_queue | 20 | 8 | 13 | 8.9 ± 2 | 857 | 215 |
| hosted MCP | get_task | 20 | 15 | 21 | 15.9 ± 2.8 | 2383 | 596 |
| hosted MCP | get_task_comments | 20 | 6 | 9 | 6.6 ± 1.3 | 105 | 27 |
| hosted MCP | add_comment | 20 | 7 | 11 | 7.6 ± 1.8 | 445 | 112 |
| stdio MCP | get_agent_queue | 20 | 4 | 7 | 4.2 ± 1.2 | 857 | 215 |
| stdio MCP | get_task | 20 | 9 | 12 | 9.8 ± 1.3 | 2383 | 596 |

**Reading these, and their limits**

- These are **server and handler cost only**. Loopback removes DNS, TLS and the network, a
  one-task board is the smallest possible, and the database is local. A preview over the internet
  will add its round trip to every row, and a real board's queue and `get_task` will be larger.
  Treat them as a floor, not as what an agent sees in production.
- **The one number that is already large is `tools/list`: 24 KB, about 6,100 tokens**, sent to an
  agent once per session by hosted MCP. It is the clearest candidate for the MCP fast-path task
  (AWTD-1553). Per-call responses are small (27 to 596 tokens).
- `get_task` is the slowest call (p50 15 ms hosted, 9 ms stdio) and the largest per-call response.
- Stdio measured faster than hosted on loopback (4 vs 8 ms for `get_agent_queue`). Do not read
  that as a transport verdict: this run cannot show how each behaves over a real network, so
  compare them again on a preview before concluding anything.
- One run, N = 20: the p95 of a 20-sample set is its second-worst value, so read p95 as indicative.
  Re-run with `--samples 100` before using a p95 to decide something.
- **Scenario d (direct Claude Code / Codex, no Astrid) is not measured.** It needs a harness
  with model credentials, which this runner does not have; the manual protocol above still
  applies, and no overhead or parity claim is made.

Each run records: date, target, Node version, machine and network, N, and the results table the
harness prints. Baselines the MCP fast-path task (AWTD-1553) compares against go here first.
