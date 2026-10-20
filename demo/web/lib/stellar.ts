import {
  Address,
  Networks,
  StrKey,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import deployment from "./deployment.json";

/**
 * Everything the browser and the server both need to know about the demo
 * deployment, and the encoders both sides use.
 *
 * Testnet is pinned here, not configured. There is no environment variable
 * that points this app at mainnet, because no part of it should ever be able
 * to reach mainnet.
 */

export const NETWORK_PASSPHRASE = Networks.TESTNET;
if (deployment.networkPassphrase !== NETWORK_PASSPHRASE) {
  throw new Error("deployment.json is not a testnet deployment");
}

export const RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";

export const POOL = deployment.contractId;
export const WASM_HASH = deployment.wasmHash;
export const ASSET_CODE = deployment.asset.code;
export const ASSET_ISSUER = deployment.asset.issuer;
export const ASSET_CONTRACT = deployment.asset.contractId;
export const TREASURY = deployment.treasury;
export const DISTRIBUTOR = deployment.distributor;
export const PARTNER = deployment.partner;
export const AUTHORITY = deployment.authority;
export const THRESHOLD = deployment.threshold;

/** tCHF has Stellar's usual seven decimals. */
export const STROOPS = 10_000_000n;
/** What each visitor is given, and what one donation is. */
export const GRANT = 100n;
export const DONATION = 50n;
/** What one approved payout sends to the partner organisation. */
export const PAYOUT = 10n;
/** The category that payout is drawn from. */
export const PAYOUT_CATEGORY = 0;

export const rpcServer = () => new rpc.Server(RPC_URL);

export const explorer = {
  tx: (hash: string) => `https://stellar.expert/explorer/testnet/tx/${hash}`,
  contract: (id: string) =>
    `https://stellar.expert/explorer/testnet/contract/${id}`,
  account: (id: string) =>
    `https://stellar.expert/explorer/testnet/account/${id}`,
};

/** Two decimals, grouped thousands, no currency symbol: 1,245.00. */
export function formatTchf(stroops: bigint): string {
  const whole = (stroops / STROOPS).toLocaleString("en-US");
  const cents = ((stroops % STROOPS) / 100_000n).toString().padStart(2, "0");
  return `${whole}.${cents}`;
}

// --- the attestation ---------------------------------------------------------

export type Attestation = {
  recipient: string;
  asset: string;
  category: number;
  amount: bigint;
  sequence: bigint;
  expiryLedger: number;
  pool: string;
  networkId: Buffer;
};

/**
 * The attestation as the contract sees it: a `#[contracttype]` struct, which
 * is an `ScMap` keyed by field name with the entries **sorted by name**, not
 * by declaration order. These bytes are what the authority keys sign, and
 * `scripts/check-vector.mts` holds this function to the contract's committed
 * known-answer vector.
 */
export function attestationScVal(a: Attestation): xdr.ScVal {
  const entry = (key: string, val: xdr.ScVal) =>
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol(key), val });
  return xdr.ScVal.scvMap([
    entry("amount", nativeToScVal(a.amount, { type: "i128" })),
    entry("asset", new Address(a.asset).toScVal()),
    entry("category", xdr.ScVal.scvU32(a.category)),
    entry("expiry_ledger", xdr.ScVal.scvU32(a.expiryLedger)),
    entry("network_id", xdr.ScVal.scvBytes(a.networkId)),
    entry("pool", new Address(a.pool).toScVal()),
    entry("recipient", new Address(a.recipient).toScVal()),
    entry("sequence", nativeToScVal(a.sequence, { type: "u64" })),
  ]);
}

export function signerSigsScVal(
  sigs: { index: number; signature: Buffer }[],
): xdr.ScVal {
  return xdr.ScVal.scvVec(
    sigs.map(({ index, signature }) =>
      xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("index"),
          val: xdr.ScVal.scvU32(index),
        }),
        new xdr.ScMapEntry({
          key: xdr.ScVal.scvSymbol("signature"),
          val: xdr.ScVal.scvBytes(signature),
        }),
      ]),
    ),
  );
}

// --- reading the pool --------------------------------------------------------

/** The Contribution event's split, for one transaction, if it has one. */
export function contributionFromEvents(
  events: xdr.ContractEvent[],
): { contributor: string; amount: bigint; split: bigint[] } | null {
  for (const event of events) {
    const id = event.contractId();
    if (!id || StrKey.encodeContract(Buffer.from(id as unknown as Uint8Array)) !== POOL) continue;
    const body = event.body().v0();
    const topics = body.topics().map((t) => scValToNative(t));
    if (topics[0] !== "contribution") continue;
    const data = scValToNative(body.data()) as {
      amount: bigint;
      split: bigint[];
    };
    return { contributor: topics[1] as string, amount: data.amount, split: data.split };
  }
  return null;
}

/** The Disbursement event, for one transaction, if it has one. */
export function disbursementFromEvents(events: xdr.ContractEvent[]): {
  recipient: string;
  category: number;
  amount: bigint;
  sequence: bigint;
  attestationHash: string;
} | null {
  for (const event of events) {
    const id = event.contractId();
    if (!id || StrKey.encodeContract(Buffer.from(id as unknown as Uint8Array)) !== POOL) continue;
    const body = event.body().v0();
    const topics = body.topics().map((t) => scValToNative(t));
    if (topics[0] !== "disbursement") continue;
    const data = scValToNative(body.data()) as {
      amount: bigint;
      sequence: bigint;
      attestation_hash: Buffer;
    };
    return {
      recipient: topics[1] as string,
      category: Number(topics[2]),
      amount: data.amount,
      sequence: data.sequence,
      attestationHash: Buffer.from(data.attestation_hash).toString("hex"),
    };
  }
  return null;
}

/** The pool's contract error codes, in the words the demo shows a visitor. */
export const POOL_ERRORS: Record<number, { name: string; plain: string }> = {
  2: { name: "InvalidAmount", plain: "The amount must be more than zero." },
  5: { name: "AttestationMismatch", plain: "The payout does not match what the approval was signed for." },
  6: { name: "WrongPool", plain: "The approval was signed for a different pool." },
  7: { name: "WrongNetwork", plain: "The approval was signed for a different network." },
  8: { name: "WrongAsset", plain: "The approval was signed for a different asset." },
  9: { name: "Expired", plain: "The approval has expired." },
  10: { name: "SequenceMismatch", plain: "The approval was already used, or is out of order." },
  11: { name: "UnknownSigner", plain: "A signature came from a key that is not an eligibility signer." },
  12: {
    name: "ThresholdNotMet",
    plain: "Refused by the pool: fewer than 2 of 3 eligibility signers approved it.",
  },
  13: { name: "InsufficientBucket", plain: "That category does not hold enough to pay this out." },
  14: { name: "Insolvent", plain: "The pool would owe more than it holds." },
  16: { name: "SelfDistribution", plain: "The pool cannot pay itself." },
};

/** Pull `Error(Contract, #N)` out of whatever the host or RPC said. */
export function poolErrorCode(text: string): number | null {
  const m = text.match(/Error\(Contract, #(\d+)\)/);
  return m ? Number(m[1]) : null;
}
