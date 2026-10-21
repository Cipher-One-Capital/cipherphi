// SPDX-License-Identifier: Apache-2.0
//
// Stand up the whole CipherPhi testnet demo from nothing:
//
//   1. Generate (or reuse) every testnet key the demo needs.
//   2. Fund the accounts from friendbot.
//   3. Give the treasury a float of Circle's testnet USDC to hand out to
//      visitors, bought on the testnet exchange (see top-up.mjs).
//   4. Make sure USDC's Stellar Asset Contract is deployed.
//   5. Deploy the pool from the reproducible Wasm in out/, constructor and all.
//   6. Seed the pool with one contribution, so a payout has something to draw on
//      even before the first visitor arrives.
//
// Writes deployment.json and web/lib/deployment.json (public, committed) and .secrets.json (testnet secret
// keys, gitignored). Run `npm run build:wasm` first.
//
// Testnet only. The passphrase is pinned below and there is no flag to change it.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { USDC, buyUsdc, usdcBalance } from "./top-up.mjs";

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const SECRETS = join(DEMO_DIR, ".secrets.json");
const DEPLOYMENT = join(DEMO_DIR, "deployment.json");
const WASM = join(DEMO_DIR, "out", "cipherphi_demo_pool.wasm");

const PASSPHRASE = Networks.TESTNET;
const HORIZON = "https://horizon-testnet.stellar.org";
const RPC = "https://soroban-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

/// The treasury's float, in whole USDC. Visitors are paid from this.
const TREASURY_FLOAT = 5000;
/// The seed contribution, in whole USDC.
const SEED = "100";
const THRESHOLD = 2;

const horizon = new Horizon.Server(HORIZON);

const ROLES = [
  "admin", // deploys the pool; stored on it and otherwise unused
  "treasury", // holds the USDC float, sponsors visitor accounts, pays fees
  "distributor", // the only address allowed to submit a payout
  "authority0", // eligibility signers, 2 of 3
  "authority1",
  "authority2",
  "partner", // the vetted partner organisation's testnet account
  "bot", // gives labelled demo donations during calls (scripts/bot.mjs)
];

function loadKeys() {
  const existing = existsSync(SECRETS) ? JSON.parse(readFileSync(SECRETS, "utf8")) : {};
  const keys = {};
  for (const role of ROLES) {
    keys[role] = existing[role] ? Keypair.fromSecret(existing[role]) : Keypair.random();
  }
  // Keys of earlier deployments (the tCHF issuer) are kept, not dropped.
  const out = { ...existing, ...Object.fromEntries(ROLES.map((r) => [r, keys[r].secret()])) };
  writeFileSync(SECRETS, JSON.stringify(out, null, 2) + "\n", { mode: 0o600 });
  return keys;
}

async function fund(kp) {
  try {
    await horizon.loadAccount(kp.publicKey());
    return;
  } catch {
    // not yet created
  }
  const res = await fetch(`${FRIENDBOT}?addr=${kp.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot refused ${kp.publicKey()}: ${res.status}`);
}

async function submit(source, ops, signers = [source]) {
  const account = await horizon.loadAccount(source.publicKey());
  let builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  for (const op of ops) builder = builder.addOperation(op);
  const tx = builder.setTimeout(60).build();
  for (const s of signers) tx.sign(s);
  const res = await horizon.submitTransaction(tx);
  return res.hash;
}

async function hasTrustline(pub, asset) {
  const acc = await horizon.loadAccount(pub);
  return acc.balances.some(
    (b) => b.asset_code === asset.getCode() && b.asset_issuer === asset.getIssuer(),
  );
}

function stellar(args) {
  return execFileSync("stellar", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

/// The SEP-58 build record, read from build.conf and the committed source
/// archive, so check-deployed-hash.mjs and verify.sh can replay the build.
function sep58Fields() {
  const conf = readFileSync(join(DEMO_DIR, "build.conf"), "utf8");
  const read = (name) => conf.match(new RegExp(`^${name}="([^"]+)"`, "m"))[1];
  const archive = readFileSync(join(DEMO_DIR, read("SOURCE_ARCHIVE")));
  return {
    version: "0.6.0",
    bldimg: read("BLDIMG"),
    bldopt: ["--locked"],
    source_sha256: createHash("sha256").update(archive).digest("hex"),
  };
}

const rawKey = (kp) => kp.rawPublicKey().toString("hex");

async function main() {
  if (!existsSync(WASM)) throw new Error("no out/cipherphi_demo_pool.wasm: run `npm run build:wasm` first");
  const wasmHash = createHash("sha256").update(readFileSync(WASM)).digest("hex");

  const keys = loadKeys();
  console.log("funding accounts from friendbot");
  for (const role of ["admin", "treasury", "distributor", "partner"]) await fund(keys[role]);

  // Trustlines, then the float. Re-runs skip what already exists.
  for (const role of ["treasury", "partner"]) {
    if (!(await hasTrustline(keys[role].publicKey(), USDC))) {
      console.log(`${role}: USDC trustline`);
      await submit(keys[role], [Operation.changeTrust({ asset: USDC })]);
    }
  }
  const held = await usdcBalance(keys.treasury.publicKey());
  if (held < TREASURY_FLOAT) {
    console.log(`buying ${TREASURY_FLOAT - held} USDC for the treasury`);
    await buyUsdc(keys.treasury.publicKey(), Math.ceil(TREASURY_FLOAT - held));
  }

  // Circle's USDC has had its asset contract on testnet for a long time; this
  // only deploys it if it is somehow not there. The address is deterministic.
  const assetContract = USDC.contractId(PASSPHRASE);
  try {
    stellar(["contract", "asset", "deploy", "--asset", `${USDC.getCode()}:${USDC.getIssuer()}`,
      "--source-account", keys.treasury.secret(), "--network", "testnet"]);
    console.log(`deployed the USDC asset contract ${assetContract}`);
  } catch {
    console.log(`USDC asset contract ${assetContract} already deployed`);
  }

  console.log("deploying the pool");
  const authority = JSON.stringify([rawKey(keys.authority0), rawKey(keys.authority1), rawKey(keys.authority2)]);
  const pool = stellar([
    "contract", "deploy", "--wasm", WASM,
    "--source-account", keys.admin.secret(), "--network", "testnet",
    "--",
    "--admin", keys.admin.publicKey(),
    "--authority", authority,
    "--threshold", String(THRESHOLD),
    "--distributor", keys.distributor.publicKey(),
    "--asset", assetContract,
  ]).split("\n").pop();
  console.log(`pool ${pool}`);

  console.log(`seeding the pool with ${SEED} USDC`);
  stellar([
    "contract", "invoke", "--id", pool,
    "--source-account", keys.treasury.secret(), "--network", "testnet",
    "--send", "yes",
    "--", "contribute", "--from", keys.treasury.publicKey(),
    "--amount", String(BigInt(SEED) * 10_000_000n),
  ]);

  const deployment = {
    network: "testnet",
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC,
    horizonUrl: HORIZON,
    contractId: pool,
    wasmHash,
    asset: {
      code: USDC.getCode(),
      issuer: USDC.getIssuer(),
      contractId: assetContract,
    },
    treasury: keys.treasury.publicKey(),
    distributor: keys.distributor.publicKey(),
    partner: keys.partner.publicKey(),
    bot: keys.bot.publicKey(),
    authority: [keys.authority0, keys.authority1, keys.authority2].map((k) => k.publicKey()),
    threshold: THRESHOLD,
    sep58: sep58Fields(),
    deployedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
  };
  writeFileSync(DEPLOYMENT, JSON.stringify(deployment, null, 2) + "\n");
  // The web app reads its own copy, so it deploys without the rest of demo/.
  writeFileSync(join(DEMO_DIR, "web", "lib", "deployment.json"), JSON.stringify(deployment, null, 2) + "\n");
  console.log(`wrote deployment.json (pool ${pool}, wasm ${wasmHash})`);
}

main().catch((err) => {
  console.error(err?.response?.data?.extras?.result_codes ?? err);
  process.exit(1);
});
