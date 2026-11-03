#!/usr/bin/env bash
#
# Produce the SEP-58 source archive of the contract workspace and print its
# source_sha256. GNU tar runs inside the pinned image with every varying field
# fixed, and the file list comes from git, so the same commit always gives the
# same bytes. The fuzz crate is left out: it is not part of what is deployed.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

cd "$REPO_DIR"
mkdir -p "ops/$(dirname "$SOURCE_ARCHIVE")"

FILES=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  FILES+=("$f")
done < <(git ls-files contracts | grep -v '^contracts/fuzz/' | sed 's|^contracts/||')
if [ "${#FILES[@]}" -eq 0 ]; then
  echo "error: no tracked files under contracts/: commit the source first" >&2
  exit 1
fi

run_pinned --entrypoint tar "$BLDIMG" \
  --create \
  --file "/work/ops/$SOURCE_ARCHIVE" \
  --directory /work/contracts \
  --transform "s,^,$SOURCE_PREFIX/," \
  --sort=name \
  --mtime=@0 \
  --owner=0 --group=0 --numeric-owner \
  --format=gnu \
  --mode=go-w \
  "${FILES[@]}"

echo "archive:       ops/$SOURCE_ARCHIVE"
echo "files:         ${#FILES[@]}"
echo "source_sha256: $(sha256_of "ops/$SOURCE_ARCHIVE")"
