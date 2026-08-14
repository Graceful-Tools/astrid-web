Pull tasks from the Astrid Web To-do and help the user work through them.

## Scope: one board, one repo

**This works the Astrid Web To-do and edits only `astrid-web`.** A separate agent
runs against the Astrid iOS To-do and the `astrid-ios` repo, so an `[ios]`/`[mac]`
task on this board is a handoff, not work to pick up:

```bash
npx tsx scripts/move-task-to-list.ts <taskId> "Astrid iOS To-do"
```

The test is where the code lives, not what the title says — **check the web
behaviour first.** If web has the same bug it is cross-platform: do the web half
here and file the iOS companion. Never commit to `astrid-ios`.

**Filing the companion is a command, not a note to self:**

```bash
npx tsx scripts/file-ios-task.ts "[ios] <what iOS must do>" "<contract to match>" -p 2
```

**Any fix that needs a Swift change gets one of these before you move on** —
whether it is the iOS half of cross-platform work, or something you discovered
while working an unrelated task. A finding recorded only in a comment on the web
board is invisible to the loop that could act on it.

Full rules, including the one case where reading `astrid-ios` is legitimate, are in
[`/fixall`](./fixall.md) → *Scope*.

**Only work tasks that are unassigned or assigned to Claude.** An assignee is a
claim: a task assigned to a person is that person's, even when it is in Ready.
`scripts/ready-tasks.ts` applies this and names whoever it skipped. If something
assigned to someone else is genuinely yours, ask Jon to reassign it rather than
working around the filter.

Refer to tasks by **title** in every report; Jon does not read task ids.

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
