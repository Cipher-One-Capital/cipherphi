import {
  Address,
  BASE_FEE,
  Contract,
  Horizon,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { Signer } from "./signing/signer";
import {
  ASSET_CODE,
  ASSET_ISSUER,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  POOL,
  STROOPS,
  TREASURY,
  type ReleaseStage,
  contributionFromEvents,
  rpcServer,
} from "./stellar";

/**
 * The visitor's side of the flow, shared by the page and the end-to-end check
 * script. Every network call the browser makes is here; every call that needs
 * a secret goes through the API routes in `app/api/`.
 */

async function postJson<T>(base: string, path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("The demo server did not respond. Check the connection and try again.");
  }
  const json = await res.json().catch(() => ({}));
  if (res.status === 409) throw new Busy(json.error);
  if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
  return json as T;
}

/**
 * Open, sponsor and fund the visitor's account, if it is not ready already.
 * The server answers 409 when another visitor's onboarding took the treasury's
 * sequence number first; then the whole exchange runs again.
 */
/** The steps of opening a visitor's account, in order. */
export type OnboardStage = "build" | "sign" | "submit";

export async function onboard(
  signer: Signer,
  base = "",
  onStage: (stage: OnboardStage) => void = () => {},
): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await onboardOnce(signer, base, onStage);
    } catch (err) {
      if (!(err instanceof Busy) || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 1000 + Math.random() * 2000));
    }
  }
}

async function onboardOnce(
  signer: Signer,
  base: string,
  onStage: (stage: OnboardStage) => void,
): Promise<string | null> {
  onStage("build");
  const built = await postJson<{ status: "ready" } | { status: "sign"; xdr: string }>(
    base,
    "/api/onboard",
    { address: signer.address },
  );
  if (built.status === "ready") return null;
  const tx = TransactionBuilder.fromXDR(built.xdr, NETWORK_PASSPHRASE) as Transaction;
  checkOnboarding(tx, signer.address);
  onStage("sign");
  const signed = await signer.signTransaction(tx);
  onStage("submit");
  const { hash } = await postJson<{ hash: string }>(base, "/api/onboard", {
    address: signer.address,
    signed: signed.toXDR(),
  });
  return hash;
}

/**
 * Before the visitor signs anything, check it is what it claims to be: the
 * treasury opening and funding this address, and nothing that spends from it.
 */
function checkOnboarding(tx: Transaction, address: string) {
  const types = tx.operations.map((op) => op.type).join(",");
  const expected =
    "beginSponsoringFutureReserves,createAccount,changeTrust,endSponsoringFutureReserves,payment";
  if (types !== expected) {
    throw new Error("The server sent an onboarding transaction this page does not recognise, so it was not signed.");
  }
  // The visitor's signature covers only the two operations that act for the
  // visitor: adding the trustline and accepting the sponsorship. Everything
  // else is the treasury's own, sent from one of its channel accounts.
  const sources = tx.operations.map((op) => op.source);
  const want = [TREASURY, TREASURY, address, address, TREASURY];
  if (sources.some((s, i) => s !== want[i])) {
    throw new Error("The onboarding transaction acts for another account, so it was not signed.");
  }
}

export async function tokenBalance(address: string): Promise<bigint> {
  try {
    const account = await new Horizon.Server(HORIZON_URL).loadAccount(address);
    const line = account.balances.find(
      (b) => "asset_code" in b && b.asset_code === ASSET_CODE && b.asset_issuer === ASSET_ISSUER,
    );
    if (!line) return 0n;
    const [whole, frac = ""] = line.balance.split(".");
    return BigInt(whole) * STROOPS + BigInt(frac.padEnd(7, "0"));
  } catch {
    return 0n;
  }
}

/** What a donation is doing right now, in the order it happens. */
export type DonateStage = "check" | "sign" | "submit" | "confirm";

/**
 * Donate the chosen amount. The visitor signs the call; the treasury wraps it
 * in a fee-bump and pays the fee, so the visitor's account never holds XLM.
 * `onStage` hears each step as it starts.
 */
export async function donate(
  signer: Signer,
  stroops: bigint,
  base = "",
  onStage: (stage: DonateStage) => void = () => {},
): Promise<string> {
  // The server answers 409 when it had to renew the pool's storage first;
  // the donation is then prepared and signed again, at the normal fee.
  for (let attempt = 0; ; attempt++) {
    try {
      return await donateOnce(signer, stroops, base, onStage);
    } catch (err) {
      if (!(err instanceof Busy) || attempt >= 2) throw err;
    }
  }
}

async function donateOnce(
  signer: Signer,
  stroops: bigint,
  base: string,
  onStage: (stage: DonateStage) => void,
): Promise<string> {
  const server = rpcServer();
  onStage("check");
  const account = await server.getAccount(signer.address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(POOL).call(
        "contribute",
        new Address(signer.address).toScVal(),
        nativeToScVal(stroops, { type: "i128" }),
      ),
    )
    .setTimeout(120)
    .build();

  // Sign after preparing: assembly changes the transaction, so a signature
  // made before it would be over different bytes.
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Stellar checked the donation and turned it down: ${sim.error}`);
  }
  const prepared = rpc.assembleTransaction(tx, sim).build();
  onStage("sign");
  const signed = await signer.signTransaction(prepared);
  onStage("submit");
  const { hash } = await postJson<{ hash: string }>(base, "/api/contribute", {
    signed: signed.toXDR(),
  });

  // The server answers once the network has accepted it; a ledger closes
  // about every five seconds, so confirmation follows shortly after.
  onStage("confirm");
  for (let i = 0; i < 30; i++) {
    const final = await server.getTransaction(hash);
    if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
      throw new Error("Stellar recorded the donation as failed. Nothing left your balance.");
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("The network did not confirm the donation in time. Check your balance before trying again.");
}

/** The split the pool recorded for one donation, read back from its event. */
export async function readSplit(txHash: string) {
  const tx = await rpcServer().getTransaction(txHash);
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return null;
  return contributionFromEvents(tx.events?.contractEventsXdr?.flat() ?? []);
}

/** The pool's eight balances, read from contract state. */
export async function readBalances(): Promise<bigint[]> {
  const server = rpcServer();
  const account = await server.getAccount(TREASURY);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(new Contract(POOL).call("balances"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new Error("Could not read the pool's balances.");
  }
  return sim.result.retval.vec()!.map((v) => {
    const parts = v.i128();
    return (parts.hi().toBigInt() << 64n) | parts.lo().toBigInt();
  });
}

export type ReleaseResult = {
  hash: string;
  ok: boolean;
  category: number;
  amount: string;
  attestationHash?: string;
  error?: { code: number | null; detail: string };
};

/**
 * Ask the server for a payout, with or without approval. The server streams
 * each step as it reaches it, which `onStage` hears, and then the result.
 */
export async function requestRelease(
  contribution: string,
  approved: boolean,
  base = "",
  onStage: (stage: ReleaseStage) => void = () => {},
): Promise<ReleaseResult> {
  const path = approved ? "/api/release" : "/api/release-unapproved";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contribution }),
    });
  } catch {
    throw new Error("The demo server did not respond. Check the connection and try again.");
  }
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `${path} failed (${res.status})`);
  }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (line.stage) onStage(line.stage);
      else if (line.error) throw new Error(line.error);
      else return line.result as ReleaseResult;
    }
  }
  throw new Error("The demo server stopped answering before the payout finished. Your receipt shows what reached the ledger.");
}

/** The server lost a race, or renewed the pool first, and asks for a retry. */
class Busy extends Error {}


