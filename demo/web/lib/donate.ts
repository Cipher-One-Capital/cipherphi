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
  DONATION,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  POOL,
  STROOPS,
  TREASURY,
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
  if (!res.ok) throw new Error(json.error ?? `${path} failed (${res.status})`);
  return json as T;
}

/** Open, sponsor and fund the visitor's account, if it is not ready already. */
export async function onboard(signer: Signer, base = ""): Promise<string | null> {
  const built = await postJson<{ status: "ready" } | { status: "sign"; xdr: string }>(
    base,
    "/api/onboard",
    { address: signer.address },
  );
  if (built.status === "ready") return null;
  const tx = TransactionBuilder.fromXDR(built.xdr, NETWORK_PASSPHRASE) as Transaction;
  checkOnboarding(tx, signer.address);
  const signed = await signer.signTransaction(tx);
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
  if (tx.source !== TREASURY || types !== expected) {
    throw new Error("The server sent an onboarding transaction this page does not recognise, so it was not signed.");
  }
  for (const op of tx.operations) {
    if (op.source && op.source !== address) {
      throw new Error("The onboarding transaction acts for another account, so it was not signed.");
    }
  }
}

export async function tchfBalance(address: string): Promise<bigint> {
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

/**
 * Donate the fixed amount. The visitor signs the call; the treasury wraps it
 * in a fee-bump and pays the fee, so the visitor's account never holds XLM.
 */
export async function donate(signer: Signer, base = ""): Promise<string> {
  const server = rpcServer();
  const account = await server.getAccount(signer.address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(POOL).call(
        "contribute",
        new Address(signer.address).toScVal(),
        nativeToScVal(DONATION * STROOPS, { type: "i128" }),
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
  const signed = await signer.signTransaction(prepared);
  const { hash } = await postJson<{ hash: string }>(base, "/api/contribute", {
    signed: signed.toXDR(),
  });
  return hash;
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

export function requestRelease(contribution: string, approved: boolean, base = "") {
  return postJson<ReleaseResult>(base, approved ? "/api/release" : "/api/release-unapproved", {
    contribution,
  });
}
