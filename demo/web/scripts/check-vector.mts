// Hold the browser/server attestation encoder to the contract's committed
// known-answer vector. If this passes, a signature made over these bytes
// verifies inside the contract; if the struct ever changes, this fails here
// rather than on the call.

import { readFileSync } from "node:fs";
import { Keypair } from "@stellar/stellar-sdk";
import { attestationScVal } from "../lib/stellar";

const vector = JSON.parse(
  readFileSync(new URL("../../contract/test_vectors/attestation.json", import.meta.url), "utf8"),
);
const a = vector.attestation;

const bytes = attestationScVal({
  recipient: a.recipient,
  asset: a.asset,
  category: 0, // "Poor", the first variant
  amount: BigInt(a.amount),
  sequence: BigInt(a.sequence),
  expiryLedger: Number(a.expiry_ledger),
  pool: a.pool,
  networkId: Buffer.from(a.network_id, "hex"),
}).toXDR();

if (bytes.toString("hex") !== vector.signed_bytes_hex) {
  console.error("encoder does not match the committed vector");
  console.error(" ours:   ", bytes.toString("hex"));
  console.error(" vector: ", vector.signed_bytes_hex);
  process.exit(1);
}

const signer = Keypair.fromRawEd25519Seed(Buffer.from(vector.signer_seed_hex, "hex"));
const signature = signer.sign(bytes).toString("hex");
if (signature !== vector.signature_hex) {
  console.error("signature does not match the committed vector");
  process.exit(1);
}
console.log("attestation encoder matches the committed vector, signature included");
