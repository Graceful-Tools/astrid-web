/**
 * Which client-facing behaviour this server has, as one number (ADEV-124).
 *
 * `apiVersion` ('v1') names the URL space and changes only for a breaking
 * change. This is finer: it rises by one each time the server gains behaviour
 * a client may come to depend on. It exists because the stock Astrid apps can
 * now sign in to a partner's own deployment, which updates on its own
 * schedule. An app needing level N refuses a server below N with "this server
 * needs an update", rather than failing in some odd way later. A server older
 * than this field sends none, and clients read that as level 0.
 *
 * Raise it in the same change that adds the behaviour, add a line below, and
 * update docs/deployment/WHITE_LABEL_COMPATIBILITY.md. Never lower it.
 *
 * History:
 *   1: /auth/desktop accepts `scheme` (the deployment's own or the stock app's),
 *      so the stock apps can complete browser sign-in on a partner's server.
 */
export const SERVER_API_LEVEL = 1
