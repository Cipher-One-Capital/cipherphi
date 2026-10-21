import Image from "next/image";

/**
 * www.cipherphi.ch: one page for partners and funders. It explains the model,
 * says plainly what is and is not true yet, and sends people to the demo or
 * to the architecture. It invites no one to donate: nothing is on mainnet.
 */

const DEMO = "https://demo.cipherphi.ch";
const REPO = "https://github.com/Cipher-One-Capital/cipherphi";
const ARCHITECTURE = `${REPO}/blob/main/ARCHITECTURE.md`;

const STEPS = [
  { name: "Give", text: "A donor pays zakat into the pool. No wallet app, no seed phrase." },
  { name: "Split", text: "The contract divides it across the eight categories the moment it arrives." },
  {
    name: "Release",
    text: "A payout to a vetted partner moves only with 2 of 3 eligibility approvals. Without them, the contract refuses it.",
  },
  { name: "Check", text: "Every step links to Stellar Expert, a public explorer CipherPhi does not run." },
];

const CATEGORIES = [
  ["The poor", "al-fuqarāʾ"],
  ["The needy", "al-masākīn"],
  ["Zakat administration", "al-ʿāmilīn ʿalayhā"],
  ["Reconciling hearts", "al-muʾallafati qulūbuhum"],
  ["Freeing captives", "fī al-riqāb"],
  ["Relief of debt", "al-ghārimīn"],
  ["In the cause of God", "fī sabīl Allāh"],
  ["The wayfarer", "ibn al-sabīl"],
];

const FOUNDATION = [
  "Federally supervised Swiss foundation.",
  "Founded 6 July 2021.",
  "Audited every year.",
  "Funded entirely by its community.",
];

const GUARANTEES = [
  {
    title: "Two functions move money",
    text: "Only contribute and distribute move value. Nothing else in the contracts can.",
  },
  {
    title: "Payouts need 2 of 3 approvals",
    text: "The Foundation's eligibility signers approve each payout. The delivery team holds none of those seats.",
  },
  {
    title: "Custody cannot be swapped",
    text: "The custody contract cannot be silently replaced. A change is a new, public deployment.",
  },
  {
    title: "No donor identity on chain",
    text: "The ledger carries addresses, amounts and hashes only.",
  },
  {
    title: "An honest claim",
    text: "A donor sees that their category was paid to a verified recipient, not where each coin went. Zakat is pooled by design.",
  },
];

const STELLAR = [
  "USDC is issued natively on Stellar. No bridge holds donated zakat.",
  "Every asset has a standard token contract. CipherPhi writes no token code.",
  "Fees are fractions of a cent, so each donation is split and recorded in full.",
  "Stellar's Disbursement Platform is the planned rail for paying individuals later.",
];

const STATUS = [
  { stage: "Now", title: "Testnet demo", text: "Live at demo.cipherphi.ch. Unaudited. No real money." },
  {
    stage: "Next",
    title: "Security review",
    text: "Independent review through the Stellar Community Fund's Audit Bank, before any mainnet deployment.",
  },
  { stage: "Then", title: "Pilot", text: "Payouts to a vetted partner organisation, on mainnet." },
];

export default function Landing() {
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="top">
        <div className="wrap top-row">
          <a href="#main" className="brand" aria-label="CipherPhi, top of the page">
            <Image src="/cipherphi-wordmark.png" alt="CipherPhi" width={109} height={24} priority />
          </a>
          <nav className="nav" aria-label="Main">
            <a href="#how">How it works</a>
            <a href={ARCHITECTURE}>Architecture</a>
          </nav>
          <a className="btn top-cta" href={DEMO}>
            Try the demo
          </a>
          <details className="menu">
            <summary>
              Menu
            </summary>
            <div className="menu-panel">
              <a href="#how">How it works</a>
              <a href={ARCHITECTURE}>Architecture</a>
            </div>
          </details>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="wrap hero-row">
            <div className="hero-copy">
              <h1 id="hero-title">Enforces zakat rules before funds move.</h1>
              <ul className="points">
                <li>Splits each donation across the eight zakat categories.</li>
                <li>Releases a payout only with 2 of 3 signer approvals.</li>
                <li>Links every step to a public explorer.</li>
              </ul>
              <div className="actions">
                <a className="btn" href={DEMO}>
                  Try the demo
                </a>
                <a className="btn secondary" href={ARCHITECTURE}>
                  Read the architecture
                </a>
              </div>
              <p className="status-line">
                <span className="dot" aria-hidden="true" />
                Testnet demo live. Contracts unaudited. Pilot in preparation.
              </p>
            </div>
            <Image
              className="hero-symbol"
              src="/cipherphi-symbol.svg"
              alt=""
              width={280}
              height={223}
              priority
            />
          </div>
        </section>

        <section id="how" className="band" aria-labelledby="how-title">
          <div className="wrap">
            <p className="eyebrow">How it works</p>
            <h2 id="how-title">Four steps, each one on the public ledger.</h2>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.name}>
                  <span className="step-num" aria-hidden="true">
                    {i + 1}
                  </span>
                  <h3>{s.name}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
            <p className="more">
              <a href={DEMO}>See it in two minutes: try the demo</a>
            </p>
          </div>
        </section>

        <section className="band white" aria-labelledby="cat-title">
          <div className="wrap split-2">
            <div>
              <p className="eyebrow">Qur&apos;an 9:60</p>
              <h2 id="cat-title">The eight categories of zakat.</h2>
              <p className="lede">
                The Foundation&apos;s Shariah authority sets how each donation is divided. The
                contract enforces it. Donors do not choose the split.
              </p>
            </div>
            <ol className="cats">
              {CATEGORIES.map(([name, arabic]) => (
                <li key={name}>
                  <span className="cat-name">{name}</span>
                  <span className="cat-ar">{arabic}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="band" aria-labelledby="inst-title">
          <div className="wrap">
            <p className="eyebrow">The institution first</p>
            <h2 id="inst-title">Built on a foundation that already does this.</h2>
            <p className="lede narrow">
              The Swiss Zakat Foundation collects and redistributes zakat today. CipherPhi moves its
              rail onchain. The collection, the vetting and the audit relationship already exist.
            </p>
            <ul className="facts">
              {FOUNDATION.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="band white" aria-labelledby="guar-title">
          <div className="wrap">
            <p className="eyebrow">Enforced in code</p>
            <h2 id="guar-title">What the contracts guarantee.</h2>
            <ul className="cards">
              {GUARANTEES.map((g) => (
                <li key={g.title}>
                  <h3>{g.title}</h3>
                  <p>{g.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="band" aria-labelledby="stellar-title">
          <div className="wrap split-2">
            <div>
              <p className="eyebrow">The network</p>
              <h2 id="stellar-title">Why Stellar.</h2>
            </div>
            <ul className="ticks">
              {STELLAR.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="band white" aria-labelledby="status-title">
          <div className="wrap">
            <p className="eyebrow">Status</p>
            <h2 id="status-title">Where CipherPhi stands today.</h2>
            <ol className="timeline">
              {STATUS.map((s, i) => (
                <li key={s.stage} className={i === 0 ? "now" : undefined}>
                  <span className="stage">{s.stage}</span>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="closing" aria-labelledby="close-title">
          <div className="wrap">
            <h2 id="close-title">See the whole flow in two minutes.</h2>
            <div className="actions center">
              <a className="btn" href={DEMO}>
                Try the demo
              </a>
              <a className="btn secondary" href={ARCHITECTURE}>
                Read the architecture
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-row">
          <p>Swiss Islamic Finance · Swiss Zakat Foundation · built by Bits &amp; Blocks</p>
          <nav aria-label="Footer">
            <a href={REPO}>GitHub</a>
            <a href={DEMO}>Demo</a>
          </nav>
          <p className="copy">© 2026 CipherPhi</p>
        </div>
      </footer>
    </>
  );
}
