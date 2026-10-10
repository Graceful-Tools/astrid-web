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
| `binding-graceful-fools.json` | none | The binding a bind wizard would store for that project's Status field |

The items are `Graceful-Fools/wordlesolver#1` and `#2` and one draft, all titled
"[Astrid sync fixture] …". Leave them there, because the P4f live smoke test reads them.
