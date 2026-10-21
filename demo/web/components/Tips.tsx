"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { TIPS, type TipId } from "@/lib/tips";

const SEEN = "cipherphi-demo:tips";
const DONE = "cipherphi-demo:tips-done";
const OFF = "off";
const DISCLAIMER = "cipherphi-demo:disclaimer";
/** Fired by the disclaimer when it closes, so the first tip can follow it. */
export const DISCLAIMER_CLOSED = "cipherphi:disclaimer-closed";

type Tips = {
  active: TipId | null;
  mount: (id: TipId) => () => void;
  dismiss: (id: TipId) => void;
  skip: () => void;
};
const TipsContext = createContext<Tips | null>(null);

function read(): { off: boolean; seen: TipId[] } {
  try {
    const raw = localStorage.getItem(SEEN);
    if (raw === OFF) return { off: true, seen: [] };
    return { off: false, seen: raw ? JSON.parse(raw) : [] };
  } catch {
    return { off: false, seen: [] };
  }
}

function write(value: string) {
  try {
    localStorage.setItem(SEEN, value);
  } catch {}
}

function disclaimerDone() {
  try {
    return localStorage.getItem(DISCLAIMER) === "1";
  } catch {
    return true;
  }
}

/**
 * First-run tips, like a game's first level: one bubble at a time, pointing
 * at the thing to use next. Of the tips whose target is on screen, the
 * earliest unseen one shows. Using the target or pressing "Got it" moves on;
 * "Skip tips" turns them off for good. They wait for the disclaimer.
 */
export function TipsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; off: boolean; seen: TipId[] }>({
    ready: false,
    off: true,
    seen: [],
  });
  const [mounted, setMounted] = useState<TipId[]>([]);

  useEffect(() => {
    const load = () => setState({ ready: disclaimerDone(), ...read() });
    load();
    window.addEventListener(DISCLAIMER_CLOSED, load);
    return () => window.removeEventListener(DISCLAIMER_CLOSED, load);
  }, []);

  const mount = useCallback((id: TipId) => {
    setMounted((m) => [...m, id]);
    return () =>
      setMounted((m) => {
        const i = m.indexOf(id);
        return i < 0 ? m : [...m.slice(0, i), ...m.slice(i + 1)];
      });
  }, []);

  const dismiss = useCallback((id: TipId) => {
    setState((s) => {
      if (s.off || s.seen.includes(id)) return s;
      const seen = [...s.seen, id];
      write(JSON.stringify(seen));
      return { ...s, seen };
    });
  }, []);

  const skip = useCallback(() => {
    write(OFF);
    setState((s) => ({ ...s, off: true }));
  }, []);

  const active = useMemo(() => {
    if (!state.ready || state.off) return null;
    const due = (t: (typeof TIPS)[number]) =>
      mounted.includes(t.id) && !state.seen.includes(t.id) && (!t.after || state.seen.includes(t.after));
    return TIPS.find(due)?.id ?? null;
  }, [state, mounted]);

  // The end of the demo: the last tip seen, or with the tips off, the receipt
  // reached. Once, a closing message hands the demo over.
  const finished =
    state.ready && (state.off ? mounted.includes("verify") : TIPS.every((t) => state.seen.includes(t.id)));
  const replay = useCallback(() => {
    write("[]");
    setState((s) => ({ ...s, off: false, seen: [] }));
  }, []);

  const value = useMemo(() => ({ active, mount, dismiss, skip }), [active, mount, dismiss, skip]);
  return (
    <TipsContext.Provider value={value}>
      {children}
      {finished && <DemoEnd onReplay={replay} />}
    </TipsContext.Provider>
  );
}

const ARCHITECTURE = "https://github.com/Cipher-One-Capital/cipherphi/blob/main/ARCHITECTURE.md";
const LANDING = "https://www.cipherphi.ch";

/** The closing message at the end of the demo, shown once per browser. */
function DemoEnd({ onReplay }: { onReplay: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let done = false;
    try {
      done = localStorage.getItem(DONE) === "1";
    } catch {}
    if (!done) ref.current?.showModal();
  }, []);
  const remember = () => {
    try {
      localStorage.setItem(DONE, "1");
    } catch {}
  };
  return (
    <dialog ref={ref} className="disclaimer" aria-labelledby="demo-end-title" onClose={remember}>
      <h2 id="demo-end-title">The demo has ended</h2>
      <p>
        What you just used is a sneak peek of how onchain philanthropy will look in CipherPhi: zakat
        split by rule, paid out only with approval, and every step on a public ledger.
      </p>
      <ul>
        <li>
          <a href={ARCHITECTURE} target="_blank" rel="noreferrer">
            Read the technical architecture ↗
          </a>
        </li>
        <li>
          <a href={LANDING} target="_blank" rel="noreferrer">
            Visit the CipherPhi website ↗
          </a>
        </li>
      </ul>
      <p className="disclaimer-foot">
        Everything ran on testnet and moved no real money. The demo stays open: run it again, or check
        each step on Stellar Expert.
      </p>
      <form method="dialog" className="dialog-actions">
        {/* Saved on the click too: the dialog's close event comes a moment
            later, after a quick reload could already have happened. */}
        <button className="btn" autoFocus onClick={remember}>
          Keep exploring
        </button>
        <button
          className="linkish"
          onClick={() => {
            try {
              localStorage.removeItem(DONE);
            } catch {}
            onReplay();
          }}
        >
          Replay the tips
        </button>
      </form>
    </dialog>
  );
}

/** Wraps the thing a tip points at. Using it counts as reading the tip. */
export function Tip({
  id,
  children,
  block,
  center,
}: {
  id: TipId;
  children: React.ReactNode;
  /** A whole section rather than a button or line. */
  block?: boolean;
  /** Centre the bubble under a full-width target. */
  center?: boolean;
}) {
  const tips = useContext(TipsContext);
  const mount = tips?.mount;
  useEffect(() => mount?.(id), [mount, id]);
  const open = tips?.active === id;
  const label = useId();
  const button = useRef<HTMLButtonElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  // "Got it" hands focus back to the thing the tip pointed at, not to the page.
  const gotIt = () => {
    tips?.dismiss(id);
    anchor.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]")?.focus();
  };

  // Keep the tip and what it points at on screen, scrolling only as far as
  // needed, and again if the page shifts or resizes while it is open.
  useEffect(() => {
    if (!open) return;
    button.current?.focus({ preventScroll: true });
    const reveal = () => {
      const a = anchor.current?.getBoundingClientRect();
      const b = bubble.current?.getBoundingClientRect();
      if (!a || !b) return;
      const h = window.innerHeight;
      const top = Math.min(a.top, b.top) - 16;
      const bottom = Math.max(a.bottom, b.bottom) + 16;
      let dy: number;
      if (bottom - top <= h) {
        // Both fit: scroll just enough to show them together.
        dy = bottom > h ? bottom - h : top < 0 ? top : 0;
      } else {
        // A tall target, like the split table: the tip itself comes first.
        dy = b.bottom + 16 > h ? b.bottom + 16 - h : b.top - 16 < 0 ? b.top - 16 : 0;
      }
      if (Math.abs(dy) < 1) return;
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollBy({ top: dy, behavior: still ? "auto" : "smooth" });
    };
    reveal();
    const watch = new ResizeObserver(reveal);
    if (anchor.current) watch.observe(anchor.current);
    // Content loading above the target moves it without resizing it.
    watch.observe(document.body);
    window.addEventListener("resize", reveal);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", reveal);
    };
  }, [open]);

  const index = TIPS.findIndex((t) => t.id === id);
  const tip = TIPS[index];

  return (
    <div
      ref={anchor}
      className={`tip-anchor${block ? " block" : ""}${center ? " center" : ""}${open ? " active" : ""}`}
      onClickCapture={(e) => {
        if (open && !(e.target as HTMLElement).closest(".tip")) tips?.dismiss(id);
      }}
    >
      {children}
      {open && (
        <div
          ref={bubble}
          className="tip"
          role="dialog"
          aria-modal="false"
          aria-labelledby={`${label}-t`}
          aria-describedby={`${label}-b`}
          onKeyDown={(e) => e.key === "Escape" && gotIt()}
        >
          <p className="tip-count">
            Tip {index + 1} of {TIPS.length}
          </p>
          <p className="tip-title" id={`${label}-t`}>
            {tip.title}
          </p>
          <p id={`${label}-b`}>{tip.body}</p>
          <div className="tip-actions">
            <button ref={button} className="btn tip-ok" onClick={gotIt}>
              Got it
            </button>
            <button className="linkish" onClick={() => tips?.skip()}>
              Skip tips
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
