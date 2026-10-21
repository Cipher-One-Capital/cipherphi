"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { rpc } from "@stellar/stellar-sdk";
import { ExplorerLink, Header } from "@/components/Header";
import { CATEGORIES, shareFor } from "@/lib/categories";
import { Hash, InfoIcon, Spinner } from "@/components/ui";
import { Tip } from "@/components/Tips";
import {
  ASSET_CONTRACT,
  PARTNER,
  POOL,
  POOL_ERRORS,
  WASM_HASH,
  contributionFromEvents,
  disbursementFromEvents,
  explorer,
  formatAmount,
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
      <Link className="back" href="/">
        <span aria-hidden="true">←</span> Back to the demo
      </Link>
      <Suspense fallback={<section className="card" />}>
        <Receipt />
      </Suspense>
      <div className="actions">
        <Link className="btn secondary" href="/">
          Back to the demo
        </Link>
      </div>
    </main>
  );
}

type Row =
  | { state: "loading" }
  | { state: "missing"; why: string }
  | { state: "ok"; ledgerTime: string; data: Record<string, unknown> };

const HASH = /^[0-9a-f]{64}$/;

/** 21 Oct 2026, 14:02:11 UTC */
function utc(seconds: number) {
  const d = new Date(seconds * 1000);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = d.toLocaleTimeString("en-GB", { hour12: false, timeZone: "UTC" });
  return `${date}, ${time} UTC`;
}

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
            why: "Transaction not found on the testnet node, which keeps about one week of history. The explorer link still resolves.",
          });
          return;
        }
        const out = read(tx);
        if (typeof out === "string") setRow({ state: "missing", why: out });
        else setRow({ state: "ok", ledgerTime: utc(Number(tx.createdAt)), data: out });
      })
      .catch(() => setRow({ state: "missing", why: "Testnet node unreachable. The explorer link still resolves." }));
  }, [hash, read]);
  if (!hash) return null;
  if (!valid) return { state: "missing", why: "Not a transaction hash." };
  return fetched?.hash === hash ? fetched.row : { state: "loading" };
}

const readDonation = (tx: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse) => {
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return "Not a donation: this transaction failed.";
  const c = contributionFromEvents(tx.events?.contractEventsXdr?.flat() ?? []);
  return c ? { ...c } : "Not a donation to the CipherPhi demo pool.";
};

const readPayout = (tx: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse) => {
  if (tx.status !== rpc.Api.GetTransactionStatus.SUCCESS) return "Not a payout: this transaction failed, so nothing moved.";
  const d = disbursementFromEvents(tx.events?.contractEventsXdr?.flat() ?? []);
  return d ? { ...d } : "Not a payout from the CipherPhi demo pool.";
};

const readRefusal = (tx: rpc.Api.GetSuccessfulTransactionResponse | rpc.Api.GetFailedTransactionResponse) => {
  if (tx.status === rpc.Api.GetTransactionStatus.SUCCESS) return "Not a refusal: this transaction succeeded.";
  const envelope = tx.envelopeXdr.v1?.().tx();
  const op = envelope?.operations()[0]?.body();
  const call = op?.switch().name === "invokeHostFunction" ? op.invokeHostFunctionOp().hostFunction().invokeContract() : null;
  if (!call || call.functionName().toString() !== "distribute") {
    return "Not a payout attempt against the demo pool.";
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
      <section className="card empty">
        <svg width="48" height="56" viewBox="0 0 48 56" aria-hidden="true">
          <path d="M8 3h24l10 10v40H8z" fill="var(--cp-panel)" stroke="var(--cp-ink)" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M32 3v10h10" fill="none" stroke="var(--cp-ink)" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M16 26h18M16 33h18M16 40h10" stroke="var(--cp-muted-mark)" strokeWidth="1.5" strokeDasharray="3 3" />
        </svg>
        <h1>No receipt found.</h1>
        <p>A receipt link carries the transaction hashes of one demo donation.</p>
      </section>
    );
  }

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h1>Receipt</h1>
          <p className="lede">
            Reads each line from Stellar testnet by transaction hash. Each link opens the same record
            on Stellar Expert, a public explorer not run by CipherPhi.
          </p>
        </div>

        <ol className="timeline">
          <Step
            title="Given"
            hash={q.get("c")}
            row={donation}
            render={(d) => (
              <p>
                <span className="num">{formatAmount(d.amount as bigint)} USDC</span> received by the
                zakat pool from a testnet address.
              </p>
            )}
          />
          <Step
            title="Split across the eight categories"
            hash={q.get("c")}
            row={donation}
            skeleton="chips"
            render={(d) => (
              <>
                <ul className="chips">
                  {(d.split as bigint[]).map((s, i) => (
                    <li key={CATEGORIES[i].name}>
                      <span>{CATEGORIES[i].name}</span>
                      <b>{formatAmount(s)}</b>
                    </li>
                  ))}
                </ul>
                <p className="meta">Recorded in the same transaction&apos;s Contribution event.</p>
              </>
            )}
          />
          {q.get("r") && (
            <Step
              title="Payout with approval: released"
              hash={q.get("r")}
              row={payout}
              render={(d) => (
                <p>
                  <span className="num">{formatAmount(d.amount as bigint)} USDC</span> from{" "}
                  {shareFor(d.category as number)} to the partner organisation
                  {d.recipient === PARTNER ? "" : ` ${d.recipient}`}. Approval fingerprint:{" "}
                  <Hash value={d.attestationHash as string} />
                </p>
              )}
            />
          )}
          {q.get("f") && (
            <Step
              title="Payout without approval: refused"
              refused
              hash={q.get("f")}
              row={refusal}
              render={() => (
                <p>
                  {POOL_ERRORS[12].plain} Appears on the explorer as a failed <code>distribute</code>{" "}
                  call.
                </p>
              )}
            />
          )}
        </ol>
      </section>

      <section className="card">
        <Tip id="verify" block>
          <h2>Verify the system</h2>
          <dl className="facts">
            <dt>Zakat pool</dt>
            <dd>
              <ExplorerLink href={explorer.contract(POOL)}>
                <Hash value={POOL} tail={8} />
              </ExplorerLink>
            </dd>
            <dt>Contract code</dt>
            <dd>
              <code className="hash" title={WASM_HASH}>
                sha256 {WASM_HASH.slice(0, 16)}…{WASM_HASH.slice(-9)}
              </code>
            </dd>
            <dt>Test token</dt>
            <dd>
              <ExplorerLink href={explorer.contract(ASSET_CONTRACT)}>USDC (testnet), Circle issuer</ExplorerLink>
            </dd>
            <dt>Partner org</dt>
            <dd>
              <ExplorerLink href={explorer.account(PARTNER)}>
                <Hash value={PARTNER} tail={5} />
              </ExplorerLink>
            </dd>
          </dl>
        </Tip>
        <p className="facts-note">
          Contract code hash: reproducible from the published source; confirms the pool runs the code
          it claims. On-chain data: addresses, amounts and hashes only; no personal data. Testnet
          demo; contracts unaudited.
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
  refused,
  skeleton,
}: {
  title: string;
  hash: string | null;
  row: Row | null;
  render: (data: Record<string, unknown>) => React.ReactNode;
  refused?: boolean;
  skeleton?: "chips";
}) {
  const state = row?.state ?? "loading";
  const link = hash && HASH.test(hash) && (
    <ExplorerLink href={explorer.tx(hash)}>
      Transaction <Hash value={hash} />
    </ExplorerLink>
  );
  return (
    <li className={`entry ${state}`}>
      <div className="rail" aria-hidden="true">
        {state === "loading" ? <Spinner size={18} /> : <span className={`dot${refused ? " refused" : ""}`} />}
        <span className="line" />
      </div>
      <div className="entry-body">
        <h2>{title}</h2>
        {state === "loading" && (
          <>
            <p role="status">Reading from the ledger…</p>
            <div className={skeleton === "chips" ? "chips-skeleton" : "line-skeleton"} aria-hidden="true">
              {(skeleton === "chips" ? [0, 1, 2, 3] : [0]).map((k) => (
                <i key={k} />
              ))}
            </div>
          </>
        )}
        {row?.state === "missing" && (
          <>
            <p className="panel small">
              <InfoIcon size={18} />
              <span>{row.why}</span>
            </p>
            {link && <p className="meta">{link}</p>}
          </>
        )}
        {row?.state === "ok" && (
          <>
            {render(row.data)}
            <p className="meta">
              <span>{row.ledgerTime}</span>
              {link}
            </p>
          </>
        )}
      </div>
    </li>
  );
}
