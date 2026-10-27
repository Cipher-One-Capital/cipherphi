"use client";

import { useEffect, useState } from "react";
import { formatAmount } from "@/lib/stellar";

/**
 * The shared pieces of the component sheet: spinner, status line, error box,
 * note panel and the small icons the buttons and outcome cards carry.
 */

export function Spinner({ size = 16, muted }: { size?: number; muted?: boolean }) {
  return (
    <svg className="spinner" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" fill="none" stroke="rgba(14, 14, 18, 0.14)" strokeWidth="3" />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        fill="none"
        stroke={muted ? "var(--cp-ink-2)" : "var(--cp-ink)"}
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

const STRIP = [" ", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * An amount that rolls to its value digit by digit, like a banking app: it
 * shows `from` first, then each digit turns over to the new one. Digits are
 * aligned from the right, so a figure that grows gains a column on the left.
 * Each column is as wide as the digit it shows, and the rolling strip is
 * centred in it and clipped, so the figure reads like ordinary text.
 */
export function Rolling({ value, from = 0n, delay = 0 }: { value: bigint; from?: bigint; delay?: number }) {
  const [shown, setShown] = useState(from);
  useEffect(() => {
    const t = setTimeout(() => setShown(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  const target = formatAmount(value);
  const now = formatAmount(shown);
  const width = Math.max(target.length, now.length);
  const chars = [...now.padStart(width, " ")];
  const digit = (c: string) => c === " " || (c >= "0" && c <= "9");
  return (
    <span className="roll">
      <span className="sr-only">{target}</span>
      <span aria-hidden="true">
        {chars.map((c, i) =>
          digit(c) ? (
            <span key={width - i} className={`roll-col${c === " " ? " blank" : ""}`}>
              {/* Sizes the column to the digit it shows, so a narrow 1 leaves no gap. */}
              <span className="roll-size">{c === " " ? "" : c}</span>
              <span className="roll-strip" style={{ "--d": STRIP.indexOf(c) } as React.CSSProperties}>
                {STRIP.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={width - i}>{c}</span>
          ),
        )}
      </span>
    </span>
  );
}

export type Event = { key: string; text: string; done: boolean };

/**
 * What the page is waiting on, one line per real step as it starts, ticked
 * once done. No spinner: the button that started it carries one, and the
 * current step's dot pulses.
 */
export function Events({ items }: { items: Event[] }) {
  return (
    <ol className="events" role="status">
      {items.map((e) => (
        <li key={e.key} className={e.done ? "done" : "active"}>
          {e.done ? <CheckIcon /> : <span className="event-dot" aria-hidden="true" />}
          <span>
            {e.text}
            {e.done ? "" : "…"}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The steps of a sequence up to the current one, those before it done. */
export function upTo<K extends string>(steps: readonly { key: K; text: string }[], current: K): Event[] {
  const at = steps.findIndex((s) => s.key === current);
  return steps.slice(0, at + 1).map((s, i) => ({ ...s, done: i < at }));
}

/** Label for a busy button: the spinner sits before it and the button keeps its width. */
export function Busy({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Spinner size={18} muted />
      {children}
    </>
  );
}

/** Label for an action already taken. */
export function Spent({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CheckIcon />
      {children}
    </>
  );
}

export function ErrorBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="error" role="alert">
      <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
        <path d="M11 2.5L20.5 19h-19z" fill="none" stroke="var(--cp-error)" strokeWidth="1.6" strokeLinejoin="round" />
        <path d="M11 8.5v4.5" stroke="var(--cp-error)" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="11" cy="15.8" r="1.1" fill="var(--cp-error)" />
      </svg>
      <div>
        <p className="error-title">{title}</p>
        <p>{children}</p>
      </div>
    </div>
  );
}

/** The grey panel the honesty notes sit in. Never smaller than 14 px. */
export function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="note-panel">
      <InfoIcon />
      <p>{children}</p>
    </div>
  );
}

export function InfoIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className="info-icon">
      <circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--cp-ink)" strokeWidth="1.5" />
      <path d="M10 9v5" stroke="var(--cp-ink)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="10" cy="6.2" r="1" fill="var(--cp-ink)" />
    </svg>
  );
}

export function CheckIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M3.5 8.3l2.8 2.8 6.2-6.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Ink circle with a lime check: a finished line or step. */
export function DoneIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="var(--cp-ink)" />
      <path
        d="M7.5 12.4l3 3 6-6.4"
        fill="none"
        stroke="var(--cp-lime)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Middle-truncated hash, 8 characters … 6 by default, with the full value on hover. */
export function Hash({ value, tail = 6 }: { value: string; tail?: number }) {
  const short = value.length > 8 + tail + 2 ? `${value.slice(0, 8)}…${value.slice(-tail)}` : value;
  return (
    <code className="hash" title={value}>
      {short}
    </code>
  );
}
