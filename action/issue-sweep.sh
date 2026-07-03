#!/usr/bin/env bash
# Opens or updates a tracking issue with the schedule-mode decay-sweep
# report — the "never dormant" channel (PDR §2.1): a repo whose code drifts
# out from under an ADR with nobody touching a PR should still hear about
# it. Requires `gh` (pre-installed on GitHub-hosted runners) authenticated
# via GH_TOKEN. Never fails the workflow — schedule mode has no PR to block.
set -euo pipefail

REPORT_MD="$1"
REPORT_JSON="$2"
ISSUE_TITLE="duckadrift: decay sweep"

FAILING=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$REPORT_JSON','utf-8')).failingCount)")

if [ "$FAILING" -eq 0 ]; then
  echo "duckadrift: 0 failing findings on this sweep — no issue opened."
  # Still close out a prior issue if one is now clean, rather than leaving a stale one open.
  EXISTING=$(gh issue list --search "in:title \"$ISSUE_TITLE\"" --state open --json number --jq '.[0].number // empty')
  if [ -n "$EXISTING" ]; then
    gh issue comment "$EXISTING" --body "Latest sweep: 0 failing findings. Closing."
    gh issue close "$EXISTING"
  fi
  exit 0
fi

EXISTING=$(gh issue list --search "in:title \"$ISSUE_TITLE\"" --state open --json number --jq '.[0].number // empty')

if [ -n "$EXISTING" ]; then
  gh issue comment "$EXISTING" --body-file "$REPORT_MD"
  echo "duckadrift: updated existing sweep issue #$EXISTING."
else
  gh issue create --title "$ISSUE_TITLE" --body-file "$REPORT_MD" --label duckadrift 2>/dev/null \
    || gh issue create --title "$ISSUE_TITLE" --body-file "$REPORT_MD"
  echo "duckadrift: opened a new sweep issue."
fi
