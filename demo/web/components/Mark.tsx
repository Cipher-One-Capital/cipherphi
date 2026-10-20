/**
 * The CipherPhi mark: a globe with an orbit and the lime dot.
 *
 * Drawn here as a stand-in, because the source artwork was not available when
 * the demo was built. Swap this component's SVG for the real mark when it
 * arrives; nothing else references the drawing.
 */
export function Mark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" fill="none">
      <circle cx="24" cy="24" r="13" stroke="var(--ink)" strokeWidth="2.2" />
      <ellipse cx="24" cy="24" rx="5.5" ry="13" stroke="var(--ink)" strokeWidth="1.6" />
      <path d="M11 24h26" stroke="var(--ink)" strokeWidth="1.6" />
      <ellipse
        cx="24"
        cy="24"
        rx="21.5"
        ry="7.5"
        transform="rotate(-24 24 24)"
        stroke="var(--ink)"
        strokeWidth="1.6"
      />
      <circle cx="42.6" cy="15.2" r="4.2" fill="var(--lime)" stroke="var(--ink)" strokeWidth="1.4" />
    </svg>
  );
}
