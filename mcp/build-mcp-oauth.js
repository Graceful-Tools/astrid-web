#!/usr/bin/env node

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🔨 Building Astrid MCP Server (OAuth Version)...');

// Both servers import `../lib/brand/config` and `../lib/logger`, so the repo
// root — not `mcp/` — is the root tsc infers across the input set, and the
// output lands at `dist/mcp/<name>.js` with `dist/lib/` beside it. The script
// used to look for `dist/<name>.js` and report "Compilation failed" for a
// compile that had in fact succeeded.
const compiledPathFor = (output) => path.join(__dirname, '..', 'dist', 'mcp', output);

const artifacts = [
  {
    input: 'mcp-server-oauth.ts',
    output: 'mcp-server-oauth.js',
    executable: 'astrid-mcp-oauth',
    description: 'stdio transport (Claude Desktop, local tooling)',
    postBuildLog: () => {
      const mcpServerPath = compiledPathFor('mcp-server-oauth.js');
      console.log('\n🚀 To test the stdio MCP server:');
      console.log(`   node "${mcpServerPath}"`);
      console.log('\n📋 Claude/Desktop config snippet:');
      console.log(JSON.stringify({
        mcpServers: {
          "astrid-oauth": {
            command: "node",
            args: [mcpServerPath],
            env: {
              ASTRID_OAUTH_CLIENT_ID: "astrid_client_xxxxx",
              ASTRID_OAUTH_CLIENT_SECRET: "your_secret_here",
              ASTRID_OAUTH_LIST_ID: "your-list-uuid",
              ASTRID_API_BASE_URL: "https://astrid.cc"
            }
          }
        }
      }, null, 2));
    },
  },
  {
    input: 'mcp-server-oauth-http.ts',
    output: 'mcp-server-oauth-http.js',
    executable: 'astrid-mcp-oauth-http',
    description: 'HTTP/SSE transport (remote MCP for OpenAI/Responses API)',
    postBuildLog: () => {
      const remoteServerPath = compiledPathFor('mcp-server-oauth-http.js');
      console.log('\n🌐 To start the HTTP/SSE MCP server:');
      console.log('   ASTRID_OAUTH_CLIENT_ID=xxx \\');
      console.log('   ASTRID_OAUTH_CLIENT_SECRET=yyy \\');
      console.log('   ASTRID_OAUTH_LIST_ID=list_uuid \\');
      console.log('   ASTRID_MCP_HTTP_AUTH_TOKEN=supersecret \\');
      console.log(`   node "${remoteServerPath}"`);
      console.log('\n   ➜ The SSE endpoint will be available at http://localhost:8787/mcp (POST: /mcp/messages)');
    },
  },
];

try {
  for (const artifact of artifacts) {
    console.log(`\n📦 Compiling ${artifact.input} (${artifact.description})...`);
    execSync(
      `npx tsc ${artifact.input} --ignoreConfig --target es2020 --module node16 --moduleResolution node16 --outDir ../dist --esModuleInterop --skipLibCheck`,
      { stdio: 'inherit' }
    );

    const compiledPath = compiledPathFor(artifact.output);
    const executablePath = path.join(__dirname, artifact.executable);

    if (!fs.existsSync(compiledPath)) {
      console.error(`❌ Compilation failed - ${compiledPath} not found`);
      process.exit(1);
    }

    console.log(`🔧 Creating executable ${artifact.executable}...`);
    const content = fs.readFileSync(compiledPath, 'utf8');
    const executableContent = `#!/usr/bin/env node
${content}`;

    fs.writeFileSync(executablePath, executableContent);
    execSync(`chmod +x "${executablePath}"`);

    console.log(`✅ Built ${artifact.description}`);
    console.log(`   • Executable: ${executablePath}`);
    console.log(`   • Compiled JS: ${compiledPath}`);

    artifact.postBuildLog?.();
  }

  console.log('\n💡 Configuration Tips:');
  console.log('   • Get OAuth credentials from https://astrid.cc/settings/api-access');
  console.log('   • Set ASTRID_OAUTH_LIST_ID to your preferred Astrid list UUID');
  console.log('   • ASTRID_API_BASE_URL defaults to https://astrid.cc (use http://localhost:3000 for local dev)');

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
