# GitHub ProjectV2Item fixtures (AWTD-1149)

The shape `lib/github/projects/apply.ts` normalises: a `ProjectV2Item` with
`content` (Issue / DraftIssue / PullRequest) and `fieldValues.nodes`, as GitHub's
GraphQL API returns it for the hydration fragment (spec §8.7).

These were written by hand against GitHub's GraphQL schema, because the token
that recorded the other fixtures has no `read:project` scope. P4b (AWTD-1150)
replaces them with recorded responses from the Graceful-Fools test org. Keep the
field ids in sync with `binding.json`.
