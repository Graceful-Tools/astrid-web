# ChatGPT Actions Integration Guide

> **Goal:** Allow ChatGPT custom GPTs to read, create, and complete Astrid tasks using Astrid's OAuth-protected API.

## Overview

Astrid now exposes:

1. **User-consent OAuth flow** at `/oauth/authorize` (authorization code + refresh tokens)
2. **Public OpenAPI spec** at `/.well-known/astrid-openapi.yaml`
3. **Plugin manifest** at `/.well-known/ai-plugin.json`

With these pieces you can build a GPT Action, share it with the team, and every user authorizes the integration with their own Astrid account.

## Requirements

- Astrid account with access to Settings → Connections
- ChatGPT Plus (custom GPT + Actions)
- Ability to create OAuth clients inside Astrid

## Step 1 – Create a ChatGPT OAuth client

1. Go to **Settings → Connections → New App**
2. Name it something like **“ChatGPT Actions”**
3. Select scope group **AI Agent**, then verify these scopes stay ticked:
   - `tasks:read`
   - `tasks:write`
   - `lists:read`
   - `comments:write`
4. Enable grant types:
   - `authorization_code`
   - `refresh_token` (auto-added when auth code is selected)
5. Add the official ChatGPT redirect URI:

   ```
   https://chat.openai.com/aip/api/v1/oauth/callback
   ```

6. Save the client and secure the **Client ID** + **Client Secret** (needed in GPT Builder).

## Step 2 – Configure the GPT Action

Open GPT Builder → **Actions** → **Add action** → choose **Import from URL** (or paste the OpenAPI spec manually).

| Setting | Value |
| --- | --- |
| **Manifest URL** | `https://astrid.cc/.well-known/ai-plugin.json` *(replace domain if self-hosting)* |
| **OpenAPI URL** | `https://astrid.cc/.well-known/astrid-openapi.yaml` |
| **OAuth Authorization URL** | `https://astrid.cc/oauth/authorize` |
| **OAuth Token URL** | `https://astrid.cc/api/v1/oauth/token` |
| **OAuth Scopes** | `tasks:read tasks:write lists:read comments:write` |
| **Redirect URL** | `https://chat.openai.com/aip/api/v1/oauth/callback` |

When prompted, paste the **Client ID** and **Client Secret** from the OAuth app you just created.

Publish or share your GPT. When users click **Connect Astrid**, they are redirected to `/oauth/authorize` to sign in and approve scopes.

## Step 3 – Test and Share

After connecting:

- Ask ChatGPT: “List my open Astrid tasks named launch”.
- Create tasks: “Add an Astrid task called ‘Ship onboarding flow’ due Friday”.
- Complete tasks: “Mark the Astrid task ‘Prepare board deck’ as done”.

Share your GPT link. Each collaborator completes OAuth once and gains their own scoped access token.

## Helpful URLs

| Purpose | URL |
| --- | --- |
| OAuth consent | `https://astrid.cc/oauth/authorize` |
| Token endpoint | `https://astrid.cc/api/v1/oauth/token` |
| Manifest | `https://astrid.cc/.well-known/ai-plugin.json` |
| OpenAPI | `https://astrid.cc/.well-known/astrid-openapi.yaml` |
| Settings page | `https://astrid.cc/settings/chatgpt` |

*(Replace `https://astrid.cc` with your deployment origin when self-hosting.)*

## Troubleshooting

- **401 Unauthorized:** Ensure the GPT action uses the correct client ID/secret and that the OAuth app has both `authorization_code` and `refresh_token` grant types.
- **Invalid redirect URI:** Double-check the redirect string matches exactly (`https://chat.openai.com/aip/api/v1/oauth/callback`).
- **Wrong scopes:** If ChatGPT reports insufficient permissions, edit the OAuth client to include the recommended scope set, then reconnect.
- **Need to revoke access:** Go to Settings → Connections → delete/regenerate the ChatGPT client to revoke all refresh tokens immediately.
