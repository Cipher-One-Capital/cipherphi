# Technical architecture: Stellar integration

#### *SCF #45 · Open Track*

CipherPhi is an onchain zakat platform on Stellar. Donors calculate and pay their zakat into a pooled Soroban smart contract, and receive cryptographic proof, from the Stellar ledger, that funds reached verified recipients.

| | |
| --- | --- |
| **Project** | CipherPhi (onchain zakat collection and redistribution) |
| **Chain** | Stellar; smart contracts on Soroban (Rust compiled to Wasm) |
| **Track** | SCF Build, Open Track (final milestone: mainnet launch) |
| **Stablecoins** | USDC first, EURC fast-follow, via the Stellar Asset Contract |
| **Institution** | Swiss Zakat Foundation (operating since 2020); CipherPhi is the onchain layer |

## What We Are Building

CipherPhi moves an operating, audited Swiss zakat foundation onchain. The rules of zakat, pooled custody, allocation across the eight categories, and distribution only to eligible recipients, are encoded in a single Soroban smart contract on Stellar. Stellar is the settlement layer, the custody layer for regulated stablecoins, and the immutable proof layer. The one thing a normal donation app cannot offer, cryptographic proof that a specific donation reached a verified recipient, is exactly what the Stellar ledger provides.

**But why Stellar?** Zakat is a payments problem: pooled stablecoin custody, low-cost final settlement, and eventual fiat-out to recipients. Stellar is purpose-built for stablecoin payments, gives sub-second finality for cents, natively supports USDC and EURC through the Stellar Asset Contract, and provides an immutable ledger that turns "trust us" into an auditable trail. Soroban adds the programmable layer to encode the zakat rules as enforced code rather than policy.

## Building Blocks

CipherPhi composes vetted Stellar building blocks around one custom Soroban contract, rather than rebuilding infrastructure. The contract is the core IP; Privy and the Stellar Disbursement Platform wrap around it.

| Stellar building block | Role in CipherPhi | Status | Est. time |
| --- | --- | --- | --- |
| **Soroban smart contracts** (Rust to Wasm) | ZakatPool: pooled custody, eight-category accounting, attestation-gated distribution. The core IP. | Core build | Custom |
| **Stellar Asset Contract** (SAC, SEP-41) | Hold and move USDC (and later EURC) inside the pool with no custom token logic. | Core | Built-in |
| **Stellar authorization** + multisig | `require_auth` role separation; the attestation authority is a 2-of-3 multisig, distinct from the distributor. | Core | Built-in |
| **Stellar ledger events** + RPC indexing | Donor proof view: reconstruct each contribution-to-delivery trace from ledger events, verifiable on-chain. | Core | Custom indexer |
| **Privy** | Embedded email/social wallet so non-crypto donors contribute without a seed phrase. | Committed | Under 1 day |
| **Stellar Disbursement Platform** (SDP) | Planned rail for individual-recipient payouts and fiat off-ramp once the pilot expands beyond partner orgs. | Planned | 1 to 2 weeks |
| **Circle CCTP** | Optional: let donors bring USDC natively from other chains into the pool. | Roadmap | 1 to 5 days |


## Architecture Overview

The load-bearing decision: funds and rules live on Stellar; identity and human judgment stay off-chain. Nothing personal ever crosses onto the ledger, which resolves GDPR and Swiss right-to-erasure, keeps on-chain state bounded within Soroban's limits, and preserves ledger immutability as the audit trail.

```md
ON-CHAIN · STELLAR / SOROBAN  (trustless, immutable)
┌─────────────────────────────────────────────────────────────┐
│   [ ZakatPool contract ]            [ Immutable event trail ]│
│   custody (SAC) · 8 buckets         contributions + payouts  │
└───────▲───────────────────▲────────────────────┬────────────┘
        │                   │                     │
- - - - │ - - - - - - - - - │ - - - - - - - - - - │ - - - - - - -
        │                   │                     ▼
┌───────┴───────────┐ ┌─────┴────────────┐ ┌──────────────────┐
│ Donor app + Privy │ │ Attestation auth │ │ Indexer + registry│
│ onboard·calc·proof│ │ signs eligibility│ │ holds PII · trace │
└───────────────────┘ └──────────────────┘ └──────────────────┘
OFF-CHAIN  (private, human judgment)
```

*On-chain: the ZakatPool contract, custody via SAC, and the immutable event trail. Off-chain: donor onboarding (Privy), eligibility attestation, and the indexer that reconstructs each donation's proof.*

**Flow.** A donor onboards through Privy (embedded Stellar wallet, no seed phrase), calculates their zakat, and contributes USDC into the ZakatPool contract via the Stellar Asset Contract. The contract records the contribution and applies the eight-category allocation, emitting a Stellar ledger event. To distribute, an independent attestation authority signs recipient eligibility off-chain; the contract verifies that signature on-chain before releasing funds, and emits a disbursement event carrying the attestation hash. An off-chain indexer reads Stellar ledger events to reconstruct each donor's proof view: received, pooled, allocated, delivered.

## The ZakatPool Soroban contract

A single Soroban contract, deliberately. At pilot scale one auditable contract beats a multi-contract system: smaller attack surface, one audit, no cross-contract reentrancy surface.

### Persistent state (bounded by design)

- `governance` multisig; the `attestation_authority` public key (a signer, not a fund-mover).
- `approved_assets`: SAC addresses for USDC (EURC later).
- `allocation_policy`: the eight-category split, governed not hardcoded, and extendable to a per-partner split signed by the authority.
- `category_balances`: eight buckets. No per-contribution or per-recipient records live in contract storage; those are ledger events, indexed off-chain. This is the deliberate answer to Soroban's storage-archival and read-limit constraints.

### Key functions

- `contribute(asset, amount, category_pref)`: pulls the asset via the Stellar Asset Contract, increments the category bucket, emits a Contribution event.
- `distribute(recipient, asset, amount, category, attestation)`: requires distributor auth, verifies the eligibility attestation signed by the authority key, checks the category balance, decrements then transfers (checks-effects-interactions), emits a Disbursement event with the attestation hash.

### Roles, separated by design

Three keys: governance (config and upgrade), distributor (moves funds), and attestation authority (signs eligibility, held as a 2-of-3 multisig). The money-mover and the eligibility-signer are deliberately different parties.

## The Integration Plan

### Milestone 1: contract, calculator, onboarding (testnet)

Deploy the ZakatPool contract to Stellar testnet with pooled custody via SAC and eight-category allocation. Integrate Privy for seedless donor onboarding (Stellar-compatible embedded wallet). Ship the zakat calculator and the contribute flow. Verifiable: contributions and category splits inspectable on a Stellar testnet explorer.

### Milestone 2: attestation-gated distribution, traceability, review (testnet)

Add the attestation scheme and the on-chain verification in `distribute()`. Pilot payout is a direct transfer from the ZakatPool contract to a vetted partner-organisation address. The Stellar Disbursement Platform is the planned rail for individual-recipient payouts and fiat off-ramp in a later phase. Build the Stellar-ledger indexer that produces the full contribution-to-disbursement trace. Enter security review.

### Milestone 3: audited mainnet launch and pilot

Deploy the audited contract to Stellar mainnet. Privy onboarding live; donors contribute real USDC/EURC. Donor proof view renders each contribution's state from Stellar ledger events. A controlled pilot runs with one partner organisation, with professional user testing. This is the SCF Open Track final milestone: live on mainnet.

## Security and trust model (Soroban-specific)

- **Storage and TTL:** only config plus eight balance buckets are persistent, with a TTL-bump strategy; no unbounded maps and no per-transaction iteration, so the contract stays within Soroban's read limit.
- **Authorization:** `require_auth` with three separated roles; the attestation authority is a 2-of-3 multisig before mainnet.
- **Assets:** the built-in Stellar Asset Contract (SEP-41); no custom token logic; transfer results checked.
- **Ordering and arithmetic:** checked i128 math and checks-effects-interactions; Soroban's no-reentrancy guarantee is a backstop, not the primary control.
- **Assurance:** independent security review through the SCF Soroban Audit Bank, plus cargo-fuzz on the fund-moving paths before mainnet.

## Data & Privacy Boundary

On-chain: pooled custody, category balances, config, and the immutable event trail with one attestation hash per disbursement. Off-chain: donor KYC, recipient identity and eligibility evidence, the human Shariah sign-off, the attestation-signing service, and the indexer. No recipient PII is ever written to the Stellar ledger; only hashes and attestations. This is what makes an immutable ledger compatible with Swiss and EU right-to-erasure.

## Deferred & Roadmap

- Stellar Disbursement Platform for individual-recipient payouts and fiat off-ramp (pilot pays a partner org directly).
- EURC alongside USDC via SAC; Circle CCTP for cross-chain USDC inflows.
- zk or decentralised identity for recipient privacy; on-chain governance of allocation. Off-chain records plus an on-chain signed attestation is the correct design now.

> *NOTE: The Shariah parameters (nisab basis, amil cap, discharge timing, category and per-partner splits) are configurable contract parameters, not hardcoded.*
