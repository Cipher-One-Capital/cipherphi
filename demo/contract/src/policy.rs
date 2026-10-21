// SPDX-License-Identifier: Apache-2.0

//! The allocation split: a pure function of an amount, with no storage and no
//! env state beyond the `&Env` a `Map` needs.
//!
//! It is a fixed **demo** policy compiled into the contract. The shares below
//! are placeholders chosen for a testnet demonstration. They are not the Swiss
//! Zakat Foundation's split and have not been validated by its Shariah
//! authority. In the funded build the split is a governed parameter held by a
//! separate `policy` contract, which the pool treats as untrusted.

use soroban_sdk::{Env, Map};

use crate::types::{Category, Error};

pub const BPS_TOTAL: i128 = 10_000;

/// Basis points per category, in [`Category::ALL`] order. Must sum to
/// [`BPS_TOTAL`].
pub const BPS: [i128; 8] = [
    3_000, // Poor
    2_000, // Needy
    1_000, // Administrators
    500,   // Reconciliation
    500,   // Captives
    1_500, // Debtors
    1_000, // CauseOfGod
    500,   // Wayfarers
];

/// The category that absorbs the rounding remainder. A configured choice, not
/// an accident of iteration order.
pub const REMAINDER: Category = Category::Poor;

// The remainder category's basis points are never read at runtime, because it
// takes what is left rather than its own floor-division. They are declared
// anyway, and checked here at compile time, because a policy whose shares do
// not add up should not build.
const _: () = {
    let mut sum = 0;
    let mut i = 0;
    while i < BPS.len() {
        sum += BPS[i];
        i += 1;
    }
    assert!(sum == BPS_TOTAL);
};

/// Split `amount` across the eight categories.
///
/// Integer division truncates, so computing every part by floor-division would
/// usually sum to slightly *less* than `amount`. Instead every category but
/// [`REMAINDER`] is floor-divided and [`REMAINDER`] takes what is left, which
/// makes the total exact by construction rather than by luck.
///
/// The sum is then asserted anyway. That assert is unreachable if this function
/// is right. It stays because "unreachable" is a claim about today's code.
pub fn split(env: &Env, amount: i128) -> Result<Map<Category, i128>, Error> {
    if amount <= 0 {
        return Err(Error::InvalidAmount);
    }

    let mut parts = Map::new(env);
    let mut rest = amount;
    for (i, category) in Category::ALL.iter().enumerate() {
        if *category == REMAINDER {
            continue;
        }
        let part = bps(amount, BPS[i])?;
        rest = rest.checked_sub(part).ok_or(Error::Overflow)?;
        parts.set(*category, part);
    }
    if rest < 0 {
        return Err(Error::SplitMismatch);
    }
    parts.set(REMAINDER, rest);

    let mut sum: i128 = 0;
    for part in parts.values().iter() {
        if part < 0 {
            return Err(Error::SplitMismatch);
        }
        sum = sum.checked_add(part).ok_or(Error::Overflow)?;
    }
    if parts.len() != 8 || sum != amount {
        return Err(Error::SplitMismatch);
    }

    Ok(parts)
}

/// `amount * bps / 10_000`, with the multiply checked.
///
/// `amount * 10_000` overflows `i128` only at absurd values, but "absurd" is
/// not a security boundary, so it returns an error rather than wrapping. The
/// release profile sets `overflow-checks = true` as the backstop for the
/// arithmetic that forgets to be explicit.
fn bps(amount: i128, bps: i128) -> Result<i128, Error> {
    amount
        .checked_mul(bps)
        .map(|scaled| scaled / BPS_TOTAL)
        .ok_or(Error::Overflow)
}
