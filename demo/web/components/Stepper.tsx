export const STEPS = ["Give", "Split", "Release", "Check"] as const;

type State = "done" | "current" | "todo";

/**
 * The four steps. Done steps link back, the current one carries
 * `aria-current`, and steps not reached yet are plain text. Each state differs
 * by its icon and bar as well as colour. Phones show only the bars and icons,
 * then one line naming the current step.
 */
export function Stepper({
  step,
  furthest,
  onGo,
}: {
  step: number;
  furthest: number;
  onGo: (step: number) => void;
}) {
  const state = (i: number): State => (i === step ? "current" : i <= furthest ? "done" : "todo");
  return (
    <nav className="stepper" aria-label="Demo steps">
      <ol>
        {STEPS.map((name, i) => {
          const s = state(i);
          const label = `Step ${i + 1}`;
          return (
            <li key={name} className={s}>
              <span className="bar" aria-hidden="true" />
              <div className="step-wide">
                <StepIcon state={s} />
                <div className="step-text">
                  <span className="step-label">{label}</span>
                  {s === "done" && (
                    <button className="linkish" onClick={() => onGo(i)}>
                      {name}
                      <span className="sr-only">, done, go back</span>
                    </button>
                  )}
                  {s === "current" && <span aria-current="step">{name}</span>}
                  {s === "todo" && (
                    <span>
                      {name}
                      <span className="sr-only">, not reached yet</span>
                    </span>
                  )}
                </div>
              </div>
              <div className="step-narrow">
                {s === "done" ? (
                  <button
                    className="step-hit"
                    onClick={() => onGo(i)}
                    aria-label={`${label}, ${name}, done, go back`}
                  >
                    <StepIcon state={s} />
                  </button>
                ) : (
                  <span className="step-hit" aria-current={s === "current" ? "step" : undefined}>
                    <StepIcon state={s} />
                    <span className="sr-only">
                      {label}, {name}, {s === "current" ? "current step" : "not reached yet"}
                    </span>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="step-of" aria-hidden="true">
        <span>Step {step + 1} of 4 · </span>
        <strong>{STEPS[step]}</strong>
      </p>
    </nav>
  );
}

function StepIcon({ state }: { state: State }) {
  return (
    <svg className="step-icon" width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      {state === "done" && (
        <>
          <circle cx="10" cy="10" r="9.25" fill="var(--cp-ink)" />
          <path
            d="M6 10.3l2.6 2.6 5.4-5.6"
            fill="none"
            stroke="var(--cp-lime)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      )}
      {state === "current" && <circle cx="10" cy="10" r="8" fill="var(--cp-lime)" />}
      {state === "todo" && (
        <circle cx="10" cy="10" r="9" fill="none" stroke="var(--cp-muted-mark)" strokeWidth="1.5" />
      )}
    </svg>
  );
}
