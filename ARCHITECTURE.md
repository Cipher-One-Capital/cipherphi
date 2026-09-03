# CipherPhi architecture

CipherPhi moves an operating, audited Swiss zakat foundation onchain. The rules of zakat, pooled custody, allocation across the 8 zakat categories, and distribution only to eligible recipients, are encoded in 3 smart contracts.

This file is the architecture: what is built, why each decision was settled the way it was, and what is deliberately not being built. Where something a reader might expect is absent, it is named under "Not in this build" with the trigger that would change it.

*Revision 3. Incorporates the findings of an internal pre-implementation security review.*

---

## The moat

Onchain zakat is not a new idea. HAQQ routes a tenth of every ISLM issuance into the Evergreen DAO endowment for Islamic charity,[^1] Zakat Coin and comparable tokens have proposed donor-facing zakat platforms,[^2] and the academic literature carries several blockchain zakat collection and distribution models.[^3] What almost all of them share is that the chain came first and the institution second: a new token, a new DAO, or a paper design, looking for a zakat body to adopt it.

CipherPhi runs the other way. The Swiss Zakat Foundation already collects and redistributes zakat under federal supervision, with audited accounts and a working eligibility process, and this project puts that existing institution's rail onchain.

The defensible part is not the contract. It is a few thousand lines of Rust that any competent team could write, and this document publishes the design rather than guarding it. The moat is that the collection, the donor base, the vetting process, the partner network, and the audit relationship already exist and are being moved rather than invented. A competitor starting today writes the contract in a month and then spends years becoming a supervised foundation with an unqualified audit opinion.

## Why Stellar

4 pillars, all of them already in the protocol rather than built for this project.

**USDC.** Circle issues USDC on Stellar directly, and CCTP moves it in from other chains by burn and mint rather than through a wrapped asset or a third-party bridge.[^4] A pool holding donated zakat cannot carry bridge counterparty risk, and on Stellar it does not have to.

**Token interface.** Every Stellar asset has a Stellar Asset Contract at a deterministic address implementing SEP-41, so custody and transfer are a standard interface call. There is no token contract in CipherPhi's codebase to write, audit, or get wrong.

**Cheap settlement suited to per-category accounting.** Fees are metered in stroops rather than in dollars.[^5] Splitting one contribution across 8 zakat categories and emitting an event for each is affordable, where on a chain with meaningful gas it would push the project toward batching, which is the thing that destroys the audit trail.

**A built-in disbursement rail.** The Stellar Disbursement Platform is maintained by SDF for exactly the job this project reaches in a later phase, paying individual recipients and off-ramping to fiat.[^6] The roadmap does not depend on CipherPhi building a payments company.

Soroban then supplies the part a payment network alone cannot do, which is the 8-category allocation and the eligibility gate run as enforced code rather than as application logic sitting above the rails.

## Architecture

A modular structure, composed by 3 main Soroban contracts and 3 separated keys, while personal data stays offchain.

## The boundary

Funds/rules live on Stellar, and identity/human judgment stay off it.

**Erasure capability:** An immutable chain and a right to erasure are only in tension if personal data reaches the ledger. Nothing personal does, so the obligation attaches to the off-chain registry and is met there.

**Onchain state stays bounded:** Recipient records are the only thing here that grows without limit, and they are the one thing kept off the ledger. What remains fits inside Soroban's storage and read limits at any donor count.

**The ledger stays readable by outsiders:** A regulator, an auditor, or a donor can follow the money without any of them being handed a list of aid recipients.

**Cost:** Eligibility becomes a claim made off-chain. That claim is signed, and the signature is verified onchain before any money moves. A reviewer does not have to trust the eligibility decision in order to verify that one was made, by a known key, before funds left the pool.

```
On-chain · Stellar and Soroban:
  [ZakatPool contract]   [Immutable event trail]   [Attestation verification]

Off-chain · private, human judgment:
  [Donor app and Privy]   [Attestation authority]   [Indexer and registry]
```

*Only a signed transaction, a signed attestation, and reads of events cross the line.*

## 3 contracts are split by what each may touch

Custody, policy, and eligibility are separate deployments from the first day.

| Contract | Responsibility | Holds funds |
| --- | --- | --- |
| `zakat_pool` | Custody, the 8 category balances, and the only 2 entry points that move value | Yes |
| `policy` | Shariah parameters and the allocation computation over a contribution | No |
| `attestation` | The attestation authority key set, and verification of an eligibility signature | No |

**The separation:** One contract holds assets. The other 2 are consulted by it and can never move anything. That is what makes the split worth its cost: the 2 components most likely to change, a refinement to the Shariah parameters and a change to the eligibility scheme, are exactly the 2 that hold no money.

**The upgrade is granular:** Refining the amil cap redeploys `policy`. Changing the attestation scheme redeploys `attestation`. Neither touches custody, so donor funds never migrate for a reason unrelated to custody. A single contract would have forced the opposite: every change to a Shariah parameter redeploying the thing holding the money.

**The cost is a trust boundary:** A cross-contract call is a place where a wrong answer can enter. `zakat_pool` pins the addresses of `policy` and `attestation` in governance-controlled storage, and treats both as untrusted inputs rather than trusted collaborators: an allocation is rejected unless the returned vector has exactly 8 elements, every element is zero or positive, and they sum exactly to the amount received. Checking only the sum would not be enough: a split of the shape `[amount + x, -x, 0, ...]` sums correctly, passes checked arithmetic, and leaves total custody intact while silently crediting one category from another's beneficiaries. A distribution is likewise rejected unless the attestation verifies against the authority the pool itself holds. The audit scope is 3 Wasm binaries rather than 1, which is a real cost and is the reason independent review is entered well before mainnet rather than alongside it.

> **Not in this build.** No in-place code upgrade on custody. Soroban contracts are mutable only if they compile in an upgrade entry point; a contract that omits `update_current_contract_wasm` is immutable by construction.[^7] `zakat_pool` omits it, because code that can be silently replaced over donor funds is an admin key by another name. `policy` and `attestation` are repointable by governance instead, and they hold nothing. A change to custody is a new deployment with a published address and a migration a donor can watch.

## Onchain storage

The storage is bounded by design.

Every Soroban entry carries a time to live. Since Protocol 23, a persistent entry whose TTL lapses is evicted to the archive and restored automatically when it next appears in a transaction footprint, with the rent and write fees of that restoration paid by whoever sends the transaction.[^8] A temporary entry is different in kind: at expiry it is deleted permanently, with no restoration path.[^9] The failure mode of unbounded per-contribution storage is therefore not a contract that stops working but one that grows steadily more expensive to touch, with restoration costs landing on donor transactions at exactly the moment the platform is succeeding.

| Contract | Entry | Durability | Content |
| --- | --- | --- | --- |
| `zakat_pool` | `governance` | Instance | Multisig address. Configuration and deployment authority |
| `zakat_pool` | `distributor` | Instance | The key permitted to move funds out of the pool |
| `zakat_pool` | `policy_addr` | Instance | Address of the policy contract, governance-controlled |
| `zakat_pool` | `attest_addr` | Instance | Address of the attestation contract, governance-controlled |
| `zakat_pool` | `approved_assets` | Instance | SAC addresses for USDC, and later EURC |
| `zakat_pool` | `category_balances` | Persistent, keyed by asset | 8 buckets per approved asset. The whole of the accounting state |
| `zakat_pool` | `distribution_seq` | Instance | Monotonic counter, bound into every attestation so a signature executes once |
| `zakat_pool` | `paused` | Instance | Contribution pause flag, governance-controlled, effective immediately |
| `zakat_pool` | `distributor_disabled` | Instance | Distributor kill switch, governance-controlled, effective immediately |
| `zakat_pool` | `pending_change` | Instance | A queued governance change: what it targets, its new value, and the ledger after which it may execute |
| `policy` | `allocation` | Instance | The 8-category split, extendable to a per-partner split |
| `policy` | `parameters` | Instance | Nisab basis, amil cap, discharge timing |
| `attestation` | `authority` | Instance | Public key set that signs recipient eligibility, and the threshold. Set at construction and immutable: there is no setter |

### Storage, continued

That is the complete stored set across all 3 contracts. It grows only when governance approves an additional asset, which adds 8 buckets. Nothing here grows with donor count, contribution count, or recipient count. **Durability is a decision, not a default.** Configuration sits in instance storage, which shares one lifetime with the contract itself, so a single extension covers all of it. Only the per-asset balances are keyed separately, because they are the one thing that grows when an asset is approved. Nothing uses temporary storage, which is deleted rather than archived at expiry: a queued governance change that vanished because its entry expired mid-timelock would be a silent failure of the delay itself.

A TTL-bump strategy runs on every entry above, so nothing load-bearing is ever archived through disuse and no donor transaction pays surprise restoration fees.

## Event emission

The previous page listed everything the contracts store. Everything else a donor or an auditor might want to see is emitted as a Stellar ledger event instead, and read back by an off-chain indexer.[^10]

Each contribution emits one event carrying the donor address, the asset, the amount, and the resulting 8-category split. Each distribution emits one carrying the recipient address, the category, the amount, and the hash of the attestation that authorised it. Those 2 event types are the complete record, and between them they reconstruct any view of the pool at any point in its history.

**Emission is cheap where storage is not.** A ledger event is written once and never read by a contract again, so it costs no ongoing rent and counts against no read limit. Persisting the same record would cost storage that has to be maintained for as long as anyone might want the trail, which for zakat is indefinitely.

**The indexer is infrastructure and can fail.** It is a service reading the ledger and shaping it for a donor. If it goes down, the donor flow goes down with it.

**It cannot fail silently or dishonestly.** Every figure it renders resolves to a ledger entry with a transaction hash, shown to the donor next to the figure. If the indexer disappears the record does not. Rebuilding is not a casual re-run, though: RPC serves events over a bounded retention window, so a rebuild covering the full history reads from Stellar's history archives rather than from RPC, and the indexer ships with that ingestion path and open source in the same repository as the contracts. Continuous ingestion and the TTL-bump job are both owned by the delivery team through the pilot and handed to the Foundation with the runbook at mainnet launch, because an unowned scheduled job is the mechanism by which "nothing load-bearing is archived through disuse" quietly stops being true.

```
[Ledger event emitted] -> [Indexer reads the ledger] -> [Donor proof view]
```

*Every state the donor sees resolves to a transaction hash they can check themselves. The indexer is a convenience, not an authority.*

## Contribute and distribute

2 functions on `zakat_pool` move value. Everything else across the 3 contracts is configuration, and these 2 are what the audit is really about.

`contribute(donor, asset, amount)`

1. `require_auth` on the donor, and reject unless `amount` is positive
2. Reject unless `asset` is in `approved_assets`
3. Pull the asset from the donor via the Stellar Asset Contract, which authorises the transfer against the donor's own signature. No allowance or `transfer_from` path exists: a third party cannot move a donor's funds into a pool that has no refund path
4. Call `policy` for the split, and reject unless it returns exactly 8 amounts, each of them zero or positive, summing exactly to the amount received
5. Increment the category buckets with checked `i128` arithmetic
6. Emit a Contribution event carrying donor address, asset, amount, and the resulting split

**No authorisation gate.** Anyone may contribute. Gating contributions would require an onchain allowlist of donors, which means donor identity onchain, which the boundary forbids.

`distribute(recipient, asset, amount, category, attestation)`

1. `require_auth` on the distributor key, and reject if the distributor is disabled
2. Reject unless `amount` is positive, `asset` is in `approved_assets`, and the recipient is not the pool itself
3. Call `attestation` to verify the signature, which binds recipient, asset, category, amount, and the pool's distribution sequence
4. Check the category bucket holds `amount`
5. Decrement the bucket, then transfer, in that order
6. Emit a Disbursement event carrying the recipient address, the category, and the attestation hash

**Ordering.** Step 5 is checks-effects-interactions. Soroban's host rejects re-entering any contract already on the call stack, so this ordering is a backstop rather than the primary control. It is written this way regardless, because a contract whose safety depends on a platform guarantee reads as safe for the wrong reason, and because the pattern survives a future platform change that the assumption would not.

**Binding.** Step 2 is what makes this different from a multisig treasury. The money-mover cannot invent a recipient. The eligibility-signer cannot move money. What the signature covers is set out under replay on the security page.

## 3 roles, separated by design

| Role | Holds | Can | Cannot |
| --- | --- | --- | --- |
| Governance | 3-of-5 multisig | Deploy, pause contributions, disable the distributor, repoint `policy` and `attestation` and change parameters under timelock | Move funds. Sign eligibility |
| Distributor | Single operational key | Call `distribute` | Change policy. Create a valid attestation |
| Attestation authority | 2-of-3 multisig | Sign recipient eligibility off-chain | Move funds. Change policy |

The separation is the control, and the design assumes one key will eventually be compromised.

**A compromised distributor** produces failed transactions rather than stolen funds, because every distribution requires an attestation it cannot forge.

**A compromised attestation authority** produces signatures nobody executes, because it cannot call the contract.

**When each multisig arrives.** Governance is a multisig from deployment, because policy is the thing a donor is trusting, and the cost of that is a slower configuration change rather than slower development. The attestation authority becomes 2-of-3 before any mainnet distribution rather than on the first day of testnet, because holding a multisig during early iteration would slow work on a contract that at that stage holds no value. It is delivered and exercised on testnet, and live on mainnet before the first distribution.

## Who holds which key

**No seat is shared.** The distributor key is held by the delivery team. No delivery-team seat sits in the attestation quorum, whose 3 seats are the Foundation's Executive Director, the Shariah authority, and an independent seat appointed by the Foundation. That exclusion is on purpose: with a seat, the delivery team plus any one other signer would produce a valid attestation for any address and execute it in the same transaction, instantly and with no timelock, which would be a strictly easier path than anything described below. Without a seat, a delivery team that wants to move funds needs an attestation it cannot produce, and an attestation quorum that wants to move funds holds no key that can call `distribute`.

The Shariah authority holds a seat because eligibility is partly a category question, whether a recipient falls inside one of the 8, which is the same judgment the parameter gate already covers.

**Rotation is repointing:** The attestation contract has no setter for its key set: `authority` is fixed at construction. Changing the quorum means deploying a new attestation contract and repointing the pool at it, which puts key rotation under the same delay and the same events as every other governance change. The alternative, an in-place setter, would have been an instant path to a quorum of governance's choosing, defeating the delay it sits beside. This also removes a setter from the audit surface, and it means the mainnet attestation contract is constructed with the final 2-of-3 set rather than migrating into it.

**What sits behind the 7-day timelock:** repointing `policy` or `attestation`, approving an asset, and changing any Shariah parameter. Each emits an event at proposal and at execution, so the change is visible before it takes effect rather than after, and governance can cancel a queued change, which also emits. 2 things are deliberately instant: pausing contributions, because a brake that takes a week is not a brake, and disabling the distributor, for the same reason. A compromised operational key must be evictable in minutes, and a disabled distributor still cannot move funds without an attestation, so instant revocation costs nothing the delay was protecting.

**Limitations:** What remains is collusion between the Foundation and the delivery team, through governance repointing `attestation` to a permissive contract. That is the floor rather than an oversight: 2 organisations, 2 key sets, and no way to reduce it further without a third party holding neither. 2 things constrain it beyond the delay itself. The pilot runs with capped amounts, bounding the window between a visible proposal and a possible loss. And the delay is only worth its cost if someone is watching: a named party monitors the proposal, execution and cancellation events with an off-chain escalation path, because a timelock nobody observes is a delay rather than a control.

**One invariant governs the governance seats**, and it is the invariant rather than the roster that makes the paragraph above true: delivery-team seats must remain below the governance quorum threshold. Otherwise the floor is one organisation plus a 7-day wait rather than 2 organisations. Holder identities, seat allocation, and custody method are published with the mainnet deployment; the invariant is a design constraint from today.

*No single key completes a distribution. The party that decides who is eligible and the party that sends the money are different parties, holding different keys.*

## Assets

USDC through the Stellar Asset Contract. EURC through the same interface once the donor base asks for it.

Every Stellar asset has a contract address reserved for it, and the Stellar Asset Contract deployed there implements the SEP-41 token interface.[^11] The pool holds and moves regulated stablecoins through that interface, so there is no custom token logic anywhere in the codebase, and the same code path works for any asset that implements the standard.[^12]

**Transfer results are checked rather than assumed.** A transfer can fail on a missing trustline or an authorisation flag, and a failed transfer treated as a success is a silent accounting error inside a zakat obligation.

**EURC is a second denomination, not a second integration, and the accounting is built for it from the start.** Category balances are keyed by asset, so each approved asset carries its own 8 buckets and its own solvency invariant. The alternative, one set of buckets across 2 denominations, would be an accounting error rather than a shortcut: zakat owed in euros is not discharged by dollars at an implied rate the contract never agreed.

`approved_assets` is a set, and adding an address to it is a governance transaction. What that transaction cannot do is convert between denominations, and nothing in the contracts prices one asset against another. USDC comes first for donor demand and depth, and EURC follows because the Foundation's donor base and its partner organisations transact in euros and francs.

**The addresses are fixed before the pool is deployed, not chosen by it.** A Stellar Asset Contract address is derived deterministically from the asset and the network passphrase, so the USDC entry in `approved_assets` is a known constant on testnet and a different known constant on mainnet. Both are taken from Circle's published references rather than from a lookup at runtime, and both are written into the repository next to the deployment that uses them.[^13]

> **Inbound from other chains is Circle's problem, not the pool's.** Circle's CCTP is live on Stellar and moves native USDC in from other chains by burning at the source and minting at the destination, with no wrapped asset and no third-party bridge.[^4] A donor holding USDC elsewhere arrives on Stellar with real USDC, and the pool sees an ordinary SAC transfer. That is why there is no custom token contract, no wrapping, and no bridging logic anywhere inside the pool: the cross-chain path terminates before it reaches CipherPhi's code.

## The pilot flow

The pilot disburses directly from `zakat_pool` to a vetted partner-organisation address.

```
[Vetted by the Foundation] -> [Address confirmed out of band] -> [Attestation signed] -> [Transfer executed]
  Eligibility   Recipient address   Authority signature   zakat_pool
```

*The recipient of a pilot distribution is an organisation the Foundation has already vetted through its existing eligibility framework. The attestation signs that organisation's address and its category.*

**The recipient address is verified before it is used.** A Stellar account can only receive an asset it holds a trustline for, so a distribution to a partner organisation that has not established one fails rather than arriving. The transfer is atomic, so a failure consumes nothing and strands no attestation, but confirming the trustline is part of confirming the address rather than something discovered on the first real distribution.

**This is a deliberately narrow scope for a first mainnet distribution, because every additional component** between the pool and the recipient is a component that must be live, correct, and audited before a single real zakat payment can be made. Distribution to a partner organisation removes all of them. The organisation then reaches individual beneficiaries through the process it already runs, under annual audit, which is a process with a track record rather than a system built for this grant.

**The Stellar Disbursement Platform is the planned rail for individual-recipient payouts and fiat off-ramp in a later phase.**[^6] The choice comes from the fact that it already exists, is maintained by SDF for exactly this job, and is on SCF's own integration list, so reaching individual recipients later is an integration rather than a build. Nothing in the funded scope depends on it.

## The donor flow

A donor sees their contribution move through 4 states, and each one is read from a ledger event that carries the transaction hash which produced it.

```
[Contribution] -> [Transfer into custody] -> [Category split] -> [Disbursement and attestation]
  Received   Pooled   Allocated   Delivered
```

*A donor who wants to check the platform rather than trust it opens a Stellar explorer, finds their transaction, and reads the same events the interface read.*

*The interface is a rendering of public data.*

**Known limitations.** A donor sees that their category received a distribution to a verified recipient, not that their individual coins reached a named person. Zakat is pooled by construction, and the 8-category split is what the zakat methodology operates on, so per-donor tracing to an individual recipient would be a fiction dressed as cryptography. Category-level delivery, with a verifiable attestation on every disbursement, is the strongest true claim available, and this document makes that claim rather than a stronger false one.

## How a donor gets funded

Before anyone can contribute, they need a Stellar account, a USDC trustline, and USDC. Privy supplies only keys, and none of those 3.

**The account and the trustline are sponsored, so the donor never holds XLM.** Stellar's sponsored reserves let CipherPhi pay the base reserve for a new donor account and its USDC trustline, and fee-bump transactions cover the transaction fee on the same principle.[^14] A donor arriving with an email address and no prior wallet ends up USDC-ready without ever acquiring the native asset. Both are protocol features rather than components to build, and the sponsorship cost at pilot volume is a few XLM.

**Acquiring the USDC is the real boundary, and the pilot is scoped inside it.** Pilot donors arrive already holding USDC, whether from an exchange, a wallet, or another chain via CCTP. Privy still does the work that matters for them: it removes seed-phrase custody, which is the barrier for a donor who holds stablecoins but has never managed keys.

**How many such donors exist is measured.** This document does not claim a quantified population of stablecoin-holding donors inside the Foundation's base, because no survey has been run. Running one is an early delivery activity, and its output is a written report of how many donors were contacted, how many hold or can acquire USDC, and how many committed to the pilot. If that number comes back too small to run a donor-side pilot, the honest consequence is that the pilot demonstrates the distribution path with Foundation-originated contributions and the donor-acquisition question moves to the phase that funds an on-ramp.

**Fiat on-ramp is a later phase:** Reaching a donor who holds only Swiss francs means a SEP-24 anchor converting fiat to USDC on Stellar, which is exactly the interface anchors exist to provide. It is mentioned in the building blocks table as planned, and the trigger for commissioning it is demonstrated pilot demand from donors who cannot self-fund.

## Onboarding

Privy provides the embedded email and social wallet, so a donor who holds stablecoins but has never managed a seed phrase contributes without one. It is listed among the wallet integrations in Stellar's own developer tooling documentation.[^15] Integration is estimated at under one day.

Seed-phrase custody is the barrier that stops a mainstream donor base from ever reaching the contract, and no amount of contract quality compensates for it. Privy is the shortest path across that barrier at pilot scale.

## The data and privacy boundary

The platform holds recipient personal data, and none of it is written to the Stellar ledger. The ledger holds addresses, amounts, and attestation hashes.

**On-chain:**

- Pooled custody and category balances
- Configuration and allocation policy
- Contribution and disbursement events
- One attestation hash per disbursement
- Addresses only

**Off-chain:**

- Donor identity and KYC
- Recipient identity and eligibility evidence
- The human Shariah sign-off
- The attestation-signing service
- The indexer and the recipient registry

**Erasure.** An immutable ledger and a right to erasure are usually presented as an unresolved tension. They are only in tension if personal data goes onto the ledger, so it does not. Erasure operates against the off-chain registry, which is where every piece of personal data lives. What remains onchain afterwards is an address, an amount, and a hash.

**Contributions are open, and screening is the Foundation's existing obligation.** Anyone may contribute, because gating the contract would put donor identity onchain. That does not make the donor anonymous to the institution: the Foundation carries Swiss anti-money-laundering duties on the funds it receives, and the donor records, screening, and source-of-funds handling that satisfy them sit in the same off-chain registry as everything else on this page, applied to onchain contributions exactly as to bank transfers. The contract's openness is a privacy decision about the ledger, not a decision to stop looking.

**What the contract cannot do, stated rather than promised around.** Screening happens in the application before a contribution transaction is built, which covers every donor who arrives through CipherPhi. A contributor who bypasses the application and calls the contract directly cannot be refused, because the entry point is open by design, and cannot be refunded, because `contribute` and `distribute` remain the only 2 functions that move value. For that case the position is accept and report rather than return, agreed in writing with the Foundation's compliance adviser and produced before mainnet. Documenting a return path the bytecode does not have would be worse than naming the limit.

The Swiss Zakat Foundation already runs recipient files this way under Swiss federal supervision, with document verification and confidential beneficiary communication. Recipient identities are protected by that existing process, and CipherPhi does not weaken it by putting any part of it onchain.

## Shariah parameters are contract configuration

The rules of zakat are parameters held in governed contract state, each validated before mainnet distribution.

| Parameter | What it sets |
| --- | --- |
| Nisab basis | Gold or silver standard, and the price source and timestamp used |
| Amil cap | The ceiling on the administration share, against the collected total |
| Discharge timing | The point at which the donor's obligation is treated as discharged |
| Category split | The distribution across the 8 zakat categories |
| Per-partner split | The allocation to a specific partner organisation within a category |

The rules are not ours to invent. Encoding one as a constant in Rust would mean that any refinement requires a redeployment, and it would put a technical team in the position of having settled a methodological question by writing it down. Holding them as governed parameters puts the methodology where it belongs, with the person qualified to set it, and leaves the contract responsible only for enforcing whatever that person sets. The Swiss Zakat Foundation publishes its methodology in full, so the parameter set has a documented starting point rather than a blank one.[^16]

**The parameter set is held through validation by our Shariah authority**, Muhammad Emamally, halal investment advisor. That validation is a gate: no distribution occurs on mainnet until it is given, recorded, and matched against the parameter set actually loaded on the contract. That match is a checkable item before the first mainnet distribution.

> **On the scope of that authority**
>
> This is one qualified advisor validating a parameter set for a controlled pilot with one partner organisation. It is not a standing Shariah board, and this document does not claim one. An independent board with formal scrutiny is planned as the platform moves beyond pilot scale, and it is named as planned rather than present because a reviewer who later discovered the difference would be right to discount everything else in this document. The trigger for standing it up is the first distribution beyond the pilot partner.

## Security model

Every control below maps to a named category in the OWASP Smart Contract Top 10 for 2026, which is compiled from 2025 incident data.[^17] The point of the mapping is that none of these are exotic: the categories that cost the most are mundane, and the design closes them by construction rather than by vigilance.

**Access control, the costliest 2025 category at USD 953 million in losses.** 3 separated roles behind `require_auth`: governance sets policy, a distributor moves funds, an attestation authority signs eligibility, and no single key does 2 of those. Governance is a multisig from deployment; the attestation authority is 2-of-3 before mainnet. The keys that can move money cannot change the rules, and the keys that set the rules cannot move money.

**Input validation, 34.6% of direct contract exploits, the class behind the Aftermath, Singularity, and Ekubo losses.** These are setters that never enforce the value range the rest of the contract assumes. Every parameter `policy` accepts is bounds-checked at the setter: the category split must sum to unity, the amil cap sits in an allowed band, no fee or ratio is stored unvalidated. A value the contract cannot honour is rejected on the way in, not discovered on the way out.

**Arithmetic and integer overflow, the Aftermath pattern where a fee read at the wrong signedness became a rebate.** Signed-integer and fixed-point operations are checked throughout, so an overflow, an underflow, or a rounding remainder is a failed transaction rather than a wrong balance. The 8-way split returns amounts that sum exactly to the amount received, with any remainder assigned deterministically rather than dropped. Which category receives it is a configured parameter validated by the Shariah authority alongside the others, not a choice the implementation makes on its own. No value crosses between signed and unsigned representations without an explicit checked conversion.

**Business logic, the solvency invariant.** After every state change, the sum of the 8 category balances must not exceed the pool's actual token balance, asserted inside `contribute` and `distribute` rather than off-chain. Buckets change only through `contribute`, so a direct token transfer to the contract address cannot corrupt the accounting; it can only leave a surplus that is visible and, in this build, unspendable. There is no recovery path and therefore no third function that moves value: `contribute` and `distribute` remain the only 2.

**Reentrancy and unchecked external calls, GMX V1 lost USD 42 million to reentrancy in 2025.** The control here is structural: neither `policy` nor `attestation` holds any address that lets it call back into the pool, the pool treats their return values as untrusted input, and every fund-moving path is written checks-effects-interactions. Soroban's host additionally rejects re-entering any contract already on the call stack, and that platform rule is treated as a backstop rather than as the control. SAC transfer results are checked, never assumed, since a failed transfer treated as success is a silent accounting error.

**Replay, closed with single-use attestations.** The signed payload binds recipient, asset, category, amount, the pool's distribution sequence, the pool's contract address, and the network passphrase. Sequence binding means a valid signature executes exactly once, with no growing list of used signatures to store, and each attestation also carries a ledger after which it expires unused. 2 consequences worth stating rather than discovering: attestations execute in the order they were signed, so one abandoned at sequence N strands those signed after it until they are reissued, and an attestation that is never executed stops being live at its expiry rather than remaining valid indefinitely. At pilot cadence, a handful of distributions to one partner organisation, serial execution is the behaviour you want. At scale it is a constraint on throughput and is named here as one. Asset binding means a signature authorising an amount in USDC cannot be presented once EURC is approved. Address and passphrase binding mean a signature is useless against a different deployment or on testnet.

### Controls, continued

**Cross-contract trust boundaries.** `zakat_pool` pins the addresses of `policy` and `attestation` in governance-controlled storage and treats both as untrusted. An allocation is rejected unless the returned vector is exactly 8 elements, each zero or positive, summing exactly to the amount received; a sum-only check would admit a split with a negative element that corrupts the category accounting while leaving total custody correct. A distribution is rejected unless the attestation verifies. Neither callee can call back into the pool, so no defect in either can move funds.

**Pause, without reintroducing mutable code.** Governance can halt `contribute`. It cannot halt `distribute`, alter balances, or move funds, and it still cannot replace the custody Wasm. Immutable code and an emergency stop are separable properties, and only one of them should be given up: if a defect surfaces after launch, the pool must stop taking new contributions while remediation runs, rather than filling up because the only alternative was an upgrade key.

**Storage bounds.** Only configuration and the per-asset balance buckets are persistent across the 3 contracts, with a TTL-bump strategy on every entry, no unbounded maps, and no per-transaction iteration over a collection. Nothing any contract reads grows with usage, so read limits stay clear as the pool fills.

## Assurance

Independent security review is requested through the SCF Soroban Audit Bank, which schedules audits for SCF-funded projects with vetted firms.[^18] It is entered well before the mainnet deployment so that findings land with time to fix them, rather than colliding with launch.

**Audit findings remediation.** The programme's rules put a twenty business day window on resolving critical, high and medium findings, and publish the final report once resolution is verified.[^19] The delivery plan leaves at least that much room between entering review and the mainnet deployment, which is why review is entered early rather than late.

**Fuzzing.** `cargo-fuzz` runs on the fund-moving paths, targeting `contribute` and `distribute` specifically, since those are the 2 functions where a malformed input becomes a balance error. Fuzzing is first-class in the Stellar toolchain: the SDK ships `arbitrary` support for contract types, and the official guide covers cargo-fuzz, property tests, and mutation testing.[^20]

**Deployment preconditions (checked onchain before the pool holds anything):** All 3 contracts initialise through `__constructor` with their configuration passed at deploy, so no separately callable initialiser exists in any binary and there is no window in which an uninitialised contract can be captured. The multisig properties are account configuration rather than contract code, and a contract cannot see them, so they are verified rather than assumed: the governance account carries 5 signers and a medium threshold of 3 with the master key weighted zero, and the attestation authority carries 3 signers and a threshold of 2 on the same basis. A default-configured Stellar account authorises on a single signature regardless of how many signers it lists, which would make every multisig claim in this document quietly false. Both accounts are read from the ledger and asserted before the first contribution.

**Toolchain:** The artifact under review is built with `stellar contract build` on Rust 1.84 or newer for the `wasm32v1-none` target, the only Wasm target the Soroban runtime supports, against the soroban-sdk 27 line, matching Protocol 27 on mainnet.[^21] The SDK's major version tracks the protocol version, so the pin follows the network rather than a release calendar. The SDK's own guidance is that contracts are not built with a bare `cargo build`, and the SEP-58 pipeline reproduces the deployed Wasm hash from the same pinned inputs. The exact versions live in the repository, in `rust-toolchain.toml` and `Cargo.lock`, so an auditor reads the pins from the source of truth and this document commits to their being pinned rather than floating. Stellar has been upgrading protocols roughly every 2 months, and this build will very likely deploy onto a network one version ahead of the SDK it was audited against, which the SDK supports. The pin is therefore reviewed twice, on entering security review and again before mainnet deployment. The signing tooling is held to the same discipline, because the authorisation credential format is itself mid-migration. Protocol 27 introduced a second one, CAP-71's address-bound `SOROBAN_CREDENTIALS_ADDRESS_V2`, alongside the original `SOROBAN_CREDENTIALS_ADDRESS`; both are valid, the CAP deprecates neither, and it names the original as a candidate for removal in a later protocol.[^22] The client SDKs have already begun defaulting to the new format. Every `require_auth` signature is therefore built from the preimage the authorisation entry carries rather than against a hardcoded envelope type, which leaves a future deprecation an SDK upgrade rather than a signing rewrite.

The audit report is published with the mainnet deployment, and every finding is either fixed or accepted with written reasoning. A reviewer can read both.

> No formal verification, and no bug bounty programme at launch. Formal verification of a contract this size returns less than a thorough manual audit plus fuzzing at this stage, and a bounty with no live value to protect attracts noise rather than researchers. The trigger for a bounty is a pool balance large enough to be worth attacking, which is the same moment it starts paying for itself. What is not deferred is the layered testing the same sources call for: unit tests, fuzz tests, and invariant tests over the solvency property above, run in CI rather than at milestones.

## Not in this build

Each line is a decision with a stated trigger, rather than something nobody considered. A reviewer can disagree with any line here, which is the point of writing them down.

| Not built | Why not, and what would change it |
| --- | --- |
| **In-place code upgrade on custody** | Soroban lets a contract replace its own Wasm while the address persists. `zakat_pool` omits that entry point; policy and attestation are repointable because they hold nothing. Custody changes only by new deployment and visible migration |
| **Stellar Disbursement Platform** | The pilot pays a vetted partner organisation directly, which removes a live dependency from the first mainnet distribution. Planned rail for individual payouts and fiat off-ramp, later phase |
| **Individual-recipient payouts** | Require SDP, recipient-level onboarding, and an off-ramp, none of which the pilot needs in order to prove the model |
| **Onchain governance voting** | Governance is a multisig held by an accountable Swiss foundation under federal supervision. A token vote would be less accountable, not more |

### Not in this build, continued

| Not built | Why not, and what would change it |
| --- | --- |
| **Per-contribution onchain storage** | Events plus an open-source indexer give the same trace without an unbounded storage growth path |
| **zk or decentralised identity** | Off-chain records plus an onchain signed attestation is the correct design at this scale. Revisit when recipient count makes the registry itself a target |
| **Native mobile applications** | The donor path is a responsive web application. Privy removes the wallet-app dependency that would otherwise force native |
| **Multi-chain deployment** | Stellar is the settlement layer, not one of several. Deploying elsewhere would fragment the pool, which defeats pooled zakat |
| **Surplus recovery** | A direct transfer to the pool address leaves a visible, unspendable surplus. A recovery path is a third value-moving function, which the audit scope does not need at pilot size. Revisit if a surplus large enough to matter accumulates |
| **Issuer recourse** | Stellar USDC is issued with authorisation revocable, so Circle can freeze a holder's balance, including a contract's. Clawback is not enabled on the asset, so the solvency invariant cannot be violated from outside, but a freeze would halt distribution with no remediation in our bytecode. Accepted rather than designed around at pilot size: the response is to pause contributions and escalate to the issuer, and issuer flags are reviewed as part of approving any asset |
| **Commodity-backed assets** | Nisab is measured as a weight of gold, but a threshold test for whether zakat is owed does not imply payment in the same asset. A pool holding gold would pass price movement between the obligation and its delivery, and would hand recipients an asset they must sell before they can spend it. Tether Gold is named on the Stellar building blocks roadmap; the trigger is Stellar-native issuance, and per-asset accounting already accommodates it as a governance transaction |
| **Fiat on-ramp** | Pilot donors arrive holding USDC. Reaching a franc-only donor is a SEP-24 anchor integration, triggered by demonstrated pilot demand from donors who cannot self-fund |
| **Standing Shariah board** | One qualified advisor validates the pilot parameter set. A board is planned for scale beyond the pilot partner, and is not claimed as present |

## Stellar building blocks

CipherPhi composes vetted Stellar infrastructure around one custom contract rather than rebuilding it. The status column separates what is funded from what is not, and that separation is enforced everywhere in this document.

The indexer depends on one property in particular: because the Stellar Asset Contract implements SEP-41, asset movements surface the same standardised transfer events whether they originate from a payment operation or from a contract call, so an indexer observes the whole trail through one uniform interface.[^23]

| Building block | Role in CipherPhi | Status |
| --- | --- | --- |
| Soroban smart contracts | 3 contracts: pooled custody, allocation policy, attestation verification. The core IP | Committed |
| Stellar Asset Contract, SEP-41 | Hold and move USDC, later EURC, with no custom token logic | Committed |
| Stellar authorisation and multisig | `require_auth` role separation. Attestation authority as 2-of-3, distinct from the distributor | Committed |
| Stellar ledger events and RPC | The donor proof view, reconstructed from ledger events by an open-source indexer | Committed |
| Privy | Embedded email and social wallet, so a donor holding stablecoins contributes without managing a seed phrase | Committed |
| SCF Soroban Audit Bank | Independent security review of the contract before mainnet | Committed |
| Stellar Disbursement Platform | Rail for individual-recipient payouts and fiat off-ramp once the pilot expands beyond partner organisations | Planned |
| EURC via SAC | Second approved asset with its own category buckets, added by governance transaction | Planned |
| Tether Gold (XAUT) | Gold-denominated approved asset with its own category buckets, contingent on Stellar-native issuance; wrapped or bridged representations stay out | Planned |
| SEP-24 anchor | Fiat on-ramp so a donor holding only francs or euros can acquire USDC on Stellar | Planned |
| Sponsored reserves | CipherPhi pays account and trustline reserves, so a donor never holds XLM | Committed |
| Circle CCTP | Native inbound USDC from other chains, terminating before CipherPhi's code | Live on Stellar |

---

## References

[^1]: HAQQ, Evergreen DAO endowment mechanism. [haqq.network/shariah-compliance-en](https://haqq.network/shariah-compliance-en)
[^2]: Zakat Coin, donor-facing zakat platform. [zktcoin.com](https://zktcoin.com)
[^3]: A blockchain based decentralized zakat collection and distribution platform. [dl.acm.org/doi/10.1145/3641067.3641071](https://dl.acm.org/doi/10.1145/3641067.3641071)
[^4]: CCTP on Stellar, maintained by Circle. [developers.stellar.org/docs/tokens/cross-chain-transfers](https://developers.stellar.org/docs/tokens/cross-chain-transfers)
[^5]: Resource limits, fees and metering. [developers.stellar.org/docs/networks/resource-limits-fees](https://developers.stellar.org/docs/networks/resource-limits-fees)
[^6]: Stellar Disbursement Platform. [developers.stellar.org/docs/platforms/stellar-disbursement-platform](https://developers.stellar.org/docs/platforms/stellar-disbursement-platform)
[^7]: Upgrading contract Wasm in place, and the system event it emits. [developers.stellar.org/docs/build/guides/conventions/upgrading-contracts](https://developers.stellar.org/docs/build/guides/conventions/upgrading-contracts)
[^8]: Soroban state archival and TTL. [developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival](https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage/state-archival)
[^9]: Soroban storage types and expiry behaviour. [developers.stellar.org/docs/build/guides/storage/choosing-the-right-storage](https://developers.stellar.org/docs/build/guides/storage/choosing-the-right-storage)
[^10]: Contract events, emission and retention. [developers.stellar.org/docs/build/guides/events](https://developers.stellar.org/docs/build/guides/events)
[^11]: Stellar Asset Contract and SEP-41. [developers.stellar.org/docs/tokens/stellar-asset-contract](https://developers.stellar.org/docs/tokens/stellar-asset-contract)
[^12]: SEP-41 token interface specification. [github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
[^13]: CCTP and USDC contract addresses on Stellar. [developers.circle.com/cctp/references/stellar](https://developers.circle.com/cctp/references/stellar)
[^14]: Sponsored reserves and fee-bump transactions. [developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/sponsored-reserves](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/sponsored-reserves)
[^15]: Stellar wallet integrations, including Privy. [developers.stellar.org/docs/tools/developer-tools/wallets](https://developers.stellar.org/docs/tools/developer-tools/wallets)
[^16]: Swiss Zakat Foundation methodology. [zakat.ch/knowledge-base/faq](https://zakat.ch/knowledge-base/faq)
[^17]: OWASP Smart Contract Top 10 for 2026, from 2025 incident data. [owasp.org/www-project-smart-contract-top-10](https://owasp.org/www-project-smart-contract-top-10)
[^18]: Soroban Security Audit Bank. [stellar.org/grants-and-funding/soroban-audit-bank](https://stellar.org/grants-and-funding/soroban-audit-bank)
[^19]: Audit Bank rules, remediation and publication. [stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules](https://stellar.gitbook.io/scf-handbook/supporting-programs/audit-bank/official-rules)
[^20]: Fuzzing Soroban contracts, official guide. [developers.stellar.org/docs/build/guides/testing/fuzzing](https://developers.stellar.org/docs/build/guides/testing/fuzzing)
[^21]: Soroban Rust SDK, supported target and build guidance. [github.com/stellar/rs-soroban-sdk](https://github.com/stellar/rs-soroban-sdk)
[^22]: CAP-71-02, address-bound Soroban address credentials. [github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md](https://github.com/stellar/stellar-protocol/blob/master/core/cap-0071-02.md)
[^23]: Standardised asset events under SEP-41. [developers.stellar.org/docs/tokens/anatomy-of-an-asset](https://developers.stellar.org/docs/tokens/anatomy-of-an-asset)
