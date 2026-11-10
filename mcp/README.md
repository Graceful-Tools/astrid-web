# MCP (Model Context Protocol) Servers

This directory contains the standalone MCP servers for the Astrid task management system.

## Files

### MCP Server Implementations
- **`mcp-server-oauth.ts`** - OAuth-enabled MCP server - **RECOMMENDED**
- **`mcp-server-v2.ts`** - Token-based MCP server (for development/testing)

### Build & Deployment
- **`build-mcp-oauth.js`** - Build script for OAuth-enabled server

## Usage

### Building the MCP Server

```bash
# From the project root directory
npm run build:mcp:oauth
```

This will:
1. Compile TypeScript to JavaScript
2. Create an executable script
3. Output the built server to `dist/mcp/mcp-server-oauth.js`

### Validating Configuration

Before using the MCP server, validate your OAuth configuration:

```bash
npm run validate:mcp:oauth
```

This will check:
- OAuth credentials are configured
- Connection to Astrid API works
- List access is properly set up
- MCP server is built correctly

### Running the MCP Server

The MCP server is designed to be used with AI assistants like Claude Desktop, not run manually.

See [Setup Guide](../docs/setup/MCP_OAUTH_SETUP.md) for complete configuration instructions.

### Claude Desktop Integration

Add this configuration to your Claude Desktop config:

```json
{
  "mcpServers": {
    "astrid-oauth": {
      "command": "node",
      "args": ["/absolute/path/to/project/mcp/astrid-mcp-launch.js"]
    }
  }
}
```

Keep credentials in the checkout's `.env.local`, as described in the
[MCP OAuth Setup Guide](../docs/setup/MCP_OAUTH_SETUP.md). The launcher loads that file
and sets `LOG_TO_STDERR=1` before loading the built server, keeping diagnostic logs off
the stdio JSON-RPC channel.

## MCP Server Versions

### OAuth Server - **RECOMMENDED**
The OAuth server (`mcp-server-oauth.ts`) includes:
- **Automatic OAuth Authentication** - No manual token provisioning
- **Token Management** - Automatic refresh and caching
- **Secure** - Uses OAuth 2.0 client credentials flow
- **AI Assistant Ready** - Works with Claude Desktop and ChatGPT
- **Production Ready** - Connects to astrid.cc or local development

### Token-Based Server (V2)
The V2 server (`mcp-server-v2.ts`) includes:
- **Token-Level Permissions** - Simplified access control at token provisioning level
- **Database-Backed Tokens** - Persistent token storage
- **Enhanced Security** - Multi-layer validation
- **Complete CRUD Operations** - 10 comprehensive operations for task management

## Documentation

For complete MCP setup and usage documentation, see:
- **[MCP OAuth Setup Guide](../docs/setup/MCP_OAUTH_SETUP.md)** - Complete OAuth MCP setup (RECOMMENDED)
- **[MCP Testing Guide](../docs/testing/MCP_TESTING_GUIDE.md)** - Comprehensive testing strategies
- **[Architecture Overview](../docs/ARCHITECTURE.md)** - System architecture
- **[Astrid Workflow Setup](../docs/setup/ASTRID_WORKFLOW_SETUP.md)** - OAuth configuration

## Development Notes

- These files are excluded from the main Next.js TypeScript compilation (see `tsconfig.json`)
- The MCP servers are standalone Node.js applications that connect to the Astrid API
- Use the build script to ensure proper compilation and executable creation
