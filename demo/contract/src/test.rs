// SPDX-License-Identifier: Apache-2.0

//! The happy path, the authorisation assertions, and the refusal matrix.
//!
//! Four things worth knowing about the harness:
//!
//! * The signatures are produced by `ed25519-dalek`, a third-party signer, over
//!   `to_xdr(attestation)`. Building the same struct and serialising it is the
//!   only way the test proves the contract's check rather than a
//!   reimplementation of it.
//! * `env.events().all()` shows the most recent invocation only, and so does
//!   `env.auths()`. Every event and auth assertion below sits immediately after
//!   the call it is about, because a later call, a view included, silently
//!   resets both and the assertion would pass on the wrong invocation.
//! * `setup()` calls `mock_all_auths()`, which authorises every address. That is
//!   what makes the authorisation assertions necessary: with the mock in place,
//!   deleting a `require_auth` changes nothing a happy-path test can see, so the
//!   three tests that read `env.auths()` are what hold those calls in place.
//!   Exactly one test, `submission_by_an_authority_key_is_refused`, narrows the
//!   mock with `mock_auths` afterwards, because a wrong-caller refusal cannot be
//!   written while every caller is authorised.
//! * Every refusal below asserts two things: the exact error, and that the pool
//!   is byte-for-byte where it was. A test that checks the error but not the
//!   state does not prove the property.

#![cfg(test)]

extern crate std;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Events, Ledger, MockAuth,
        MockAuthInvoke,
    },
    token,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Event, IntoVal, Symbol, Vec,
};

use crate::{
    policy, Attestation, AttestationGate, AttestationGateArgs, AttestationGateClient, Category,
    Contribution, Disbursement, Error, SignerSig,
};

/// Fixed seeds, so a failing test is reproducible.
const AUTHORITY_SEEDS: [[u8; 32]; 3] = [[11u8; 32], [22u8; 32], [33u8; 32]];
/// A key that is deliberately *not* in the authority vector.
const OUTSIDER_SEED: [u8; 32] = [44u8; 32];
const THRESHOLD: u32 = 2;
const CONTRIBUTION: i128 = 1_000_000;
const START_LEDGER: u32 = 100;
const EXPIRY_LEDGER: u32 = 1_000;
/// `Env::default()` leaves the network id all zeros, which would make an
/// all-zero attestation field indistinguishable from a real one and the
/// wrong-network refusal untestable. `setup()` sets it to what a real network
/// id is: the SHA-256 of the network passphrase.
const TESTNET_PASSPHRASE: &str = "Test SDF Network ; September 2015";

/// Everything a refusal has to leave exactly as it found it.
#[derive(Clone, Debug, Eq, PartialEq)]
struct State {
    sequence: u64,
    buckets: Vec<i128>,
    recipient_balance: i128,
    contributor_balance: i128,
    pool_balance: i128,
}

struct Fixture {
    env: Env,
    gate_id: Address,
    asset: Address,
    contributor: Address,
    recipient: Address,
    admin: Address,
    distributor: Address,
    authority: Vec<BytesN<32>>,
    signers: std::vec::Vec<SigningKey>,
}

impl Fixture {
    fn client(&self) -> AttestationGateClient<'_> {
        AttestationGateClient::new(&self.env, &self.gate_id)
    }

    fn token(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.asset)
    }

    /// An attestation that is valid for this deployment right now. Tests that
    /// need an invalid one build this and overwrite the single field under test,
    /// before signing, so that what fails is exactly what the name says.
    fn attestation(&self, category: Category, amount: i128, sequence: u64) -> Attestation {
        Attestation {
            recipient: self.recipient.clone(),
            asset: self.asset.clone(),
            category,
            amount,
            sequence,
            expiry_ledger: EXPIRY_LEDGER,
            pool: self.gate_id.clone(),
            network_id: self.env.ledger().network_id(),
        }
    }

    /// Sign the attestation's XDR with the authority keys at `indexes`.
    fn sign(&self, attestation: &Attestation, indexes: &[u32]) -> Vec<SignerSig> {
        let message: std::vec::Vec<u8> = attestation.clone().to_xdr(&self.env).iter().collect();
        let mut sigs = Vec::new(&self.env);
        for index in indexes {
            let signature = self.signers[*index as usize].sign(&message);
            sigs.push_back(SignerSig {
                index: *index,
                signature: BytesN::from_array(&self.env, &signature.to_bytes()),
            });
        }
        sigs
    }

    /// Sign with an arbitrary key and present the signature at `index`. Used for
    /// the two cases where the key and the slot are deliberately mismatched.
    fn sign_with(&self, attestation: &Attestation, key: &SigningKey, index: u32) -> Vec<SignerSig> {
        let message: std::vec::Vec<u8> = attestation.clone().to_xdr(&self.env).iter().collect();
        let signature = key.sign(&message);
        soroban_sdk::vec![
            &self.env,
            SignerSig {
                index,
                signature: BytesN::from_array(&self.env, &signature.to_bytes()),
            }
        ]
    }

    /// SHA-256 of the exact bytes the keys signed, which is what the
    /// `Disbursement` event carries.
    fn attestation_hash(&self, attestation: &Attestation) -> BytesN<32> {
        let message = attestation.clone().to_xdr(&self.env);
        self.env.crypto().sha256(&message).to_bytes()
    }

    fn state(&self) -> State {
        let gate = self.client();
        State {
            sequence: gate.distribution_seq(),
            buckets: gate.balances(),
            recipient_balance: self.token().balance(&self.recipient),
            contributor_balance: self.token().balance(&self.contributor),
            pool_balance: self.token().balance(&self.gate_id),
        }
    }

    fn assert_unchanged(&self, before: &State) {
        assert_eq!(&self.state(), before, "a refused call moved the pool");
    }
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);
    let network_id = env
        .crypto()
        .sha256(&Bytes::from_slice(&env, TESTNET_PASSPHRASE.as_bytes()))
        .to_bytes();
    env.ledger().set_network_id(network_id.to_array());

    let admin = Address::generate(&env);
    let distributor = Address::generate(&env);
    let contributor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let asset = sac.address();
    token::StellarAssetClient::new(&env, &asset).mint(&contributor, &(CONTRIBUTION * 10));

    let signers: std::vec::Vec<SigningKey> =
        AUTHORITY_SEEDS.iter().map(SigningKey::from_bytes).collect();
    let mut authority = Vec::new(&env);
    for signer in &signers {
        authority.push_back(BytesN::from_array(&env, &signer.verifying_key().to_bytes()));
    }

    let gate_id = env.register(
        AttestationGate,
        AttestationGateArgs::__constructor(&admin, &authority, &THRESHOLD, &distributor, &asset),
    );

    Fixture {
        env,
        gate_id,
        asset,
        contributor,
        recipient,
        admin,
        distributor,
        authority,
        signers,
    }
}

/// Assert that constructing a pool with these arguments is refused with
/// `expected`.
///
/// This is the one place a negative test does not call a `try_` variant, and the
/// reason is structural rather than a preference. The SDK generates no
/// `try___constructor` on the client, and the host refuses a direct call to
/// `__constructor` on a live instance, so `Env::register` is the only way to run
/// a constructor and it panics when the constructor refuses. The panic is caught
/// here and matched against the exact ABI code the expected variant carries, so
/// the assertion is still on one named variant rather than on "it failed".
fn assert_construction_refused(
    env: &Env,
    admin: &Address,
    authority: &Vec<BytesN<32>>,
    threshold: u32,
    distributor: &Address,
    asset: &Address,
    expected: Error,
) {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(
            AttestationGate,
            AttestationGateArgs::__constructor(admin, authority, &threshold, distributor, asset),
        )
    }));

    let payload = match outcome {
        Ok(address) => panic!(
            "the constructor accepted arguments it should have refused, deploying to {:?}",
            address
        ),
        Err(payload) => payload,
    };
    let message = payload
        .downcast_ref::<std::string::String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| std::string::String::from(*text))
        })
        .unwrap_or_default();

    let code = std::format!("Error(Contract, #{})", expected as u32);
    assert!(
        message.contains(&code),
        "expected {:?}, which is {}, but the host reported: {}",
        expected,
        code,
        message
    );
}

// --- happy path -------------------------------------------------------------

#[test]
fn constructor_stores_the_configuration() {
    let f = setup();
    let gate = f.client();

    assert_eq!(gate.admin(), f.admin);
    assert_eq!(gate.distributor(), f.distributor);
    assert_eq!(gate.asset(), f.asset);
    assert_eq!(gate.authority(), f.authority);
    assert_eq!(gate.threshold(), THRESHOLD);
    assert_eq!(gate.distribution_seq(), 0);

    // Eight buckets, all at zero. Not absent: initialised.
    assert_eq!(gate.buckets().len(), 8);
    for category in Category::ALL {
        assert_eq!(gate.bucket(&category), 0);
    }
}

#[test]
fn contribute_credits_every_bucket() {
    let f = setup();
    let gate = f.client();

    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Before anything else. Every call into a contract resets the event
    // stream, and a view is a call: assert on the events of the invocation
    // under test first, or the assertion runs against someone else's.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.gate_id),
        std::vec![Contribution {
            contributor: f.contributor.clone(),
            amount: CONTRIBUTION,
            split: soroban_sdk::vec![&f.env, 300_000, 200_000, 100_000, 50_000, 50_000, 150_000, 100_000, 50_000],
        }
        .to_xdr(&f.env, &f.gate_id)]
    );

    // 30 / 20 / 10 / 5 / 5 / 15 / 10 / 5 of 1_000_000, per the compiled-in
    // demo policy, and `balances()` reports them in category order.
    assert_eq!(gate.bucket(&Category::Poor), 300_000);
    assert_eq!(gate.bucket(&Category::Administrators), 100_000);
    assert_eq!(gate.bucket(&Category::Wayfarers), 50_000);
    assert_eq!(
        gate.balances(),
        soroban_sdk::vec![&f.env, 300_000, 200_000, 100_000, 50_000, 50_000, 150_000, 100_000, 50_000]
    );

    // The buckets account for every unit contributed, and the pool holds them.
    let claimed: i128 = gate.buckets().values().iter().sum();
    assert_eq!(claimed, CONTRIBUTION);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION);
    assert_eq!(
        f.token().balance(&f.contributor),
        CONTRIBUTION * 10 - CONTRIBUTION
    );
}

#[test]
fn distribute_pays_out_against_a_valid_quorum() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let payout: i128 = 250_000;
    let attestation = f.attestation(Category::Poor, payout, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let expected = Disbursement {
        recipient: f.recipient.clone(),
        category: Category::Poor,
        amount: payout,
        sequence: 0,
        attestation_hash: f.attestation_hash(&attestation),
    }
    .to_xdr(&f.env, &f.gate_id);

    gate.distribute(
        &f.recipient,
        &Category::Poor,
        &payout,
        &attestation,
        &sigs,
    );

    // Immediately, and before any view call: see the note in
    // `contribute_credits_every_bucket`. The hash is built above for the same
    // reason, so that nothing runs between the call and the assertion.
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.gate_id),
        std::vec![expected]
    );

    assert_eq!(f.token().balance(&f.recipient), payout);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION - payout);
    assert_eq!(gate.bucket(&Category::Poor), 300_000 - payout);
    // Only the named bucket moved.
    assert_eq!(gate.bucket(&Category::Administrators), 100_000);
    assert_eq!(gate.bucket(&Category::Wayfarers), 50_000);
    // The consumed sequence is spent, so the same attestation is now stale.
    assert_eq!(gate.distribution_seq(), 1);
}

#[test]
fn signatures_beyond_the_threshold_are_accepted() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // 3-of-3 where 2 would do. The rule is "at least threshold distinct valid
    // signers", not "exactly threshold".
    let attestation = f.attestation(Category::Wayfarers, 50_000, 0);
    let sigs = f.sign(&attestation, &[0, 1, 2]);

    gate.distribute(
        &f.recipient,
        &Category::Wayfarers,
        &50_000,
        &attestation,
        &sigs,
    );

    assert_eq!(gate.bucket(&Category::Wayfarers), 0);
    assert_eq!(f.token().balance(&f.recipient), 50_000);
}

#[test]
fn consecutive_distributions_advance_the_sequence() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    for sequence in 0..3u64 {
        let attestation = f.attestation(Category::Administrators, 10_000, sequence);
        let sigs = f.sign(&attestation, &[1, 2]);
        gate.distribute(
            &f.recipient,
            &Category::Administrators,
            &10_000,
            &attestation,
            &sigs,
        );
        assert_eq!(gate.distribution_seq(), sequence + 1);
    }

    assert_eq!(gate.bucket(&Category::Administrators), 100_000 - 30_000);
    assert_eq!(f.token().balance(&f.recipient), 30_000);
}

#[test]
fn a_second_contribution_accumulates() {
    let f = setup();
    let gate = f.client();

    gate.contribute(&f.contributor, &CONTRIBUTION);
    gate.contribute(&f.contributor, &CONTRIBUTION);

    assert_eq!(gate.bucket(&Category::Poor), 600_000);
    assert_eq!(gate.bucket(&Category::Administrators), 200_000);
    assert_eq!(gate.bucket(&Category::Wayfarers), 100_000);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION * 2);
}

#[test]
fn split_sums_to_the_input() {
    let env = Env::default();

    // Amounts chosen so the two floor-divided buckets leave a remainder that
    // the Poor bucket has to absorb. This is the hand-picked version of the
    // property the funded build should state with proptest.
    for amount in [1i128, 3, 7, 9_999, 10_000, 10_001, 123_456_789] {
        let parts = policy::split(&env, amount).unwrap();
        let sum: i128 = parts.values().iter().sum();
        assert_eq!(sum, amount, "split of {} did not sum to itself", amount);
        assert_eq!(parts.len(), 8);
    }
}

#[test]
fn a_surplus_sent_straight_to_the_pool_belongs_to_no_bucket() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Anyone can transfer the asset to the contract address without going
    // through `contribute`, and the contract cannot prevent it.
    f.token().transfer(&f.contributor, &f.gate_id, &500_000);

    // The surplus is visible in the balance and allocated to nothing, so it can
    // never be distributed. Solvency is `sum(buckets) <= balance`, not `==`.
    let claimed: i128 = gate.buckets().values().iter().sum();
    assert_eq!(claimed, CONTRIBUTION);
    assert_eq!(f.token().balance(&f.gate_id), CONTRIBUTION + 500_000);

    // The surplus is not spendable, and this is the assertion that proves it.
    // The pool holds 1_500_000, so the token balance is not what refuses here:
    // the Poor bucket claims 300_000 and one unit above that is overdrawn.
    let before = f.state();
    let overdraw = f.attestation(Category::Poor, 300_001, 0);
    let overdraw_sigs = f.sign(&overdraw, &[0, 2]);
    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &300_001,
            &overdraw,
            &overdraw_sigs
        ),
        Err(Ok(Error::InsufficientBucket))
    );
    f.assert_unchanged(&before);

    // And the pool still works.
    let attestation = f.attestation(Category::Poor, 300_000, 0);
    let sigs = f.sign(&attestation, &[0, 2]);
    gate.distribute(
        &f.recipient,
        &Category::Poor,
        &300_000,
        &attestation,
        &sigs,
    );
    assert_eq!(gate.bucket(&Category::Poor), 0);
}

// --- authorisation ----------------------------------------------------------
//
// `mock_all_auths` authorises everyone, so no happy-path assertion notices a
// deleted `require_auth`. These three read `env.auths()` and pin the address,
// the contract, the function and the arguments that had to be signed for.

#[test]
fn the_constructor_requires_the_admin_to_authorise() {
    let f = setup();

    // Read before anything else, a view included: `env.auths()` reports the most
    // recent invocation only, and `setup()`'s registration is that invocation.
    assert_eq!(
        f.env.auths(),
        std::vec![(
            f.admin.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.gate_id.clone(),
                    Symbol::new(&f.env, "__constructor"),
                    (
                        f.admin.clone(),
                        f.authority.clone(),
                        THRESHOLD,
                        f.distributor.clone(),
                        f.asset.clone(),
                    )
                        .into_val(&f.env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
fn contribute_requires_the_contributor_to_authorise() {
    let f = setup();

    f.client().contribute(&f.contributor, &CONTRIBUTION);

    // The contributor signs twice over: once for `contribute` itself, and once,
    // as a sub-invocation, for the token transfer that moves their own money.
    assert_eq!(
        f.env.auths(),
        std::vec![(
            f.contributor.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.gate_id.clone(),
                    Symbol::new(&f.env, "contribute"),
                    (f.contributor.clone(), CONTRIBUTION).into_val(&f.env),
                )),
                sub_invocations: std::vec![AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        f.asset.clone(),
                        Symbol::new(&f.env, "transfer"),
                        (f.contributor.clone(), f.gate_id.clone(), CONTRIBUTION)
                            .into_val(&f.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );
}

#[test]
fn distribute_requires_the_distributor_to_authorise() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let payout: i128 = 250_000;
    let attestation = f.attestation(Category::Poor, payout, 0);
    let sigs = f.sign(&attestation, &[0, 1]);

    gate.distribute(
        &f.recipient,
        &Category::Poor,
        &payout,
        &attestation,
        &sigs,
    );

    // One entry, and only one. The outgoing transfer is made by the pool from
    // its own balance, so it needs no signature from anybody: the distributor
    // authorises the submission and nothing else.
    assert_eq!(
        f.env.auths(),
        std::vec![(
            f.distributor.clone(),
            AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    f.gate_id.clone(),
                    Symbol::new(&f.env, "distribute"),
                    (
                        f.recipient.clone(),
                        Category::Poor,
                        payout,
                        attestation.clone(),
                        sigs.clone(),
                    )
                        .into_val(&f.env),
                )),
                sub_invocations: std::vec![],
            }
        )]
    );
}

#[test]
fn submission_by_an_authority_key_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let payout: i128 = 250_000;
    let attestation = f.attestation(Category::Poor, payout, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    // Holding an authority key confers nothing at the ledger: to the contract,
    // the holder is one more address that is not the distributor. This is the
    // only test that narrows the mock, because a wrong-caller refusal cannot be
    // written while `mock_all_auths` authorises every caller.
    let holder = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &holder,
        invoke: &MockAuthInvoke {
            contract: &f.gate_id,
            fn_name: "distribute",
            args: (
                f.recipient.clone(),
                Category::Poor,
                payout,
                attestation.clone(),
                sigs.clone(),
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);

    // An unmet `require_auth` is a host error and not a contract error: the body
    // never runs, so there is no typed variant for it to return.
    assert!(matches!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &payout,
            &attestation,
            &sigs
        ),
        Err(Err(_))
    ));
    f.assert_unchanged(&before);
}

// --- refusals: the quorum ---------------------------------------------------

#[test]
fn below_threshold_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let attestation = f.attestation(Category::Poor, 250_000, 0);
    let sigs = f.sign(&attestation, &[0]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::ThresholdNotMet))
    );
    f.assert_unchanged(&before);
}

#[test]
fn wrong_key_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let attestation = f.attestation(Category::Poor, 250_000, 0);
    let outsider = SigningKey::from_bytes(&OUTSIDER_SEED);
    let sigs = f.sign_with(&attestation, &outsider, 0);
    let before = f.state();

    // `ed25519_verify` traps rather than returning: the host has no fallible
    // variant, so a signature that does not match the key at its index is a host
    // error by design and there is no typed error for it.
    assert!(matches!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Err(_))
    ));
    f.assert_unchanged(&before);
}

#[test]
fn duplicate_signer_counts_once() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Both signatures are valid. Both are key zero's. Two of three is not met by
    // one key signing twice.
    let attestation = f.attestation(Category::Poor, 250_000, 0);
    let sigs = f.sign(&attestation, &[0, 0]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::ThresholdNotMet))
    );
    f.assert_unchanged(&before);
}

#[test]
fn unknown_signer_index_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Three keys occupy indexes 0, 1 and 2. Index 3 is off the end, and the
    // bounds check refuses before any signature is looked at.
    let attestation = f.attestation(Category::Poor, 250_000, 0);
    let sigs = f.sign_with(&attestation, &f.signers[0], 3);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::UnknownSigner))
    );
    f.assert_unchanged(&before);
}

#[test]
fn duplicate_authority_key_is_refused_at_construction() {
    let f = setup();

    // `[K1, K1, K2]` at a threshold of two is a one-of-two pool wearing a
    // two-of-three label: `verify_quorum` dedupes on the index, so K1 signing at
    // both of its positions would meet the threshold on its own.
    let mut authority = Vec::new(&f.env);
    authority.push_back(f.authority.get_unchecked(0));
    authority.push_back(f.authority.get_unchecked(0));
    authority.push_back(f.authority.get_unchecked(1));

    assert_construction_refused(
        &f.env,
        &f.admin,
        &authority,
        2,
        &f.distributor,
        &f.asset,
        Error::DuplicateAuthorityKey,
    );
}

#[test]
fn threshold_zero_is_refused_at_construction() {
    let f = setup();

    assert_construction_refused(
        &f.env,
        &f.admin,
        &f.authority,
        0,
        &f.distributor,
        &f.asset,
        Error::InvalidThreshold,
    );
}

#[test]
fn threshold_above_key_count_is_refused_at_construction() {
    let f = setup();

    assert_construction_refused(
        &f.env,
        &f.admin,
        &f.authority,
        4,
        &f.distributor,
        &f.asset,
        Error::InvalidThreshold,
    );
}

// --- refusals: the payload --------------------------------------------------

#[test]
fn altered_amount_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let attestation = f.attestation(Category::Poor, 250_000, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    // Signed for 250_000, submitted for 250_001. The argument and the
    // attestation are compared before any signature work happens.
    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_001,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::AttestationMismatch))
    );
    f.assert_unchanged(&before);
}

#[test]
fn altered_recipient_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let attestation = f.attestation(Category::Poor, 250_000, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let elsewhere = Address::generate(&f.env);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &elsewhere,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::AttestationMismatch))
    );
    f.assert_unchanged(&before);
    // The redirect target gained nothing either.
    assert_eq!(f.token().balance(&elsewhere), 0);
}

#[test]
fn altered_category_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Signed against Poor, submitted against Wayfarers, which also holds enough
    // to pay it. The bucket the signature named is the only one it authorises.
    let attestation = f.attestation(Category::Poor, 50_000, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Wayfarers,
            &50_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::AttestationMismatch))
    );
    f.assert_unchanged(&before);
}

#[test]
fn altered_attestation_after_signing_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // The argument-versus-attestation check is a cheap early refusal, not the
    // guarantee. Raise the amount inside the attestation after signing and match
    // the argument to it, and every equality check passes; what refuses is the
    // signature, over bytes that no longer serialise to what was signed.
    let mut attestation = f.attestation(Category::Poor, 250_000, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    attestation.amount = 250_001;
    let before = f.state();

    // A trap, not a typed error: see the note in `wrong_key_is_refused`.
    assert!(matches!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_001,
            &attestation,
            &sigs
        ),
        Err(Err(_))
    ));
    f.assert_unchanged(&before);
}

// --- refusals: the wrong door -----------------------------------------------

#[test]
fn wrong_asset_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // A second SAC, registered and real, but not the one this pool was pinned to
    // at deployment.
    let other = env_second_asset(&f);
    let mut attestation = f.attestation(Category::Poor, 250_000, 0);
    attestation.asset = other;
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::WrongAsset))
    );
    f.assert_unchanged(&before);
}

#[test]
fn wrong_pool_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // A second deployment of this same contract, with the same authority keys
    // and the same threshold. Without the `pool` binding, one signature would be
    // good against both.
    let twin = f.env.register(
        AttestationGate,
        AttestationGateArgs::__constructor(
            &f.admin,
            &f.authority,
            &THRESHOLD,
            &f.distributor,
            &f.asset,
        ),
    );
    let mut attestation = f.attestation(Category::Poor, 250_000, 0);
    attestation.pool = twin;
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::WrongPool))
    );
    f.assert_unchanged(&before);
}

#[test]
fn wrong_network_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let mut attestation = f.attestation(Category::Poor, 250_000, 0);
    attestation.network_id = BytesN::from_array(&f.env, &[0u8; 32]);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::WrongNetwork))
    );
    f.assert_unchanged(&before);
}

// --- refusals: freshness and replay -----------------------------------------

#[test]
fn consumed_sequence_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let attestation = f.attestation(Category::Poor, 250_000, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    gate.distribute(
        &f.recipient,
        &Category::Poor,
        &250_000,
        &attestation,
        &sigs,
    );

    // Same attestation, same signatures, submitted again. The pool has moved on
    // to sequence one and the slot the approval names is spent.
    let before = f.state();
    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::SequenceMismatch))
    );
    f.assert_unchanged(&before);
}

#[test]
fn future_sequence_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Attestations are consumed strictly in order, so one signed for a slot the
    // pool has not reached yet is refused rather than queued.
    let attestation = f.attestation(Category::Poor, 250_000, 1);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::SequenceMismatch))
    );
    f.assert_unchanged(&before);
}

#[test]
fn expired_attestation_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Signed to lapse at the ledger the pool started on, and submitted five
    // hundred ledgers later: strictly behind.
    let mut attestation = f.attestation(Category::Poor, 250_000, 0);
    attestation.expiry_ledger = START_LEDGER;
    let sigs = f.sign(&attestation, &[0, 1]);
    f.env.ledger().set_sequence_number(START_LEDGER + 500);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::Expired))
    );
    f.assert_unchanged(&before);
}

#[test]
fn expiry_at_boundary_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Equal to the current ledger, not behind it. The comparison is
    // `expiry_ledger <= sequence`, so the named ledger is already too late and
    // the boundary is not off by one.
    let mut attestation = f.attestation(Category::Poor, 250_000, 0);
    attestation.expiry_ledger = f.env.ledger().sequence();
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::Expired))
    );
    f.assert_unchanged(&before);
}

// --- refusals: amounts and accounting ---------------------------------------

#[test]
fn insufficient_bucket_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Wayfarers holds a twentieth of the contribution. One unit above that is
    // refused even though the pool as a whole holds twenty times the amount.
    assert_eq!(gate.bucket(&Category::Wayfarers), 50_000);
    let attestation = f.attestation(Category::Wayfarers, 50_001, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.recipient,
            &Category::Wayfarers,
            &50_001,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::InsufficientBucket))
    );
    f.assert_unchanged(&before);
}

#[test]
fn zero_contribution_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);
    let before = f.state();

    assert_eq!(
        gate.try_contribute(&f.contributor, &0),
        Err(Ok(Error::InvalidAmount))
    );
    f.assert_unchanged(&before);
}

#[test]
fn negative_contribution_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);
    let before = f.state();

    // A contribution of minus one would be a withdrawal wearing the wrong name.
    assert_eq!(
        gate.try_contribute(&f.contributor, &-1),
        Err(Ok(Error::InvalidAmount))
    );
    f.assert_unchanged(&before);
}

#[test]
fn zero_distribution_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    let attestation = f.attestation(Category::Poor, 0, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(&f.recipient, &Category::Poor, &0, &attestation, &sigs),
        Err(Ok(Error::InvalidAmount))
    );
    f.assert_unchanged(&before);
}

#[test]
fn negative_distribution_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // Signed and quorate, and still refused: a negative payout would credit the
    // bucket and debit the recipient.
    let attestation = f.attestation(Category::Poor, -1, 0);
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(&f.recipient, &Category::Poor, &-1, &attestation, &sigs),
        Err(Ok(Error::InvalidAmount))
    );
    f.assert_unchanged(&before);
}

#[test]
fn self_distribution_is_refused() {
    let f = setup();
    let gate = f.client();
    gate.contribute(&f.contributor, &CONTRIBUTION);

    // A transfer to self would leave the bucket decremented and the tokens
    // unallocated, with no recovery path.
    let mut attestation = f.attestation(Category::Poor, 250_000, 0);
    attestation.recipient = f.gate_id.clone();
    let sigs = f.sign(&attestation, &[0, 1]);
    let before = f.state();

    assert_eq!(
        gate.try_distribute(
            &f.gate_id,
            &Category::Poor,
            &250_000,
            &attestation,
            &sigs
        ),
        Err(Ok(Error::SelfDistribution))
    );
    f.assert_unchanged(&before);
}

// --- the committed known-answer vector --------------------------------------
//
// Everything above derives the signed bytes from the SDK's `to_xdr`, which
// proves the contract agrees with `ed25519-dalek` and nothing about whether a
// non-Rust signer can reproduce the preimage. These fixed values, the XDR they
// serialise to, and the signature over it are committed in
// `test_vectors/attestation.json` as the reference for anyone implementing the
// signer outside this crate. The test below is what keeps the file honest: if
// the struct layout or the field order ever changes, it fails here rather than
// silently in someone else's integration.

const VECTOR_RECIPIENT: &str = "GDQNY3PBOJOKYZSRMK2S7LHHGWZIUISD4QORETLMXEWXBI7KFZZMKTL3";
const VECTOR_ASSET: &str = "CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE";
const VECTOR_POOL: &str = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const VECTOR_AMOUNT: i128 = 250_000;
const VECTOR_SEQUENCE: u64 = 7;
const VECTOR_EXPIRY_LEDGER: u32 = 1_000;
const VECTOR_NETWORK_ID: [u8; 32] = [7u8; 32];

const VECTOR_JSON: &str = include_str!("../test_vectors/attestation.json");

fn vector_attestation(env: &Env) -> Attestation {
    Attestation {
        recipient: Address::from_str(env, VECTOR_RECIPIENT),
        asset: Address::from_str(env, VECTOR_ASSET),
        category: Category::Poor,
        amount: VECTOR_AMOUNT,
        sequence: VECTOR_SEQUENCE,
        expiry_ledger: VECTOR_EXPIRY_LEDGER,
        pool: Address::from_str(env, VECTOR_POOL),
        network_id: BytesN::from_array(env, &VECTOR_NETWORK_ID),
    }
}

fn hex(bytes: &[u8]) -> std::string::String {
    let mut out = std::string::String::new();
    for byte in bytes {
        out.push_str(&std::format!("{:02x}", byte));
    }
    out
}

/// Read one string field out of the committed vector.
///
/// Hand-rolled rather than a JSON dependency: the file sits beside this test,
/// its shape is fixed, and every value in it is a string, so a parser would be
/// weight without a purpose.
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
    let attestation = vector_attestation(&env);

    // The field values, so the file is a readable specification and not only a
    // blob to diff against.
    assert_eq!(vector_field("recipient"), VECTOR_RECIPIENT);
    assert_eq!(vector_field("asset"), VECTOR_ASSET);
    assert_eq!(vector_field("category"), "Poor");
    assert_eq!(vector_field("amount"), "250000");
    assert_eq!(vector_field("sequence"), "7");
    assert_eq!(vector_field("expiry_ledger"), "1000");
    assert_eq!(vector_field("pool"), VECTOR_POOL);
    assert_eq!(vector_field("network_id"), hex(&VECTOR_NETWORK_ID));

    // The preimage. This is the byte string an off-chain signer has to
    // reproduce, and the one the contract hands to `ed25519_verify`.
    let signed_bytes: std::vec::Vec<u8> = attestation.clone().to_xdr(&env).iter().collect();
    assert_eq!(
        hex(&signed_bytes),
        vector_field("signed_bytes_hex"),
        "the XDR of the attestation no longer matches the committed vector"
    );

    // The signature, from the first authority seed.
    let signer = SigningKey::from_bytes(&AUTHORITY_SEEDS[0]);
    assert_eq!(hex(&AUTHORITY_SEEDS[0]), vector_field("signer_seed_hex"));
    assert_eq!(
        hex(&signer.verifying_key().to_bytes()),
        vector_field("signer_public_key_hex")
    );
    let signature = signer.sign(&signed_bytes).to_bytes();
    assert_eq!(hex(&signature), vector_field("signature_hex"));

    // And the host's own verifier accepts the committed pair, so the vector is
    // checked against the contract's verification path rather than being merely
    // self-consistent. This traps if it does not hold.
    env.crypto().ed25519_verify(
        &BytesN::from_array(&env, &signer.verifying_key().to_bytes()),
        &attestation.to_xdr(&env),
        &BytesN::from_array(&env, &signature),
    );
}

// --- helpers ----------------------------------------------------------------

/// A second registered SAC, for the wrong-asset refusal.
fn env_second_asset(f: &Fixture) -> Address {
    f.env
        .register_stellar_asset_contract_v2(Address::generate(&f.env))
        .address()
}
