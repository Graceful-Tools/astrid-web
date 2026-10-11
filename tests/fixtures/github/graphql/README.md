# Recorded GitHub GraphQL responses

Real responses from the **Graceful-Fools** test org's project "Graceful-Tools Test"
(`PVT_kwDOFEb-HM4BmXS2`), recorded 2026-10-10 with the App's installation token for
AWTD-1150 (P4b). The queries are `HYDRATE_ITEM_QUERY` and `PROJECT_ITEMS_PAGE_QUERY`
from `lib/github/projects/hydrate.ts`. **Re-record them whenever that fragment changes**,
since a recording is what proves the fragment is valid against GitHub's schema.

| File | Query | What it shows |
|---|---|---|
| `project-items-page.json` | items page | Open issue in Todo, issue closed as not planned (Done), draft in progress. Includes the fieldless `ProjectV2ItemFieldRepositoryValue`. |
| `hydrate-item-draft.json` | one item | The draft by item id |
| `hydrate-item-missing.json` | one item | An unknown id returns `node: null` with a NOT_FOUND error beside partial data |
| `org-projects.json` | org projects | The org's projects, for the bind wizard's list |
| `project-schema.json` | project fields | Status, an option-less Priority, Size, Estimate, dates, and more |
| `viewer-permissions.json` | viewer role | `viewerCanUpdate` / `viewerCanClose` (recorded as the App, so admin) |
| `binding-graceful-fools.json` | none | The binding a bind wizard would store for that project's Status field |

**2026-10-10, AWTD-1119.** The fragment grew `parent { id }` and
`blockedBy(first: 20) { totalCount nodes { id } }` on issues. It was re-run against the
project the same day: GitHub accepted it and answered `parent: null` and an empty `blockedBy`
for both issues, and the page's `rateLimit.cost` went from 1 to 2. Only those two fields were
added to `project-items-page.json`. The rest of the recording was kept because the live
project had drifted by then (#1 sat in Done, reopened), and other tests pin the lanes as
first recorded. No fixture issue has a parent or a blocker, so a non-empty answer is not yet
recorded.

**2026-10-10, AWTD-1188.** The fragment grew
`labels(first: 20) { totalCount nodes { id name color } }` on issues and pull requests. It was
re-run against the project the same day: GitHub accepted it (HTTP 200, no errors) and answered
`labels: { totalCount: 0, nodes: [] }` for both issues and no `labels` key for the draft. The
page's `rateLimit.cost` went from 2 to 3. Only that field was added to
`project-items-page.json`, for the same reason as above. No fixture issue carries a label and
the project holds no pull request, so a non-empty answer and a PR's labels are not yet
recorded. The fixture issues were left unlabelled, since other tests read them as they are.

The items are `Graceful-Fools/wordlesolver#1` and `#2` and one draft, all titled
"[Astrid sync fixture] …". Leave them there, because the P4f live smoke test reads them.
