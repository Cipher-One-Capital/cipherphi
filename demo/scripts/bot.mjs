// SPDX-License-Identifier: Apache-2.0
//
// The demo bot: gives to the pool at a random interval, so the live strip has
// something to show during a partner call.
//
//   node scripts/bot.mjs                 # one gift every 1-3 minutes, for 60 minutes
//   node scripts/bot.mjs --minutes 90 --min 30 --max 120   # seconds between gifts
//
// It gives from its own account, the `bot` key, whose address is published in
// deployment.json. The site labels its gifts "the demo bot" and counts them
// apart from visitors' donations, so the strip never passes them off as real
// visitors. Stop it with Ctrl-C.
//
// Testnet only. The passphrase is pinned below and there is no flag to change it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { USDC, buyUsdc, usdcBalance } from "./top-up.mjs";

const DEMO_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const PASSPHRASE = Networks.TESTNET;
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

/// Gift sizes in whole USDC, picked at random: mostly small, now and then larger.
const AMOUNTS = [5, 5, 5, 10, 10, 20, 25, 50];
/// Top up below this, by this much.
const LOW = 200;
const REFILL = 2000;

const { values } = parseArgs({
  options: {
    minutes: { type: "string", default: "60" },
    min: { type: "string", default: "60" },
    max: { type: "string", default: "180" },
  },
});
const minutes = Number(values.minutes);
const [minGap, maxGap] = [Number(values.min), Number(values.max)];
if (!(minutes > 0 && minGap > 0 && maxGap >= minGap)) throw new Error("bad --minutes, --min or --max");

const deployment = JSON.parse(readFileSync(join(DEMO_DIR, "deployment.json"), "utf8"));
const secrets = JSON.parse(readFileSync(join(DEMO_DIR, ".secrets.json"), "utf8"));
if (!secrets.bot) throw new Error("no bot key in .secrets.json: run `npm run deploy` first");
const bot = Keypair.fromSecret(secrets.bot);
if (deployment.bot !== bot.publicKey()) throw new Error("deployment.json does not name this bot key");

async function setUp() {
  try {
    await horizon.loadAccount(bot.publicKey());
  } catch {
    console.log(`opening the bot account ${bot.publicKey()}`);
    const res = await fetch(`https://friendbot.stellar.org?addr=${bot.publicKey()}`);
    if (!res.ok) throw new Error(`friendbot refused the bot: ${res.status}`);
  }
  const account = await horizon.loadAccount(bot.publicKey());
  const trusts = account.balances.some((b) => b.asset_code === USDC.getCode() && b.asset_issuer === USDC.getIssuer());
  if (!trusts) {
    console.log("adding the bot's USDC trustline");
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(Operation.changeTrust({ asset: USDC }))
      .setTimeout(60)
      .build();
    tx.sign(bot);
    await horizon.submitTransaction(tx);
  }
}

async function give() {
  if ((await usdcBalance(bot.publicKey())) < LOW) {
    console.log(`buying ${REFILL} USDC for the bot`);
    await buyUsdc(bot.publicKey(), REFILL);
  }
  const amount = AMOUNTS[Math.floor(Math.random() * AMOUNTS.length)];
  execFileSync("stellar", [
    "contract", "invoke", "--id", deployment.contractId,
    "--source-account", bot.secret(), "--network", "testnet", "--send", "yes",
    "--", "contribute", "--from", bot.publicKey(), "--amount", String(BigInt(amount) * 10_000_000n),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  console.log(`${new Date().toISOString().slice(11, 19)} gave ${amount} USDC`);
}

async function main() {
  await setUp();
  const end = Date.now() + minutes * 60_000;
  console.log(`giving every ${minGap}-${maxGap} s for ${minutes} min. Ctrl-C to stop.`);
  while (Date.now() < end) {
    try {
      await give();
    } catch (err) {
      // Testnet hiccups (timeouts, a busy node) skip one gift, not the run.
      console.error(`skipped a gift: ${String(err?.stderr ?? err?.message ?? err).trim().split("\n").pop()}`);
    }
    const gap = minGap + Math.random() * (maxGap - minGap);
    await new Promise((r) => setTimeout(r, gap * 1000));
  }
  console.log("done");
}

main().catch((err) => {
  console.error(err?.response?.data?.extras?.result_codes ?? err);
  process.exit(1);
});
