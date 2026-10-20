# CipherPhi

Onchain zakat collection and redistribution on Stellar.

Donors calculate and pay their zakat into a pooled Soroban contract, and can verify from the Stellar ledger that their category was distributed to a recipient whose eligibility was signed before the funds moved. Zakat is pooled by construction, so the claim is category-level, and the architecture keeps it that way throughout.

CipherPhi is the onchain layer for the Swiss Zakat Foundation, a federally supervised Swiss foundation collecting and redistributing zakat since its founding deed of 6 July 2021, audited annually and entirely community funded.

## Status

SCF #45 Build Award submission, Open Track, shortlisted for Community Vote.

> Bits & Blocks has published working examples covering the integrations this build depends on. Read more: [bits-and-blocks/stellar-examples](https://github.com/bits-and-blocks/stellar-examples).

## Architecture

CipherPhi is composed of three main Soroban contracts:

- `zakat_pool` holds custody and the per-asset eight-category balances, and has the only two functions that move value.
- `policy` holds the Shariah parameters and computes the allocation.
- `attestation` verifies eligibility signatures.

> Read the full design: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Testnet demo

A clickable demo of give, split, release and check runs on Stellar testnet with a test token: pool [`CCMGJ2SBHSAGCVQBGZLOKWPX3H7EUDFMCHBNSN3VUXHQ5QZNHG3DJ4YT`](https://stellar.expert/explorer/testnet/contract/CCMGJ2SBHSAGCVQBGZLOKWPX3H7EUDFMCHBNSN3VUXHQ5QZNHG3DJ4YT), Wasm hash `f498a9c5d440ddeee3da70f37b14f95044647b586a01c816a98c24d084072677`. It is unaudited and handles no real funds.

> How it is built, and where it differs from the architecture: [demo/README.md](./demo/README.md).

## Revisions

The architecture has been through three review cycles. The structure itself was never touched: the 3 contracts, the separated keys and the on-chain boundary are as first submitted. What each cycle changed is what the design was run against, security review and platform checks, and the corrections those found.

| ID | Logs | Branches |
| --- | --- | --- |
| 1 | The design as submitted with the SCF #45 Build Award application. | Merged directly to `main` |
| 2 | Findings of an internal pre-implementation security review folded in, the review's attribution and its internal scope stated, references turned into real footnotes, and the CAP-71 credential migration named in the toolchain pin. | [`docs/architecture-security-review`](https://github.com/bits-and-blocks/cipherphi/tree/docs/architecture-security-review), [`docs/review-claim-accuracy`](https://github.com/bits-and-blocks/cipherphi/tree/docs/review-claim-accuracy), [`docs/cap-71-credentials`](https://github.com/bits-and-blocks/cipherphi/tree/docs/cap-71-credentials), [`docs/readme-and-license`](https://github.com/bits-and-blocks/cipherphi/tree/docs/readme-and-license) |
| 3 | Corrupted text and inconsistencies repaired, a platform correction on Stellar transaction ordering, monitoring and issuer-freeze detection made concrete, and figures added. | [`docs/architecture-revision-3`](https://github.com/bits-and-blocks/cipherphi/tree/docs/architecture-revision-3), [`rev-3/transaction-ordering-rationale`](https://github.com/bits-and-blocks/cipherphi/tree/rev-3/transaction-ordering-rationale) |

## Stack

- Stellar Soroban, Rust to Wasm on the soroban-sdk 27
- Stellar Asset Contract custody, USDC first with EURC planned
- Privy embedded wallets, with the Stellar Wallets Kit as the named fallback
- Sponsored reserves covering donor accounts and trustlines
- Circle CCTP for native inbound USDC

Planned but not committed:

- Stellar Disbursement Platform for individual-recipient payouts
- SEP-24 anchor for fiat on-ramp
- Tether Gold contingent on Stellar-native issuance

## Team

- [Swiss Zakat Foundation](https://zakat.ch), the operating institution: Saâd Dhif, Founder and Executive Director.
- [Bits & Blocks](https://www.bitsandblocks.tech), delivery: Aladdin Battikh, CTO.
- [Muhammad Emamally](https://www.linkedin.com/in/phil-emamally-/), Shariah authority for the pilot.
- [Ismail Amara](https://www.linkedin.com/in/ismail-a-667666111/), partnerships and pilot.

## License

Apache 2.0, see [LICENSE](./LICENSE)
