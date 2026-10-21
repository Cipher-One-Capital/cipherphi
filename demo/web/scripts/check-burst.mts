// Several visitors opening accounts at the same moment, as on a partner call
// where everyone tries the demo at once. Each must end up funded.
//
//   BASE=http://localhost:3100 npm run check:burst -- 8

import { Keypair } from "@stellar/stellar-sdk";
import { privySigner } from "../lib/signing/privy";
import { onboard } from "../lib/donate";

const base = process.env.BASE ?? "http://localhost:3000";
const count = Number(process.argv[2] ?? 8);

const visit = async (i: number) => {
  const kp = Keypair.random();
  const signer = privySigner(kp.publicKey(), async ({ hash }) => ({
    signature: `0x${kp.sign(Buffer.from(hash.slice(2), "hex")).toString("hex")}`,
  }));
  const t = Date.now();
  try {
    await onboard(signer, base);
    return { ok: true, line: `visitor ${i}: opened in ${((Date.now() - t) / 1000).toFixed(1)} s` };
  } catch (e) {
    return { ok: false, line: `visitor ${i}: FAILED ${(e as Error).message}` };
  }
};

const results = await Promise.all(Array.from({ length: count }, (_, i) => visit(i + 1)));
console.log(results.map((r) => r.line).join("\n"));
if (results.some((r) => !r.ok)) process.exit(1);
