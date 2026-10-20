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

/** A spinner and one line, announced to screen readers as it changes. */
export function Status({ children }: { children: React.ReactNode }) {
  return (
    <p className="status" role="status">
      <Spinner />
      <span>{children}</span>
    </p>
  );
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

/** Middle-truncated hash, 8 characters … 6, with the full value for assistive tech and hover. */
export function Hash({ value }: { value: string }) {
  const short = value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
  return (
    <code className="hash" title={value}>
      {short}
    </code>
  );
}
