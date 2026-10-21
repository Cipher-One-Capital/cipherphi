"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExplorerLink, Header } from "@/components/Header";
import { Tip } from "@/components/Tips";
import { Stepper } from "@/components/Stepper";
import { CATEGORIES, shareFor } from "@/lib/categories";
import {
  type DonateStage,
  type ReleaseResult,
  donate,
  onboard,
  readBalances,
  readSplit,
  requestRelease,
  tokenBalance,
} from "@/lib/donate";
import {
  DONATION,
  SUGGESTED,
  parseAmount,
  GRANT,
  PAYOUT,
  PAYOUT_CATEGORY,
  POOL_ERRORS,
  STROOPS,
  THRESHOLD,
  AUTHORITY,
  explorer,
  formatAmount,
} from "@/lib/stellar";
import { useSession } from "@/lib/wallet/session";
import { Busy, CheckIcon, DoneIcon, ErrorBox, Hash, Note, Spent, Spinner, Status } from "@/components/ui";

type Progress = {
  contribution?: string;
  approved?: ReleaseResult;
  refused?: ReleaseResult;
};

/** Per-visitor progress, so a reload mid-demo picks up where it left off. */
function load(key: string | null): Progress {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}");
  } catch {
    return {};
  }
}

function useProgress(address: string | null) {
  const key = address ? `cipherphi-demo:${address}` : null;
  const [stored, setStored] = useState<{ key: string | null; progress: Progress }>({
    key: null,
    progress: {},
  });
  const progress = stored.key === key ? stored.progress : load(key);
  const update = useCallback(
    (patch: Partial<Progress>) =>
      setStored((prev) => {
        const next = { ...(prev.key === key ? prev.progress : load(key)), ...patch };
        try {
          if (key) localStorage.setItem(key, JSON.stringify(next));
        } catch {}
        return { key, progress: next };
      }),
    [key],
  );
  return [progress, update] as const;
}

export default function Demo() {
  const session = useSession();
  const [progress, update] = useProgress(session.address);
  const [step, setStep] = useState(0);
  // The furthest step this visitor has opened in this tab: only those show as done.
  const [seen, setSeen] = useState(0);
  const go = useCallback((i: number) => {
    setStep(i);
    setSeen((s) => Math.max(s, i));
  }, []);

  // Land on the furthest step this visitor has reached.
  const reached = progress.approved ? 3 : progress.contribution ? 1 : 0;
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (session.address && restored.current !== session.address && progress.contribution) {
      restored.current = session.address;
      go(reached);
    }
  }, [session.address, progress.contribution, reached, go]);

  const furthest = progress.approved || progress.refused ? 3 : progress.contribution ? 2 : 0;

  // Signing out, or starting over, always lands on the first page.
  const restart = async () => {
    await session.disconnect();
    restored.current = null;
    setStep(0);
    setSeen(0);
  };
  // Again: the same test wallet while it still holds test USDC, so the
  // treasury funds no one twice; a new one only when it is empty.
  const again = async () => {
    const left = session.address ? await tokenBalance(session.address) : 0n;
    if (left > 0n) {
      update({ contribution: undefined, approved: undefined, refused: undefined });
      setStep(0);
      setSeen(0);
      return;
    }
    await restart();
    await session.connect();
  };
  const shown = session.connected ? step : 0;

  return (
    <main className="shell">
      <Header>
        {session.connected && (
          <div className="who">
            <SignOut onConfirm={restart} />
          </div>
        )}
      </Header>

      {/* The first page is the landing card alone; the steps start after it. */}
      {session.connected && <Stepper step={shown} furthest={Math.min(furthest, seen)} onGo={go} />}

      {shown === 0 && (
        <Give
          key={session.address ?? "signed-out"}
          contribution={progress.contribution}
          onDonated={(hash) => {
            update({ contribution: hash });
            go(1);
          }}
          onNext={() => go(1)}
        />
      )}
      {shown === 1 && progress.contribution && (
        <Split contribution={progress.contribution} onNext={() => go(2)} />
      )}
      {shown === 2 && progress.contribution && (
        <Release
          contribution={progress.contribution}
          approved={progress.approved}
          refused={progress.refused}
          onResult={(r) => update(r.ok ? { approved: r } : { refused: r })}
          onNext={() => go(3)}
        />
      )}
      {shown === 3 && progress.contribution && (
        <Check progress={progress} local={!!session.local} onAgain={again} onRestart={restart} />
      )}
    </main>
  );
}

/** Signing out ends this run of the demo, so it asks first. */
function SignOut({ onConfirm }: { onConfirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className="linkish" onClick={() => ref.current?.showModal()}>
        Sign out
      </button>
      <dialog ref={ref} className="disclaimer" aria-labelledby="sign-out-title">
        <h2 id="sign-out-title">Sign out?</h2>
        <p>All your progress in this demo will be lost, and you will start again from the first page.</p>
        <p className="disclaimer-foot">
          Your donation stays on the ledger. To find it again later, copy your receipt link first.
        </p>
        <form method="dialog" className="dialog-actions">
          <button className="btn" onClick={onConfirm}>
            Sign out
          </button>
          <button className="linkish" autoFocus>
            Stay signed in
          </button>
        </form>
      </dialog>
    </>
  );
}

// --- 1. Give -----------------------------------------------------------------

function Give({
  contribution,
  onDonated,
  onNext,
}: {
  contribution?: string;
  onDonated: (hash: string) => void;
  onNext: () => void;
}) {
  const session = useSession();
  const [giving, setGiving] = useState(false);
  const [stage, setStage] = useState<DonateStage | null>(null);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amountText, setAmountText] = useState(String(DONATION));
  const walletRequested = useRef(false);
  const started = useRef<string | null>(null);

  // Signed in: make the wallet, then open and fund the account, without asking.
  useEffect(() => {
    if (!session.connected) return;
    if (!session.address) {
      if (walletRequested.current) return;
      walletRequested.current = true;
      session.createWallet().catch((e) => setError(String(e?.message ?? e)));
      return;
    }
    if (!session.signer || started.current === session.address) return;
    started.current = session.address;
    const address = session.address;
    onboard(session.signer)
      .then(() => tokenBalance(address))
      .then(setBalance)
      .catch((e) => setError(e.message));
  }, [session]);

  const phase = !session.address
    ? "wallet"
    : balance === null
      ? "account"
      : giving
        ? "giving"
        : "ready";

  if (!session.ready) {
    return (
      <section className="card">
        <Status>Loading…</Status>
      </section>
    );
  }

  if (!session.connected) {
    return (
      <section className="card landing">
        <div className="landing-head">
          <div className="card-head">
            <Image className="symbol symbol-sm" src="/cipherphi-symbol.svg" alt="" width={88} height={70} />
            <h1 className="display">Enforces zakat rules before funds move.</h1>
            <ul className="lede points">
              <li>Splits each donation across the eight zakat categories.</li>
              <li>
                Releases a payout only with {THRESHOLD} of {AUTHORITY.length} signer approvals.
              </li>
              <li>Links every step to a public explorer.</li>
            </ul>
          </div>
          <Image className="symbol symbol-lg" src="/cipherphi-symbol.svg" alt="" width={148} height={118} priority />
        </div>
        <div className="stack">
          <div className="actions">
            <button className="btn" onClick={() => session.connect()}>
              {session.local ? "Start" : "Sign in with your email"}
            </button>
          </div>
          <p className="note">
            {session.local
              ? "Email sign-in is disabled in this deployment. Uses a throwaway test key held in this browser tab. Requires no wallet app or seed phrase."
              : "Requires no wallet app or seed phrase. The email address stays with the sign-in provider and is never written on chain."}
          </p>
        </div>
      </section>
    );
  }

  const amount = parseAmount(amountText);
  const amountOk = amount !== null && balance !== null && amount <= balance;

  const give = async () => {
    if (!session.signer || !amountOk) return;
    setError(null);
    setGiving(true);
    try {
      onDonated(await donate(session.signer, amount, "", setStage));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGiving(false);
      setStage(null);
    }
  };

  if (phase === "wallet" || phase === "account") {
    return (
      <section className="card">
        <h1 className="sr-only">Give</h1>
        <Tip id="setup" block>
          <ol className="setup" aria-live="polite">
            <li className={phase === "wallet" ? "active" : "done"}>
              {phase === "wallet" ? <Spinner size={24} /> : <DoneIcon />}
              <p>Creates a wallet for this session. Requires nothing to write down.</p>
            </li>
            {phase === "account" && (
              <li className="active">
                <Spinner size={24} />
                <p>
                  Opening a test account and funding it with {formatAmount(GRANT * STROOPS)} testnet USDC. The demo
                  pays all network fees; the donor handles no crypto.
                </p>
              </li>
            )}
          </ol>
        </Tip>
        {error && <ErrorBox title="Account not opened.">{error}</ErrorBox>}
      </section>
    );
  }

  return (
    <section className="card">
      <h1 className="sr-only">Give</h1>
      <Tip id="balance" block>
        <div className="balance">
          <span className="label">Test balance</span>
          <p className="figure">
            <span>{formatAmount(balance ?? 0n)}</span>
            <small>USDC (testnet)</small>
          </p>
        </div>
      </Tip>
      {contribution && (
        <p className="panel">
          A donation from this account is already recorded.{" "}
          <ExplorerLink href={explorer.tx(contribution)}>See your donation</ExplorerLink>
        </p>
      )}
      {!contribution && balance !== null && (
        <Tip id="amount" block>
          <fieldset className="amount" disabled={phase === "giving"}>
            <legend className="label">Your zakat</legend>
            <div className="picks">
              {SUGGESTED.filter((s) => parseAmount(s)! <= balance).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={amountText === s ? "pick on" : "pick"}
                  aria-pressed={amountText === s}
                  onClick={() => setAmountText(s)}
                >
                  {formatAmount(parseAmount(s)!)} USDC
                </button>
              ))}
            </div>
            <label className="amount-field">
              <span>Or type an amount</span>
              <span className="amount-input">
                <input
                  inputMode="decimal"
                  autoComplete="off"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  aria-invalid={!amountOk}
                  aria-describedby="amount-hint"
                />
                <span aria-hidden="true">USDC</span>
              </span>
            </label>
            <p id="amount-hint" className={amountOk ? "note" : "note invalid"}>
              {amountOk
                ? `Any amount up to your balance of ${formatAmount(balance)} USDC.`
                : `Enter an amount above 0.00, with at most two decimals, up to your balance of ${formatAmount(balance)} USDC.`}
            </p>
          </fieldset>
        </Tip>
      )}
      {error && <ErrorBox title="Transaction not sent.">{error}</ErrorBox>}
      <div className="stack">
        <div className="actions">
          {contribution ? (
            <button className="btn" onClick={onNext}>
              See how it was split
            </button>
          ) : (
            <Tip id="give">
              <button className="btn" onClick={give} disabled={phase === "giving" || !amountOk}>
                {phase === "giving" ? (
                  <Busy>Giving…</Busy>
                ) : amountOk ? (
                  `Give ${formatAmount(amount)} USDC as zakat`
                ) : (
                  "Give as zakat"
                )}
              </button>
            </Tip>
          )}
        </div>
        {phase === "giving" && stage && <GiveEvents stage={stage} />}
      </div>
    </section>
  );
}

const GIVE_EVENTS: { stage: DonateStage; text: string }[] = [
  { stage: "check", text: "Checking the donation against the zakat pool contract" },
  { stage: "sign", text: "Signing it with your wallet" },
  { stage: "submit", text: "Submitting it to Stellar testnet, with the fee paid by the demo" },
  { stage: "confirm", text: "Waiting for the next ledger to confirm it, about 5 seconds" },
];

/** What the donation is doing, one line per step as it starts. The button carries the spinner. */
function GiveEvents({ stage }: { stage: DonateStage }) {
  const current = GIVE_EVENTS.findIndex((e) => e.stage === stage);
  return (
    <ol className="events" aria-live="polite">
      {GIVE_EVENTS.slice(0, current + 1).map((e, i) => (
        <li key={e.stage} className={i < current ? "done" : "active"}>
          {i < current ? <CheckIcon /> : <span className="event-dot" aria-hidden="true" />}
          <span>
            {e.text}
            {i < current ? "" : "…"}
          </span>
        </li>
      ))}
    </ol>
  );
}

// --- 2. Split ----------------------------------------------------------------

function Split({ contribution, onNext }: { contribution: string; onNext: () => void }) {
  const [mine, setMine] = useState<bigint[] | null>(null);
  const [pool, setPool] = useState<bigint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([readSplit(contribution), readBalances()])
      .then(([split, balances]) => {
        if (!live) return;
        if (!split) throw new Error("The donation's split is not readable yet. Try again in a moment.");
        setMine(split.split);
        setPool(balances);
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [contribution]);

  const total = mine?.reduce((a, b) => a + b, 0n) ?? 0n;
  const grow = useGrowIn();
  const top = Math.max(...CATEGORIES.map((c) => c.share));

  return (
    <section className="card">
      <div className="card-head">
        <h1>Split</h1>
        <p className="lede">
          Splits {mine ? `the ${formatAmount(total)} USDC donation` : "the donation"} across the eight
          categories on arrival. Donors do not choose the split. In the pilot, the Foundation&apos;s Shariah
          authority sets it; in this demo, it is fixed in the contract. The contract rejects any
          split that does not sum to the amount given.
        </p>
      </div>

      {mine && pool ? (
        <Tip id="split" block>
          <div className="split" role="table" aria-label="Your zakat by category" ref={grow}>
            <div className="split-row split-head" role="row">
              <span role="columnheader">Category</span>
              <span role="columnheader" className="wide">
                Share
              </span>
              <span role="columnheader" className="num">
                Your zakat
              </span>
              <span role="columnheader" className="num wide">
                Pool now holds
              </span>
            </div>
            {CATEGORIES.map((c, i) => {
              const bar = {
                "--w": `${((c.share / top) * 100).toFixed(1)}%`,
                "--i": i,
              } as React.CSSProperties;
              return (
                <div className="split-row" role="row" key={c.name} style={bar}>
                  <div role="rowheader" className="cat">
                    <span className="cat-name">{c.name}</span>
                    <span className="cat-sub">
                      {c.arabic} · {c.share / 100}%
                    </span>
                    <i className="share-bar narrow" aria-hidden="true" />
                  </div>
                  <div role="cell" className="wide" aria-label={`${c.share / 100}%`}>
                    <i className="share-bar" />
                  </div>
                  <span role="cell" className="num gift">
                    {formatAmount(mine[i])}
                  </span>
                  <span role="cell" className="num pool wide">
                    {formatAmount(pool[i])}
                  </span>
                </div>
              );
            })}
            <div className="split-row split-total" role="row">
              <span role="rowheader">Total</span>
              <span role="cell" className="cat-sub wide">
                100%
              </span>
              <span role="cell" className="num">
                {formatAmount(total)}
              </span>
              <span role="cell" className="num wide">
                {formatAmount(pool.reduce((a, b) => a + b, 0n))}
              </span>
            </div>
          </div>
        </Tip>
      ) : error ? (
        <ErrorBox title="Donation not readable.">{error}</ErrorBox>
      ) : (
        <div className="stack">
          <Status>Reading the donation from the ledger.</Status>
          <div className="skeleton" aria-hidden="true">
            {CATEGORIES.map((c) => (
              <div className="split-row" key={c.name}>
                <div className="cat">
                  <i style={{ width: "60%", height: 12 }} />
                  <i style={{ width: "40%", height: 10 }} />
                </div>
                <i className="wide" style={{ width: `${(c.share / top) * 80}%`, height: 10 }} />
                <i className="num" style={{ width: 48, height: 12 }} />
                <i className="wide" />
              </div>
            ))}
          </div>
        </div>
      )}

      <Tip id="split-note" block>
        <Note>
          Your zakat: read from the Contribution event recorded for this transaction. Pool now holds:
          read live from contract state. Percentages: demo placeholders, not the Foundation&apos;s
          allocation, not set by its Shariah authority.{" "}
          <ExplorerLink href={explorer.tx(contribution)}>Your donation on Stellar Expert</ExplorerLink>
        </Note>
      </Tip>
      <div className="actions">
        <button className="btn" onClick={onNext} disabled={!mine}>
          Next: Release
        </button>
      </div>
    </section>
  );
}

// --- 3. Release --------------------------------------------------------------

function Release({
  contribution,
  approved,
  refused,
  onResult,
  onNext,
}: {
  contribution: string;
  approved?: ReleaseResult;
  refused?: ReleaseResult;
  onResult: (r: ReleaseResult) => void;
  onNext: () => void;
}) {
  const [busy, setBusy] = useState<"approved" | "refused" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const category = shareFor(PAYOUT_CATEGORY);

  const run = async (withApproval: boolean) => {
    setError(null);
    setBusy(withApproval ? "approved" : "refused");
    try {
      onResult(await requestRelease(contribution, withApproval));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <div className="card-head">
        <h1>Release</h1>
        <p className="lede">
          Pays {formatAmount(PAYOUT * STROOPS)} USDC from {category} to a vetted partner organisation.
          Requires approval from {THRESHOLD} of {AUTHORITY.length} eligibility signers for that exact
          payout: recipient, category, amount, single use.
        </p>
      </div>

      <Tip id="roles" block>
        <RoleDiagram />
      </Tip>

      <div className="stack">
        <div className="actions">
          {approved ? (
            <button className="btn spent" disabled>
              <Spent>Released</Spent>
            </button>
          ) : (
            <Tip id="release">
              <button className="btn" onClick={() => run(true)} disabled={busy !== null}>
                {busy === "approved" ? <Busy>Releasing…</Busy> : "Release with approval"}
              </button>
            </Tip>
          )}
          {refused ? (
            <button className="btn spent" disabled>
              <Spent>Tried without approval</Spent>
            </button>
          ) : (
            <Tip id="refuse">
              <button className="btn secondary" onClick={() => run(false)} disabled={busy !== null}>
                {busy === "refused" ? <Busy>Trying…</Busy> : "Try it without approval"}
              </button>
            </Tip>
          )}
        </div>
        {busy && <Status>Submitting to Stellar testnet. Takes up to 30 seconds.</Status>}
      </div>

      {error && <ErrorBox title="Request not completed.">{error}</ErrorBox>}

      {(approved || refused) && (
        <div className={`outcomes${approved && refused ? " both" : ""}`} role="status">
          {approved && (
            <Tip id="paid" block>
              <article className="outcome paid">
                <span className="tag">
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="7" fill="var(--cp-ink)" />
                    <path
                      d="M4.8 8.2l2.1 2.1 4.3-4.5"
                      fill="none"
                      stroke="var(--cp-lime)"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  Paid
                </span>
                <p>
                  <strong>{formatAmount(BigInt(approved.amount))} USDC</strong> paid from{" "}
                  {shareFor(approved.category)} to the partner organisation. Approved by {THRESHOLD} of{" "}
                  {AUTHORITY.length} signers.
                </p>
                {approved.attestationHash && (
                  <p className="small">
                    Approval fingerprint: <Hash value={approved.attestationHash} />. Hash of the
                    off-chain approval; ties this payout to it.
                  </p>
                )}
                <ExplorerLink href={explorer.tx(approved.hash)}>The payout on Stellar Expert</ExplorerLink>
              </article>
            </Tip>
          )}
          {refused && (
            <Tip id="refused" block>
              <article className="outcome refused">
                <span className="tag">
                  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                    <circle cx="8" cy="8" r="6.3" fill="none" stroke="var(--cp-ink)" strokeWidth="1.6" />
                    <path d="M5.2 8h5.6" stroke="var(--cp-ink)" strokeWidth="1.8" strokeLinecap="round" />
                  </svg>
                  Refused by the pool
                </span>
                <p>
                  <strong>Same payout, no approval attached.</strong>{" "}
                  {POOL_ERRORS[refused.error?.code ?? 12]?.plain ?? refused.error?.detail}
                </p>
                <p className="small">
                  Contract error: <code>{POOL_ERRORS[refused.error?.code ?? 12]?.name}</code>. No funds
                  moved. Submitted to the network on purpose, so the refusal is a public failed
                  transaction, not a claim.
                </p>
                <ExplorerLink href={explorer.tx(refused.hash)}>
                  The refused attempt on Stellar Expert
                </ExplorerLink>
              </article>
            </Tip>
          )}
        </div>
      )}

      <Note>
        Demo setup: one server holds the distributor key and two signer keys, so the flow completes
        in about a minute. The contract enforces the separation regardless. In the pilot, each key
        belongs to a different organisation.
      </Note>
      <div className="actions">
        <button className="btn" onClick={onNext} disabled={!approved && !refused}>
          Next: Check
        </button>
      </div>
    </section>
  );
}

/** The two roles, joined into the one thing a payout needs: both of them. */
function RoleDiagram() {
  return (
    <div className="roles">
      <div className="role-cards">
        <div className="role">
          <div className="role-head">
            <span className="role-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M3 10h12M11 5.5L15.5 10 11 14.5"
                  fill="none"
                  stroke="var(--cp-ink)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h2>Distributor</h2>
          </div>
          <ul>
            <li>
              <CheckIcon />
              Can send a payout.
            </li>
            <li className="cannot">
              <NoIcon />
              Cannot approve one.
            </li>
          </ul>
        </div>
        <div className="role-plus" aria-hidden="true">
          +
        </div>
        <div className="role">
          <div className="role-head">
            <span className="role-icon">
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path
                  d="M4 14.5c2-1 2.5-4.5 4.5-4.5 1.8 0 1 3 2.8 3 1.4 0 2-2 3.7-2"
                  fill="none"
                  stroke="var(--cp-ink)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <path d="M3 17h14" stroke="var(--cp-ink)" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
            <h2>Eligibility signers</h2>
            <span className="quorum" role="img" aria-label={`${THRESHOLD} of ${AUTHORITY.length} signers needed`}>
              {AUTHORITY.map((a, i) =>
                i < THRESHOLD ? (
                  <svg key={a} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <circle cx="7" cy="7" r="6.5" fill="var(--cp-lime)" />
                  </svg>
                ) : (
                  <svg key={a} width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <circle
                      cx="7"
                      cy="7"
                      r="6"
                      fill="none"
                      stroke="var(--cp-muted-mark)"
                      strokeWidth="1.2"
                      strokeDasharray="2 1.6"
                    />
                  </svg>
                ),
              )}
            </span>
          </div>
          <ul>
            <li>
              <CheckIcon />
              Can approve a payout.
            </li>
            <li className="cannot">
              <NoIcon />
              Cannot send one.
            </li>
          </ul>
        </div>
      </div>
      <div className="role-join" aria-hidden="true">
        <i />
        <i />
      </div>
      <p className="role-pill">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <circle cx="5" cy="5" r="5" fill="var(--cp-lime)" />
        </svg>
        Payout requires both
      </p>
    </div>
  );
}

function NoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.8 12.2l8.4-8.4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

// --- 4. Check ----------------------------------------------------------------

function Check({
  progress,
  local,
  onAgain,
  onRestart,
}: {
  progress: Progress;
  local: boolean;
  onAgain: () => void;
  onRestart: () => void;
}) {
  const params = new URLSearchParams({ c: progress.contribution! });
  if (progress.approved) params.set("r", progress.approved.hash);
  if (progress.refused) params.set("f", progress.refused.hash);
  const href = `/receipt?${params}`;
  const [copied, setCopied] = useState(false);

  return (
    <section className="card">
      <div className="card-head">
        <h1>Check</h1>
        <p className="lede">
          Lists every step of this donation, each linked to its transaction on Stellar Expert, a
          public explorer not run by CipherPhi. Requires no trust in this page or its operators.
        </p>
      </div>
      <div className="actions">
        <Tip id="receipt">
          <Link className="btn" href={href}>
            Open your receipt
          </Link>
        </Tip>
        <button
          className="btn secondary"
          aria-live="polite"
          onClick={() => {
            navigator.clipboard
              ?.writeText(new URL(href, location.href).toString())
              .then(() => setCopied(true))
              .catch(() => {});
          }}
        >
          {copied ? (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <circle cx="9" cy="9" r="8" fill="var(--cp-lime)" />
                <path
                  d="M5.5 9.3l2.3 2.3 4.7-5"
                  fill="none"
                  stroke="var(--cp-ink)"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              Link copied
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <rect x="6" y="6" width="9" height="9" rx="2" fill="none" stroke="var(--cp-ink)" strokeWidth="1.5" />
                <path
                  d="M12 3.5H5A1.5 1.5 0 0 0 3.5 5v7"
                  fill="none"
                  stroke="var(--cp-ink)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              Copy receipt link
            </>
          )}
        </button>
      </div>
      <Note>
        Public page. Opens for anyone with the link, without sign-in. Contains transaction hashes
        only.
      </Note>
      <div className="restart">
        <h2>Demo complete</h2>
        <p className="note">
          {local
            ? "Runs the four steps again with the test USDC left in this wallet, or a new wallet once it is empty. Or signs out and returns to the first page. Keep the receipt link first: it is the only way back to this donation."
            : "Signs out and returns to the first page. Keep the receipt link first: it is the only way back to this donation from another device."}
        </p>
        <div className="actions">
          {local && (
            <button className="btn secondary" onClick={onAgain}>
              Run the demo again
            </button>
          )}
          <button className="btn secondary" onClick={onRestart}>
            Back to the start
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Marks the element `.in` the first time it scrolls into view, which starts
 * the split bars growing. Runs once per mount.
 */
function useGrowIn() {
  return useCallback((el: HTMLElement | null) => {
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          el.classList.add("in");
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
  }, []);
}
