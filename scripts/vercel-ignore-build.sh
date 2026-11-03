#!/usr/bin/env bash
# Vercel's Ignored Build Step for every project in this repo. Exit 0 skips the
# build, exit 1 builds. Only production builds: preview deployments for branches
# and pull requests are off. A redeploy started by hand in Vercel still builds.
# VERCEL_ENV is not always set here, so the branch comes from
# VERCEL_GIT_COMMIT_REF.

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

echo "Previews are off: skipping $branch."
exit 0
