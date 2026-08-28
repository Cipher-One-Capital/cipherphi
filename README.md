# CipherPhi

Onchain zakat collection and redistribution on Stellar.

Donors calculate and pay their zakat into a pooled Soroban contract, and can verify from the Stellar ledger, rather than from a server, that their category was distributed to a recipient whose eligibility was signed before the funds moved. Zakat is pooled by construction, so the claim is category-level, and the architecture keeps it that way throughout.

CipherPhi is the onchain layer for the Swiss Zakat Foundation, a federally supervised Swiss foundation collecting and redistributing zakat since its founding deed of 6 July 2021, audited annually and entirely community funded.

## Status

SCF #45 Build Award submission, Open Track, in panel review. The architecture is at Revision 2, incorporating the findings of an independent pre-implementation security review. Funded contract development begins at grant kickoff. The delivery partner's Stellar integration examples are already public at [bits-and-blocks/stellar-examples](https://github.com/bits-and-blocks/stellar-examples).

## Architecture

Three Soroban contracts, split by what each may touch. `zakat_pool` holds custody and the per-asset eight-category balances, and has the only two functions that move value. `policy` holds the Shariah parameters and computes the allocation. `attestation` verifies eligibility signatures. One contract holds funds; the other two can never move anything, so the components most likely to change are the ones holding no money.

The full design, including what is deliberately not in this build and the trigger that would change each absence:

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [Technical proposal and delivery plan (PDF)](./CipherPhi_Technical_Proposal_and_Delivery_Plan.pdf)

## Stack

- Stellar
- Soroban, Rust to Wasm on the soroban-sdk 27
- Stellar Asset Contract custody, USDC first with EURC planned
- Privy embedded wallets, with the Stellar Wallets Kit as the named fallback
- Sponsored reserves covering donor accounts and trustlines
- Circle CCTP, live on Stellar, for native inbound USDC

Planned but not committed:

- Stellar Disbursement Platform for individual-recipient payouts
- SEP-24 anchor for fiat on-ramp
- Tether Gold contingent on Stellar-native issuance

## Team

- [Swiss Zakat Foundation](https://zakat.ch), the operating institution: Saâd Dhif, Founder and Executive Director.
- [Bits & Blocks](https://www.bitsandblocks.tech), delivery: Aladdin Battikh, CTO.
- Muhammad Emamally, Shariah authority for the pilot.
- Ismail Amara, partnerships and pilot.

## License

Apache 2.0, see [LICENSE](./LICENSE)
