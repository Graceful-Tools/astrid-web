# GitHub webhook payloads

**`issue-comment-created.json` (AWTD-1283) is NOT recorded.** It is a trimmed `issue_comment`
delivery written by hand in GitHub's documented shape, using the ids of the test org's fixture
issue `Graceful-Fools/wordlesolver#1`. The handler reads only the ids from a delivery:
`installation.id`, `issue.node_id`, `issue.pull_request` and `comment.node_id`. The comment
itself is re-read from GitHub. So only those ids, and the payload's overall shape, need to be
faithful. Replace it with a real delivery (App settings → Advanced → Recent Deliveries) the
next time someone comments on that issue.
