# CipherPhi testnet demo

A clickable demo of the CipherPhi flow for partner calls: give, see it split, see it released, check it. It runs on Stellar testnet with a test token, so a visitor can try it in a fresh browser with no setup.

**Testnet only, unaudited, no real funds.** The passphrase is pinned to testnet in code and no mainnet key exists anywhere in this directory.

| | |
| --- | --- |
| Pool contract | [`CCMGJ2SBHSAGCVQBGZLOKWPX3H7EUDFMCHBNSN3VUXHQ5QZNHG3DJ4YT`](https://stellar.expert/explorer/testnet/contract/CCMGJ2SBHSAGCVQBGZLOKWPX3H7EUDFMCHBNSN3VUXHQ5QZNHG3DJ4YT) |
| Wasm hash | `f498a9c5d440ddeee3da70f37b14f95044647b586a01c816a98c24d084072677` |
| Test token | `tCHF` issued by `GCC6JONMUDEEHA3A7F4UIQVOAXH5CHP2QXEZZY5YR3QWUHIXTI7HRJ7X` |
| Token contract | [`CC23RTNDA6XD55SBAI6JRDFXP4BNXQA6RZE6NBHNZOV64M7KXNUQZ5QX`](https://stellar.expert/explorer/testnet/contract/CC23RTNDA6XD55SBAI6JRDFXP4BNXQA6RZE6NBHNZOV64M7KXNUQZ5QX) |
| Partner organisation | [`GDIMG5XEHP7BCHJ26AI36GFHJQVKHM3NLJZFF4ERTD5UZWB3DX5YSSNQ`](https://stellar.expert/explorer/testnet/account/GDIMG5XEHP7BCHJ26AI36GFHJQVKHM3NLJZFF4ERTD5UZWB3DX5YSSNQ) |
| Eligibility signers | 2 of 3, public keys in [`deployment.json`](deployment.json) |
| Deployed | 20 October 2026 |

Testnet is reset roughly quarterly and every contract on it is deleted. If the ids above stop resolving, redeploy with `npm run deploy` and update this table. The Wasm hash is the durable part: it rebuilds from this source at any time.

## The four moments

1. **Give.** Sign in with an email through Privy, with no wallet app and no seed phrase. The demo opens the visitor's Stellar account with sponsored reserves, adds the tCHF trustline, and gives them 100 tCHF in one transaction. The visitor then donates 50 tCHF. The treasury pays every fee with a fee-bump, so the visitor never holds XLM.
2. **See it split.** The donation's split across the eight categories, read from the `Contribution` event the pool emitted, next to the pool's eight balances read live from contract state.
3. **See it released.** A 10 tCHF payout from "The poor" to the partner organisation, with a 2-of-3 signed approval, succeeds. The same payout with no approval is sent to the network anyway and fails with `ThresholdNotMet` (contract error 12). The UI shows that reason, and the failed transaction is public.
4. **Check it.** A public receipt at `/receipt?c=…&r=…&f=…`, which re-reads every transaction from the ledger by hash and links each one to Stellar Expert.

## What it is built from

- **`contract/`** is Bits and Blocks' [`soroban-attestation-gate`](https://github.com/bits-and-blocks/stellar-examples/tree/main/examples/soroban-attestation-gate), widened from 3 buckets to the 8 categories of Qur'an 9:60. It includes the refusal tests that were still uncommitted on that example's branch. 37 tests: `cd contract && cargo test`.
- **`scripts/build.sh`** and the verifier come from [`soroban-reproducible-build`](https://github.com/bits-and-blocks/stellar-examples/tree/main/examples/soroban-reproducible-build). The deployed Wasm is built in a digest-pinned container, with SEP-58 build metadata recorded inside it.
- **`web/`** is a Next.js app whose Privy signing code comes from [`privy-stellar-onboarding`](https://github.com/bits-and-blocks/stellar-examples/tree/main/examples/privy-stellar-onboarding).

### How the demo differs from ARCHITECTURE.md

This is a demonstration, not the funded build. The differences are deliberate, and each one is stated in the UI where a visitor would otherwise assume the stronger claim.

| ARCHITECTURE.md | This demo |
| --- | --- |
| 3 contracts: `zakat_pool`, `policy`, `attestation` | 1 contract with the split compiled in and the quorum check inline |
| Split set by governance, validated by the Shariah authority | A fixed **placeholder** split: 30 / 20 / 10 / 5 / 5 / 15 / 10 / 5 percent, with the remainder to "The poor". It is not the Foundation's allocation. |
| Distributor, signers and governance held by different parties | One demo server holds the distributor key and 2 of the 3 signer keys. The third signer key is not on the server. The contract enforces the role split either way. |
| USDC through its Stellar Asset Contract | `tCHF (testnet)`, a test token from a throwaway issuer, so nothing reads as a real issuer's asset |
| Governance multisig, timelock, pause | None. The authority set is fixed at deployment. |

## Visitor caps

- One grant per visitor address. The onboarding transaction only opens an account that does not exist yet, so an address is funded once.
- At most 300 new visitor accounts in any 24 hours, counted from the treasury's own history on Horizon, so no database is needed.
- One approved payout and one unapproved attempt per donation. Before each, the distributor sends a no-op transaction whose memo is `sha256(kind ‖ donation hash)`, and a request that finds its memo already there is refused.
- Sponsored fees are capped at 2 XLM per transaction, and only one call is sponsored: `contribute` on this pool, from the transaction's own source, for at most the grant.

## Run it

```bash
npm install                         # in demo/, for the build and deploy scripts
npm run build:wasm                  # reproducible build in Docker, writes out/
npm run deploy                      # testnet keys, tCHF, token contract, pool, seed
node scripts/check-deployed-hash.mjs  # rebuild and compare against the chain

cd web
npm install
cp .env.example .env.local          # fill from ../.secrets.json
npm run check:vector                # the attestation encoder against the contract's vector
npm run dev -- -p 3100
BASE=http://localhost:3100 npm run check:flow   # the four moments via the API, live testnet
npx playwright test e2e/four-moments.spec.ts    # the four moments in a browser
```

`deploy.mjs` writes `deployment.json` and its copy in `web/lib/`, both public and committed, and `.secrets.json`, which holds the testnet keys and is gitignored.

Without `NEXT_PUBLIC_PRIVY_APP_ID`, a development build swaps Privy for a throwaway key in the browser tab, so the page can be worked on without a Privy app. A production build does the same only with `NEXT_PUBLIC_DEMO_LOCAL_WALLET=1`, and the page then says it is using a test key.

## Deploy the web app

```bash
cd web
vercel link --project cipherphi-demo
vercel env add NEXT_PUBLIC_PRIVY_APP_ID production
vercel env add TREASURY_SECRET production       # from ../.secrets.json
vercel env add DISTRIBUTOR_SECRET production
vercel env add AUTHORITY_SECRET_0 production
vercel env add AUTHORITY_SECRET_1 production
vercel deploy --prod
```

Then add the deployment's origin to the Privy app's allowed origins.

## Fallback recording

`RECORD=1 BASE_URL=<url> npx playwright test e2e/record.spec.ts` replays the four moments at a watchable pace and writes a `.webm` under `web/test-results/`.
