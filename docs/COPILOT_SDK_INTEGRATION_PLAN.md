# GitHub Copilot SDK Integration

**Status:** Implemented in code; server OAuth application configuration is required before use.

## Supported architecture

Astrid uses GitHub's supported `@github/copilot-sdk` and a separate OAuth or
GitHub App. Each user authorizes their own GitHub account, so Copilot requests
use that user's identity, subscription, policies, and quota.

The implementation intentionally does not call private
`api.githubcopilot.com` endpoints or impersonate another editor's integration
identifier.

1. `GET /api/v1/integrations/copilot/authorize` creates an HMAC-signed,
   provider-tagged OAuth state and returns GitHub's authorization URL.
2. The callback exchanges the one-time code and encrypts access and refresh
   tokens in `CopilotCredential`.
3. Agent execution retrieves the user's token and supplies it to the Copilot
   SDK at both client and session scope.
4. The SDK runs in `empty` mode, skips cross-session embedding retrieval, and
   receives only Astrid's explicitly registered tools.

## Runtime modes

- With no `COPILOT_CLI_URL`, the Node SDK starts its bundled Copilot runtime.
- With `COPILOT_CLI_URL`, Astrid connects to a separately operated headless
  runtime. Per-session GitHub tokens maintain user isolation.

The external runtime is recommended for production serverless deployments to
avoid cold-starting a CLI process during a request.

## Required configuration

```text
GITHUB_COPILOT_CLIENT_ID
GITHUB_COPILOT_CLIENT_SECRET
```

Optional:

```text
COPILOT_CLI_URL
```

Set the GitHub application's callback URL to:

```text
https://<astrid-host>/api/v1/integrations/copilot/callback
```

Do not store tokens in source, scripts, or client-side storage. OAuth tokens
are encrypted by the existing field-encryption service.

## Compatibility

The integration is additive. Existing Claude, OpenAI, Gemini, OpenClaw, legacy
API routes, and v1 routes retain their existing wire contracts. Copilot
credential status and authorization are exposed only through new v1 routes.

## Verification

Focused tests cover:

- agent registry and routing;
- OAuth state tamper, expiry, and provider-replay rejection;
- encrypted token retrieval and refresh;
- SDK empty-mode isolation and explicit tool registration;
- cleanup after successful and failed SDK calls.

Before deployment, run `npm run predeploy` and verify the OAuth callback with a
non-production GitHub application and an account that has an active Copilot
subscription.
