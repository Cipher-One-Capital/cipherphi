// SPDX-License-Identifier: Apache-2.0

//! # attestation
//!
//! Holds the authority key set and threshold, and verifies that a quorum signed
//! an attestation. The key set is fixed at construction and has no setter:
//! changing it means deploying a new contract and repointing the pool at it,
//! under the timelock. It holds no funds and cannot call back into the pool.
//!
//! This contract checks signatures only. Whether the payload names this pool,
//! this network, the current sequence and a live expiry is checked by
//! `zakat_pool`, which does not trust this contract to have looked.
//!
//! Testnet only, and unaudited.

#![no_std]

#[cfg(test)]
mod test;

pub use cipherphi_interface::AttestationError as Error;
use cipherphi_interface::{Attestation as Payload, SignerSig};
use soroban_sdk::{contract, contractimpl, contracttype, xdr::ToXdr, BytesN, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
enum DataKey {
    Authority,
    Threshold,
}

#[contract]
pub struct Attestation;

#[contractimpl]
impl Attestation {
    /// `__constructor` runs once, atomically with deployment, so no window
    /// exists in which someone else could install their own keys.
    pub fn __constructor(
        env: Env,
        authority: Vec<BytesN<32>>,
        threshold: u32,
    ) -> Result<(), Error> {
        // Zero is a pool anyone drains; above the key count is a pool nobody
        // can pay out of.
        if threshold == 0 || threshold > authority.len() {
            return Err(Error::InvalidThreshold);
        }

        // A repeated key is a threshold quietly lowered: `verify` dedupes on
        // the index, so [K1, K1, K2] at 2 is satisfied by K1 alone.
        for i in 0..authority.len() {
            for j in (i + 1)..authority.len() {
                if authority.get_unchecked(i) == authority.get_unchecked(j) {
                    return Err(Error::DuplicateAuthorityKey);
                }
            }
        }

        let storage = env.storage().instance();
        storage.set(&DataKey::Authority, &authority);
        storage.set(&DataKey::Threshold, &threshold);
        Ok(())
    }

    /// Require that at least `threshold` distinct authority keys signed the
    /// payload's XDR.
    ///
    /// Every signature submitted must be valid, because `ed25519_verify` traps
    /// on a bad one. A repeated index counts once, otherwise 2-of-3 could be
    /// faked by submitting one signature twice.
    pub fn verify(env: Env, payload: Payload, signatures: Vec<SignerSig>) -> Result<(), Error> {
        let authority = Self::authority(env.clone());
        let threshold = Self::threshold(env.clone());
        let message = payload.to_xdr(&env);

        let mut distinct: Vec<u32> = Vec::new(&env);
        for sig in signatures.iter() {
            let key = authority.get(sig.index).ok_or(Error::UnknownSigner)?;
            env.crypto().ed25519_verify(&key, &message, &sig.signature);
            if !distinct.contains(sig.index) {
                distinct.push_back(sig.index);
            }
        }

        if distinct.len() < threshold {
            return Err(Error::ThresholdNotMet);
        }
        Ok(())
    }

    pub fn authority(env: Env) -> Vec<BytesN<32>> {
        env.storage().instance().get(&DataKey::Authority).unwrap()
    }

    pub fn threshold(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Threshold).unwrap()
    }
}
