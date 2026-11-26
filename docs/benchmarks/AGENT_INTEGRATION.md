# Agent integration benchmark (AWTD-1551)

**Goal:** know, rather than assume, what Astrid adds to an agent run compared with using Claude
Code or Codex directly, and where that overhead is. Nothing here claims parity until it is
measured.

**Status:** the harness exists and is tested. First results (2026-11-26, scenarios a–c) are in
[AGENT_INTEGRATION_RESULTS.md](./AGENT_INTEGRATION_RESULTS.md). Scenario d is still unmeasured.

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
| b | **Local stdio MCP** | `mcp/astrid-mcp-launch.js` pointed at the target (`ASTRID_API_BASE_URL`): `get_agent_queue`, `get_task`, `get_task_comments` | yes, when a client-credentials pair for the target is set (needs `npm run build:mcp:oauth`) |
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
# credentials, from the environment only (never printed). By default nothing extra is needed:
# the harness exchanges the script client ASTRID_OAUTH_CLIENT_ID / _SECRET for a
# client-credentials token ON THE TARGET, which a preview's database knows. Optional overrides:
#   ASTRID_BENCH_TOKEN                       a ready access token on the target
#   ASTRID_BENCH_CLIENT_ID / _CLIENT_SECRET   a client pair that exists only on the target
npm run bench:agents -- --origin https://<branch>.astrid.cc --agent claude \
  --scratch-board --samples 30 [--write] [--json]
# or, against a board you already made on the target:
#   --list <throwaway board id> --task <task on it>
```

`--scratch-board` creates a new private board and one task on the target and benchmarks against
them. `--write` posts one comment per sample to the task, so use a throwaway task only.

The stdio launcher reloads the local env file with `override: true`, so it ignores what the
harness passes when the file disagrees. The harness skips the stdio scenario rather than let
that happen: when the file sets `ASTRID_API_BASE_URL` to another origin, or a BENCH pair would
be replaced by the script pair.

MCP tool errors arrive as HTTP 200 with `isError`. The harness fails the run on one instead of
timing an error message as if it were an answer.

## Results

| Run | Target | Conditions | Result |
|---|---|---|---|
| 1, 2026-11-26 | preview of 7fd15d27 | Apple M5, Node 26.5, N=30 × 3 passes, throwaway board | [AGENT_INTEGRATION_RESULTS.md](./AGENT_INTEGRATION_RESULTS.md#run-1-2026-11-26-preview-three-passes): hosted MCP tool calls p50 ≈ 280–310 ms, about 110–150 ms slower than stdio; `add_comment` p50 592 ms |

Each run records: date, target, Node version, machine and network, N, and the results table the
harness prints. Baselines the MCP fast-path task (AWTD-1553) compares against are in the results
file.
