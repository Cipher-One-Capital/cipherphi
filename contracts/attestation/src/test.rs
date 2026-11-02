// SPDX-License-Identifier: Apache-2.0
#![cfg(test)]

extern crate std;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{testutils::Address as _, xdr::ToXdr, Address, BytesN, Env, Vec};

use crate::{Attestation, AttestationArgs, AttestationClient, Error};
use cipherphi_interface::{Attestation as Payload, Category, SignerSig};

const SEEDS: [[u8; 32]; 3] = [[11u8; 32], [22u8; 32], [33u8; 32]];
const OUTSIDER: [u8; 32] = [44u8; 32];

fn keys(env: &Env) -> Vec<BytesN<32>> {
    let mut out = Vec::new(env);
    for seed in &SEEDS {
        out.push_back(BytesN::from_array(
            env,
            &SigningKey::from_bytes(seed).verifying_key().to_bytes(),
        ));
    }
    out
}

fn setup() -> (Env, Address) {
    let env = Env::default();
    let id = env.register(Attestation, AttestationArgs::__constructor(&keys(&env), &2));
    (env, id)
}

fn payload(env: &Env) -> Payload {
    Payload {
        recipient: Address::generate(env),
        asset: Address::generate(env),
        category: Category::Poor,
        amount: 250_000,
        sequence: 0,
        expiry_ledger: 1_000,
        pool: Address::generate(env),
        network_id: BytesN::from_array(env, &[7u8; 32]),
    }
}

fn signature(env: &Env, payload: &Payload, seed: &[u8; 32], index: u32) -> SignerSig {
    let message: std::vec::Vec<u8> = payload.clone().to_xdr(env).iter().collect();
    SignerSig {
        index,
        signature: BytesN::from_array(env, &SigningKey::from_bytes(seed).sign(&message).to_bytes()),
    }
}

/// `register` panics on a constructor error, so the refusal is read from the
/// panic message rather than from a typed result.
fn refusal_of(register: impl FnOnce()) -> std::string::String {
    let payload = std::panic::catch_unwind(std::panic::AssertUnwindSafe(register))
        .expect_err("the constructor accepted arguments it should have refused");
    payload
        .downcast_ref::<std::string::String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| std::string::String::from(*text))
        })
        .unwrap_or_default()
}

fn assert_refused(message: &str, code: u32) {
    let want = std::format!("Error(Contract, #{})", code);
    assert!(message.contains(&want), "wanted {} in: {}", want, message);
}

#[test]
fn constructor_stores_the_key_set() {
    let (env, id) = setup();
    let client = AttestationClient::new(&env, &id);
    assert_eq!(client.authority(), keys(&env));
    assert_eq!(client.threshold(), 2);
}

#[test]
fn two_of_three_verifies() {
    let (env, id) = setup();
    let p = payload(&env);
    let sigs = soroban_sdk::vec![
        &env,
        signature(&env, &p, &SEEDS[0], 0),
        signature(&env, &p, &SEEDS[2], 2)
    ];
    AttestationClient::new(&env, &id).verify(&p, &sigs);
}

#[test]
fn signatures_beyond_the_threshold_are_accepted() {
    let (env, id) = setup();
    let p = payload(&env);
    let sigs = soroban_sdk::vec![
        &env,
        signature(&env, &p, &SEEDS[0], 0),
        signature(&env, &p, &SEEDS[1], 1),
        signature(&env, &p, &SEEDS[2], 2)
    ];
    AttestationClient::new(&env, &id).verify(&p, &sigs);
}

#[test]
fn one_signature_is_below_the_threshold() {
    let (env, id) = setup();
    let p = payload(&env);
    let sigs = soroban_sdk::vec![&env, signature(&env, &p, &SEEDS[0], 0)];
    assert_eq!(
        AttestationClient::new(&env, &id).try_verify(&p, &sigs),
        Err(Ok(Error::ThresholdNotMet))
    );
}

#[test]
fn no_signature_is_below_the_threshold() {
    let (env, id) = setup();
    let p = payload(&env);
    assert_eq!(
        AttestationClient::new(&env, &id).try_verify(&p, &Vec::new(&env)),
        Err(Ok(Error::ThresholdNotMet))
    );
}

#[test]
fn a_repeated_signer_counts_once() {
    let (env, id) = setup();
    let p = payload(&env);
    let one = signature(&env, &p, &SEEDS[0], 0);
    let sigs = soroban_sdk::vec![&env, one.clone(), one];
    assert_eq!(
        AttestationClient::new(&env, &id).try_verify(&p, &sigs),
        Err(Ok(Error::ThresholdNotMet))
    );
}

#[test]
fn an_unknown_signer_index_is_refused() {
    let (env, id) = setup();
    let p = payload(&env);
    let sigs = soroban_sdk::vec![&env, signature(&env, &p, &SEEDS[0], 3)];
    assert_eq!(
        AttestationClient::new(&env, &id).try_verify(&p, &sigs),
        Err(Ok(Error::UnknownSigner))
    );
}

#[test]
fn a_key_outside_the_authority_traps() {
    let (env, id) = setup();
    let p = payload(&env);
    let sigs = soroban_sdk::vec![
        &env,
        signature(&env, &p, &OUTSIDER, 0),
        signature(&env, &p, &SEEDS[1], 1)
    ];
    assert!(AttestationClient::new(&env, &id)
        .try_verify(&p, &sigs)
        .is_err());
}

#[test]
fn a_changed_payload_traps() {
    let (env, id) = setup();
    let p = payload(&env);
    let sigs = soroban_sdk::vec![
        &env,
        signature(&env, &p, &SEEDS[0], 0),
        signature(&env, &p, &SEEDS[1], 1)
    ];
    let mut changed = p.clone();
    changed.amount += 1;
    assert!(AttestationClient::new(&env, &id)
        .try_verify(&changed, &sigs)
        .is_err());
}

#[test]
fn threshold_zero_is_refused_at_construction() {
    let env = Env::default();
    let keys = keys(&env);
    let message = refusal_of(|| {
        env.register(Attestation, AttestationArgs::__constructor(&keys, &0));
    });
    assert_refused(&message, Error::InvalidThreshold as u32);
}

#[test]
fn threshold_above_key_count_is_refused_at_construction() {
    let env = Env::default();
    let keys = keys(&env);
    let message = refusal_of(|| {
        env.register(Attestation, AttestationArgs::__constructor(&keys, &4));
    });
    assert_refused(&message, Error::InvalidThreshold as u32);
}

#[test]
fn an_empty_key_set_is_refused_at_construction() {
    let env = Env::default();
    let empty = Vec::new(&env);
    let message = refusal_of(|| {
        env.register(Attestation, AttestationArgs::__constructor(&empty, &1));
    });
    assert_refused(&message, Error::InvalidThreshold as u32);
}

#[test]
fn a_duplicate_key_is_refused_at_construction() {
    let env = Env::default();
    let mut authority = keys(&env);
    authority.set(2, authority.get_unchecked(0));
    let message = refusal_of(|| {
        env.register(Attestation, AttestationArgs::__constructor(&authority, &2));
    });
    assert_refused(&message, Error::DuplicateAuthorityKey as u32);
}

// --- the demo's encoding, unchanged ------------------------------------------

const VECTOR_JSON: &str = include_str!("../../test_vectors/attestation.json");

fn hex(bytes: &[u8]) -> std::string::String {
    let mut out = std::string::String::new();
    for byte in bytes {
        out.push_str(&std::format!("{:02x}", byte));
    }
    out
}

fn vector_field(key: &str) -> &'static str {
    let needle = std::format!("\"{}\":", key);
    let after = VECTOR_JSON
        .find(&needle)
        .map(|at| at + needle.len())
        .unwrap_or_else(|| panic!("the committed vector has no {} field", key));
    let rest = &VECTOR_JSON[after..];
    let open = rest.find('"').expect("an unquoted value") + 1;
    let close = open + rest[open..].find('"').expect("an unterminated value");
    &rest[open..close]
}

#[test]
fn attestation_xdr_matches_the_committed_vector() {
    let env = Env::default();
    let payload = Payload {
        recipient: Address::from_str(&env, vector_field("recipient")),
        asset: Address::from_str(&env, vector_field("asset")),
        category: Category::Poor,
        amount: vector_field("amount").parse().unwrap(),
        sequence: vector_field("sequence").parse().unwrap(),
        expiry_ledger: vector_field("expiry_ledger").parse().unwrap(),
        pool: Address::from_str(&env, vector_field("pool")),
        network_id: BytesN::from_array(&env, &[7u8; 32]),
    };
    assert_eq!(vector_field("network_id"), hex(&[7u8; 32]));

    let signed: std::vec::Vec<u8> = payload.clone().to_xdr(&env).iter().collect();
    assert_eq!(hex(&signed), vector_field("signed_bytes_hex"));

    let signer = SigningKey::from_bytes(&SEEDS[0]);
    assert_eq!(hex(&SEEDS[0]), vector_field("signer_seed_hex"));
    assert_eq!(
        hex(&signer.verifying_key().to_bytes()),
        vector_field("signer_public_key_hex")
    );
    let signature = signer.sign(&signed).to_bytes();
    assert_eq!(hex(&signature), vector_field("signature_hex"));

    // The contract's own path accepts the committed pair.
    let id = env.register(
        Attestation,
        AttestationArgs::__constructor(
            &soroban_sdk::vec![
                &env,
                BytesN::from_array(&env, &signer.verifying_key().to_bytes())
            ],
            &1,
        ),
    );
    AttestationClient::new(&env, &id).verify(
        &payload,
        &soroban_sdk::vec![
            &env,
            SignerSig {
                index: 0,
                signature: BytesN::from_array(&env, &signature),
            }
        ],
    );
}
