// The four moments end to end against live testnet, through the app's own API
// routes, with a fresh local keypair standing in for the Privy wallet. The
// signer is the real `privySigner`, handed a local key in place of Privy's
// service, so the hash-sign-attach path is the one the browser runs.
//
//   BASE=http://localhost:3000 npm run check:flow

import { Keypair } from "@stellar/stellar-sdk";
import { privySigner } from "../lib/signing/privy";
import { donate, onboard, readBalances, readSplit, requestRelease, tchfBalance } from "../lib/donate";
import { POOL_ERRORS, explorer, formatTchf } from "../lib/stellar";

const base = process.env.BASE ?? "http://localhost:3000";
const visitor = Keypair.random();
const signer = privySigner(visitor.publicKey(), async ({ hash }) => ({
  signature: `0x${visitor.sign(Buffer.from(hash.slice(2), "hex")).toString("hex")}`,
}));

function step(name: string) {
  console.log(`\n== ${name}`);
}
function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

step("give: onboard");
const onboarding = await onboard(signer, base);
if (!onboarding) fail("a fresh address came back as already onboarded");
console.log("onboarded", explorer.tx(onboarding));
const granted = await tchfBalance(visitor.publicKey());
console.log("balance", formatTchf(granted), "tCHF");
if (granted !== 100n * 10_000_000n) fail("grant was not 100 tCHF");

const again = await onboard(signer, base);
if (again !== null) fail("the same address was funded twice");
console.log("second onboarding refused as already ready: ok");

step("give: donate");
const before = await readBalances();
const donation = await donate(signer, base);
console.log("donated", explorer.tx(donation));

step("see it split");
const split = await readSplit(donation);
if (!split) fail("no Contribution event on the donation");
console.log("split", split.split.map((s) => formatTchf(s)).join(" / "));
const sum = split.split.reduce((a, b) => a + b, 0n);
if (sum !== split.amount) fail("split does not sum to the donation");
const after = await readBalances();
for (let i = 0; i < 8; i++) {
  if (after[i] - before[i] < split.split[i]) fail(`bucket ${i} did not grow by its share`);
}
console.log("pool balances grew by at least the split: ok");

step("see it released: without approval");
const refused = await requestRelease(donation, false, base);
console.log("refused", explorer.tx(refused.hash), refused.error);
if (refused.ok) fail("an unapproved payout succeeded");
if (refused.error?.code !== 12) fail(`expected ThresholdNotMet (#12), got ${refused.error?.detail}`);
console.log("why:", POOL_ERRORS[12].plain);

step("see it released: with approval");
const released = await requestRelease(donation, true, base);
console.log("released", explorer.tx(released.hash), "attestation", released.attestationHash);
if (!released.ok) fail(`approved payout failed: ${released.error?.detail}`);

const repeat = await requestRelease(donation, true, base).then(
  () => null,
  (err: Error) => err.message,
);
if (!repeat?.includes("already had its approved payout")) fail("a second release for the same donation was not refused");
console.log("second release for the same donation refused: ok");

step("check it");
console.log("receipt", `${base}/receipt?c=${donation}&r=${released.hash}&f=${refused.hash}`);
console.log("\nall four moments passed");
