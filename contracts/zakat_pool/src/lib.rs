// SPDX-License-Identifier: Apache-2.0

//! # zakat_pool
//!
//! Custody, the 8 category balances per asset, and the only 2 entry points that
//! move value. It has no `update_current_contract_wasm` call, so its code cannot
//! be replaced: a change to custody is a new deployment and a visible migration.
//!
//! `policy` and `attestation` are pinned here and treated as untrusted. A split
//! is rejected unless it has exactly 8 elements, each zero or positive, summing
//! exactly to the amount received. A payout is rejected unless the attestation
//! verifies, and this contract checks every binding itself rather than relying
//! on the verifier to have looked.
//!
//! Neither value-moving function extends a TTL. Rent is paid by the scheduled
//! job from the treasury, so it can never land on a donor's transaction.
//!
//! Testnet only, and unaudited. See `ARCHITECTURE.md`.

#![no_std]

#[cfg(test)]
mod test;

mod types;

pub use cipherphi_interface::{Attestation, Category, SignedAttestation, SignerSig};
pub use types::*;

use cipherphi_interface::{AttestationClient, AttestationError, PolicyClient, CATEGORY_COUNT};
use soroban_sdk::{contract, contractimpl, token, xdr::ToXdr, Address, Env, Vec};

/// 7 days at 5 seconds a ledger. A constructor cannot set a shorter delay.
pub const MIN_TIMELOCK_LEDGERS: u32 = 120_960;

#[contract]
pub struct ZakatPool;

#[contractimpl]
impl ZakatPool {
    /// Runs once, atomically with deployment, so there is no separately callable
    /// initialiser and no window in which the pool can be captured.
    pub fn __constructor(
        env: Env,
        governance: Address,
        distributor: Address,
        policy: Address,
        attestation: Address,
        asset: Address,
        timelock_ledgers: u32,
    ) -> Result<(), Error> {
        governance.require_auth();

        if timelock_ledgers < MIN_TIMELOCK_LEDGERS {
            return Err(Error::TimelockTooShort);
        }
        if governance == distributor {
            return Err(Error::RolesOverlap);
        }

        let storage = env.storage().instance();
        storage.set(&DataKey::Governance, &governance);
        storage.set(&DataKey::Distributor, &distributor);
        storage.set(&DataKey::PolicyAddr, &policy);
        storage.set(&DataKey::AttestAddr, &attestation);
        storage.set(&DataKey::DistributionSeq, &0u64);
        storage.set(&DataKey::Paused, &false);
        storage.set(&DataKey::DistributorDisabled, &false);
        storage.set(&DataKey::TimelockLedgers, &timelock_ledgers);

        let mut assets = Vec::new(&env);
        assets.push_back(asset.clone());
        storage.set(&DataKey::ApprovedAssets, &assets);
        env.storage()
            .persistent()
            .set(&DataKey::CategoryBalances(asset), &empty_buckets(&env));
        Ok(())
    }

    // --- the two functions that move value ---------------------------------

    /// Pay into the pool. Anyone may; gating this would put donor identity on
    /// chain.
    pub fn contribute(env: Env, donor: Address, asset: Address, amount: i128) -> Result<(), Error> {
        donor.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if flag(&env, &DataKey::Paused) {
            return Err(Error::ContributionsPaused);
        }
        if !Self::is_approved(env.clone(), asset.clone()) {
            return Err(Error::AssetNotApproved);
        }

        // Transfer before credit: a bucket credited before the money arrives is
        // a state that should never exist, even transiently.
        let pool = env.current_contract_address();
        let token = token::Client::new(&env, &asset);
        let held_before = token.balance(&pool);
        token.transfer(&donor, &pool, &amount);
        if token.balance(&pool).checked_sub(held_before) != Some(amount) {
            return Err(Error::TransferShortfall);
        }

        let split = allocation(&env, amount)?;
        let mut buckets = Self::balances(env.clone(), asset.clone());
        for index in 0..CATEGORY_COUNT {
            let credited = buckets
                .get_unchecked(index)
                .checked_add(split.get_unchecked(index))
                .ok_or(Error::Overflow)?;
            buckets.set(index, credited);
        }
        env.storage()
            .persistent()
            .set(&DataKey::CategoryBalances(asset.clone()), &buckets);

        assert_solvent(&env, &asset, &buckets)?;

        Contribution {
            donor,
            asset,
            amount,
            split,
        }
        .publish(&env);
        Ok(())
    }

    /// Pay out of the pool against a quorum-signed attestation.
    ///
    /// Not stopped by the contribution pause: a pause must not strand what the
    /// pool already holds.
    pub fn distribute(
        env: Env,
        recipient: Address,
        asset: Address,
        amount: i128,
        category: Category,
        attestation: SignedAttestation,
    ) -> Result<(), Error> {
        // 1. The distributor, and not disabled.
        Self::distributor(env.clone()).require_auth();
        if flag(&env, &DataKey::DistributorDisabled) {
            return Err(Error::DistributorDisabled);
        }

        // 2. The arguments.
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if !Self::is_approved(env.clone(), asset.clone()) {
            return Err(Error::AssetNotApproved);
        }
        let pool = env.current_contract_address();
        if recipient == pool {
            return Err(Error::SelfDistribution);
        }

        // 3. The attestation. Every binding is checked here, each with its own
        //    error, and only then is the verifier consulted.
        let SignedAttestation {
            payload,
            signatures,
        } = attestation;
        if payload.recipient != recipient
            || payload.category != category
            || payload.amount != amount
        {
            return Err(Error::AttestationMismatch);
        }
        if payload.pool != pool {
            return Err(Error::WrongPool);
        }
        if payload.network_id != env.ledger().network_id() {
            return Err(Error::WrongNetwork);
        }
        if payload.asset != asset {
            return Err(Error::WrongAsset);
        }
        if payload.expiry_ledger <= env.ledger().sequence() {
            return Err(Error::Expired);
        }
        let sequence = Self::distribution_seq(env.clone());
        if payload.sequence != sequence {
            return Err(Error::SequenceMismatch);
        }
        verify(&env, &payload, &signatures)?;

        // 4. The bucket holds the amount.
        let index = category as u32;
        let mut buckets = Self::balances(env.clone(), asset.clone());
        let balance = buckets.get_unchecked(index);
        if balance < amount {
            return Err(Error::InsufficientBucket);
        }

        // 5. Decrement, then transfer.
        buckets.set(index, balance.checked_sub(amount).ok_or(Error::Overflow)?);
        env.storage()
            .persistent()
            .set(&DataKey::CategoryBalances(asset.clone()), &buckets);
        env.storage().instance().set(
            &DataKey::DistributionSeq,
            &sequence.checked_add(1).ok_or(Error::Overflow)?,
        );

        let token = token::Client::new(&env, &asset);
        let held_before = token.balance(&pool);
        token.transfer(&pool, &recipient, &amount);
        if held_before.checked_sub(token.balance(&pool)) != Some(amount) {
            return Err(Error::TransferShortfall);
        }

        assert_solvent(&env, &asset, &buckets)?;

        // 6. The event.
        Disbursement {
            recipient,
            category,
            asset,
            amount,
            sequence,
            attestation_hash: env.crypto().sha256(&payload.to_xdr(&env)).to_bytes(),
        }
        .publish(&env);
        Ok(())
    }

    // --- instant controls ----------------------------------------------------

    /// Stop new contributions at once. Payouts are unaffected.
    pub fn pause_contributions(env: Env) {
        Self::governance(env.clone()).require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        ContributionsPaused {}.publish(&env);
    }

    pub fn resume_contributions(env: Env) {
        Self::governance(env.clone()).require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        ContributionsResumed {}.publish(&env);
    }

    /// Stop the distributor at once. Only a queued `SetDistributor` lifts this,
    /// so returning payouts to service is visible for the whole delay.
    pub fn disable_distributor(env: Env) {
        Self::governance(env.clone()).require_auth();
        env.storage()
            .instance()
            .set(&DataKey::DistributorDisabled, &true);
        DistributorDisabled {}.publish(&env);
    }

    // --- changes behind the timelock -----------------------------------------

    /// Queue a change. There is one slot, so a queued change is executed or
    /// cancelled before another is proposed.
    pub fn propose_change(env: Env, change: Change) -> Result<u32, Error> {
        Self::governance(env.clone()).require_auth();
        let storage = env.storage().instance();
        if storage.has(&DataKey::PendingChange) {
            return Err(Error::ChangeAlreadyPending);
        }
        let execute_after = env
            .ledger()
            .sequence()
            .checked_add(Self::timelock_ledgers(env.clone()))
            .ok_or(Error::Overflow)?;
        storage.set(
            &DataKey::PendingChange,
            &PendingChange {
                change: change.clone(),
                execute_after,
            },
        );
        ChangeProposed {
            change,
            execute_after,
        }
        .publish(&env);
        Ok(execute_after)
    }

    /// Apply the queued change, once the ledger is past its `execute_after`.
    pub fn execute_change(env: Env) -> Result<(), Error> {
        Self::governance(env.clone()).require_auth();
        let PendingChange {
            change,
            execute_after,
        } = Self::pending_change(env.clone()).ok_or(Error::NoPendingChange)?;
        if env.ledger().sequence() <= execute_after {
            return Err(Error::TimelockNotElapsed);
        }

        let storage = env.storage().instance();
        match change.clone() {
            Change::SetPolicy(address) => {
                // A replacement that answered to anyone else would take
                // parameter changes out from behind this timelock. This
                // catches a deploy mistake, not a dishonest contract, which can
                // answer anything: that is for the review during the delay.
                match PolicyClient::new(&env, &address).try_controller() {
                    Ok(Ok(controller)) if controller == env.current_contract_address() => {}
                    _ => return Err(Error::PolicyControllerMismatch),
                }
                storage.set(&DataKey::PolicyAddr, &address);
            }
            Change::SetAttestation(address) => storage.set(&DataKey::AttestAddr, &address),
            Change::ApproveAsset(asset) => {
                let mut assets = Self::approved_assets(env.clone());
                if assets.contains(&asset) {
                    return Err(Error::AssetAlreadyApproved);
                }
                assets.push_back(asset.clone());
                storage.set(&DataKey::ApprovedAssets, &assets);
                env.storage()
                    .persistent()
                    .set(&DataKey::CategoryBalances(asset), &empty_buckets(&env));
            }
            Change::SetAllocation(allocation) => {
                match policy_client(&env).try_set_allocation(&allocation) {
                    Ok(Ok(())) => {}
                    _ => return Err(Error::PolicyRefused),
                }
            }
            Change::SetParameters(parameters) => {
                match policy_client(&env).try_set_parameters(&parameters) {
                    Ok(Ok(())) => {}
                    _ => return Err(Error::PolicyRefused),
                }
            }
            Change::SetDistributor(address) => {
                if address == Self::governance(env.clone()) {
                    return Err(Error::RolesOverlap);
                }
                storage.set(&DataKey::Distributor, &address);
                storage.set(&DataKey::DistributorDisabled, &false);
            }
        }

        storage.remove(&DataKey::PendingChange);
        ChangeExecuted {
            change,
            execute_after,
        }
        .publish(&env);
        Ok(())
    }

    pub fn cancel_change(env: Env) -> Result<(), Error> {
        Self::governance(env.clone()).require_auth();
        let PendingChange {
            change,
            execute_after,
        } = Self::pending_change(env.clone()).ok_or(Error::NoPendingChange)?;
        env.storage().instance().remove(&DataKey::PendingChange);
        ChangeCancelled {
            change,
            execute_after,
        }
        .publish(&env);
        Ok(())
    }

    // --- views ---------------------------------------------------------------

    /// The 8 balances of `asset` in [`Category`] order, zeros if not approved.
    pub fn balances(env: Env, asset: Address) -> Vec<i128> {
        env.storage()
            .persistent()
            .get(&DataKey::CategoryBalances(asset))
            .unwrap_or_else(|| empty_buckets(&env))
    }

    pub fn is_approved(env: Env, asset: Address) -> bool {
        Self::approved_assets(env).contains(&asset)
    }

    pub fn approved_assets(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::ApprovedAssets)
            .unwrap()
    }

    pub fn distribution_seq(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::DistributionSeq)
            .unwrap()
    }

    pub fn governance(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Governance).unwrap()
    }

    pub fn distributor(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Distributor).unwrap()
    }

    pub fn policy(env: Env) -> Address {
        env.storage().instance().get(&DataKey::PolicyAddr).unwrap()
    }

    pub fn attestation(env: Env) -> Address {
        env.storage().instance().get(&DataKey::AttestAddr).unwrap()
    }

    pub fn is_paused(env: Env) -> bool {
        flag(&env, &DataKey::Paused)
    }

    pub fn is_distributor_disabled(env: Env) -> bool {
        flag(&env, &DataKey::DistributorDisabled)
    }

    pub fn timelock_ledgers(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::TimelockLedgers)
            .unwrap()
    }

    pub fn pending_change(env: Env) -> Option<PendingChange> {
        env.storage().instance().get(&DataKey::PendingChange)
    }
}

fn flag(env: &Env, key: &DataKey) -> bool {
    env.storage().instance().get(key).unwrap_or(false)
}

fn empty_buckets(env: &Env) -> Vec<i128> {
    let mut buckets = Vec::new(env);
    for _ in 0..CATEGORY_COUNT {
        buckets.push_back(0);
    }
    buckets
}

fn policy_client(env: &Env) -> PolicyClient<'_> {
    PolicyClient::new(env, &ZakatPool::policy(env.clone()))
}

/// Ask `policy` for the split, and reject anything but exactly 8 elements, each
/// zero or positive, summing exactly to the amount. Checking only the sum would
/// admit `[amount + x, -x, 0, ...]`, which credits one category from another.
fn allocation(env: &Env, amount: i128) -> Result<Vec<i128>, Error> {
    let split = match policy_client(env).try_allocate(&amount) {
        Ok(Ok(split)) => split,
        _ => return Err(Error::InvalidAllocation),
    };
    if split.len() != CATEGORY_COUNT {
        return Err(Error::InvalidAllocation);
    }
    let mut sum: i128 = 0;
    for part in split.iter() {
        if part < 0 {
            return Err(Error::InvalidAllocation);
        }
        sum = sum.checked_add(part).ok_or(Error::InvalidAllocation)?;
    }
    if sum != amount {
        return Err(Error::InvalidAllocation);
    }
    Ok(split)
}

/// Ask `attestation` to verify. Only a clean unit return counts as yes.
fn verify(env: &Env, payload: &Attestation, signatures: &Vec<SignerSig>) -> Result<(), Error> {
    let address = ZakatPool::attestation(env.clone());
    match AttestationClient::new(env, &address).try_verify(payload, signatures) {
        Ok(Ok(())) => Ok(()),
        Err(Ok(AttestationError::ThresholdNotMet)) => Err(Error::ThresholdNotMet),
        Err(Ok(AttestationError::UnknownSigner)) => Err(Error::UnknownSigner),
        _ => Err(Error::AttestationRejected),
    }
}

/// The buckets never claim more than the pool holds. The direction is `<=`
/// because anyone can transfer straight to this address: that surplus shows in
/// the balance, belongs to no bucket, and can never be paid out.
fn assert_solvent(env: &Env, asset: &Address, buckets: &Vec<i128>) -> Result<(), Error> {
    let mut claimed: i128 = 0;
    for amount in buckets.iter() {
        claimed = claimed.checked_add(amount).ok_or(Error::Overflow)?;
    }
    let held = token::Client::new(env, asset).balance(&env.current_contract_address());
    if claimed > held {
        return Err(Error::Insolvent);
    }
    Ok(())
}
