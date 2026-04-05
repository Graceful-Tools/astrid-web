Run the standard predeploy checks for the web app.

Execute:
```bash
npm run predeploy
```

This runs the self-healing predeploy (auto-fix + retry) which includes:
1. TypeScript type checking
2. ESLint
3. Vitest unit/integration tests

Report the results clearly. If there are failures, summarize what failed and suggest fixes.

Other predeploy variants:
- `npm run predeploy:quick` — TypeScript + lint only (fastest)
- `npm run predeploy:full` — Includes Playwright E2E tests (slowest)
- `npm run predeploy:simple` — Basic checks without auto-fix
