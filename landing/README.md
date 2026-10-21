# CipherPhi website

The landing page at www.cipherphi.ch, for partners and funders. One static page: what CipherPhi is, how it works, the eight categories, the Swiss Zakat Foundation behind it, what the contracts guarantee, why Stellar, and where the project stands. It links to the demo at demo.cipherphi.ch and to [ARCHITECTURE.md](../ARCHITECTURE.md). It invites no one to donate: nothing is on mainnet.

It shares `app/tokens.css` with the demo, so the two read as one product. If the tokens change, copy them across.

```bash
npm install
npm run dev                    # http://localhost:3000
npm run build && npx next start -p 3300
npx playwright test            # axe, focus ring, 48 px targets, links, at 1440 and 375 px
```

## Vercel

Its own Vercel project, separate from the demo: Root Directory `landing`, framework Next.js, no environment variables. Domains: `www.cipherphi.ch`, with `cipherphi.ch` redirecting to it.
