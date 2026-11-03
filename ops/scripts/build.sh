#!/usr/bin/env bash
#
# Build all three contracts the SEP-58 way: from the source archive, in the
# digest-pinned image, with the build environment recorded into each Wasm.
# Writes ops/out/ and ops/out/hashes.json.

. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

bash "$OPS_DIR/scripts/make-source-archive.sh" >/dev/null
SOURCE_SHA256="$(sha256_of "$OPS_DIR/$SOURCE_ARCHIVE")"

BUILD_ROOT="$OPS_DIR/.build"
SOURCE_DIR="$BUILD_ROOT/$SOURCE_PREFIX"
rm -rf "$SOURCE_DIR/interface" "$SOURCE_DIR/zakat_pool" "$SOURCE_DIR/policy" "$SOURCE_DIR/attestation"
mkdir -p "$BUILD_ROOT"
run_pinned --entrypoint tar "$BLDIMG" \
  --extract --file "/work/ops/$SOURCE_ARCHIVE" --directory /work/ops/.build

TOOLCHAIN="$(image_toolchain "$BLDIMG")"

echo "bldimg:        $BLDIMG"
echo "               ($BLDIMG_TAG)"
echo "toolchain:     $TOOLCHAIN"
echo "bldopt:        ${BLDOPT[*]}"
echo "source_sha256: $SOURCE_SHA256"
echo

# Meta order is fixed here, because the meta lands inside the Wasm and is itself
# part of what is hashed.
META=(--meta "bldimg=$BLDIMG")
for opt in "${BLDOPT[@]}"; do
  META+=(--meta "bldopt=$opt")
done
META+=(--meta "source_sha256=$SOURCE_SHA256")

docker run --rm \
  --platform "$BUILD_PLATFORM" \
  "${AS_CALLING_USER[@]}" \
  -v "$SOURCE_DIR:/source" \
  -e "RUSTUP_TOOLCHAIN=$TOOLCHAIN" \
  "$BLDIMG" \
  contract build "${BLDOPT[@]}" "${META[@]}"

mkdir -p "$OPS_DIR/out"
{
  echo "{"
  echo "  \"source_sha256\": \"$SOURCE_SHA256\","
  echo "  \"bldimg\": \"$BLDIMG\","
  echo "  \"wasm\": {"
  last="${WASM_NAMES[${#WASM_NAMES[@]}-1]}"
  for name in "${WASM_NAMES[@]}"; do
    cp "$SOURCE_DIR/target/wasm32v1-none/release/$name" "$OPS_DIR/out/$name"
    sep=","; [ "$name" = "$last" ] && sep=""
    echo "    \"${name%.wasm}\": \"$(sha256_of "$OPS_DIR/out/$name")\"$sep"
  done
  echo "  }"
  echo "}"
} > "$OPS_DIR/out/hashes.json"

echo
cat "$OPS_DIR/out/hashes.json"
