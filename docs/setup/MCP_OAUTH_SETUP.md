# MCP OAuth Setup Guide

**Complete guide for connecting AI assistants to Astrid via MCP with OAuth authentication**

## Overview

The Astrid MCP Server V3 (OAuth) enables AI assistants like Claude Desktop and ChatGPT to interact with your Astrid tasks using OAuth 2.0 authentication. This eliminates the need for manual token provisioning and provides secure, scoped access to your task lists.

## Architecture

```
┌─────────────────┐
│ Claude Desktop  │
│   or ChatGPT    │
└────────┬────────┘
         │ MCP Protocol (stdio)
         │
┌────────▼────────────────────────┐
│  Astrid MCP Server V3           │
│  (OAuth-Enabled)                │
│                                 │
│  • Automatic token management   │
│  • Secure OAuth flow            │
│  • List-scoped access           │
└────────┬────────────────────────┘
         │ OAuth 2.0 client_credentials
         │ X-OAuth-Token header
         │
┌────────▼────────────────────────┐
│  Astrid.cc API                  │
│  (Production or Local)          │
└─────────────────────────────────┘
```

## Prerequisites

### 1. OAuth Client Credentials

You need OAuth credentials from Astrid.cc:

**Production (astrid.cc):**
1. Visit [https://astrid.cc/settings/api-access](https://astrid.cc/settings/api-access)
2. Click "Create OAuth Client"
3. Fill in details:
   - Name: "Claude Desktop MCP" (or your preferred name)
   - Description: "AI assistant integration via MCP"
   - Grant Types: Select "client_credentials"
   - Scopes: Select `tasks:read`, `tasks:write`, `lists:read`, `comments:read`, `comments:write`
4. Save and **copy the Client ID and Client Secret immediately** (secret shown only once!)

**Local Development:**
- If running Astrid locally, use your local OAuth credentials
- API base URL: `http://localhost:3000`

### 2. List ID

Get the UUID of the list you want to grant access to:

1. Visit the list on Astrid.cc
2. Copy the UUID from the URL:
   - URL: `https://astrid.cc/lists/a623f322-4c3c-49b5-8a94-d2d9f00c82ba`
   - List ID: `a623f322-4c3c-49b5-8a94-d2d9f00c82ba`

**Recommended:** Use your "Astrid Bugs & Polish" list or create a dedicated list for AI agents.

### 3. Build the MCP Server

From your project root:

```bash
# Build the OAuth MCP server
npm run build:mcp:oauth
```

This creates:
- `dist/mcp-server-oauth.js` - Compiled JavaScript
- `mcp/astrid-mcp-oauth` - Executable script

## Setup Instructions

### For Claude Desktop

**1. Locate Claude Desktop Configuration File**

The configuration file location varies by platform:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

**2. Add MCP Server Configuration**

Edit the configuration file and add:

```json
{
  "mcpServers": {
    "astrid-oauth": {
      "command": "node",
      "args": ["/absolute/path/to/your/project/dist/mcp-server-oauth.js"],
      "env": {
        "ASTRID_OAUTH_CLIENT_ID": "astrid_client_xxxxxxxxxxxxx",
        "ASTRID_OAUTH_CLIENT_SECRET": "your_secret_here",
        "ASTRID_OAUTH_LIST_ID": "your-list-uuid-here",
        "ASTRID_API_BASE_URL": "https://astrid.cc"
      }
    }
  }
}
```

**Important:**
- Replace `/absolute/path/to/your/project` with the actual absolute path
- Use forward slashes `/` even on Windows
- Set `ASTRID_API_BASE_URL` to `http://localhost:3000` for local development

**3. Example Configuration**

```json
{
  "mcpServers": {
    "astrid-oauth": {
      "command": "node",
      "args": ["/Users/jonparis/Documents/mycode/astrid-res/www/dist/mcp-server-oauth.js"],
      "env": {
        "ASTRID_OAUTH_CLIENT_ID": "astrid_client_abc123def456",
        "ASTRID_OAUTH_CLIENT_SECRET": "secret_xyz789uvw012",
        "ASTRID_OAUTH_LIST_ID": "a623f322-4c3c-49b5-8a94-d2d9f00c82ba",
        "ASTRID_API_BASE_URL": "https://astrid.cc"
      }
    }
  }
}
```

**4. Restart Claude Desktop**

Completely quit and restart Claude Desktop for the changes to take effect.

**5. Verify Connection**

In Claude Desktop, try:
```
Can you list my Astrid tasks?
```

Claude should now be able to access and manage your Astrid tasks!

### For OpenAI GPTs / ChatGPT Desktop

OpenAI’s MCP support works with the exact same OAuth server. Each teammate just needs to drop the configuration below into their ChatGPT MCP config file and supply their own Astrid OAuth credentials.

**1. Locate the OpenAI MCP configuration file**

| Platform | Path |
| --- | --- |
| macOS | `~/Library/Application Support/OpenAI/ChatGPT/mcp_config.json` |
| Windows | `%APPDATA%\OpenAI\ChatGPT\mcp_config.json` |
| Linux | `~/.config/OpenAI/ChatGPT/mcp_config.json` |

> If the file doesn’t exist yet, create it manually. Refer to OpenAI’s MCP docs for the latest file locations as the desktop app is still evolving.

**2. Add the Astrid server entry**

```json
{
  "mcpServers": {
    "astrid-oauth": {
      "command": "node",
      "args": ["/absolute/path/to/astrid-res/www/dist/mcp-server-oauth.js"],
      "env": {
        "ASTRID_OAUTH_CLIENT_ID": "astrid_client_xxxxxxxxxxxxx",
        "ASTRID_OAUTH_CLIENT_SECRET": "your_secret_here",
        "ASTRID_OAUTH_LIST_ID": "your-list-uuid-here",
        "ASTRID_API_BASE_URL": "https://astrid.cc"
      }
    }
  }
}
```

Tips:
- Use the fully-qualified path to the `dist/mcp-server-oauth.js` file.
- Forward slashes work on every platform (`C:/Users/...` on Windows).
- Point `ASTRID_API_BASE_URL` to `http://localhost:3000` when developing against a local Astrid instance.

**3. Restart ChatGPT**

Quit the ChatGPT desktop app completely, relaunch it, then open your custom GPT and attach the “astrid-oauth” server. ChatGPT will now have direct access to the MCP tools.

**4. Each teammate brings their own credentials**

Because OAuth clients are scoped per Astrid user, share these instructions with teammates. They simply:
1. Create an OAuth client inside Astrid (Settings → API Access)
2. Paste their Client ID, Client Secret, and preferred List ID into the `mcp_config.json`
3. Restart ChatGPT and start issuing Astrid commands (e.g., “List my Astrid bugs”)

### For GitHub Copilot / VS Code

VS Code (GitHub Copilot agent mode) connects to the **hosted** Astrid MCP server
over OAuth — no local build, no manual token. VS Code discovers the OAuth server
from Astrid's RFC 9728 metadata and opens a browser to sign you in on first
connect.

Astrid supports OAuth dynamic client registration and S256 PKCE, so public MCP
hosts—including Copilot CLI, Codex, and IDE integrations that cannot safely store
a client secret—can register themselves during that first connection. You do not
need to create an API Access client or paste a secret into their configuration.

**1. Add the server to `.vscode/mcp.json`** (workspace) — or your user `mcp.json`
via the *MCP: Open User Configuration* command:

```json
{
  "servers": {
    "astrid": {
      "type": "sse",
      "url": "https://www.astrid.cc/mcp"
    }
  }
}
```

**2. Start it & sign in** — click **Start** on the server in `mcp.json` (or run
*MCP: List Servers*). A browser opens for Astrid sign-in; approve the requested
scopes. The Astrid tools then appear in Copilot agent mode's tool picker.

Notes:
- OAuth clients that support RFC 7591 use
  `/api/v1/oauth/register`, then complete authorization-code OAuth with S256 PKCE.
  Confidential server integrations can continue using a manually created client
  and `client_credentials`; the two client types remain separate.
- **Either host works.** `astrid.cc/mcp` and `www.astrid.cc/mcp` are both fine —
  `/mcp` is exempt from the apex→www redirect. It used to redirect, and clients
  dropped the `Authorization` header when they followed it, producing a 401 that
  looked like bad credentials (task a0e0808c).
- Astrid serves **both transports**. Streamable HTTP (`"type": "http"`) posts
  JSON-RPC to the single `/mcp` URL and is what current clients prefer. The older
  **SSE** transport (`"type": "sse"`, a GET stream plus a separate
  `/mcp/messages` POST URL) still works for clients that need it.
- Prefer **workspace `.vscode/mcp.json`** over a repo-root `.mcp.json` — VS Code
  has a known bug where custom `headers` in `.mcp.json` are silently dropped. You
  don't need `headers` here anyway (OAuth is automatic), but keep to
  `.vscode/mcp.json` to avoid surprises.

### Remote HTTP/SSE MCP server (OpenAI Responses API & connectors)

You now have two options:

#### Option A – Use the hosted Astrid endpoint

- **Server URL:** `https://astrid.cc/mcp` — one URL for Streamable HTTP: POST
  your JSON-RPC there and read the reply from the response body. For the older
  SSE transport, GET the same URL for the stream and POST messages to
  `https://astrid.cc/mcp/messages`.
- **Auth model:** bring your own Astrid OAuth credentials. Astrid never shares its own client ID/secret.

Supported headers:

| Header | Required? | Notes |
| --- | --- | --- |
| `Authorization: Bearer <astrid_access_token>` | One of Bearer or Basic required | Obtain the token via `/api/v1/oauth/token` using your client credentials. |
| `Authorization: Basic base64(client_id:client_secret)` | Alternative to Bearer | The server exchanges these credentials for a token on every session (scoped to your Astrid account). |
| `X-Astrid-Access-Token` | Optional | Same as Bearer but useful if you don’t want to use the standard Authorization header. |
| `X-Astrid-Client-Id` + `X-Astrid-Client-Secret` | Optional | Same as Basic auth. |
| `X-Astrid-List-Id` | Optional | Overrides your default list for this connection. |
| `X-Astrid-API-Base-URL` | Optional | Point the MCP server at another Astrid deployment (e.g., `http://localhost:3000`). |

Usage flow:

1. **Create your Astrid OAuth client** (Settings → API Access) and note the Client ID/Secret + desired list ID.
2. **Fetch an access token** (or let the server do it via Basic auth):
   ```bash
   curl https://astrid.cc/api/v1/oauth/token \
     -H "Content-Type: application/json" \
     -d '{
       "grant_type": "client_credentials",
       "client_id": "astrid_client_xxx",
       "client_secret": "super_secret"
     }'
   ```
3. **Call the Responses API / Custom GPT Action** with the hosted server URL:

   ```jsonc
   {
     "type": "mcp",
     "server_label": "astrid_tasks",
     "server_description": "Read, create, and complete Astrid tasks",
     "server_url": "https://astrid.cc/mcp",
     "authorization": "Bearer astrid_access_token_from_step_2",
     "require_approval": "always",
     "allowed_tools": ["get_lists","get_tasks","create_task","update_task","add_comment"]
   }
   ```

   *Prefer to let Astrid exchange client credentials on the fly?* Replace the `authorization` field with your Basic credentials: `Authorization: Basic base64(client_id:client_secret)`.

4. **Every teammate repeats steps 1–3** with their own OAuth client, so tokens stay scoped to their Astrid data.

#### Option B – Self-host the HTTP/SSE server

Prefer to run the transport yourself (custom domain, private VPC, staging, etc.)? Use the bundled binary.

1. **Build the binaries** (only required once per checkout):
   ```bash
   npm run build:mcp:oauth
   ```
   Outputs:
   - `mcp/astrid-mcp-oauth-http` – executable wrapper
   - `dist/mcp-server-oauth-http.js` – compiled HTTP/SSE entry point

2. **Run or deploy the server** with your Astrid OAuth credentials:
   ```bash
   ASTRID_OAUTH_CLIENT_ID=astrid_client_xxx \
   ASTRID_OAUTH_CLIENT_SECRET=super_secret \
   ASTRID_OAUTH_LIST_ID=a623f322-4c3c-49b5-8a94-d2d9f00c82ba \
   ASTRID_MCP_HTTP_AUTH_TOKEN=astrid_shared_secret \
   PORT=8787 \
   ./mcp/astrid-mcp-oauth-http
   ```

   Key environment variables:

   | Variable | Required | Default | Description |
   | --- | --- | --- | --- |
   | `ASTRID_OAUTH_CLIENT_ID` | ✅ | – | Astrid OAuth client ID |
   | `ASTRID_OAUTH_CLIENT_SECRET` | ✅ | – | Astrid OAuth client secret |
   | `ASTRID_OAUTH_LIST_ID` | ⚠️ Recommended | – | Default list UUID for MCP calls |
   | `ASTRID_API_BASE_URL` | No | `https://astrid.cc` | Point to local Astrid when testing |
   | `ASTRID_MCP_HTTP_AUTH_TOKEN` | ✅ for shared deployments | – | Token every remote caller must supply in `Authorization: Bearer <token>` |
   | `ASTRID_MCP_HTTP_PORT` / `PORT` | No | `8787` | HTTP listen port |
   | `ASTRID_MCP_SSE_PATH` | No | `/mcp` | GET path for SSE stream |
   | `ASTRID_MCP_POST_PATH` | No | `/mcp/messages` | POST endpoint for JSON-RPC payloads |
   | `ASTRID_MCP_ENABLE_DNS_PROTECTION` | No | `false` | Enable Host/Origin allowlists |
   | `ASTRID_MCP_ALLOWED_HOSTS` | No | – | Comma-separated Host header allowlist |
   | `ASTRID_MCP_ALLOWED_ORIGINS` | No | – | Comma-separated Origin allowlist |

3. **Point OpenAI (or any MCP client) at your server URL** with the same JSON block shown above—just swap `server_url` + `authorization` to match your deployment.

4. **Share carefully**: anyone who knows your hosted URL *and* the auth token can issue Astrid API calls. Rotate the token or regenerate the OAuth client to revoke access instantly.

5. **Health check**: `GET /healthz` returns `{ "status": "ok" }` so you can plug it into uptime monitors.

## Available MCP Tools

Once configured, AI assistants can use these tools:

### Task Management
- `get_lists` - Get all accessible task lists
- `get_tasks` - Get tasks from a list (uses default list if not specified)
- `get_task` - Get detailed information about a specific task
- `create_task` - Create a new task
- `update_task` - Update an existing task (including marking as complete)

### Comments
- `add_comment` - Add a comment to a task
- `get_task_comments` - Get all comments for a task

### Resources
- `lists://all` - Browse all accessible lists

## Usage Examples

### Claude Desktop Usage

**Get tasks:**
```
Show me my uncompleted tasks from Astrid
```

**Create task:**
```
Create a new task in Astrid:
- Title: "Fix OAuth token refresh"
- Description: "Implement automatic token refresh before expiry"
- Priority: 2
```

**Update task:**
```
Mark task [task-id] as completed
```

**Add comment:**
```
Add a comment to task [task-id]: "Started working on this. Found the issue in the auth middleware."
```

**Get task details:**
```
Get full details for task [task-id] including all comments
```

## Configuration Options

### Environment Variables

All configuration is via environment variables in the `claude_desktop_config.json`:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ASTRID_OAUTH_CLIENT_ID` | ✅ Yes | - | OAuth client ID from Astrid |
| `ASTRID_OAUTH_CLIENT_SECRET` | ✅ Yes | - | OAuth client secret |
| `ASTRID_OAUTH_LIST_ID` | ⚠️ Recommended | - | Default list UUID (can be overridden per call) |
| `ASTRID_API_BASE_URL` | No | `https://astrid.cc` | API base URL (use `http://localhost:3000` for local) |

### Optional List ID

If you don't set `ASTRID_OAUTH_LIST_ID`:
- You must provide `listId` parameter in each tool call
- More flexible but requires explicit list specification

If you set `ASTRID_OAUTH_LIST_ID`:
- Used as default for all operations
- Can still override with `listId` parameter in specific calls

## Troubleshooting

### "OAuth credentials not configured"

**Problem:** Missing or invalid OAuth credentials

**Solution:**
1. Check that `ASTRID_OAUTH_CLIENT_ID` and `ASTRID_OAUTH_CLIENT_SECRET` are set
2. Verify credentials are correct (copy-paste from Astrid settings)
3. Ensure no extra spaces or quotes in the values

### "Failed to obtain access token"

**Problem:** OAuth token request failed

**Solutions:**
1. **Check API URL:**
   - Production: `https://astrid.cc`
   - Local: `http://localhost:3000`
2. **Verify OAuth client:**
   - Visit [https://astrid.cc/settings/api-access](https://astrid.cc/settings/api-access)
   - Check that your OAuth client is active
   - Verify grant type is `client_credentials`
3. **Check scopes:**
   - Required: `tasks:read`, `tasks:write`, `lists:read`, `comments:read`, `comments:write`

### "No list ID provided and no default list configured"

**Problem:** No list specified and no default configured

**Solution:**
1. Add `ASTRID_OAUTH_LIST_ID` to your configuration
2. Or specify `listId` parameter in each tool call

### "Invalid or expired access token"

**Problem:** Token expired or invalid

**Solution:**
- Tokens are automatically refreshed
- If issue persists, check OAuth client is still active
- Restart Claude Desktop to clear token cache

### Claude Desktop not seeing the MCP server

**Problem:** MCP tools not available in Claude

**Solutions:**
1. **Check file path:**
   - Must be absolute path (e.g., `/Users/username/...`)
   - Use forward slashes `/` even on Windows
2. **Verify build:**
   - Run `npm run build:mcp:oauth` again
   - Check that `dist/mcp-server-oauth.js` exists
3. **Check configuration file:**
   - Valid JSON (no trailing commas)
   - Correct environment variables
4. **Restart Claude Desktop:**
   - Completely quit (not just close window)
   - Restart the application

### Debugging Connection Issues

Enable detailed logging:

1. Run the MCP server manually to see error messages:
   ```bash
   ASTRID_OAUTH_CLIENT_ID="your_id" \
   ASTRID_OAUTH_CLIENT_SECRET="your_secret" \
   ASTRID_OAUTH_LIST_ID="your_list_id" \
   ASTRID_API_BASE_URL="https://astrid.cc" \
   node dist/mcp-server-oauth.js
   ```

2. Check the output for connection errors
3. Test OAuth credentials directly:
   ```bash
   npm run test:oauth
   ```

## Security Considerations

### OAuth Client Security

- **Keep secrets safe:** Never commit OAuth secrets to version control
- **Separate clients:** Use different OAuth clients for different purposes
- **Scope restriction:** Only grant necessary scopes
- **Regular rotation:** Consider rotating secrets periodically

### Access Control

- **List-scoped:** Access is limited to specified list(s)
- **OAuth scopes:** Further restricts what operations are allowed
- **Token expiry:** Tokens expire and are refreshed automatically
- **Revocation:** Disable OAuth client in Astrid to revoke access immediately

### Token Storage at Rest

- **MCP tokens (dual storage):** the `token` column stores a SHA-256 hash (used for lookup) and a separate `tokenEncrypted` column stores the AES-256-GCM ciphertext (used to reveal/reuse the plaintext).
- **OAuth access/refresh tokens:** stored hashed at rest (SHA-256) with dual-read — lookup matches either the hash or legacy plaintext during migration.

## Advanced Configuration

### Multiple Lists

To give access to multiple lists, you can:

1. **Option A:** Create separate MCP server instances with different list IDs
2. **Option B:** Don't set default list, specify `listId` in each call
3. **Option C:** Create a custom OAuth client with broader list access

### Custom Base URL (Local Development)

For local development against `localhost:3000`:

```json
{
  "mcpServers": {
    "astrid-local": {
      "command": "node",
      "args": ["/path/to/dist/mcp-server-oauth.js"],
      "env": {
        "ASTRID_OAUTH_CLIENT_ID": "local_client_id",
        "ASTRID_OAUTH_CLIENT_SECRET": "local_secret",
        "ASTRID_OAUTH_LIST_ID": "local_list_id",
        "ASTRID_API_BASE_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Running Both Production and Local

You can configure both simultaneously:

```json
{
  "mcpServers": {
    "astrid-production": {
      "command": "node",
      "args": ["/path/to/dist/mcp-server-oauth.js"],
      "env": {
        "ASTRID_API_BASE_URL": "https://astrid.cc",
        "ASTRID_OAUTH_CLIENT_ID": "prod_client_id",
        "ASTRID_OAUTH_CLIENT_SECRET": "prod_secret",
        "ASTRID_OAUTH_LIST_ID": "prod_list_id"
      }
    },
    "astrid-local": {
      "command": "node",
      "args": ["/path/to/dist/mcp-server-oauth.js"],
      "env": {
        "ASTRID_API_BASE_URL": "http://localhost:3000",
        "ASTRID_OAUTH_CLIENT_ID": "local_client_id",
        "ASTRID_OAUTH_CLIENT_SECRET": "local_secret",
        "ASTRID_OAUTH_LIST_ID": "local_list_id"
      }
    }
  }
}
```

Then specify which one to use: "Use the astrid-production server" or "Use astrid-local"

## Support & Documentation

- **MCP Protocol:** [Model Context Protocol Docs](https://modelcontextprotocol.io/)
- **Astrid OAuth:** [OAuth Setup Guide](./ASTRID_WORKFLOW_SETUP.md)
- **Claude Desktop:** [Anthropic Documentation](https://docs.anthropic.com/)
- **MCP Server Code:** `/mcp/mcp-server-oauth.ts`

## Next Steps

After successful setup:

1. **Test basic operations:** Get lists, create tasks, add comments
2. **Integrate with workflow:** Use Claude to manage your development tasks
3. **Automate task creation:** Have Claude create tasks from bug reports or feature requests
4. **Task analysis:** Let Claude analyze and prioritize your task backlog

## Related Documentation

- [Astrid Workflow Setup](./ASTRID_WORKFLOW_SETUP.md) - OAuth setup for production workflow
- [MCP Testing Guide](../testing/MCP_TESTING_GUIDE.md) - Testing MCP servers
- [Architecture Overview](../ARCHITECTURE.md) - System architecture

---

**Questions or Issues?**
- Check the [Troubleshooting](#troubleshooting) section above
- Run `npm run test:oauth` to validate OAuth connection
- Review MCP server logs for detailed error messages
