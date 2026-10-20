"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { rpc } from "@stellar/stellar-sdk";
import { ExplorerLink, Header } from "@/components/Header";
import { CATEGORIES } from "@/lib/categories";
import {
  ASSET_CONTRACT,
  PARTNER,
  POOL,
  POOL_ERRORS,
  WASM_HASH,
  contributionFromEvents,
  disbursementFromEvents,
  explorer,
  formatTchf,
  rpcServer,
} from "@/lib/stellar";

/**
 * The public receipt. Everything on it is read back from the ledger by hash,
 * in the browser, so it shows only what the network recorded: a hash that is
 * not a transaction against this pool is reported as such, not rendered.
 */
export default function ReceiptPage() {
  return (
    <main className="shell">
      <Header />
      <Suspense fallback={<section className="card">Loading…</section>}>
        <Receipt />
      </Suspense>
    </main>
  );
}

type Row =
  | { state: "loading" }
  | { state: "missing"; why: string }
  | { state: "ok"; ledgerTime: string; data: Record<string, unknown> };

const HASH = /^[0-9a-f]{64}$/;

function useTx(
  hash: string | null,
  read: (tx: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse) =>
    | Record<string, unknown>
    | string,
): Row | null {
  const [fetched, setFetched] = useState<{ hash: string; row: Row } | null>(null);
  const valid = hash !== null && HASH.test(hash);
  useEffect(() => {
    if (!hash || !HASH.test(hash)) return;
    const setRow = (row: Row) => setFetched({ hash, row });
    rpcServer()
      .getTransaction(hash)
      .then((tx) => {
        if (tx.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
          setRow({
            state: "missing",
            why: "The testnet node does not have this transaction. It keeps about a week of history; the explorer link still works.",
          });
          return;
        }
        const out = read(tx);
        if (typeof out === "string") setRow({ state: "missing", why: out });
        else setRow({ state: "ok", ledgerTime: new Date(Number(tx.createdAt) * 1000).toLocaleString(), data: out });
      })
      .catch(() => setRow({ state: "missing", why: "Could not reach the testnet node. Use the explorer link." }));
  }, [hash, read]);
  if (!hash) return null;
  if (!valid) return { state: "missing", why: "This is not a transaction hash." };
  return fetched?.hash === hash ? fetched.row : { state: "loading" };
}

const readDonation = (tx: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse) => {
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return "This transaction failed, so it is not a donation.";
  const c = contributionFromEvents(tx.events?.contractEventsXdr?.flat() ?? []);
  return c ? { ...c } : "This transaction is not a donation to the CipherPhi demo pool.";
};

const readPayout = (tx: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse) => {
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return "This transaction failed, so nothing was paid.";
  const d = disbursementFromEvents(tx.events?.contractEventsXdr?.flat() ?? []);
  return d ? { ...d } : "This transaction is not a payout from the CipherPhi demo pool.";
};

const readRefusal = (tx: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse) => {
  if (tx.status === rpc.Api.GetTransactionStatus.SUCCESS) return "This transaction succeeded, so it is not a refusal.";
  const envelope = tx.envelopeXdr.v1?.().tx();
  const op = envelope?.operations()[0]?.body();
  const call = op?.switch().name === "invokeHostFunction" ? op.invokeHostFunctionOp().hostFunction().invokeContract() : null;
  if (!call || call.functionName().toString() !== "distribute") {
    return "This transaction is not a payout attempt against the demo pool.";
  }
  return { code: 12 };
};

function Receipt() {
  const q = useSearchParams();
  const donation = useTx(q.get("c"), readDonation);
  const payout = useTx(q.get("r"), readPayout);
  const refusal = useTx(q.get("f"), readRefusal);

  if (!q.get("c")) {
    return (
      <section className="card">
        <h2>No receipt here</h2>
        <p className="lede">A receipt link carries the transaction hashes of a demo donation.</p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <h1>Receipt</h1>
        <p className="lede">
          Every line below is read from Stellar testnet by its transaction hash. Follow any link to
          see the same record on Stellar Expert, a public explorer CipherPhi does not run.
        </p>

        <ol className="timeline">
          <Step
            title="Given"
            hash={q.get("c")}
            row={donation}
            render={(d) => (
              <>
                {formatTchf(d.amount as bigint)} tCHF received by the zakat pool from a testnet
                address.
              </>
            )}
          />
          <Step
            title="Split across the eight categories"
            hash={q.get("c")}
            row={donation}
            render={(d) => (
              <>
                {(d.split as bigint[])
                  .map((s, i) => `${CATEGORIES[i].name} ${formatTchf(s)}`)
                  .join(" · ")}
                . Recorded in the same transaction&apos;s Contribution event.
              </>
            )}
          />
          {q.get("r") && (
            <Step
              title="Payout with approval: released"
              hash={q.get("r")}
              row={payout}
              render={(d) => (
                <>
                  {formatTchf(d.amount as bigint)} tCHF from{" "}
                  {CATEGORIES[d.category as number].name.toLowerCase()} to the partner organisation
                  {d.recipient === PARTNER ? "" : ` ${d.recipient}`}. Approval fingerprint{" "}
                  <code className="hash">{d.attestationHash as string}</code>
                </>
              )}
            />
          )}
          {q.get("f") && (
            <Step
              title="Payout without approval: refused"
              hollow
              hash={q.get("f")}
              row={refusal}
              render={() => (
                <>
                  {POOL_ERRORS[12].plain} On the explorer this shows as a failed transaction calling{" "}
                  <code>distribute</code>.
                </>
              )}
            />
          )}
        </ol>
      </section>

      <section className="card">
        <h2>Check the system, not just the receipt</h2>
        <dl className="facts">
          <dt>Zakat pool</dt>
          <dd>
            <ExplorerLink href={explorer.contract(POOL)}>{POOL}</ExplorerLink>
          </dd>
          <dt>Contract code</dt>
          <dd className="hash">sha256 {WASM_HASH}</dd>
          <dt>Test token</dt>
          <dd>
            <ExplorerLink href={explorer.contract(ASSET_CONTRACT)}>tCHF (testnet)</ExplorerLink>
          </dd>
          <dt>Partner org</dt>
          <dd>
            <ExplorerLink href={explorer.account(PARTNER)}>{PARTNER}</ExplorerLink>
          </dd>
        </dl>
        <p className="note">
          The contract code hash can be rebuilt from the published source, so anyone can confirm
          the pool runs the code it claims. No personal data is on chain: addresses, amounts and
          hashes only. Testnet demo, unaudited contracts.
        </p>
      </section>
    </>
  );
}

function Step({
  title,
  hash,
  row,
  render,
  hollow,
}: {
  title: string;
  hash: string | null;
  row: Row | null;
  render: (data: Record<string, unknown>) => React.ReactNode;
  hollow?: boolean;
}) {
  return (
    <li>
      <span className={`dot${hollow ? " hollow" : ""}`} aria-hidden="true" />
      <h3>{title}</h3>
      {row?.state === "loading" && <p>Reading from the ledger…</p>}
      {row?.state === "missing" && <p>{row.why}</p>}
      {row?.state === "ok" && (
        <p>
          {render(row.data)} <span style={{ whiteSpace: "nowrap" }}>{row.ledgerTime}</span>
        </p>
      )}
      {hash && HASH.test(hash) && (
        <p>
          <ExplorerLink href={explorer.tx(hash)}>Transaction {hash.slice(0, 8)}…{hash.slice(-6)}</ExplorerLink>
        </p>
      )}
    </li>
  );
}
