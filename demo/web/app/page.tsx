"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ExplorerLink, Header } from "@/components/Header";
import { Stepper } from "@/components/Stepper";
import { CATEGORIES } from "@/lib/categories";
import {
  type ReleaseResult,
  donate,
  onboard,
  readBalances,
  readSplit,
  requestRelease,
  tchfBalance,
} from "@/lib/donate";
import {
  DONATION,
  PAYOUT,
  PAYOUT_CATEGORY,
  POOL_ERRORS,
  STROOPS,
  THRESHOLD,
  AUTHORITY,
  explorer,
  formatTchf,
} from "@/lib/stellar";
import { useSession } from "@/lib/wallet/session";

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

  // Land on the furthest step this visitor has reached.
  const reached = progress.approved ? 3 : progress.contribution ? 1 : 0;
  const restored = useRef<string | null>(null);
  useEffect(() => {
    if (session.address && restored.current !== session.address && progress.contribution) {
      restored.current = session.address;
      setStep(reached);
    }
  }, [session.address, progress.contribution, reached]);

  const furthest = progress.approved || progress.refused ? 3 : progress.contribution ? 2 : 0;

  return (
    <main className="shell">
      <Header>
        {session.connected && (
          <div className="who">
            <span>{session.label}</span>
            <button className="linkish" onClick={() => session.disconnect()}>
              Sign out
            </button>
          </div>
        )}
      </Header>

      <Stepper step={step} furthest={furthest} onGo={setStep} />

      {step === 0 && (
        <Give
          contribution={progress.contribution}
          onDonated={(hash) => {
            update({ contribution: hash });
            setStep(1);
          }}
          onNext={() => setStep(1)}
        />
      )}
      {step === 1 && progress.contribution && (
        <Split contribution={progress.contribution} onNext={() => setStep(2)} />
      )}
      {step === 2 && progress.contribution && (
        <Release
          contribution={progress.contribution}
          approved={progress.approved}
          refused={progress.refused}
          onResult={(r) => update(r.ok ? { approved: r } : { refused: r })}
          onNext={() => setStep(3)}
        />
      )}
      {step === 3 && progress.contribution && <Check progress={progress} />}
    </main>
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
  const [balance, setBalance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      .then(() => tchfBalance(address))
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
        <p className="status">
          <span className="spinner" /> Loading…
        </p>
      </section>
    );
  }

  if (!session.connected) {
    return (
      <section className="card">
        <h1>Zakat rules, enforced before the money moves.</h1>
        <p className="lede">
          Give test francs, watch them split across the eight zakat categories, see a payout
          released only with a signed approval, and check every step yourself on a public
          explorer.
        </p>
        <div className="actions">
          <button className="btn" onClick={() => session.connect()}>
            {session.local ? "Start with a test wallet" : "Sign in with your email"}
          </button>
        </div>
        <p className="note">
          {session.local
            ? "Email sign-in is not switched on for this copy of the demo, so a throwaway test key is kept in this browser tab instead. Still no wallet app and no seed phrase."
            : "No wallet app and no seed phrase. Your email stays with the sign-in provider and never goes on chain."}
        </p>
      </section>
    );
  }

  const give = async () => {
    if (!session.signer) return;
    setError(null);
    setGiving(true);
    try {
      onDonated(await donate(session.signer));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGiving(false);
    }
  };

  return (
    <section className="card">
      <h2>Give</h2>
      {phase === "wallet" && !error && <Status>Creating your wallet. There is nothing to write down.</Status>}
      {phase === "account" && !error && (
        <Status>
          Opening your test account and adding 100 test francs. The demo pays every network fee, so
          you never handle crypto.
        </Status>
      )}
      {(phase === "ready" || phase === "giving") && balance !== null && (
        <>
          <p className="lede">Your test balance</p>
          <div className="figure">
            {formatTchf(balance)}
            <small>tCHF (testnet)</small>
          </div>
          {contribution ? (
            <>
              <p className="note">
                You have already given in this demo.{" "}
                <ExplorerLink href={explorer.tx(contribution)}>See your donation</ExplorerLink>
              </p>
              <div className="actions">
                <button className="btn" onClick={onNext}>
                  See how it was split
                </button>
              </div>
            </>
          ) : (
            <div className="actions">
              <button className="btn" onClick={give} disabled={phase === "giving"}>
                {phase === "giving" ? "Giving…" : `Give ${DONATION} tCHF as zakat`}
              </button>
            </div>
          )}
          {phase === "giving" && <Status>Sending to the zakat pool on Stellar testnet.</Status>}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// --- 2. See it split ---------------------------------------------------------

function Split({ contribution, onNext }: { contribution: string; onNext: () => void }) {
  const [mine, setMine] = useState<bigint[] | null>(null);
  const [pool, setPool] = useState<bigint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let live = true;
    Promise.all([readSplit(contribution), readBalances()])
      .then(([split, balances]) => {
        if (!live) return;
        if (!split) throw new Error("The donation's split is not readable yet. Try again in a moment.");
        setMine(split.split);
        setPool(balances);
        requestAnimationFrame(() => setShown(true));
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [contribution]);

  const total = mine?.reduce((a, b) => a + b, 0n) ?? 0n;
  const max = mine ? mine.reduce((a, b) => (b > a ? b : a), 0n) : 1n;

  return (
    <section className="card">
      <h2>See it split</h2>
      <p className="lede">
        The pool split your {DONATION} tCHF across the eight categories the moment it arrived. The
        rule is fixed in the contract, and the contract refuses any split that does not add up to
        exactly what was given.
      </p>
      {!mine && !error && <Status>Reading your donation from the ledger.</Status>}
      {mine && pool && (
        <table className="split">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Your gift</th>
              <th className="num hide-sm">Pool now holds</th>
            </tr>
          </thead>
          <tbody>
            {CATEGORIES.map((c, i) => (
              <tr key={c.name}>
                <td>
                  <span className="cat">
                    {c.name} <em>{c.arabic} · {c.share / 100}%</em>
                  </span>
                  <div className="bar" aria-hidden="true">
                    <i style={{ width: shown ? `${Number((mine[i] * 100n) / (max || 1n))}%` : 0 }} />
                  </div>
                </td>
                <td className="num">{formatTchf(mine[i])}</td>
                <td className="num hide-sm">{formatTchf(pool[i])}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">{formatTchf(total)}</td>
              <td className="num hide-sm">{formatTchf(pool.reduce((a, b) => a + b, 0n))}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {error && <p className="error">{error}</p>}
      <p className="note">
        Your gift is read from the event the contract recorded for your transaction; the pool column
        is read live from contract state. The percentages are a demo placeholder, not the
        Foundation&apos;s allocation, and have not been set by its Shariah authority.{" "}
        <ExplorerLink href={explorer.tx(contribution)}>Your donation on Stellar Expert</ExplorerLink>
      </p>
      <div className="actions">
        <button className="btn" onClick={onNext} disabled={!mine}>
          Next: release a payout
        </button>
      </div>
    </section>
  );
}

// --- 3. See it released ------------------------------------------------------

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
  const category = CATEGORIES[PAYOUT_CATEGORY].name.toLowerCase();

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
      <h2>See it released</h2>
      <p className="lede">
        A vetted partner organisation is paid {formatTchf(PAYOUT * STROOPS)} tCHF from{" "}
        {category}. The pool pays only if {THRESHOLD} of the {AUTHORITY.length} eligibility signers
        have approved that exact payout: this recipient, this category, this amount, once.
      </p>

      <div className="roles">
        <div className="role">
          <b>Distributor</b>
          <span>Can send a payout. Cannot approve one.</span>
        </div>
        <div className="role">
          <b>Eligibility signers</b>
          <span>Can approve a payout. Cannot send one.</span>
        </div>
      </div>

      <div className="actions">
        <button className="btn" onClick={() => run(true)} disabled={busy !== null || !!approved}>
          {busy === "approved" ? "Releasing…" : approved ? "Released" : "Release with approval"}
        </button>
        <button
          className="btn ghost"
          onClick={() => run(false)}
          disabled={busy !== null || !!refused}
        >
          {busy === "refused" ? "Trying…" : refused ? "Tried without approval" : "Try it without approval"}
        </button>
      </div>
      {busy && <Status>Submitting to Stellar testnet. This takes a few seconds.</Status>}

      {approved && (
        <div className="outcome">
          <span className="tag">Paid</span>
          <p>
            <strong>{formatTchf(BigInt(approved.amount))} tCHF</strong> was paid from{" "}
            {CATEGORIES[approved.category].name.toLowerCase()} to the partner organisation, approved
            by {THRESHOLD} of {AUTHORITY.length} signers.
          </p>
          {approved.attestationHash && (
            <p className="note">
              Approval fingerprint <code>{approved.attestationHash}</code>. The approval itself stays
              off chain; this hash ties the payout to it.
            </p>
          )}
          <p>
            <ExplorerLink href={explorer.tx(approved.hash)}>The payout on Stellar Expert</ExplorerLink>
          </p>
        </div>
      )}

      {refused && (
        <div className="outcome refused">
          <span className="tag">Refused by the pool</span>
          <p>
            <strong>The same payout, with no approval attached.</strong>{" "}
            {POOL_ERRORS[refused.error?.code ?? 12]?.plain ?? refused.error?.detail}
          </p>
          <p className="note">
            The contract returned <code>{POOL_ERRORS[refused.error?.code ?? 12]?.name}</code> and
            nothing moved. It was sent to the network on purpose, so the refusal is a public failed
            transaction rather than our word for it.
          </p>
          <p>
            <ExplorerLink href={explorer.tx(refused.hash)}>The refused attempt on Stellar Expert</ExplorerLink>
          </p>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <p className="note">
        In this demo one server holds the distributor key and two of the signer keys, so the whole
        flow runs in a minute. The contract enforces the separation either way; in the pilot they
        are different organisations.
      </p>
      <div className="actions">
        <button className="btn" onClick={onNext} disabled={!approved && !refused}>
          Next: check it yourself
        </button>
      </div>
    </section>
  );
}

// --- 4. Check it -------------------------------------------------------------

function Check({ progress }: { progress: Progress }) {
  const params = new URLSearchParams({ c: progress.contribution! });
  if (progress.approved) params.set("r", progress.approved.hash);
  if (progress.refused) params.set("f", progress.refused.hash);
  const href = `/receipt?${params}`;
  const [copied, setCopied] = useState(false);

  return (
    <section className="card">
      <h2>Check it</h2>
      <p className="lede">
        Your receipt lists every step with a link to its transaction on Stellar Expert, a public
        explorer we do not run. You do not have to trust this page, or us.
      </p>
      <div className="actions">
        <Link className="btn" href={href}>
          Open your receipt
        </Link>
        <button
          className="btn ghost"
          onClick={() => {
            navigator.clipboard
              ?.writeText(new URL(href, location.href).toString())
              .then(() => setCopied(true))
              .catch(() => {});
          }}
        >
          {copied ? "Link copied" : "Copy receipt link"}
        </button>
      </div>
      <p className="note">
        The receipt is a public page: anyone with the link can open it, without signing in. It
        holds transaction hashes only.
      </p>
    </section>
  );
}

function Status({ children }: { children: React.ReactNode }) {
  return (
    <p className="status" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
