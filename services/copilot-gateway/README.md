# Copilot gateway

A small HTTPS service that runs [`@microsoft/copilot-sdk`](https://www.npmjs.com/package/@microsoft/copilot-sdk)
next to its runtime, so Astrid's server can use Copilot without bundling the runtime
(about 200 MB) into a Vercel function, and without sending users' GitHub tokens over the SDK's
only remote transport, which is plaintext TCP. Why this shape:
[docs/COPILOT_SDK_INTEGRATION_PLAN.md, Phase 2](../../docs/COPILOT_SDK_INTEGRATION_PLAN.md).

It is its own package. It is not in the root `package.json` or workspaces, and the root's
TypeScript, ESLint and Vitest configs skip it. Astrid calls it from
`lib/ai/providers/copilot-provider.ts` when `COPILOT_GATEWAY_URL` and `COPILOT_GATEWAY_SECRET`
are both set (ADEV-245).

## API

The request and response types are in [`src/contract.ts`](./src/contract.ts), a copy of
`lib/ai/providers/copilot-gateway-contract.ts`. A root test fails if the two differ.

| Route | Auth | Body | Returns |
|---|---|---|---|
| `GET /healthz` | none | | `{ ok, sdkVersion, runtimeVersion }` |
| `POST /v1/turns` | bearer | `{ githubToken, model, prompt, maxTokens?, jsonOnly?, tools?: [{ name, description, parameters }] }` | a turn response |
| `POST /v1/turns/:turnId/tool-results` | bearer | `{ results: [{ id, output }] }` | a turn response |

A turn response is either `{ status: "done", text, usage }` or
`{ status: "tool_calls", turnId, calls: [{ id, name, arguments }] }`. On `tool_calls`, run the calls
and post their outputs to `/v1/turns/:turnId/tool-results`. Repeat until `done`.

- **Auth:** `Authorization: Bearer $COPILOT_GATEWAY_SECRET`, compared in constant time. Anything
  else gets `401`.
- **Sessions:** one SDK session per turn, created with `mode: "empty"`, the caller's token through
  `github.tokenProvider`, the tools as declarations only (`tools.availableTools` is exactly those
  names), the cross-session store off, and an in-memory session filesystem. The session is
  disconnected and deleted when the turn ends.
- **Expiry:** a turn waiting on tool results for 5 minutes is aborted and deleted. Its id then
  gets `404`.
- **Errors:** `400` bad body, `401` bad secret, `404` unknown or expired turn, `409` results
  posted while the turn is still running, `413` body over 5 MB, `502` Copilot refused (bad
  token, model or quota), `504` Copilot took longer than 55 seconds for one step. Error
  bodies are `{ error }` with fixed text and never include request values.
- **Logging:** JSON lines on stdout: method, route, status and duration, plus turn ids, tool
  names and error types. Request bodies are never logged. As a backstop, the shared secret and
  each live user token are scrubbed from every line.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `COPILOT_GATEWAY_SECRET` | yes | Shared bearer secret, at least 32 characters (`openssl rand -hex 32`). The same value goes in Astrid's `COPILOT_GATEWAY_SECRET`. |
| `PORT` | no | Listen port, default `8080`. |

The gateway has no GitHub credentials of its own. Every session uses the token in its request.
TLS is the host's job: put it behind the platform's HTTPS endpoint, and never expose the
container's port directly.

## Run locally

```bash
cd services/copilot-gateway
npm ci
npm test                     # vitest, SDK faked, no network
npm run build
COPILOT_GATEWAY_SECRET="$(openssl rand -hex 32)" PORT=8080 npm start
curl -s localhost:8080/healthz
```

With Docker:

```bash
docker build -t astrid-copilot-gateway services/copilot-gateway
docker run --rm -p 8080:8080 -e COPILOT_GATEWAY_SECRET=... astrid-copilot-gateway
```

To point a local Astrid at it, set `COPILOT_GATEWAY_URL=http://localhost:8080` and the same
`COPILOT_GATEWAY_SECRET` in `.env.local`.

## Tests

`npm test` here, or `npm run test:copilot-gateway` from the repo root. The root script is part of
`npm run predeploy` (the "Copilot Gateway" gate). The tests fake the SDK client, so the root can
run them without installing this package's dependencies.

## Hosting

Not deployed by the PR that added it. Hosting is a separate step (ADEV-246): one small
always-on instance (Azure Container Apps, Fly or similar) with HTTPS on the host's domain, the
secret set on both sides, and `COPILOT_GATEWAY_URL` set in Vercel. To roll back, unset
`COPILOT_GATEWAY_URL` in Vercel. Astrid then uses the REST path again.

## Upgrading the SDK

The SDK is pinned exactly (`2.0.1`). The integration plan says to wait until a release has been
out for two weeks. 2.0.1 was published 2026-11-18, so it reaches that on 2026-12-02, before
hosting is expected. To upgrade, change the pin, run `npm install`, `npm run typecheck` (the
SDK's types are the source of truth for `src/sdk-client.ts`) and `npm test`.
