// SPDX-License-Identifier: Apache-2.0
//
// Top up the treasury with testnet USDC:
//
//   node scripts/top-up.mjs [amount]     # whole USDC, default 5000
//
// Circle's testnet faucet sends 20 USDC per request, which funds two visitors.
// Testnet also has an XLM/USDC liquidity pool on its exchange, so instead this
// opens a throwaway account from friendbot, swaps its test XLM for USDC paid
// straight to the treasury, and merges what XLM is left into the treasury too.
// One run of 5000 USDC funds 500 visitors.
//
// Testnet only. The passphrase is pinned below and there is no flag to change it.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const PASSPHRASE = Networks.TESTNET;
const HORIZON = "https://horizon-testnet.stellar.org";
const FRIENDBOT = "https://friendbot.stellar.org";

/// Circle's testnet USDC issuer, from Circle's Stellar quickstart.
export const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
/// Friendbot gives 10,000 XLM. Keep enough back for the merge.
const MAX_XLM = "9900";
/// The most bought in one swap, so one friendbot account always covers it.
const CHUNK = 5000;

const horizon = new Horizon.Server(HORIZON);

/** The USDC balance of an account, in whole USDC (0 without a trustline). */
export async function usdcBalance(pub) {
  const acc = await horizon.loadAccount(pub);
  const line = acc.balances.find((b) => b.asset_code === USDC.getCode() && b.asset_issuer === USDC.getIssuer());
  return line ? Number(line.balance) : 0;
}

/** Buy `amount` USDC for `destination`, which must already trust USDC. */
export async function buyUsdc(destination, amount) {
  for (let left = amount; left > 0; left -= CHUNK) {
    const chunk = Math.min(left, CHUNK);
    const throwaway = Keypair.random();
    const res = await fetch(`${FRIENDBOT}?addr=${throwaway.publicKey()}`);
    if (!res.ok) throw new Error(`friendbot refused ${throwaway.publicKey()}: ${res.status}`);

    const account = await horizon.loadAccount(throwaway.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
      .addOperation(
        Operation.pathPaymentStrictReceive({
          sendAsset: Asset.native(),
          sendMax: MAX_XLM,
          destination,
          destAsset: USDC,
          destAmount: String(chunk),
          path: [],
        }),
      )
      .addOperation(Operation.accountMerge({ destination }))
      .setTimeout(60)
      .build();
    tx.sign(throwaway);
    const sent = await horizon.submitTransaction(tx);
    console.log(`bought ${chunk} USDC for ${destination} (${sent.hash})`);
  }
}

async function main() {
  const amount = Number(process.argv[2] ?? 5000);
  if (!(amount > 0)) throw new Error("amount must be a positive number of USDC");
  const secrets = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", ".secrets.json"), "utf8"));
  const treasury = Keypair.fromSecret(secrets.treasury).publicKey();
  await buyUsdc(treasury, amount);
  console.log(`treasury now holds ${await usdcBalance(treasury)} USDC`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err?.response?.data?.extras?.result_codes ?? err);
    process.exit(1);
  });
}
