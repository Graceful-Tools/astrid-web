#!/bin/zsh -l
#
# Renders the launchd templates next to this script into ~/Library/LaunchAgents and
# (re)bootstraps them.
#
# launchd expands neither ~ nor $HOME inside ProgramArguments or StandardOutPath, so an
# installed agent has to name absolute paths. Nothing in git should name one machine,
# though — a committed absolute path rots the moment a checkout moves, and it rots
# silently, because a plist pointing at a missing script fails without saying so. So the
# templates carry placeholders and this script fills them in from where the checkout
# actually is:
#
#   __REPO_ROOT__     this repo
#   __REPO_PARENT__   the directory holding it (for jobs that run from a sibling worktree)
#   __HOME__          $HOME
#
#   ./scripts/launchd/install.sh                        # every template here
#   ./scripts/launchd/install.sh cc.astrid.fixall-web   # just one
#
# Re-run it after moving the checkout. Bootstrapping stops any run currently in flight for
# that label, so prefer a quiet moment. See docs/WEEKLY_HYGIENE_REVIEW.md and
# .claude/commands/fixall.md.

set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h:h}
REPO_PARENT=${REPO_ROOT:h}
AGENTS_DIR=$HOME/Library/LaunchAgents
GUI_DOMAIN=gui/$(id -u)

mkdir -p "$AGENTS_DIR" "$HOME/Library/Logs"

typeset -a labels
labels=("$@")
if (( ${#labels} == 0 )); then
  # (N) so an empty directory yields nothing rather than a zsh "no matches found"
  # abort, which would beat the friendlier error just below to the punch.
  for template in "$SCRIPT_DIR"/*.plist.template(N); do
    # A retired job still has a template — kept so it can be revived or read —
    # but installing every template by default resurrects it, schedules work
    # nobody asked for, and does it silently. Opt those out with a marker line;
    # naming one explicitly still installs it.
    if grep -qi '^[[:space:]]*install-default:[[:space:]]*skip' "$template"; then
      print "skipping ${${template:t}%.plist.template} (install-default: skip)"
      continue
    fi
    labels+=("${${template:t}%.plist.template}")
  done
fi

if (( ${#labels} == 0 )); then
  print -u2 "no .plist.template files in $SCRIPT_DIR"
  exit 1
fi

for label in "${labels[@]}"; do
  template=$SCRIPT_DIR/$label.plist.template
  if [[ ! -f $template ]]; then
    print -u2 "no template for '$label' (expected $template)"
    exit 1
  fi

  dest=$AGENTS_DIR/$label.plist

  # Render and check somewhere else, then move into place. Writing straight to
  # $dest would leave a half-valid plist installed when a check fails — exactly
  # the silent breakage this script exists to prevent, since launchd declines a
  # malformed job without saying so.
  tmp=$(mktemp "${TMPDIR:-/tmp}/$label.XXXXXX")
  trap 'rm -f "$tmp"' EXIT INT TERM

  sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" \
      -e "s|__REPO_PARENT__|$REPO_PARENT|g" \
      -e "s|__HOME__|$HOME|g" \
      "$template" > "$tmp"

  plutil -lint "$tmp" > /dev/null

  # An unrendered placeholder would install a job pointing at a path that cannot exist.
  if grep -q '__[A-Z][A-Z_]*__' "$tmp"; then
    print -u2 "unrendered placeholder left in $label:"
    grep -n '__[A-Z][A-Z_]*__' "$tmp" >&2
    exit 1
  fi

  mv "$tmp" "$dest"
  trap - EXIT INT TERM

  launchctl bootout "$GUI_DOMAIN/$label" 2> /dev/null || true
  launchctl bootstrap "$GUI_DOMAIN" "$dest"
  print "installed $label -> $dest"
done
