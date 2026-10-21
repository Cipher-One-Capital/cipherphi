import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Horizon,
  Keypair,
  Memo,
  Operation,
  StrKey,
  Transaction,
  TransactionBuilder,
  hash,
  nativeToScVal,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  ASSET_CODE,
  ASSET_ISSUER,
  AUTHORITY,
  DISTRIBUTOR,
  GRANT,
  HORIZON_URL,
  NETWORK_PASSPHRASE,
  PARTNER,
  PAYOUT,
  PAYOUT_CATEGORY,
  type ReleaseStage,
  POOL,
  ASSET_CONTRACT,
  STROOPS,
  TREASURY,
  attestationScVal,
  contributionFromEvents,
  poolErrorCode,
  rpcServer,
  signerSigsScVal,
} from "../stellar";

/**
 * Everything that needs a testnet secret key. Server only.
 *
 * Four keys live here, all testnet, all throwaway:
 *
 *   - the treasury, which sponsors a visitor's account, gives them USDC, and
 *     pays their transaction fees;
 *   - the distributor, the only address the pool lets submit a payout;
 *   - two of the three eligibility signers. The third is deliberately not on
 *     this server, so that what the demo shows is a real 2-of-3 quorum.
 *
 * In the pilot these are different parties holding different keys. Here one
 * server holds them so that a visitor can watch the whole flow in a few
 * minutes, and the UI says so.
 */

class DemoError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export { DemoError };

function key(name: string): Keypair {
  const secret = process.env[name];
  if (!secret) throw new DemoError(`${name} is not set on the server`, 500);
  return Keypair.fromSecret(secret);
}

const token = () => new Asset(ASSET_CODE, ASSET_ISSUER);
const horizon = () => new Horizon.Server(HORIZON_URL);

/** How many visitor accounts the treasury will open in any 24 hours. */
const DAILY_ONBOARD_CAP = 300;
/** The most a sponsored transaction may cost the treasury, in stroops of XLM. */
const MAX_SPONSORED_FEE = 20_000_000n; // 2 XLM

// --- 1. onboarding -----------------------------------------------------------

/**
 * A transaction that opens the visitor's account, adds the USDC trustline, and
 * pays them the grant, with the treasury sponsoring every reserve. The
 * treasury signs it here; the visitor's signature, added in the browser, is
 * what makes it valid. Because the treasury has already signed, the visitor
 * cannot change a byte of it without voiding that signature.
 *
 * The per-visitor cap is the account itself: this is only ever built for an
 * address that does not exist yet, so one address is funded once. The global
 * cap is read from the treasury's own history on Horizon, so it needs no
 * database.
 */
export async function buildOnboarding(address: string): Promise<
  { status: "ready" } | { status: "sign"; xdr: string }
> {
  if (!StrKey.isValidEd25519PublicKey(address)) throw new DemoError("not a Stellar address");
  const h = horizon();

  try {
    const account = await h.loadAccount(address);
    const holds = account.balances.some(
      (b) => "asset_code" in b && b.asset_code === ASSET_CODE && b.asset_issuer === ASSET_ISSUER,
    );
    if (holds) return { status: "ready" };
    throw new DemoError(
      "This address already exists on testnet without testnet USDC, so the demo will not fund it. Sign in with a different email.",
    );
  } catch (err) {
    if (err instanceof DemoError) throw err;
    // 404: the account does not exist yet, which is the case we fund.
  }

  const treasury = key("TREASURY_SECRET");
  const since = Date.now() - 24 * 3600 * 1000;
  const recent = await h
    .operations()
    .forAccount(TREASURY)
    .order("desc")
    .limit(200)
    .call();
  const opened = recent.records.filter(
    (op) => op.type === "create_account" && Date.parse(op.created_at) > since,
  ).length;
  if (opened >= DAILY_ONBOARD_CAP) {
    throw new DemoError("The demo has reached today's visitor limit. Try again tomorrow.", 429);
  }

  const funds = await h.loadAccount(treasury.publicKey());
  // The treasury's USDC is bought on the testnet exchange and topped up by
  // hand (scripts/top-up.mjs), so it can run out. Say so plainly.
  const float = funds.balances.find(
    (b) => "asset_code" in b && b.asset_code === ASSET_CODE && b.asset_issuer === ASSET_ISSUER,
  );
  if (!float || Number(float.balance) < Number(GRANT)) {
    throw new DemoError("The demo has run out of test USDC. Try again later.", 503);
  }
  // The transaction comes from a channel account, so visitors arriving
  // together do not queue on one sequence number; every operation that
  // spends is the treasury's own.
  const channel = await channelFor(h, treasury);
  const tx = new TransactionBuilder(channel.account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.beginSponsoringFutureReserves({ sponsoredId: address, source: TREASURY }),
    )
    .addOperation(
      Operation.createAccount({ destination: address, startingBalance: "0", source: TREASURY }),
    )
    .addOperation(Operation.changeTrust({ asset: token(), source: address }))
    .addOperation(Operation.endSponsoringFutureReserves({ source: address }))
    .addOperation(
      Operation.payment({
        destination: address,
        asset: token(),
        amount: GRANT.toString(),
        source: TREASURY,
      }),
    )
    .setTimeout(300)
    .build();
  tx.sign(channel.key, treasury);
  return { status: "sign", xdr: tx.toXDR() };
}

/** How many channel accounts onboarding spreads over. */
const CHANNELS = 16;

/**
 * Channel account `i`: a key derived from the treasury's, so the server
 * needs no extra secrets. It holds a little XLM for fees and nothing else.
 */
function channelKey(treasury: Keypair, i: number): Keypair {
  return Keypair.fromRawEd25519Seed(
    hash(Buffer.concat([Buffer.from(`cipherphi-channel:${i}:`), treasury.rawSecretKey()])),
  );
}

const isChannel = (source: string, treasury: Keypair) =>
  Array.from({ length: CHANNELS }, (_, i) => channelKey(treasury, i).publicKey()).includes(source);

/** A random channel account, opened from the treasury the first time it is used. */
async function channelFor(h: Horizon.Server, treasury: Keypair) {
  const key = channelKey(treasury, Math.floor(Math.random() * CHANNELS));
  try {
    return { key, account: await h.loadAccount(key.publicKey()) };
  } catch {
    const open = new TransactionBuilder(await h.loadAccount(treasury.publicKey()), {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.createAccount({ destination: key.publicKey(), startingBalance: "20" }))
      .setTimeout(60)
      .build();
    open.sign(treasury);
    const result = await sendAndWait(open);
    const exists = await h.loadAccount(key.publicKey()).then((a) => a, () => null);
    if (exists) return { key, account: exists };
    throw new DemoError(
      result.ok ? "the channel account did not appear" : "The demo is opening another visitor's account. Trying again.",
      409,
    );
  }
}

/** Submit the onboarding transaction once the visitor has signed it. */
export async function submitOnboarding(signedXdr: string): Promise<string> {
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (tx instanceof FeeBumpTransaction || !isChannel(tx.source, key("TREASURY_SECRET"))) {
    throw new DemoError("not an onboarding transaction");
  }
  // The treasury's signature is already on it, so a tampered body would fail
  // at the network anyway. This is the cheaper refusal.
  const treasury = Keypair.fromPublicKey(TREASURY);
  if (!tx.signatures.some((s) => treasury.verify(tx.hash(), s.signature()))) {
    throw new DemoError("onboarding transaction was altered after the treasury signed it");
  }
  // Sent through RPC, which answers a sequence clash at once (Horizon on
  // testnet times out instead). Two visitors onboarding at the same moment
  // share the treasury's next sequence number and one loses; the browser then
  // rebuilds, re-signs and tries again on a 409.
  let result;
  try {
    result = await sendAndWait(tx, () => droppedFromChannel(tx));
  } catch {
    // The testnet RPC node itself failed (a 502 from its gateway, say).
    result = { hash: tx.hash().toString("hex"), ok: false, detail: NOT_CONFIRMED };
  }
  if (result.ok) return result.hash;
  // A clash can also show as a transaction the network took and then dropped.
  // If the account exists anyway, it landed; if not, it is the same retry.
  const address = tx.operations.find((op) => op.type === "createAccount")?.destination;
  const exists = address && (await horizon().loadAccount(address).then(() => true, () => false));
  if (exists) return result.hash;
  if (["txBadSeq", "TRY_AGAIN_LATER", NOT_CONFIRMED].includes(result.detail)) {
    throw new DemoError("The demo is opening another visitor's account. Trying again.", 409);
  }
  throw new DemoError(`the network refused the onboarding: ${result.detail}`, 502);
}

/** Horizon's transaction result code for a rejected submission, if it gave one. */
function horizonCode(err: unknown): string | undefined {
  const e = err as { response?: { data?: { extras?: { result_codes?: { transaction?: string } } } } };
  return e?.response?.data?.extras?.result_codes?.transaction;
}

// --- 2. the donation, fee-bumped ---------------------------------------------

/**
 * Wrap the visitor's signed `contribute` call in a fee-bump paid by the
 * treasury, so the visitor never needs XLM. Only a single call to this pool's
 * `contribute`, from the transaction's own source, for at most the grant, is
 * sponsored; anything else is refused before it costs the treasury anything.
 */
export async function sponsorContribution(signedXdr: string): Promise<string> {
  const inner = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  if (inner instanceof FeeBumpTransaction) throw new DemoError("already fee-bumped");
  checkContribution(inner);
  if (BigInt(inner.fee) > MAX_SPONSORED_FEE) throw new DemoError("fee too high to sponsor");

  const bump = TransactionBuilder.buildFeeBumpTransaction(
    key("TREASURY_SECRET"),
    (BigInt(inner.fee) + 1000n).toString(),
    inner,
    NETWORK_PASSPHRASE,
  );
  bump.sign(key("TREASURY_SECRET"));
  const sent = await rpcServer().sendTransaction(bump);
  if (sent.status === "ERROR") {
    throw new DemoError(`the network refused it: ${describeResult(sent.errorResult)}`, 502);
  }
  if (sent.status === "TRY_AGAIN_LATER") throw new DemoError("the network is busy, try again in a moment", 503);
  return sent.hash;
}

function checkContribution(tx: Transaction) {
  if (tx.operations.length !== 1) throw new DemoError("one operation only");
  const op = tx.operations[0];
  if (op.type !== "invokeHostFunction") throw new DemoError("not a contract call");
  const fn = op.func;
  if (fn.switch() !== xdr.HostFunctionType.hostFunctionTypeInvokeContract()) {
    throw new DemoError("not a contract call");
  }
  const call = fn.invokeContract();
  if (Address.fromScAddress(call.contractAddress()).toString() !== POOL) {
    throw new DemoError("not a call to the demo pool");
  }
  if (call.functionName().toString() !== "contribute") {
    throw new DemoError("only contribute is sponsored");
  }
  const [from, amount] = call.args();
  if (Address.fromScVal(from).toString() !== tx.source) {
    throw new DemoError("contributor must be the transaction source");
  }
  const stroops = BigInt(
    (amount.i128().hi().toBigInt() << 64n) | amount.i128().lo().toBigInt(),
  );
  if (stroops <= 0n || stroops > GRANT * STROOPS) throw new DemoError("amount out of range");
}

// --- 3. the payout -----------------------------------------------------------

export type Release = {
  hash: string;
  ok: boolean;
  category: number;
  amount: string;
  attestationHash?: string;
  error?: { code: number | null; detail: string };
};

/**
 * Pay the partner organisation from one category, once per donation.
 *
 * Once per donation, without a database. A Soroban transaction cannot carry a
 * memo, so before each payout the distributor sends a no-op classic
 * transaction whose memo is `sha256(kind || donation hash)`. Finding that memo
 * in the distributor's history means this donation has had its payout of this
 * kind, and the request is refused. Nothing personal goes on chain: the memo
 * is a hash of a public transaction hash.
 *
 * `approved: false` sends the very same payout with no eligibility signatures
 * at all, and sends it to the network rather than stopping at simulation, so
 * the refusal is a failed transaction anyone can look up, not a claim the UI
 * makes.
 */
export async function release(
  contributionHash: string,
  approved: boolean,
  onStage: (stage: ReleaseStage) => void = () => {},
): Promise<Release> {
  if (!/^[0-9a-f]{64}$/.test(contributionHash)) throw new DemoError("not a transaction hash");
  onStage("check");
  await requireContribution(contributionHash);

  const marker = hash(Buffer.concat([
    Buffer.from(approved ? "approved:" : "unapproved:"),
    Buffer.from(contributionHash, "hex"),
  ]));
  if (await markerExists(marker)) {
    throw new DemoError(
      approved
        ? "This donation has already had its approved payout. Your receipt has the link."
        : "This donation has already had its unapproved attempt. Your receipt has the link.",
      409,
    );
  }

  const server = rpcServer();
  const distributor = key("DISTRIBUTOR_SECRET");
  const signers = [key("AUTHORITY_SECRET_0"), key("AUTHORITY_SECRET_1")];
  if (signers[0].publicKey() !== AUTHORITY[0] || signers[1].publicKey() !== AUTHORITY[1]) {
    throw new DemoError("authority keys on the server do not match the deployment", 500);
  }
  onStage("mark");
  await sendMarker(distributor, marker);

  // Attestations are consumed strictly in sequence. Two visitors releasing at
  // the same moment would sign for the same slot, so a lost race re-reads the
  // sequence and tries again.
  for (let attempt = 0; attempt < 4; attempt++) {
    onStage("approve");
    const latest = await server.getLatestLedger();
    const sequence = await readSequence(server);
    const attestation = {
      recipient: PARTNER,
      asset: ASSET_CONTRACT,
      category: PAYOUT_CATEGORY,
      amount: PAYOUT * STROOPS,
      sequence,
      expiryLedger: latest.sequence + 120, // about ten minutes
      pool: POOL,
      networkId: hash(Buffer.from(NETWORK_PASSPHRASE)),
    };
    const attestationVal = attestationScVal(attestation);
    const message = attestationVal.toXDR();
    const signed = signerSigsScVal(
      signers.map((kp, index) => ({ index, signature: kp.sign(message) })),
    );

    const args = (sigs: xdr.ScVal) => [
      new Address(PARTNER).toScVal(),
      xdr.ScVal.scvU32(PAYOUT_CATEGORY),
      nativeToScVal(attestation.amount, { type: "i128" }),
      attestationVal,
      sigs,
    ];
    // The distributor is the transaction source, so its authorisation is the
    // source-account kind. It is written out rather than taken from the
    // simulation because the unapproved call is never simulated successfully,
    // and an auth entry covers the exact arguments it was made for.
    const call = (sigs: xdr.ScVal) =>
      Operation.invokeContractFunction({
        contract: POOL,
        function: "distribute",
        args: args(sigs),
        auth: [
          new xdr.SorobanAuthorizationEntry({
            credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
            rootInvocation: new xdr.SorobanAuthorizedInvocation({
              function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
                new xdr.InvokeContractArgs({
                  contractAddress: new Address(POOL).toScAddress(),
                  functionName: "distribute",
                  args: args(sigs),
                }),
              ),
              subInvocations: [],
            }),
          }),
        ],
      });

    // A fresh Account per build: the builder bumps the sequence it is handed,
    // and the approved and unapproved variants must share one.
    const { sequenceNumber } = await server.getAccount(distributor.publicKey()).then((a) => ({
      sequenceNumber: a.sequenceNumber(),
    }));
    const build = (sigs: xdr.ScVal) =>
      new TransactionBuilder(new Account(distributor.publicKey(), sequenceNumber), { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
        .addOperation(call(sigs))
        .setTimeout(120)
        .build();

    // Simulate the *approved* call either way: its footprint and resources
    // are what the unapproved one needs to reach the network at all, since its
    // own simulation fails, which is the point of it.
    const approvedTx = build(signed);
    const sim = await server.simulateTransaction(approvedTx);
    if (rpc.Api.isSimulationError(sim)) {
      if (poolErrorCode(sim.error) === 10) continue; // lost the sequence race
      throw new DemoError(`the payout could not be prepared: ${sim.error}`, 502);
    }

    let tx: Transaction;
    if (approved) {
      tx = rpc.assembleTransaction(approvedTx, sim).build();
    } else {
      const unapproved = build(xdr.ScVal.scvVec([]));
      tx = rpc.assembleTransaction(unapproved, sim).build();
    }
    tx.sign(distributor);

    onStage("submit");
    const result = await sendAndWait(tx, undefined, () => onStage("confirm"));
    if (!result.ok && poolErrorCode(result.detail) === 10 && approved) continue;
    // Another visitor's payout used the distributor's sequence number first:
    // a race on our side, not the pool's answer, so build it again.
    if (!result.ok && result.detail === "txBadSeq") continue;
    return {
      hash: result.hash,
      ok: result.ok,
      category: PAYOUT_CATEGORY,
      amount: (PAYOUT * STROOPS).toString(),
      attestationHash: approved ? hash(message).toString("hex") : undefined,
      error: result.ok ? undefined : { code: poolErrorCode(result.detail), detail: result.detail },
    };
  }
  throw new DemoError("the pool is busy, try again in a moment", 503);
}

async function requireContribution(txHash: string) {
  const tx = await rpcServer().getTransaction(txHash);
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw new DemoError("that donation is not on the ledger yet");
  }
  const contribution = contributionFromEvents(tx.events?.contractEventsXdr?.flat() ?? []);
  if (!contribution) throw new DemoError("that transaction is not a donation to this pool");
  if (contribution.amount > GRANT * STROOPS) throw new DemoError("not a demo donation");
}

async function markerExists(marker: Buffer): Promise<boolean> {
  const memo = marker.toString("base64");
  const page = await horizon()
    .transactions()
    .forAccount(DISTRIBUTOR)
    .order("desc")
    .limit(200)
    .call();
  return page.records.some((t) => t.memo_type === "hash" && t.memo === memo);
}

/** A no-op classic transaction that exists only to carry the memo. */
async function sendMarker(distributor: Keypair, marker: Buffer) {
  for (let attempt = 0; ; attempt++) {
    const account = await horizon().loadAccount(distributor.publicKey());
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
      .addOperation(Operation.bumpSequence({ bumpTo: "0" }))
      .addMemo(Memo.hash(marker.toString("hex")))
      .setTimeout(60)
      .build();
    tx.sign(distributor);
    try {
      await horizon().submitTransaction(tx);
      return;
    } catch (err) {
      // Lost a sequence race with another visitor's payout: reload and resend.
      if (horizonCode(err) !== "tx_bad_seq" || attempt >= 3) throw err;
    }
  }
}

async function readSequence(server: rpc.Server): Promise<bigint> {
  const account = await server.getAccount(TREASURY);
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(new Contract(POOL).call("distribution_seq"))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) {
    throw new DemoError("could not read the pool's sequence", 502);
  }
  return sim.result.retval.u64().toBigInt();
}

// --- submission --------------------------------------------------------------

const NOT_CONFIRMED = "the network did not confirm it in time";

/**
 * True once the channel account has used this transaction's sequence number
 * for another transaction: two visitors drew the same channel, and this one
 * was dropped. Seen in seconds, rather than after a full wait.
 */
async function droppedFromChannel(tx: Transaction): Promise<boolean> {
  const account = await rpcServer().getAccount(tx.source).catch(() => null);
  return account !== null && BigInt(account.sequenceNumber()) >= BigInt(tx.sequence);
}

async function sendAndWait(
  tx: Transaction | FeeBumpTransaction,
  dropped?: () => Promise<boolean>,
  onAccepted?: () => void,
): Promise<{ hash: string; ok: boolean; detail: string }> {
  const server = rpcServer();
  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    return { hash: sent.hash, ok: false, detail: describeResult(sent.errorResult) };
  }
  if (sent.status === "TRY_AGAIN_LATER") return { hash: sent.hash, ok: false, detail: "TRY_AGAIN_LATER" };
  onAccepted?.();
  let final = await server.getTransaction(sent.hash);
  for (let i = 0; i < 30 && final.status === rpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    final = await server.getTransaction(sent.hash);
    if (final.status === rpc.Api.GetTransactionStatus.NOT_FOUND && i >= 2 && (await dropped?.())) {
      return { hash: sent.hash, ok: false, detail: "txBadSeq" };
    }
  }
  if (final.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    return { hash: sent.hash, ok: true, detail: "" };
  }
  if (final.status === rpc.Api.GetTransactionStatus.FAILED) {
    return { hash: sent.hash, ok: false, detail: await failureDetail(sent.hash, final) };
  }
  return { hash: sent.hash, ok: false, detail: NOT_CONFIRMED };
}

function describeResult(result?: xdr.TransactionResult): string {
  if (!result) return "rejected";
  return result.result().switch().name;
}

/**
 * Why a submitted transaction failed. A contract error from the pool is
 * surfaced as `Error(Contract, #N)`, read from the diagnostic events RPC keeps
 * for a failed call.
 */
async function failureDetail(
  txHash: string,
  final: rpc.Api.GetFailedTransactionResponse,
): Promise<string> {
  const diagnostics = final.diagnosticEventsXdr ?? [];
  for (const d of diagnostics) {
    const data = d.event().body().v0().data();
    if (data.switch() === xdr.ScValType.scvError()) {
      const e = data.error();
      if (e.switch() === xdr.ScErrorType.sceContract()) {
        return `Error(Contract, #${e.contractCode()})`;
      }
    }
    for (const topic of d.event().body().v0().topics()) {
      if (topic.switch() === xdr.ScValType.scvError()) {
        const e = topic.error();
        if (e.switch() === xdr.ScErrorType.sceContract()) {
          return `Error(Contract, #${e.contractCode()})`;
        }
      }
    }
  }
  return `${final.resultXdr.result().switch().name} (${txHash})`;
}
