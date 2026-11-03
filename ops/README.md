# Reproducible build

Builds `zakat_pool`, `policy` and `attestation` from this repository's source, in a digest-pinned container, so anyone can check that a deployed contract runs exactly this code. Testnet only, unaudited, no real funds.

```bash
bash ops/scripts/build.sh                # writes ops/out/*.wasm and ops/out/hashes.json
node ops/scripts/check-no-upgrade.mjs    # reads the Wasm: zakat_pool has no way to replace its code
```

The build follows `demo/scripts`: the same pinned image, set in `build.conf`, with SEP-58 metadata recorded in each Wasm. All three Wasm files record the same `source_sha256`, because one archive holds the whole workspace. The archive is rebuilt from git rather than committed, and it leaves out the fuzz crate.

To check a deployed contract, fetch its Wasm from the network and compare its hash with the matching one in `ops/out/hashes.json`:

```bash
stellar contract fetch --id <contract id> --network testnet --out-file deployed.wasm
shasum -a 256 deployed.wasm
```

Fuzz targets are in `contracts/fuzz`, and CI runs them on Linux:

```bash
cd contracts/fuzz && cargo +nightly fuzz run --sanitizer none contribute
```

They do not link on macOS, because of the contracts' `cdylib` crate type. Run them in a Linux container there.
