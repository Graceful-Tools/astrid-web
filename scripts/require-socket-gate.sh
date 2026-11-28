#!/usr/bin/env bash
# Makes the Socket package gate (ADEV-339) a required check on the default branch of astrid-web,
# astrid-core, astrid-ios, astrid-windows and astrid-android. It adds one ruleset, `socket_gate`, per repo and
# leaves the existing rulesets alone. Repo admins can still bypass it through a pull request, as
# they can on astrid-web's protect_main.
#
# Jon runs this: it changes branch protection, which agents do not change on their own. It needs a
# gh login with admin on the repos. Safe to re-run: a repo that already has `socket_gate` is skipped.
#
#   scripts/require-socket-gate.sh            apply
#   scripts/require-socket-gate.sh --dry-run  print what it would create
#
# astrid-android joined on 2026-11-28, once ADEV-355 exempted Google Maven artifacts (which Socket
# does not index) instead of refusing every androidx or AGP upgrade.
#
# To undo for one repo: gh api -X DELETE repos/Graceful-Tools/<repo>/rulesets/<id>
set -euo pipefail
dry=false; [[ "${1:-}" == "--dry-run" ]] && dry=true
ORG=Graceful-Tools
GITHUB_ACTIONS_APP=15368

# repo|check context, as GitHub names the check on a pull request
targets=(
  "astrid-web|socket-package-gate"
  "astrid-core|socket / socket-package-gate"
  "astrid-ios|socket / socket-package-gate"
  "astrid-windows|socket / socket-package-gate"
  "astrid-android|socket / socket-package-gate"
)

for target in "${targets[@]}"; do
  repo="${target%%|*}"; context="${target#*|}"
  if gh api "repos/$ORG/$repo/rulesets" --jq '.[].name' | grep -qx socket_gate; then
    echo "$repo: socket_gate already exists, skipped"; continue
  fi
  body="$(jq -n --arg context "$context" --argjson app "$GITHUB_ACTIONS_APP" '{
    name: "socket_gate", target: "branch", enforcement: "active",
    bypass_actors: [{actor_id: 5, actor_type: "RepositoryRole", bypass_mode: "pull_request"}],
    conditions: {ref_name: {include: ["~DEFAULT_BRANCH"], exclude: []}},
    rules: [{type: "required_status_checks", parameters: {
      strict_required_status_checks_policy: false, do_not_enforce_on_create: false,
      required_status_checks: [{context: $context, integration_id: $app}]}}]}')"
  if $dry; then echo "$repo: would require \"$context\""; continue; fi
  id="$(gh api -X POST "repos/$ORG/$repo/rulesets" --input - --jq .id <<<"$body")"
  echo "$repo: ruleset $id requires \"$context\""
done
