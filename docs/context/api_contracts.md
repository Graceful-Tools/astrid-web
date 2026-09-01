# API Contract Notes

The authoritative external and mobile wire contract is
[`docs/API_CONTRACT.md`](../API_CONTRACT.md). Update that file when a stable
`/api/v1/*` request, response, scope, or compatibility promise changes.

The unversioned `/api/*` routes are internal implementation surfaces and are
defined by their route handlers, schemas, and tests. They are not a second stable
contract and may change with the web client.