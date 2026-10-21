"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { TIPS, type TipId } from "@/lib/tips";

const SEEN = "cipherphi-demo:tips";
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

  const value = useMemo(() => ({ active, mount, dismiss, skip }), [active, mount, dismiss, skip]);
  return <TipsContext.Provider value={value}>{children}</TipsContext.Provider>;
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
  // "Got it" hands focus back to the thing the tip pointed at, not to the page.
  const gotIt = () => {
    tips?.dismiss(id);
    anchor.current?.querySelector<HTMLElement>("button:not([disabled]), a[href]")?.focus();
  };

  useEffect(() => {
    if (open) button.current?.focus({ preventScroll: true });
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
