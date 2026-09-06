Run the weekly deep review over both Astrid repos.

The review itself is `../../scripts/weekly-deep-review.prompt.md` — **read that file from
disk and execute it.** Do not improvise a review from this description; the prompt changes
and this file does not.

Normally this runs from the driver task on the Astrid iOS board, because the `astrid` MCP
server is configured for `astrid-ios` and not for this repo. Running it here means you are
either testing, or acting as the fallback because the driver did not run — say which in your
summary.

Without MCP in this repo, file findings with the OAuth scripts:

```bash
npx tsx scripts/create-task.ts   "[deep-review] <title>" "<description>" -p <1|2|3>
npx tsx scripts/file-ios-task.ts "[deep-review][ios] <title>" "<description>" -p 2
```

Operational detail — the trigger, the driver/guard coordination, and how to verify a change
without touching the real boards — is in `docs/WEEKLY_DEEP_REVIEW.md`.
