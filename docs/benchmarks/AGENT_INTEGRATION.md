# Agent integration benchmark (AWTD-1551)

**Goal:** know, rather than assume, what Astrid adds to an agent run compared with using Claude
Code or Codex directly, and where that overhead is. Nothing here claims parity until it is
measured.

**Status:** the harness exists and is tested. **First results are pending a preview token** (see
*Running it*). This document is updated with each run.

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
| — | — | — | pending: needs an access token (and optionally a client pair) on a preview |

Each run records: date, target, Node version, machine and network, N, and the results table the
harness prints. Baselines the MCP fast-path task (AWTD-1553) compares against go here first.
