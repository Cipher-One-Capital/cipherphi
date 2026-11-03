// SPDX-License-Identifier: Apache-2.0
//
// Check that zakat_pool cannot replace its own code, by reading the Wasm rather
// than the source. A contract can only do that through the host function
// update_current_contract_wasm, which a Wasm reaches by importing it: module
// "l", name "6" in soroban-env 27 (env.json). No import, no upgrade path.
//
//   node ops/scripts/check-no-upgrade.mjs [path to zakat_pool.wasm]

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const path = process.argv[2] ?? join(here, "..", "out", "zakat_pool.wasm");
const imports = WebAssembly.Module.imports(new WebAssembly.Module(readFileSync(path)));
const exportsList = WebAssembly.Module.exports(new WebAssembly.Module(readFileSync(path))).map((e) => e.name);

console.log(`${path}: ${imports.length} host imports, ${exportsList.length} exports`);
if (imports.length === 0) {
  console.error("no host imports found: this does not look like a Soroban contract");
  process.exit(1);
}
const upgrade = imports.filter((i) => i.module === "l" && i.name === "6");
const named = exportsList.filter((name) => /upgrade|update_current_contract_wasm/i.test(name));
if (upgrade.length > 0 || named.length > 0) {
  console.error("zakat_pool can replace its own code:", { upgrade, named });
  process.exit(1);
}
for (const needed of ["contribute", "distribute"]) {
  if (!exportsList.includes(needed)) {
    console.error(`zakat_pool does not export ${needed}: wrong file?`);
    process.exit(1);
  }
}
console.log("zakat_pool has no update_current_contract_wasm import and no upgrade entry point");
