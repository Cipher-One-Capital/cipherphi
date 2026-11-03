// SPDX-License-Identifier: Apache-2.0

//! What the three CipherPhi contracts agree on: the shared types, and the two
//! interfaces `zakat_pool` calls. `zakat_pool` links only this crate, never the
//! other contracts, so their code cannot reach the custody Wasm and it treats
//! whatever answers at the pinned addresses as untrusted.

#![no_std]

use soroban_sdk::{contractclient, contracterror, contracttype, Address, BytesN, Env, Vec};

/// Number of zakat categories, and of elements in every split.
pub const CATEGORY_COUNT: u32 = 8;
/// A split sums to this many basis points.
pub const BPS_TOTAL: u32 = 10_000;

/// The eight zakat categories of Qur'an 9:60, in the order the verse names
/// them. Events and views report balances in this order.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Category {
    /// al-fuqara, the poor
    Poor = 0,
    /// al-masakin, the needy
    Needy = 1,
    /// al-amilina alayha, those who administer zakat
    Administrators = 2,
    /// al-muallafati qulubuhum, those whose hearts are to be reconciled
    Reconciliation = 3,
    /// fi al-riqab, freeing captives
    Captives = 4,
    /// al-gharimin, those in debt
    Debtors = 5,
    /// fi sabilillah, in the cause of God
    CauseOfGod = 6,
    /// ibn al-sabil, the wayfarer
    Wayfarers = 7,
}

/// The off-chain approval. XDR-serialized, and those bytes are what the
/// authority keys sign, so every field is bound by the signature. The encoding
/// is the demo's, unchanged: see `test_vectors/attestation.json`.
///
/// | Field | What an attacker gets if it is not bound |
/// | --- | --- |
/// | `recipient` | A valid attestation, redirected. |
/// | `asset` | A signature approved for one token, spent in another. |
/// | `category` | A signature approved against one bucket, drawn from another. |
/// | `amount` | The number raised after signing, before submission. |
/// | `sequence` | Replay. |
/// | `expiry_ledger` | An approval that never lapses. |
/// | `pool` | The same signature, valid against a second deployment. |
/// | `network_id` | A testnet approval, replayed against mainnet. |
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Attestation {
    pub recipient: Address,
    pub asset: Address,
    pub category: Category,
    pub amount: i128,
    pub sequence: u64,
    pub expiry_ledger: u32,
    pub pool: Address,
    pub network_id: BytesN<32>,
}

/// One authority signature, as (position in the authority vector, signature).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignerSig {
    pub index: u32,
    pub signature: BytesN<64>,
}

/// The `attestation` argument of `distribute`: the payload and its signatures.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignedAttestation {
    pub payload: Attestation,
    pub signatures: Vec<SignerSig>,
}

/// The category split. A placeholder until the Shariah authority validates it.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Allocation {
    /// Basis points per category, in [`Category`] order, summing to 10,000.
    pub split_bps: Vec<u32>,
    /// The category that absorbs the rounding remainder.
    pub remainder: Category,
}

/// Gold or silver standard. The price source and timestamp are the app's, and
/// are shown beside the figure they produce.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NisabBasis {
    Gold = 0,
    Silver = 1,
}

/// The point at which a donor's obligation is treated as discharged.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DischargeTiming {
    Received = 0,
    Allocated = 1,
    Delivered = 2,
}

/// The Shariah parameters other than the split. Placeholders until validated.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Parameters {
    pub nisab_basis: NisabBasis,
    /// Zakat rate in basis points. The app's calculator reads it from here.
    pub rate_bps: u32,
    /// Ceiling on the administrators' share, in basis points.
    pub amil_cap_bps: u32,
    pub discharge_timing: DischargeTiming,
}

/// The refusals of `attestation.verify`. The numbers match the pool's own.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AttestationError {
    /// Threshold of zero, or above the key count.
    InvalidThreshold = 1,
    /// A signature index outside the authority vector.
    UnknownSigner = 11,
    /// Fewer than `threshold` distinct authority keys signed.
    ThresholdNotMet = 12,
    /// The same key appears twice in the constructor's key vector.
    DuplicateAuthorityKey = 15,
}

/// What `zakat_pool` needs from `policy`.
#[contractclient(name = "PolicyClient")]
pub trait PolicyInterface {
    /// Split `amount` into 8 amounts in [`Category`] order.
    fn allocate(env: Env, amount: i128) -> Vec<i128>;
    /// Replace the split. Authorised by the policy's controller.
    fn set_allocation(env: Env, allocation: Allocation);
    /// Replace the parameters. Authorised by the policy's controller.
    fn set_parameters(env: Env, parameters: Parameters);
    /// The one address the setters answer to.
    fn controller(env: Env) -> Address;
}

/// What `zakat_pool` needs from `attestation`.
#[contractclient(name = "AttestationClient")]
pub trait AttestationInterface {
    /// Succeed only if a quorum of the authority signed `payload`'s XDR.
    fn verify(
        env: Env,
        payload: Attestation,
        signatures: Vec<SignerSig>,
    ) -> Result<(), AttestationError>;
}
