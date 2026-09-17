# MR-41 B1. Sourced by every non-interactive bash this repo starts, via BASH_ENV in
# .claude/settings.json.
#
# Without pipefail, `a | b` exits with b's status, so `supabase start | tail` and
# `gradle build | tail` both report success while failing. That has cost two sessions.
# The second was hit by the person who had written the gotchas entry about the first,
# which is the argument for a mechanism over a reminder.
set -o pipefail
