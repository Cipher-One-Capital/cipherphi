#!/usr/bin/env bash
# Vercel's Ignored Build Step for every project in this repo. Exit 0 skips the
# build, exit 1 builds. Previews are opt-in to save build minutes: a branch
# other than production builds only when its last commit message says
# "[preview]", in any case. VERCEL_ENV and VERCEL_GIT_COMMIT_MESSAGE are not
# always set here, so the branch comes from VERCEL_GIT_COMMIT_REF and the
# message from git.

production_branch="${PRODUCTION_BRANCH:-main}"
branch="${VERCEL_GIT_COMMIT_REF:-}"

if [ -z "$branch" ]; then
  echo "Branch unknown: building."
  exit 1
fi

if [ "$branch" = "$production_branch" ] || [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "Production branch $branch: building."
  exit 1
fi

if [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ] && [ "${VERCEL_GIT_PREVIOUS_SHA:-}" = "$VERCEL_GIT_COMMIT_SHA" ]; then
  echo "Redeploy of $VERCEL_GIT_COMMIT_SHA: building."
  exit 1
fi

message="$(git log -1 --format=%B 2>/dev/null || true)"
message="${message:-${VERCEL_GIT_COMMIT_MESSAGE:-}}"

if printf '%s' "$message" | grep -qi '\[preview\]'; then
  echo "Preview asked for on $branch: building."
  exit 1
fi

echo "No [preview] in the last commit on $branch: skipping. To build one, push a commit whose message contains [preview]."
exit 0
