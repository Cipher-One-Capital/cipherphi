// SPDX-License-Identifier: Apache-2.0

use cipherphi_interface::{Allocation, Category, Parameters};
use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN, Vec};

/// Configuration is instance storage, sharing the contract's lifetime. Only the
/// per-asset balances are keyed separately. Nothing here is temporary storage,
/// where a queued change could vanish mid-timelock.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Governance,
    Distributor,
    PolicyAddr,
    AttestAddr,
    ApprovedAssets,
    DistributionSeq,
    Paused,
    DistributorDisabled,
    TimelockLedgers,
    PendingChange,
    /// Persistent: the 8 buckets of one approved asset.
    CategoryBalances(Address),
}

/// A governance change that waits out the timelock.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Change {
    SetPolicy(Address),
    SetAttestation(Address),
    ApproveAsset(Address),
    SetAllocation(Allocation),
    SetParameters(Parameters),
    /// Replace the distributor and lift a disable.
    SetDistributor(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingChange {
    pub change: Change,
    /// The change may execute in any ledger after this one.
    pub execute_after: u32,
}

/// One variant per refusal, so a failed transaction says which door was wrong.
/// Numbers carried over from the demo keep their meaning.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Non-positive contribution or payout amount.
    InvalidAmount = 2,
    /// `policy` returned something other than 8 non-negative amounts summing
    /// exactly to the amount received.
    InvalidAllocation = 3,
    /// Checked arithmetic said no.
    Overflow = 4,
    /// The arguments disagree with the attestation.
    AttestationMismatch = 5,
    /// The attestation names a different deployment.
    WrongPool = 6,
    /// The attestation was signed for a different network.
    WrongNetwork = 7,
    /// The attestation names a different asset from the one being paid.
    WrongAsset = 8,
    /// `expiry_ledger` is at or behind the current ledger.
    Expired = 9,
    /// Replay, or a sequence from the future.
    SequenceMismatch = 10,
    /// A signature index outside the authority vector.
    UnknownSigner = 11,
    /// Fewer than the threshold of distinct authority keys signed.
    ThresholdNotMet = 12,
    /// The category bucket does not hold the amount.
    InsufficientBucket = 13,
    /// The buckets claim more than the pool holds.
    Insolvent = 14,
    /// The payout recipient is the pool itself.
    SelfDistribution = 16,
    /// The asset is not in `approved_assets`.
    AssetNotApproved = 17,
    /// Contributions are paused.
    ContributionsPaused = 18,
    /// The distributor is disabled.
    DistributorDisabled = 19,
    /// The constructor was given a delay under 7 days.
    TimelockTooShort = 20,
    /// One change is already queued.
    ChangeAlreadyPending = 21,
    /// No change is queued.
    NoPendingChange = 22,
    /// The ledger has not passed the change's `execute_after`.
    TimelockNotElapsed = 23,
    /// `attestation` refused or returned nonsense: a bad signature, for one.
    AttestationRejected = 24,
    /// The token moved a different amount from the one asked for.
    TransferShortfall = 25,
    /// The asset is already approved.
    AssetAlreadyApproved = 26,
    /// `policy` refused a queued value.
    PolicyRefused = 27,
    /// Governance and the distributor would be the same address.
    RolesOverlap = 28,
    /// The `policy` being pointed to does not name this pool as its controller.
    PolicyControllerMismatch = 29,
}

/// Emitted by `contribute`. Carries the whole split, 8 amounts in [`Category`]
/// order, so a reader with only the event stream can rebuild every balance.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contribution {
    #[topic]
    pub donor: Address,
    #[topic]
    pub asset: Address,
    pub amount: i128,
    pub split: Vec<i128>,
}

/// Emitted by `distribute`. `attestation_hash` is the SHA-256 of the XDR the
/// authority keys signed.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Disbursement {
    #[topic]
    pub recipient: Address,
    #[topic]
    pub category: Category,
    pub asset: Address,
    pub amount: i128,
    pub sequence: u64,
    pub attestation_hash: BytesN<32>,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChangeProposed {
    pub change: Change,
    pub execute_after: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChangeExecuted {
    pub change: Change,
    pub execute_after: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ChangeCancelled {
    pub change: Change,
    pub execute_after: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionsPaused {}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContributionsResumed {}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DistributorDisabled {}
