Pull tasks from the Astrid web to-do list and help the user work through them.

## Steps

1. **Validate permissions**:
   ```bash
   npm run validate:settings:fix
   ```

2. **Check deployment status** (OK if this fails):
   ```bash
   npm run monitor:vercel
   ```

3. **Pull web tasks**:
   ```bash
   npx tsx scripts/get-astrid-tasks.ts
   ```

4. **Present the tasks** to the user and ask which one(s) to work on.

5. **For each task**, follow the coding workflow in ASTRID.md:
   - **Post session link** so user can follow along on mobile:
     ```bash
     npx tsx scripts/post-session-link.ts <taskId>
     ```
   - Analyze the issue
   - Post strategy comment to the task
   - Create a feature branch (`fix/<short-description>`)
   - **RED-GREEN TDD (mandatory for bug fixes):**
     1. Write a failing test that reproduces the bug. Cite the task id in
        the test name. Confirm it fails for the right reason.
        - Prefer a vitest unit test against a pure helper. If the bug only
          manifests in the UI, add a Playwright spec under `e2e/` too.
     2. Implement the minimum code change to make the test pass.
     3. Refactor while tests stay green.
   - Run `npm run predeploy` to verify
   - Fix any regressions
   - Deploy preview: `./scripts/deploy-preview.sh`
   - Post preview link and fix summary comment to the task
   - Wait for user approval before merging to main

6. **After all fixes**, ask the user if they're ready to ship.

See [ASTRID.md](./ASTRID.md) > "Coding Workflow" for the full required workflow.
See [ASTRID.md](./ASTRID.md) > "Let's Fix Stuff Workflow" for task script documentation.
