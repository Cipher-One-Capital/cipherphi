// SPDX-License-Identifier: Apache-2.0

//! # policy
//!
//! Holds the 8-category split and the Shariah parameters, and computes the
//! allocation of a contribution. It holds no funds and cannot call back into
//! the pool.
//!
//! Every value is bounds-checked at the setter. The setters answer only to the
//! `controller`, which is the `zakat_pool` contract, so a change reaches this
//! contract only through governance and the pool's 7-day timelock.
//!
//! The deployed values are placeholders. They are not the Swiss Zakat
//! Foundation's allocation and the Shariah authority has not validated them.
//!
//! Testnet only, and unaudited.

#![no_std]

#[cfg(test)]
mod test;

pub use cipherphi_interface::{Allocation, Category, DischargeTiming, NisabBasis, Parameters};
use cipherphi_interface::{BPS_TOTAL, CATEGORY_COUNT};
use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, Env, Vec};

/// The widest administrators' share any setting may allow. A technical bound on
/// bad input, not a religious ruling: the validated cap sits inside this band.
pub const MAX_AMIL_CAP_BPS: u32 = 2_500;
/// The widest zakat rate any setting may allow, on the same basis.
pub const MAX_RATE_BPS: u32 = 1_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Controller,
    Allocation,
    Parameters,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// Non-positive amount.
    InvalidAmount = 2,
    /// Checked arithmetic said no.
    Overflow = 4,
    /// The split does not have exactly 8 elements.
    SplitLength = 30,
    /// The split does not sum to 10,000 basis points.
    SplitSum = 31,
    /// The remainder category has no share of the split.
    RemainderWithoutShare = 32,
    /// The amil cap is outside its allowed band.
    AmilCapOutOfBand = 33,
    /// The zakat rate is outside its allowed band.
    RateOutOfBand = 34,
    /// The administrators' share is above the amil cap.
    AdministratorsAboveCap = 35,
}

#[contract]
pub struct Policy;

#[contractimpl]
impl Policy {
    /// `controller` is the pool. The deploy script computes the pool's address
    /// before deploying this contract, since each needs the other's.
    pub fn __constructor(
        env: Env,
        controller: Address,
        allocation: Allocation,
        parameters: Parameters,
    ) -> Result<(), Error> {
        check(&allocation, &parameters)?;
        let storage = env.storage().instance();
        storage.set(&DataKey::Controller, &controller);
        storage.set(&DataKey::Allocation, &allocation);
        storage.set(&DataKey::Parameters, &parameters);
        Ok(())
    }

    pub fn set_allocation(env: Env, allocation: Allocation) -> Result<(), Error> {
        Self::controller(env.clone()).require_auth();
        check(&allocation, &Self::parameters(env.clone()))?;
        env.storage()
            .instance()
            .set(&DataKey::Allocation, &allocation);
        Ok(())
    }

    pub fn set_parameters(env: Env, parameters: Parameters) -> Result<(), Error> {
        Self::controller(env.clone()).require_auth();
        check(&Self::allocation(env.clone()), &parameters)?;
        env.storage()
            .instance()
            .set(&DataKey::Parameters, &parameters);
        Ok(())
    }

    /// Split `amount` into 8 amounts in [`Category`] order.
    ///
    /// Every category but the remainder is floor-divided and the remainder takes
    /// what is left, so the total is exact by construction.
    pub fn allocate(env: Env, amount: i128) -> Result<Vec<i128>, Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        let allocation = Self::allocation(env.clone());
        let remainder_index = allocation.remainder as u32;

        let mut rest = amount;
        let mut parts: Vec<i128> = Vec::new(&env);
        for (index, bps) in allocation.split_bps.iter().enumerate() {
            if index as u32 == remainder_index {
                parts.push_back(0);
                continue;
            }
            let part = amount.checked_mul(bps as i128).ok_or(Error::Overflow)? / BPS_TOTAL as i128;
            rest = rest.checked_sub(part).ok_or(Error::Overflow)?;
            parts.push_back(part);
        }
        parts.set(remainder_index, rest);
        Ok(parts)
    }

    pub fn controller(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Controller).unwrap()
    }

    pub fn allocation(env: Env) -> Allocation {
        env.storage().instance().get(&DataKey::Allocation).unwrap()
    }

    pub fn parameters(env: Env) -> Parameters {
        env.storage().instance().get(&DataKey::Parameters).unwrap()
    }
}

/// The one place the bounds live. Each setter passes the stored half of the
/// pair, so a cap can never be lowered beneath the live split or the other way
/// round.
fn check(allocation: &Allocation, parameters: &Parameters) -> Result<(), Error> {
    let split = &allocation.split_bps;
    if split.len() != CATEGORY_COUNT {
        return Err(Error::SplitLength);
    }
    let mut sum: u32 = 0;
    for bps in split.iter() {
        sum = sum.checked_add(bps).ok_or(Error::SplitSum)?;
    }
    if sum != BPS_TOTAL {
        return Err(Error::SplitSum);
    }
    if split.get_unchecked(allocation.remainder as u32) == 0 {
        return Err(Error::RemainderWithoutShare);
    }
    if parameters.amil_cap_bps > MAX_AMIL_CAP_BPS {
        return Err(Error::AmilCapOutOfBand);
    }
    if parameters.rate_bps == 0 || parameters.rate_bps > MAX_RATE_BPS {
        return Err(Error::RateOutOfBand);
    }
    if split.get_unchecked(Category::Administrators as u32) > parameters.amil_cap_bps {
        return Err(Error::AdministratorsAboveCap);
    }
    Ok(())
}
