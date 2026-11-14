# Shared-string review sheets (AWTD-1654)

Web and iOS translate some shared strings differently. Jon's call (2026-11-14): **short strings take
iOS's wording**, and the rest is decided **per string by someone who speaks the language**.

Short strings (three English words or fewer) are already settled. Web uses astrid-core's catalog
wording for them, which is iOS's. Each `<locale>.csv` here holds what is left: the longer strings,
and the web keys that two shared keys claim with different translations.

## Filling one in

Open the file in Numbers, Excel or Google Sheets. For each row, read `english`, compare `web` and
`ios`, and put one of these in `choice`:

| `choice` | Means |
|---|---|
| `ios` | iOS's wording is right. Only for `kind` = `differ`. |
| `web` | Web's wording is right. |
| any other text | Neither is right; use this wording instead. |
| empty | Not decided yet. |

A `conflict` row's `ios` column shows both of core's translations, separated by `‖`. Core has two
shared keys for one web key (for example the "Done" button and the "Done" status), so the answer is
`web` or a new wording, never `ios`.

Save it as CSV in the same place.

## Applying it

```bash
node scripts/sync-core-strings.mjs --apply-review   # ios rows leave the list, and web takes core's value
node scripts/sync-core-strings.mjs --review-sheet   # rewrite the sheets from what is still open
```

Rows marked `web`, or with new wording, are listed by `--apply-review`. They have to change in
astrid-core's catalog (`strings/shared/`), so iOS changes with them. Then move web's pin with
`node scripts/sync-core-strings.mjs --rev <sha>` and run `--update-divergent`.
