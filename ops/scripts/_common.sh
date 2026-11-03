# shellcheck shell=bash
# Sourced by the other scripts. Not executable on its own.
#
# Adapted from demo/scripts/_common.sh, which explains the container flags.

set -euo pipefail

OPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$OPS_DIR/.." && pwd)"
# shellcheck source=../build.conf
. "$OPS_DIR/build.conf"

command -v docker >/dev/null 2>&1 || { echo "error: docker is required" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "error: the Docker daemon is not reachable" >&2; exit 1; }

# The image's own user cannot write to a bind mount owned by another uid, so run
# as the caller and move what the image expected to write under /stellar to /tmp.
# CARGO_HOME moves too: the CLI remaps it out of the Wasm, so the bytes are
# unchanged.
AS_CALLING_USER=(
  --user "$(id -u):$(id -g)"
  -e CARGO_HOME=/tmp/cargo
  -e HOME=/tmp
  -e STELLAR_CONFIG_HOME=/tmp/stellar/config
  -e STELLAR_DATA_HOME=/tmp/stellar/data
)

# Utility runs: the repository at /work.
run_pinned() {
  docker run --rm \
    --platform "$BUILD_PLATFORM" \
    "${AS_CALLING_USER[@]}" \
    -v "$REPO_DIR:/work" \
    -w /work \
    "$@"
}

# The toolchain the image ships. Forced back in through RUSTUP_TOOLCHAIN, so no
# file in the source can swap it mid-build.
image_toolchain() {
  docker run --rm --platform "$BUILD_PLATFORM" --entrypoint rustup "$1" default | cut -d' ' -f1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}
