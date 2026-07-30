"use strict";
/**
 * Claude Code CLI Executor
 *
 * Manages Claude Code CLI interactions with session support.
 * Uses --print for non-interactive mode and --resume for session continuity.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.claudeExecutor = exports.ClaudeExecutor = void 0;
const child_process_1 = require("child_process");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
class ClaudeExecutor {
    model;
    maxTurns;
    timeout;
    constructor(options = {}) {
        // Use 'opus' alias which points to Claude Opus 4.5 (claude-opus-4-5-20251101)
        this.model = options.model || process.env.CLAUDE_MODEL || 'opus';
        this.maxTurns = options.maxTurns || parseInt(process.env.CLAUDE_MAX_TURNS || '10', 10);
        this.timeout = options.timeout || parseInt(process.env.CLAUDE_TIMEOUT || '900000', 10); // 15 minutes default
    }
    /**
     * Create MCP config file for Claude Code
     * Returns the path to the config file, or undefined if no MCP token
     */
    async createMcpConfig(session, mcpToken) {
        if (!mcpToken) {
            return undefined;
        }
        const mcpConfig = {
            mcpServers: {
                astrid: {
                    command: 'npx',
                    args: ['-y', '@anthropic-ai/mcp-astrid'],
                    env: {
                        ASTRID_API_URL: process.env.ASTRID_CALLBACK_URL || 'https://astrid.cc/api',
                        ASTRID_ACCESS_TOKEN: mcpToken
                    }
                }
            }
        };
        // Write to a temp file in the persistent sessions directory
        // This matches the Fly.io volume mount at /app/persistent
        const configPath = path_1.default.join(process.env.DATA_DIR || '/app/persistent/sessions', `mcp-config-${session.taskId}.json`);
        await promises_1.default.writeFile(configPath, JSON.stringify(mcpConfig, null, 2));
        console.log(`📝 Created MCP config at: ${configPath}`);
        return configPath;
    }
    /**
     * Clean up MCP config file after session
     */
    async cleanupMcpConfig(session) {
        const configPath = path_1.default.join(process.env.DATA_DIR || '/app/persistent/sessions', `mcp-config-${session.taskId}.json`);
        try {
            await promises_1.default.unlink(configPath);
            console.log(`🧹 Cleaned up MCP config: ${configPath}`);
        }
        catch {
            // File may not exist, ignore
        }
    }
    /**
     * Capture git diff and modified files after execution
     */
    async captureGitChanges(projectPath) {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        try {
            // Get modified files (staged and unstaged)
            const statusOutput = execSync('git status --porcelain', {
                cwd: projectPath,
                encoding: 'utf-8',
                timeout: 10000
            });
            const files = statusOutput
                .split('\n')
                .filter(line => line.trim())
                .map(line => line.slice(3).trim()); // Remove status prefix
            // Get diff (staged and unstaged, limited to 5000 chars)
            let diff = '';
            try {
                diff = execSync('git diff HEAD --no-color', {
                    cwd: projectPath,
                    encoding: 'utf-8',
                    timeout: 10000,
                    maxBuffer: 1024 * 1024 // 1MB max
                });
                // Truncate if too long
                if (diff.length > 5000) {
                    diff = diff.slice(0, 5000) + '\n\n[... diff truncated ...]';
                }
            }
            catch {
                // No diff or not a git repo
            }
            console.log(`📊 Git changes: ${files.length} files modified`);
            return { diff, files };
        }
        catch (error) {
            console.log(`⚠️ Could not capture git changes: ${error}`);
            return { diff: '', files: [] };
        }
    }
    /**
     * Extract PR URL from Claude output
     */
    extractPrUrl(output) {
        // Match GitHub PR URLs
        const prUrlPatterns = [
            /https:\/\/github\.com\/[^\/]+\/[^\/]+\/pull\/\d+/g,
            /PR URL:\s*(https:\/\/[^\s]+)/i,
            /Pull Request:\s*(https:\/\/[^\s]+)/i
        ];
        for (const pattern of prUrlPatterns) {
            const match = output.match(pattern);
            if (match) {
                return match[0].replace(/PR URL:\s*/i, '').replace(/Pull Request:\s*/i, '');
            }
        }
        return undefined;
    }
    /**
     * Read CLAUDE.md or ASTRID.md from project for context
     * Limits context to MAX_CONTEXT_CHARS to avoid API timeouts
     */
    async readProjectContext(projectPath) {
        const MAX_CONTEXT_CHARS = 4000; // Limit context to avoid slow API calls
        const contextFiles = ['CLAUDE.md', 'ASTRID.md', 'CODEX.md'];
        let context = '';
        for (const file of contextFiles) {
            try {
                const filePath = path_1.default.join(projectPath, file);
                let content = await promises_1.default.readFile(filePath, 'utf-8');
                // Truncate if too long
                if (content.length > MAX_CONTEXT_CHARS) {
                    content = content.slice(0, MAX_CONTEXT_CHARS) + '\n\n[... truncated for brevity ...]';
                    console.log(`📄 Loaded project context from ${file} (truncated from ${content.length} to ${MAX_CONTEXT_CHARS} chars)`);
                }
                else {
                    console.log(`📄 Loaded project context from ${file} (${content.length} chars)`);
                }
                context += `\n\n## Project Instructions (from ${file})\n\n${content}`;
                break; // Only use the first found file
            }
            catch {
                // File doesn't exist, try next
            }
        }
        return context;
    }
    /**
     * Format comment history for context
     */
    formatCommentHistory(comments) {
        if (!comments || comments.length === 0)
            return '';
        const formatted = comments
            .slice(-10) // Last 10 comments for context
            .map(c => `**${c.authorName}** (${new Date(c.createdAt).toLocaleString()}):\n${c.content}`)
            .join('\n\n---\n\n');
        return `\n\n## Previous Discussion\n\n${formatted}`;
    }
    /**
     * Detect platform from task title and description
     */
    detectPlatform(title, description) {
        const text = `${title} ${description || ''}`.toLowerCase();
        // iOS indicators (high confidence)
        const iosKeywords = ['ipad', 'iphone', 'ios', 'swift', 'swiftui', 'xcode', 'uikit', 'testflight', 'app store'];
        const iosMatches = iosKeywords.filter(k => text.includes(k));
        if (iosMatches.length > 0) {
            return { platform: 'ios', confidence: iosMatches.length >= 2 ? 'high' : 'medium' };
        }
        // Android indicators
        const androidKeywords = ['android', 'kotlin', 'java', 'gradle', 'play store', 'apk'];
        const androidMatches = androidKeywords.filter(k => text.includes(k));
        if (androidMatches.length > 0) {
            return { platform: 'android', confidence: androidMatches.length >= 2 ? 'high' : 'medium' };
        }
        // Web indicators
        const webKeywords = ['web', 'browser', 'react', 'next', 'vercel', 'css', 'html', 'typescript', 'javascript', 'component'];
        const webMatches = webKeywords.filter(k => text.includes(k));
        if (webMatches.length > 0) {
            return { platform: 'web', confidence: webMatches.length >= 2 ? 'high' : 'medium' };
        }
        return { platform: 'unknown', confidence: 'low' };
    }
    /**
     * Get platform-specific instructions
     */
    getPlatformInstructions(platform) {
        switch (platform) {
            case 'ios':
                return `
## Platform: iOS

**IMPORTANT**: This is an iOS/iPadOS task. Look for code in:
- \`ios-app/\` directory (Swift/SwiftUI code)
- \`*.swift\` files
- Do NOT modify web code (components/, app/, etc.) for iOS issues

**iOS-specific guidance:**
- SwiftUI views are in \`ios-app/Astrid App/Views/\`
- Services are in \`ios-app/Astrid App/Core/Services/\`
- For iPad-specific issues, check for \`UIDevice.current.userInterfaceIdiom\` or \`.horizontalSizeClass\`
- Test with: \`xcodebuild test -scheme "Astrid App" -destination "platform=iOS Simulator,name=iPad Pro"\``;
            case 'android':
                return `
## Platform: Android

**IMPORTANT**: This is an Android task. Look for code in:
- \`android/\` or \`android-app/\` directory
- \`*.kt\` (Kotlin) or \`*.java\` files
- Do NOT modify web or iOS code for Android issues`;
            case 'web':
                return `
## Platform: Web

This is a web task. Look for code in:
- \`components/\` - React components
- \`app/\` - Next.js app router pages and API routes
- \`lib/\` - Shared utilities
- Do NOT modify iOS code (ios-app/) for web issues`;
            default:
                return `
## Platform Detection

Could not determine platform from task description. Please:
1. Check if this is iOS (ios-app/), Android (android/), or Web (components/, app/)
2. Look at the task title for hints (iPad/iPhone = iOS, browser/web = Web)
3. Ask for clarification if unsure`;
        }
    }
    /**
     * Build prompt from task details
     */
    async buildPrompt(session, userMessage, context) {
        if (userMessage) {
            // Follow-up message - include comment history for context
            const history = this.formatCommentHistory(context?.comments);
            return history ? `${history}\n\n---\n\n## Latest Message\n\n${userMessage}` : userMessage;
        }
        // Read project context (CLAUDE.md/ASTRID.md)
        let projectContext = '';
        if (session.projectPath) {
            projectContext = await this.readProjectContext(session.projectPath);
        }
        // Format comment history
        const commentHistory = this.formatCommentHistory(context?.comments);
        // Detect platform and get instructions
        const { platform, confidence } = this.detectPlatform(session.title, session.description);
        const platformInstructions = this.getPlatformInstructions(platform);
        console.log(`🎯 Detected platform: ${platform} (confidence: ${confidence})`);
        // Initial task prompt with full context
        return `# Task: ${session.title}

${session.description}
${platformInstructions}
${commentHistory}
${projectContext}

## CRITICAL Workflow Requirements

1. **Understand the task FIRST**: Read the task title and description carefully. What EXACTLY is being asked?
2. **Verify platform**: iOS tasks = \`ios-app/\` directory, Web tasks = \`components/\`, \`app/\` directories
3. **Locate relevant code**: Find the files that actually implement what needs to change
4. **Make ONLY the requested changes**: Do NOT make unrelated changes (no dependency updates, no refactoring)
5. **Run predeploy tests**: ALWAYS run \`npm run predeploy\` to verify your changes don't break anything
6. **Create PR**: Use \`gh pr create\` with a clear title describing the actual change
7. **Verify your changes match the task**: Before completing, re-read the task and confirm your changes address it

## Test Requirements (MANDATORY)

Before creating a PR, you MUST run:
\`\`\`bash
npm run predeploy
\`\`\`

If tests fail, FIX the issues before creating the PR. Include the test results in your summary.

## Output Requirements

Your response MUST include:
1. **Task understanding**: What exactly was requested (in your own words)
2. **Actual changes made**: What you specifically changed and WHY it addresses the task
3. **Files modified**: List each file path (ONLY files with substantive changes, not dependency files)
4. **Test results**: Output from \`npm run predeploy\` showing tests pass
5. **PR URL**: The pull request URL (REQUIRED for code changes)
6. **Preview URL**: The Vercel preview will be at \`https://astrid-res-www-git-{branch-name}-graceful-tools.vercel.app\`

## CRITICAL Warnings

- **Do NOT make unrelated changes**: If task is about CSS padding, only change CSS/styling code
- **Do NOT update dependencies** unless specifically asked
- **Do NOT modify package.json** unless specifically required for the task
- **VERIFY your changes match the task** before completing
- If you realize you made wrong changes, UNDO them and start over
- If unsure what to change, ASK before making any modifications`;
    }
    /**
     * Start a new Claude Code session
     */
    async startSession(session, prompt, context, onProgress) {
        const taskPrompt = prompt || await this.buildPrompt(session, undefined, context);
        // Create MCP config if token is available
        const mcpConfigPath = await this.createMcpConfig(session, context?.mcpToken);
        // Use model from context if provided, otherwise fall back to instance default
        const modelToUse = context?.model || this.model;
        console.log(`🧠 Using model: ${modelToUse}`);
        const args = [
            '--print',
            '--model', modelToUse,
            '--max-turns', String(this.maxTurns),
            '--output-format', 'text', // Use text format for reliability
            '--dangerously-skip-permissions', // Pre-approve all tools (we trust the codebase)
        ];
        // Add MCP config if available
        if (mcpConfigPath) {
            args.push('--mcp-config', mcpConfigPath);
            console.log(`🔌 MCP config enabled: ${mcpConfigPath}`);
        }
        // Truncate prompt if too long for command line (avoid ARG_MAX issues)
        const MAX_PROMPT_LENGTH = 50000;
        let finalPrompt = taskPrompt;
        if (taskPrompt.length > MAX_PROMPT_LENGTH) {
            finalPrompt = taskPrompt.slice(0, MAX_PROMPT_LENGTH) + '\n\n[... prompt truncated ...]';
            console.log(`⚠️ Prompt truncated from ${taskPrompt.length} to ${MAX_PROMPT_LENGTH} chars`);
        }
        console.log(`📝 Prompt length: ${finalPrompt.length} chars`);
        args.push('-p', finalPrompt);
        // Note: Working directory is set via spawn's cwd option, not via --cwd flag
        console.log(`🚀 Starting new Claude Code session for task: ${session.title}`);
        if (session.projectPath) {
            console.log(`📁 Working directory: ${session.projectPath}`);
        }
        try {
            return await this.runClaude(args, session, onProgress);
        }
        finally {
            // Clean up MCP config after session
            if (mcpConfigPath) {
                await this.cleanupMcpConfig(session);
            }
        }
    }
    /**
     * Resume an existing Claude Code session
     */
    async resumeSession(session, input, context, onProgress) {
        if (!session.claudeSessionId) {
            throw new Error('No Claude session ID - cannot resume. Starting new session instead.');
        }
        // Include comment history for context in follow-up
        const promptWithContext = await this.buildPrompt(session, input, context);
        // Create MCP config if token is available
        const mcpConfigPath = await this.createMcpConfig(session, context?.mcpToken);
        const args = [
            '--print',
            '--resume', session.claudeSessionId,
            '--output-format', 'stream-json',
            '--dangerously-skip-permissions',
        ];
        // Add MCP config if available
        if (mcpConfigPath) {
            args.push('--mcp-config', mcpConfigPath);
            console.log(`🔌 MCP config enabled: ${mcpConfigPath}`);
        }
        args.push('-p', promptWithContext);
        // Note: Working directory is set via spawn's cwd option, not via --cwd flag
        console.log(`🔄 Resuming Claude Code session ${session.claudeSessionId}`);
        if (session.projectPath) {
            console.log(`📁 Working directory: ${session.projectPath}`);
        }
        try {
            return await this.runClaude(args, session, onProgress);
        }
        finally {
            // Clean up MCP config after session
            if (mcpConfigPath) {
                await this.cleanupMcpConfig(session);
            }
        }
    }
    /**
     * Execute Claude Code CLI with enhanced timeout and error handling
     */
    runClaude(args, session, onProgress) {
        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let extractedSessionId;
            let lastProgressTime = Date.now();
            let lastOutputTime = Date.now();
            let heartbeatInterval = null;
            let initialTimeoutHandle = null;
            const INITIAL_TIMEOUT = 600000; // 10 minutes for first output (complex tasks need time to analyze)
            const STALL_TIMEOUT = 600000; // 10 minutes of no output = stalled (Claude --print only outputs at end)
            console.log(`🤖 Running: claude ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);
            console.log(`⏱️ Timeouts: initial=${INITIAL_TIMEOUT / 1000}s, stall=${STALL_TIMEOUT / 1000}s, max=${this.timeout / 1000}s`);
            // Log environment being passed (for debugging)
            const claudeEnv = {
                ...process.env,
                // Ensure non-interactive mode
                CLAUDE_CODE_ENTRYPOINT: 'cli',
                // Point Claude to persistent config directory (symlinked from ~/.claude)
                CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR || '/app/persistent/.claude'
            };
            console.log(`🔧 ANTHROPIC_API_KEY in spawn env: ${process.env.ANTHROPIC_API_KEY ? 'set' : 'NOT SET'}`);
            console.log(`🔧 Working directory: ${session.projectPath || process.cwd()}`);
            const proc = (0, child_process_1.spawn)('claude', args, {
                cwd: session.projectPath || process.cwd(),
                env: claudeEnv,
                stdio: ['ignore', 'pipe', 'pipe'] // Explicitly close stdin, pipe stdout/stderr
            });
            // Verify process started
            console.log(`🚀 Claude process spawned with PID: ${proc.pid}`);
            if (!proc.pid) {
                console.error(`❌ Failed to spawn Claude process - no PID`);
                reject(new Error('Failed to spawn Claude process'));
                return;
            }
            // Heartbeat: log status every 30 seconds
            heartbeatInterval = setInterval(() => {
                const elapsed = Math.round((Date.now() - lastOutputTime) / 1000);
                const totalElapsed = Math.round((Date.now() - lastProgressTime) / 1000);
                console.log(`💓 Heartbeat: ${totalElapsed}s elapsed, last output ${elapsed}s ago, stdout=${stdout.length} chars`);
                // Check for stall
                if (Date.now() - lastOutputTime > STALL_TIMEOUT) {
                    console.error(`❌ Process stalled - no output for ${STALL_TIMEOUT / 1000}s, killing`);
                    proc.kill('SIGTERM');
                }
            }, 30000);
            // Initial timeout: if no output within 2 minutes, something is wrong
            initialTimeoutHandle = setTimeout(() => {
                if (stdout.length === 0 && stderr.length === 0) {
                    console.error(`❌ No output received within ${INITIAL_TIMEOUT / 1000}s, killing process`);
                    proc.kill('SIGTERM');
                }
            }, INITIAL_TIMEOUT);
            const cleanup = () => {
                if (heartbeatInterval)
                    clearInterval(heartbeatInterval);
                if (initialTimeoutHandle)
                    clearTimeout(initialTimeoutHandle);
            };
            proc.stdout.on('data', (data) => {
                const chunk = data.toString();
                stdout += chunk;
                lastOutputTime = Date.now();
                process.stdout.write(chunk); // Echo to console for debugging
                // Clear initial timeout once we get output
                if (initialTimeoutHandle) {
                    clearTimeout(initialTimeoutHandle);
                    initialTimeoutHandle = null;
                }
                // Parse JSON lines for session ID and progress
                const lines = chunk.split('\n').filter(l => l.trim());
                for (const line of lines) {
                    try {
                        const json = JSON.parse(line);
                        // Extract session ID from JSON output
                        if (json.session_id) {
                            extractedSessionId = json.session_id;
                            console.log(`🔑 Extracted session ID: ${extractedSessionId}`);
                        }
                        // Extract from init message
                        if (json.type === 'system' && json.session_id) {
                            extractedSessionId = json.session_id;
                        }
                        // Send progress updates (throttled to every 30s)
                        if (onProgress && Date.now() - lastProgressTime > 30000) {
                            if (json.type === 'assistant' && json.message) {
                                const preview = json.message.slice(0, 200);
                                onProgress(`Working... ${preview}`);
                                lastProgressTime = Date.now();
                            }
                        }
                    }
                    catch {
                        // Not JSON, try regex patterns
                        const sessionMatch = line.match(/Session ID:\s*([a-f0-9-]+)/i);
                        if (sessionMatch) {
                            extractedSessionId = sessionMatch[1];
                        }
                        const contextMatch = line.match(/"session_id":\s*"([a-f0-9-]+)"/i);
                        if (contextMatch) {
                            extractedSessionId = contextMatch[1];
                        }
                    }
                }
            });
            proc.stderr.on('data', (data) => {
                const chunk = data.toString();
                stderr += chunk;
                lastOutputTime = Date.now();
                console.error(`⚠️ stderr: ${chunk}`); // Log stderr prominently
            });
            proc.on('close', (code) => {
                cleanup();
                console.log(`✅ Claude Code exited with code ${code}`);
                console.log(`📊 Final stats: stdout=${stdout.length} chars, stderr=${stderr.length} chars`);
                resolve({
                    exitCode: code,
                    stdout,
                    stderr,
                    sessionId: extractedSessionId
                });
            });
            proc.on('error', (error) => {
                cleanup();
                console.error(`❌ Claude Code execution error:`, error);
                reject(error);
            });
            // Handle max timeout
            setTimeout(() => {
                if (!proc.killed) {
                    cleanup();
                    console.log(`⏰ Max timeout (${this.timeout / 1000}s) reached, killing Claude Code process`);
                    proc.kill('SIGTERM');
                }
            }, this.timeout);
        });
    }
    /**
     * Parse Claude Code output to extract key information
     */
    parseOutput(output) {
        const result = {};
        const lines = output.split('\n');
        const files = [];
        for (const line of lines) {
            // Extract modified/created files
            const fileMatch = line.match(/(?:modified|created|edited|wrote):\s*[`'"]*([^`'"]+)[`'"]*/i);
            if (fileMatch) {
                files.push(fileMatch[1].trim());
            }
            // Extract PR URL
            const prMatch = line.match(/(https:\/\/github\.com\/[\w-]+\/[\w-]+\/pull\/\d+)/i);
            if (prMatch) {
                result.prUrl = prMatch[1];
            }
            // Extract error messages
            if (line.toLowerCase().includes('error:') || line.toLowerCase().includes('failed:')) {
                result.error = line.trim();
            }
        }
        if (files.length > 0) {
            result.files = [...new Set(files)];
        }
        // Try to extract summary (last substantial paragraph)
        const paragraphs = output.split(/\n\n+/).filter(p => p.trim().length > 50);
        if (paragraphs.length > 0) {
            result.summary = paragraphs[paragraphs.length - 1].trim().slice(0, 500);
        }
        return result;
    }
    /**
     * Check if Claude Code is available
     */
    async checkAvailable() {
        return new Promise((resolve) => {
            const proc = (0, child_process_1.spawn)('claude', ['--version'], {
                timeout: 5000
            });
            proc.on('close', (code) => {
                resolve(code === 0);
            });
            proc.on('error', () => {
                resolve(false);
            });
        });
    }
}
exports.ClaudeExecutor = ClaudeExecutor;
// Export singleton instance
exports.claudeExecutor = new ClaudeExecutor();
//# sourceMappingURL=claude-executor.js.map