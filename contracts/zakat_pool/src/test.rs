// SPDX-License-Identifier: Apache-2.0

//! The happy paths, the authorisation assertions, and the refusal matrix,
//! ported from the demo and extended for assets, governance and the two
//! untrusted callees.
//!
//! `policy` and `attestation` are the real contracts unless a test is about a
//! callee misbehaving, in which case a mock answers at the pinned address.
//! `env.events().all()` and `env.auths()` show the most recent invocation only,
//! so each such assertion sits directly after the call it is about. Every
//! refusal asserts the exact error and that the pool did not move.

#![cfg(test)]

extern crate std;

use ed25519_dalek::{Signer, SigningKey};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::{Address as _, AuthorizedFunction, Events, Ledger, MockAuth, MockAuthInvoke},
    token, vec,
    xdr::ToXdr,
    Address, Bytes, BytesN, Env, Event, IntoVal, Symbol, Vec,
};

use crate::*;
use ::attestation::{Attestation as AttestationContract, AttestationArgs};
use ::policy::{
    Allocation, DischargeTiming, NisabBasis, Parameters, Policy, PolicyArgs, PolicyClient,
};

const SEEDS: [[u8; 32]; 3] = [[11u8; 32], [22u8; 32], [33u8; 32]];
const OUTSIDER: [u8; 32] = [44u8; 32];
const THRESHOLD: u32 = 2;
const PLACEHOLDER: [u32; 8] = [3000, 2000, 1000, 500, 500, 1500, 1000, 500];
const CONTRIBUTION: i128 = 1_000_000;
const START_LEDGER: u32 = 100;
const EXPIRY_LEDGER: u32 = 1_000;
const TIMELOCK: u32 = MIN_TIMELOCK_LEDGERS;
const PASSPHRASE: &str = "Test SDF Network ; September 2015";

/// Everything a refusal has to leave exactly as it found it.
#[derive(Clone, Debug, Eq, PartialEq)]
struct State {
    sequence: u64,
    buckets: Vec<i128>,
    recipient_balance: i128,
    donor_balance: i128,
    pool_balance: i128,
    pending: Option<PendingChange>,
}

struct Fixture {
    env: Env,
    pool: Address,
    policy: Address,
    attestation: Address,
    asset: Address,
    donor: Address,
    recipient: Address,
    governance: Address,
    distributor: Address,
    signers: std::vec::Vec<SigningKey>,
}

fn allocation(env: &Env, split: &[u32]) -> Allocation {
    Allocation {
        split_bps: Vec::from_slice(env, split),
        remainder: Category::Poor,
    }
}

fn parameters() -> Parameters {
    Parameters {
        nisab_basis: NisabBasis::Gold,
        rate_bps: 250,
        amil_cap_bps: 1250,
        discharge_timing: DischargeTiming::Received,
    }
}

fn setup() -> Fixture {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_sequence_number(START_LEDGER);
    let network_id = env
        .crypto()
        .sha256(&Bytes::from_slice(&env, PASSPHRASE.as_bytes()))
        .to_bytes();
    env.ledger().set_network_id(network_id.to_array());
    // The timelock tests run far past the default TTLs.
    env.ledger().with_mut(|l| {
        l.min_persistent_entry_ttl = 2_000_000;
        l.min_temp_entry_ttl = 2_000_000;
        l.max_entry_ttl = 6_000_000;
    });

    let governance = Address::generate(&env);
    let distributor = Address::generate(&env);
    let donor = Address::generate(&env);
    let recipient = Address::generate(&env);

    let asset = env
        .register_stellar_asset_contract_v2(Address::generate(&env))
        .address();
    token::StellarAssetClient::new(&env, &asset).mint(&donor, &(CONTRIBUTION * 10));

    let signers: std::vec::Vec<SigningKey> = SEEDS.iter().map(SigningKey::from_bytes).collect();
    let mut authority = Vec::new(&env);
    for signer in &signers {
        authority.push_back(BytesN::from_array(&env, &signer.verifying_key().to_bytes()));
    }

    // Policy and pool each need the other's address, so the pool's is settled
    // first, as the deploy script does with a salt.
    let pool = Address::generate(&env);
    let policy = env.register(
        Policy,
        PolicyArgs::__constructor(&pool, &allocation(&env, &PLACEHOLDER), &parameters()),
    );
    let attestation = env.register(
        AttestationContract,
        AttestationArgs::__constructor(&authority, &THRESHOLD),
    );
    env.register_at(
        &pool,
        ZakatPool,
        ZakatPoolArgs::__constructor(
            &governance,
            &distributor,
            &policy,
            &attestation,
            &asset,
            &TIMELOCK,
        ),
    );

    Fixture {
        env,
        pool,
        policy,
        attestation,
        asset,
        donor,
        recipient,
        governance,
        distributor,
        signers,
    }
}

impl Fixture {
    fn client(&self) -> ZakatPoolClient<'_> {
        ZakatPoolClient::new(&self.env, &self.pool)
    }

    fn token(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.asset)
    }

    /// Valid for this deployment right now. Tests overwrite the one field under
    /// test before signing, so what fails is exactly what the name says.
    fn payload(&self, category: Category, amount: i128, sequence: u64) -> Attestation {
        Attestation {
            recipient: self.recipient.clone(),
            asset: self.asset.clone(),
            category,
            amount,
            sequence,
            expiry_ledger: EXPIRY_LEDGER,
            pool: self.pool.clone(),
            network_id: self.env.ledger().network_id(),
        }
    }

    fn signature(&self, payload: &Attestation, key: &SigningKey, index: u32) -> SignerSig {
        let message: std::vec::Vec<u8> = payload.clone().to_xdr(&self.env).iter().collect();
        SignerSig {
            index,
            signature: BytesN::from_array(&self.env, &key.sign(&message).to_bytes()),
        }
    }

    fn signed(&self, payload: &Attestation, indexes: &[u32]) -> SignedAttestation {
        let mut signatures = Vec::new(&self.env);
        for index in indexes {
            signatures.push_back(self.signature(payload, &self.signers[*index as usize], *index));
        }
        SignedAttestation {
            payload: payload.clone(),
            signatures,
        }
    }

    fn state(&self) -> State {
        let pool = self.client();
        State {
            sequence: pool.distribution_seq(),
            buckets: pool.balances(&self.asset),
            recipient_balance: self.token().balance(&self.recipient),
            donor_balance: self.token().balance(&self.donor),
            pool_balance: self.token().balance(&self.pool),
            pending: pool.pending_change(),
        }
    }

    fn give(&self) {
        self.client()
            .contribute(&self.donor, &self.asset, &CONTRIBUTION);
    }

    /// Attempt a payout the way a refusal test wants: assert the error, then
    /// assert nothing moved.
    fn refuse(
        &self,
        recipient: &Address,
        asset: &Address,
        amount: i128,
        category: Category,
        attestation: &SignedAttestation,
        want: Error,
    ) {
        let before = self.state();
        assert_eq!(
            self.client()
                .try_distribute(recipient, asset, &amount, &category, attestation),
            Err(Ok(want))
        );
        assert_eq!(self.state(), before, "a refused payout moved the pool");
    }

    /// A payout whose only defect is the field a test changes in `edit`.
    fn refuse_edited(&self, edit: impl FnOnce(&mut Attestation), want: Error) {
        let mut payload = self.payload(Category::Poor, 250_000, 0);
        edit(&mut payload);
        let signed = self.signed(&payload, &[0, 1]);
        self.refuse(
            &self.recipient,
            &self.asset,
            250_000,
            Category::Poor,
            &signed,
            want,
        );
    }

    fn past_timelock(&self, execute_after: u32) {
        self.env.ledger().set_sequence_number(execute_after + 1);
    }
}

// --- construction -------------------------------------------------------------

#[test]
fn constructor_stores_the_configuration() {
    let f = setup();
    let pool = f.client();
    assert_eq!(pool.governance(), f.governance);
    assert_eq!(pool.distributor(), f.distributor);
    assert_eq!(pool.policy(), f.policy);
    assert_eq!(pool.attestation(), f.attestation);
    assert_eq!(pool.approved_assets(), vec![&f.env, f.asset.clone()]);
    assert_eq!(pool.distribution_seq(), 0);
    assert_eq!(pool.timelock_ledgers(), TIMELOCK);
    assert!(!pool.is_paused());
    assert!(!pool.is_distributor_disabled());
    assert_eq!(pool.pending_change(), None);
    assert_eq!(
        pool.balances(&f.asset),
        vec![&f.env, 0, 0, 0, 0, 0, 0, 0, 0]
    );
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

fn refuse_construction(
    env: &Env,
    governance: &Address,
    distributor: &Address,
    timelock: u32,
    want: Error,
) {
    let (policy, attestation, asset) = (
        Address::generate(env),
        Address::generate(env),
        Address::generate(env),
    );
    let message = refusal_of(|| {
        env.register(
            ZakatPool,
            ZakatPoolArgs::__constructor(
                governance,
                distributor,
                &policy,
                &attestation,
                &asset,
                &timelock,
            ),
        );
    });
    assert_refused(&message, want as u32);
}

#[test]
fn a_timelock_under_seven_days_is_refused_at_construction() {
    let env = Env::default();
    env.mock_all_auths();
    let (g, d) = (Address::generate(&env), Address::generate(&env));
    refuse_construction(
        &env,
        &g,
        &d,
        MIN_TIMELOCK_LEDGERS - 1,
        Error::TimelockTooShort,
    );
}

#[test]
fn governance_cannot_also_be_the_distributor() {
    let env = Env::default();
    env.mock_all_auths();
    let g = Address::generate(&env);
    refuse_construction(&env, &g, &g, TIMELOCK, Error::RolesOverlap);
}

#[test]
fn the_constructor_requires_governance_to_authorise() {
    let f = setup();
    // Read before anything else, a view included: `setup()`'s registration of
    // the pool is the most recent invocation.
    let (who, invocation) = f.env.auths().first().cloned().unwrap();
    assert_eq!(who, f.governance);
    assert_eq!(
        invocation.function,
        AuthorizedFunction::Contract((
            f.pool.clone(),
            Symbol::new(&f.env, "__constructor"),
            (
                f.governance.clone(),
                f.distributor.clone(),
                f.policy.clone(),
                f.attestation.clone(),
                f.asset.clone(),
                TIMELOCK,
            )
                .into_val(&f.env),
        ))
    );
}

// --- contribute ---------------------------------------------------------------

#[test]
fn contribute_credits_every_bucket_and_emits_the_split() {
    let f = setup();
    f.give();
    let split = vec![
        &f.env,
        300_000i128,
        200_000,
        100_000,
        50_000,
        50_000,
        150_000,
        100_000,
        50_000,
    ];
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![Contribution {
            donor: f.donor.clone(),
            asset: f.asset.clone(),
            amount: CONTRIBUTION,
            split: split.clone(),
        }
        .to_xdr(&f.env, &f.pool)]
    );
    assert_eq!(f.client().balances(&f.asset), split);
    assert_eq!(f.token().balance(&f.pool), CONTRIBUTION);
}

#[test]
fn a_second_contribution_accumulates() {
    let f = setup();
    f.give();
    f.give();
    assert_eq!(f.client().balances(&f.asset).get_unchecked(0), 600_000);
    assert_eq!(f.token().balance(&f.pool), CONTRIBUTION * 2);
}

#[test]
fn contribute_requires_the_donor_to_authorise() {
    let f = setup();
    f.give();
    let (who, invocation) = f.env.auths().first().cloned().unwrap();
    assert_eq!(who, f.donor);
    assert_eq!(
        invocation.function,
        AuthorizedFunction::Contract((
            f.pool.clone(),
            Symbol::new(&f.env, "contribute"),
            (f.donor.clone(), f.asset.clone(), CONTRIBUTION).into_val(&f.env),
        ))
    );
}

#[test]
fn a_contribution_without_the_donors_authorisation_fails() {
    let f = setup();
    let before = f.state();
    f.env.mock_auths(&[]);
    assert!(f
        .client()
        .try_contribute(&f.donor, &f.asset, &CONTRIBUTION)
        .is_err());
    f.env.mock_all_auths();
    assert_eq!(f.state(), before);
}

#[test]
fn zero_and_negative_contributions_are_refused() {
    let f = setup();
    let before = f.state();
    for amount in [0i128, -1, i128::MIN] {
        assert_eq!(
            f.client().try_contribute(&f.donor, &f.asset, &amount),
            Err(Ok(Error::InvalidAmount))
        );
    }
    assert_eq!(f.state(), before);
}

#[test]
fn an_asset_that_is_not_approved_is_refused() {
    let f = setup();
    let other = f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&f.env))
        .address();
    token::StellarAssetClient::new(&f.env, &other).mint(&f.donor, &CONTRIBUTION);
    let before = f.state();
    assert_eq!(
        f.client().try_contribute(&f.donor, &other, &CONTRIBUTION),
        Err(Ok(Error::AssetNotApproved))
    );
    assert_eq!(f.state(), before);
    assert_eq!(token::Client::new(&f.env, &other).balance(&f.pool), 0);
}

#[test]
fn a_surplus_sent_straight_to_the_pool_belongs_to_no_bucket() {
    let f = setup();
    f.give();
    f.token().transfer(&f.donor, &f.pool, &777);
    let claimed: i128 = f.client().balances(&f.asset).iter().sum();
    assert_eq!(claimed, CONTRIBUTION);
    assert_eq!(f.token().balance(&f.pool), CONTRIBUTION + 777);
}

// --- policy is untrusted ------------------------------------------------------

#[contracttype]
enum MockKey {
    Answer,
}

#[contract]
struct MockPolicy;

#[contractimpl]
impl MockPolicy {
    pub fn __constructor(env: Env, answer: Vec<i128>) {
        env.storage().instance().set(&MockKey::Answer, &answer);
    }

    pub fn allocate(env: Env, _amount: i128) -> Vec<i128> {
        env.storage().instance().get(&MockKey::Answer).unwrap()
    }
}

/// Answers `allocate` with a bare number instead of a vector.
#[contract]
struct WrongTypePolicy;

#[contractimpl]
impl WrongTypePolicy {
    pub fn allocate(_env: Env, _amount: i128) -> u32 {
        8
    }
}

/// Repoint the pool directly, standing in for an executed change, so these
/// tests are about the shape check and not the timelock.
fn point_at_policy(f: &Fixture, policy: &Address) {
    f.env.as_contract(&f.pool, || {
        f.env.storage().instance().set(&DataKey::PolicyAddr, policy);
    });
}

fn refuse_policy_answer(answer: &[i128]) {
    let f = setup();
    let mock = f
        .env
        .register(MockPolicy, (Vec::<i128>::from_slice(&f.env, answer),));
    point_at_policy(&f, &mock);
    let before = f.state();
    assert_eq!(
        f.client().try_contribute(&f.donor, &f.asset, &100),
        Err(Ok(Error::InvalidAllocation))
    );
    assert_eq!(f.state(), before);
}

#[test]
fn an_allocation_of_seven_elements_is_rejected() {
    refuse_policy_answer(&[50, 10, 10, 10, 10, 5, 5]);
}

#[test]
fn an_allocation_of_nine_elements_is_rejected() {
    refuse_policy_answer(&[50, 10, 10, 10, 10, 5, 5, 0, 0]);
}

#[test]
fn an_allocation_with_a_negative_element_is_rejected() {
    // Sums correctly to 100: the case a sum-only check would admit.
    refuse_policy_answer(&[150, -50, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn an_allocation_with_a_short_sum_is_rejected() {
    refuse_policy_answer(&[50, 10, 10, 10, 10, 5, 4, 0]);
}

#[test]
fn an_allocation_with_a_long_sum_is_rejected() {
    refuse_policy_answer(&[50, 10, 10, 10, 10, 5, 6, 0]);
}

#[test]
fn an_allocation_that_overflows_is_rejected() {
    refuse_policy_answer(&[i128::MAX, i128::MAX, 0, 0, 0, 0, 0, 0]);
}

#[test]
fn a_policy_that_returns_the_wrong_type_is_rejected() {
    let f = setup();
    let mock = f.env.register(WrongTypePolicy, ());
    point_at_policy(&f, &mock);
    assert_eq!(
        f.client().try_contribute(&f.donor, &f.asset, &100),
        Err(Ok(Error::InvalidAllocation))
    );
}

#[test]
fn a_well_formed_mock_allocation_is_accepted() {
    let f = setup();
    let answer = [100i128, 0, 0, 0, 0, 0, 0, 0];
    let mock = f
        .env
        .register(MockPolicy, (Vec::<i128>::from_slice(&f.env, &answer),));
    point_at_policy(&f, &mock);
    f.client().contribute(&f.donor, &f.asset, &100);
    assert_eq!(
        f.client().balances(&f.asset),
        Vec::<i128>::from_slice(&f.env, &answer)
    );
}

// --- distribute ---------------------------------------------------------------

#[test]
fn distribute_pays_out_against_a_valid_quorum() {
    let f = setup();
    f.give();
    let payload = f.payload(Category::Poor, 250_000, 0);
    let signed = f.signed(&payload, &[0, 1]);
    let hash = f
        .env
        .crypto()
        .sha256(&payload.clone().to_xdr(&f.env))
        .to_bytes();
    let expected = Disbursement {
        recipient: f.recipient.clone(),
        category: Category::Poor,
        asset: f.asset.clone(),
        amount: 250_000,
        sequence: 0,
        attestation_hash: hash,
    }
    .to_xdr(&f.env, &f.pool);

    f.client()
        .distribute(&f.recipient, &f.asset, &250_000, &Category::Poor, &signed);

    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![expected]
    );
    assert_eq!(f.token().balance(&f.recipient), 250_000);
    assert_eq!(f.client().balances(&f.asset).get_unchecked(0), 50_000);
    assert_eq!(f.client().distribution_seq(), 1);
}

#[test]
fn signatures_beyond_the_threshold_are_accepted() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Poor, 1, 0), &[0, 1, 2]);
    f.client()
        .distribute(&f.recipient, &f.asset, &1, &Category::Poor, &signed);
    assert_eq!(f.token().balance(&f.recipient), 1);
}

#[test]
fn consecutive_distributions_advance_the_sequence() {
    let f = setup();
    f.give();
    for sequence in 0..3u64 {
        let signed = f.signed(&f.payload(Category::Needy, 10, sequence), &[1, 2]);
        f.client()
            .distribute(&f.recipient, &f.asset, &10, &Category::Needy, &signed);
    }
    assert_eq!(f.client().distribution_seq(), 3);
    assert_eq!(f.token().balance(&f.recipient), 30);
}

#[test]
fn distribute_requires_the_distributor_to_authorise() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Poor, 1, 0), &[0, 1]);
    f.client()
        .distribute(&f.recipient, &f.asset, &1, &Category::Poor, &signed);
    let (who, _) = f.env.auths().first().cloned().unwrap();
    assert_eq!(who, f.distributor);
}

#[test]
fn submission_by_an_authority_key_is_refused() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Poor, 1, 0), &[0, 1]);
    let before = f.state();
    let holder = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &holder,
        invoke: &MockAuthInvoke {
            contract: &f.pool,
            fn_name: "distribute",
            args: (
                f.recipient.clone(),
                f.asset.clone(),
                1i128,
                Category::Poor,
                signed.clone(),
            )
                .into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(f
        .client()
        .try_distribute(&f.recipient, &f.asset, &1, &Category::Poor, &signed)
        .is_err());
    f.env.mock_all_auths();
    assert_eq!(f.state(), before);
}

#[test]
fn one_signature_fails_with_threshold_not_met() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Poor, 250_000, 0), &[0]);
    f.refuse(
        &f.recipient,
        &f.asset,
        250_000,
        Category::Poor,
        &signed,
        Error::ThresholdNotMet,
    );
}

#[test]
fn no_signature_fails_with_threshold_not_met() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Poor, 250_000, 0), &[]);
    f.refuse(
        &f.recipient,
        &f.asset,
        250_000,
        Category::Poor,
        &signed,
        Error::ThresholdNotMet,
    );
}

#[test]
fn a_duplicate_signer_counts_once() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Poor, 250_000, 0), &[0, 0]);
    f.refuse(
        &f.recipient,
        &f.asset,
        250_000,
        Category::Poor,
        &signed,
        Error::ThresholdNotMet,
    );
}

#[test]
fn an_unknown_signer_index_is_refused() {
    let f = setup();
    f.give();
    let payload = f.payload(Category::Poor, 250_000, 0);
    let signed = SignedAttestation {
        payload: payload.clone(),
        signatures: vec![&f.env, f.signature(&payload, &f.signers[0], 9)],
    };
    f.refuse(
        &f.recipient,
        &f.asset,
        250_000,
        Category::Poor,
        &signed,
        Error::UnknownSigner,
    );
}

#[test]
fn a_key_outside_the_authority_is_refused() {
    let f = setup();
    f.give();
    let payload = f.payload(Category::Poor, 250_000, 0);
    let outsider = SigningKey::from_bytes(&OUTSIDER);
    let signed = SignedAttestation {
        payload: payload.clone(),
        signatures: vec![
            &f.env,
            f.signature(&payload, &outsider, 0),
            f.signature(&payload, &f.signers[1], 1),
        ],
    };
    f.refuse(
        &f.recipient,
        &f.asset,
        250_000,
        Category::Poor,
        &signed,
        Error::AttestationRejected,
    );
}

#[test]
fn an_attestation_altered_after_signing_is_refused() {
    let f = setup();
    f.give();
    let mut signed = f.signed(&f.payload(Category::Poor, 250_000, 0), &[0, 1]);
    signed.payload.expiry_ledger += 1;
    f.refuse(
        &f.recipient,
        &f.asset,
        250_000,
        Category::Poor,
        &signed,
        Error::AttestationRejected,
    );
}

#[test]
fn an_altered_amount_is_refused() {
    let f = setup();
    f.give();
    f.refuse_edited(|p| p.amount = 1, Error::AttestationMismatch);
}

#[test]
fn an_altered_recipient_is_refused() {
    let f = setup();
    f.give();
    let other = Address::generate(&f.env);
    f.refuse_edited(|p| p.recipient = other, Error::AttestationMismatch);
}

#[test]
fn an_altered_category_is_refused() {
    let f = setup();
    f.give();
    f.refuse_edited(|p| p.category = Category::Needy, Error::AttestationMismatch);
}

#[test]
fn an_attestation_for_another_asset_is_refused() {
    let f = setup();
    f.give();
    let other = Address::generate(&f.env);
    f.refuse_edited(|p| p.asset = other, Error::WrongAsset);
}

#[test]
fn an_attestation_for_another_pool_is_refused() {
    let f = setup();
    f.give();
    let other = Address::generate(&f.env);
    f.refuse_edited(|p| p.pool = other, Error::WrongPool);
}

#[test]
fn an_attestation_for_another_network_is_refused() {
    let f = setup();
    f.give();
    let other = BytesN::from_array(&f.env, &[9u8; 32]);
    f.refuse_edited(|p| p.network_id = other, Error::WrongNetwork);
}

#[test]
fn a_reused_attestation_is_refused() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Poor, 10, 0), &[0, 1]);
    f.client()
        .distribute(&f.recipient, &f.asset, &10, &Category::Poor, &signed);
    f.refuse(
        &f.recipient,
        &f.asset,
        10,
        Category::Poor,
        &signed,
        Error::SequenceMismatch,
    );
}

#[test]
fn a_future_sequence_is_refused() {
    let f = setup();
    f.give();
    f.refuse_edited(|p| p.sequence = 1, Error::SequenceMismatch);
}

#[test]
fn an_expired_attestation_is_refused() {
    let f = setup();
    f.give();
    f.refuse_edited(|p| p.expiry_ledger = START_LEDGER - 1, Error::Expired);
}

#[test]
fn expiry_at_the_current_ledger_is_refused() {
    let f = setup();
    f.give();
    f.refuse_edited(|p| p.expiry_ledger = START_LEDGER, Error::Expired);
}

#[test]
fn an_empty_bucket_is_refused() {
    let f = setup();
    f.give();
    let signed = f.signed(&f.payload(Category::Wayfarers, 50_001, 0), &[0, 1]);
    f.refuse(
        &f.recipient,
        &f.asset,
        50_001,
        Category::Wayfarers,
        &signed,
        Error::InsufficientBucket,
    );
}

#[test]
fn zero_and_negative_payouts_are_refused() {
    let f = setup();
    f.give();
    for amount in [0i128, -1] {
        let signed = f.signed(&f.payload(Category::Poor, amount, 0), &[0, 1]);
        f.refuse(
            &f.recipient,
            &f.asset,
            amount,
            Category::Poor,
            &signed,
            Error::InvalidAmount,
        );
    }
}

#[test]
fn a_payout_to_the_pool_itself_is_refused() {
    let f = setup();
    f.give();
    let mut payload = f.payload(Category::Poor, 10, 0);
    payload.recipient = f.pool.clone();
    let signed = f.signed(&payload, &[0, 1]);
    f.refuse(
        &f.pool,
        &f.asset,
        10,
        Category::Poor,
        &signed,
        Error::SelfDistribution,
    );
}

#[test]
fn a_payout_in_an_asset_that_is_not_approved_is_refused() {
    let f = setup();
    f.give();
    let other = Address::generate(&f.env);
    let mut payload = f.payload(Category::Poor, 10, 0);
    payload.asset = other.clone();
    let signed = f.signed(&payload, &[0, 1]);
    f.refuse(
        &f.recipient,
        &other,
        10,
        Category::Poor,
        &signed,
        Error::AssetNotApproved,
    );
}

// --- attestation is untrusted -------------------------------------------------

/// Says yes to everything, standing in for a verifier repointed to something
/// permissive. Every binding the pool checks itself must still hold.
#[contract]
struct PermissiveVerifier;

#[contractimpl]
impl PermissiveVerifier {
    pub fn verify(_env: Env, _payload: Attestation, _signatures: Vec<SignerSig>) {}
}

/// Answers with something that is not a clean yes.
#[contract]
struct NonsenseVerifier;

#[contractimpl]
impl NonsenseVerifier {
    pub fn verify(_env: Env, _payload: Attestation, _signatures: Vec<SignerSig>) -> bool {
        true
    }
}

fn point_at_verifier(f: &Fixture, verifier: &Address) {
    f.env.as_contract(&f.pool, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::AttestAddr, verifier);
    });
}

#[test]
fn a_verifier_answering_nonsense_is_rejected() {
    let f = setup();
    f.give();
    let verifier = f.env.register(NonsenseVerifier, ());
    point_at_verifier(&f, &verifier);
    let signed = f.signed(&f.payload(Category::Poor, 10, 0), &[0, 1]);
    f.refuse(
        &f.recipient,
        &f.asset,
        10,
        Category::Poor,
        &signed,
        Error::AttestationRejected,
    );
}

#[test]
fn the_pool_checks_its_bindings_even_under_a_permissive_verifier() {
    let f = setup();
    f.give();
    let verifier = f.env.register(PermissiveVerifier, ());
    point_at_verifier(&f, &verifier);
    let other = Address::generate(&f.env);
    let other_network = BytesN::from_array(&f.env, &[9u8; 32]);
    f.refuse_edited(|p| p.expiry_ledger = START_LEDGER, Error::Expired);
    f.refuse_edited(|p| p.sequence = 5, Error::SequenceMismatch);
    f.refuse_edited(|p| p.pool = other, Error::WrongPool);
    f.refuse_edited(|p| p.network_id = other_network, Error::WrongNetwork);
    f.refuse_edited(|p| p.amount = 1, Error::AttestationMismatch);
}

// --- a token that does not move what it is asked to ----------------------------

#[contracttype]
enum FeeKey {
    Balance(Address),
}

/// Keeps 1 unit of every transfer, which no Stellar Asset Contract does.
#[contract]
struct FeeToken;

#[contractimpl]
impl FeeToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        env.storage().instance().set(&FeeKey::Balance(to), &amount);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .instance()
            .get(&FeeKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        let storage = env.storage().instance();
        let from_balance: i128 = storage.get(&FeeKey::Balance(from.clone())).unwrap_or(0);
        let to_balance: i128 = storage.get(&FeeKey::Balance(to.clone())).unwrap_or(0);
        storage.set(&FeeKey::Balance(from), &(from_balance - amount));
        storage.set(&FeeKey::Balance(to), &(to_balance + amount - 1));
    }
}

#[test]
fn a_contribution_that_arrives_short_is_refused() {
    let f = setup();
    let fee_token = f.env.register(FeeToken, ());
    FeeTokenClient::new(&f.env, &fee_token).mint(&f.donor, &1_000);
    f.env.as_contract(&f.pool, || {
        f.env
            .storage()
            .instance()
            .set(&DataKey::ApprovedAssets, &vec![&f.env, fee_token.clone()]);
    });
    assert_eq!(
        f.client().try_contribute(&f.donor, &fee_token, &100),
        Err(Ok(Error::TransferShortfall))
    );
}

// --- pause and distributor disable --------------------------------------------

#[test]
fn pause_blocks_contribute_at_once_and_does_not_block_distribute() {
    let f = setup();
    f.give();
    f.client().pause_contributions();
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![ContributionsPaused {}.to_xdr(&f.env, &f.pool)]
    );
    assert!(f.client().is_paused());

    let before = f.state();
    assert_eq!(
        f.client().try_contribute(&f.donor, &f.asset, &CONTRIBUTION),
        Err(Ok(Error::ContributionsPaused))
    );
    assert_eq!(f.state(), before);

    let signed = f.signed(&f.payload(Category::Poor, 10, 0), &[0, 1]);
    f.client()
        .distribute(&f.recipient, &f.asset, &10, &Category::Poor, &signed);
    assert_eq!(f.token().balance(&f.recipient), 10);
}

#[test]
fn resume_reopens_contributions() {
    let f = setup();
    f.client().pause_contributions();
    f.client().resume_contributions();
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![ContributionsResumed {}.to_xdr(&f.env, &f.pool)]
    );
    f.give();
}

#[test]
fn disabling_the_distributor_blocks_distribute_at_once() {
    let f = setup();
    f.give();
    f.client().disable_distributor();
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![DistributorDisabled {}.to_xdr(&f.env, &f.pool)]
    );
    let signed = f.signed(&f.payload(Category::Poor, 10, 0), &[0, 1]);
    f.refuse(
        &f.recipient,
        &f.asset,
        10,
        Category::Poor,
        &signed,
        Error::DistributorDisabled,
    );
    // Contributions are not affected.
    f.give();
}

/// A call that governance alone may make, tried by someone else. An unmet
/// `require_auth` is a host error, so there is no typed variant to assert.
fn outsider_cannot(f: &Fixture, fn_name: &str, args: Vec<soroban_sdk::Val>, call: impl FnOnce()) {
    let stranger = Address::generate(&f.env);
    f.env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &f.pool,
            fn_name,
            args,
            sub_invokes: &[],
        },
    }]);
    call();
    f.env.mock_all_auths();
}

#[test]
fn only_governance_can_use_the_instant_controls() {
    let f = setup();
    let empty = Vec::new(&f.env);
    outsider_cannot(&f, "pause_contributions", empty.clone(), || {
        assert!(f.client().try_pause_contributions().is_err());
    });
    outsider_cannot(&f, "resume_contributions", empty.clone(), || {
        assert!(f.client().try_resume_contributions().is_err());
    });
    outsider_cannot(&f, "disable_distributor", empty, || {
        assert!(f.client().try_disable_distributor().is_err());
    });
    assert!(!f.client().is_paused());
    assert!(!f.client().is_distributor_disabled());
}

// --- the timelock --------------------------------------------------------------

fn next_allocation(f: &Fixture) -> Allocation {
    allocation(&f.env, &[2500, 2500, 1000, 500, 500, 1500, 1000, 500])
}

#[test]
fn a_change_cannot_execute_at_or_before_its_execute_after_ledger() {
    let f = setup();
    let change = Change::SetAllocation(next_allocation(&f));
    let execute_after = f.client().propose_change(&change);
    assert_eq!(execute_after, START_LEDGER + TIMELOCK);

    assert_eq!(
        f.client().try_execute_change(),
        Err(Ok(Error::TimelockNotElapsed))
    );
    f.env.ledger().set_sequence_number(execute_after);
    assert_eq!(
        f.client().try_execute_change(),
        Err(Ok(Error::TimelockNotElapsed))
    );
    assert_eq!(
        PolicyClient::new(&f.env, &f.policy).allocation(),
        allocation(&f.env, &PLACEHOLDER)
    );
    assert!(f.client().pending_change().is_some());
}

#[test]
fn a_change_executes_after_the_delay_and_each_step_emits_its_event() {
    let f = setup();
    let change = Change::SetAllocation(next_allocation(&f));
    let execute_after = f.client().propose_change(&change);
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![ChangeProposed {
            change: change.clone(),
            execute_after,
        }
        .to_xdr(&f.env, &f.pool)]
    );

    f.past_timelock(execute_after);
    f.client().execute_change();
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![ChangeExecuted {
            change,
            execute_after,
        }
        .to_xdr(&f.env, &f.pool)]
    );

    assert_eq!(
        PolicyClient::new(&f.env, &f.policy).allocation(),
        next_allocation(&f)
    );
    assert_eq!(f.client().pending_change(), None);

    // The new split is what the next contribution uses.
    f.give();
    assert_eq!(f.client().balances(&f.asset).get_unchecked(0), 250_000);
}

#[test]
fn a_change_can_be_cancelled_and_emits_its_event() {
    let f = setup();
    let change = Change::SetAllocation(next_allocation(&f));
    let execute_after = f.client().propose_change(&change);

    f.client().cancel_change();
    assert_eq!(
        f.env.events().all().filter_by_contract(&f.pool),
        std::vec![ChangeCancelled {
            change,
            execute_after,
        }
        .to_xdr(&f.env, &f.pool)]
    );
    assert_eq!(f.client().pending_change(), None);

    f.past_timelock(execute_after);
    assert_eq!(
        f.client().try_execute_change(),
        Err(Ok(Error::NoPendingChange))
    );
    assert_eq!(
        PolicyClient::new(&f.env, &f.policy).allocation(),
        allocation(&f.env, &PLACEHOLDER)
    );
}

#[test]
fn a_cancelled_slot_can_be_used_again_with_a_fresh_delay() {
    let f = setup();
    let change = Change::SetAllocation(next_allocation(&f));
    f.client().propose_change(&change);
    f.client().cancel_change();
    f.env.ledger().set_sequence_number(START_LEDGER + 50);
    assert_eq!(
        f.client().propose_change(&change),
        START_LEDGER + 50 + TIMELOCK
    );
}

#[test]
fn only_one_change_can_be_queued() {
    let f = setup();
    let change = Change::SetAllocation(next_allocation(&f));
    f.client().propose_change(&change);
    assert_eq!(
        f.client().try_propose_change(&change),
        Err(Ok(Error::ChangeAlreadyPending))
    );
}

#[test]
fn execute_and_cancel_need_a_queued_change() {
    let f = setup();
    assert_eq!(
        f.client().try_execute_change(),
        Err(Ok(Error::NoPendingChange))
    );
    assert_eq!(
        f.client().try_cancel_change(),
        Err(Ok(Error::NoPendingChange))
    );
}

#[test]
fn a_caller_without_governance_cannot_change_the_policy() {
    let f = setup();
    let change = Change::SetAllocation(next_allocation(&f));

    outsider_cannot(
        &f,
        "propose_change",
        (change.clone(),).into_val(&f.env),
        || {
            assert!(f.client().try_propose_change(&change).is_err());
        },
    );
    assert_eq!(f.client().pending_change(), None);

    // Queued by governance, it still cannot be pushed through by someone else.
    let execute_after = f.client().propose_change(&change);
    f.past_timelock(execute_after);
    let empty = Vec::new(&f.env);
    outsider_cannot(&f, "execute_change", empty.clone(), || {
        assert!(f.client().try_execute_change().is_err());
    });
    outsider_cannot(&f, "cancel_change", empty, || {
        assert!(f.client().try_cancel_change().is_err());
    });
    assert!(f.client().pending_change().is_some());
}

#[test]
fn governance_cannot_reach_around_the_pool_to_the_policy() {
    let f = setup();
    let policy = PolicyClient::new(&f.env, &f.policy);
    let next = next_allocation(&f);
    f.env.mock_auths(&[MockAuth {
        address: &f.governance,
        invoke: &MockAuthInvoke {
            contract: &f.policy,
            fn_name: "set_allocation",
            args: (next.clone(),).into_val(&f.env),
            sub_invokes: &[],
        },
    }]);
    assert!(policy.try_set_allocation(&next).is_err());
    f.env.mock_all_auths();
    assert_eq!(policy.allocation(), allocation(&f.env, &PLACEHOLDER));
}

#[test]
fn a_value_the_policy_refuses_fails_at_execution_and_stays_queued() {
    let f = setup();
    let bad = allocation(&f.env, &[1, 1, 1, 1, 1, 1, 1, 1]);
    let execute_after = f.client().propose_change(&Change::SetAllocation(bad));
    f.past_timelock(execute_after);
    assert_eq!(
        f.client().try_execute_change(),
        Err(Ok(Error::PolicyRefused))
    );
    assert!(f.client().pending_change().is_some());
}

#[test]
fn parameters_change_through_the_timelock() {
    let f = setup();
    let mut next = parameters();
    next.nisab_basis = NisabBasis::Silver;
    let execute_after = f
        .client()
        .propose_change(&Change::SetParameters(next.clone()));
    assert_eq!(
        PolicyClient::new(&f.env, &f.policy).parameters(),
        parameters()
    );
    f.past_timelock(execute_after);
    f.client().execute_change();
    assert_eq!(PolicyClient::new(&f.env, &f.policy).parameters(), next);
}

#[test]
fn policy_and_attestation_repoint_through_the_timelock() {
    let f = setup();
    let new_policy = Address::generate(&f.env);
    let new_attestation = Address::generate(&f.env);

    let after = f
        .client()
        .propose_change(&Change::SetPolicy(new_policy.clone()));
    assert_eq!(f.client().policy(), f.policy);
    f.past_timelock(after);
    f.client().execute_change();
    assert_eq!(f.client().policy(), new_policy);

    let after = f
        .client()
        .propose_change(&Change::SetAttestation(new_attestation.clone()));
    assert_eq!(f.client().attestation(), f.attestation);
    f.past_timelock(after);
    f.client().execute_change();
    assert_eq!(f.client().attestation(), new_attestation);
}

#[test]
fn approving_an_asset_goes_through_the_timelock_and_gives_it_its_own_buckets() {
    let f = setup();
    let second = f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&f.env))
        .address();
    token::StellarAssetClient::new(&f.env, &second).mint(&f.donor, &1_000);
    f.give();

    let after = f
        .client()
        .propose_change(&Change::ApproveAsset(second.clone()));
    assert_eq!(
        f.client().try_contribute(&f.donor, &second, &1_000),
        Err(Ok(Error::AssetNotApproved))
    );
    f.past_timelock(after);
    f.client().execute_change();
    f.client().contribute(&f.donor, &second, &1_000);

    assert_eq!(f.client().balances(&second).get_unchecked(0), 300);
    assert_eq!(f.client().balances(&f.asset).get_unchecked(0), 300_000);
}

#[test]
fn approving_an_approved_asset_is_refused() {
    let f = setup();
    let after = f
        .client()
        .propose_change(&Change::ApproveAsset(f.asset.clone()));
    f.past_timelock(after);
    assert_eq!(
        f.client().try_execute_change(),
        Err(Ok(Error::AssetAlreadyApproved))
    );
}

#[test]
fn a_new_distributor_takes_the_delay_and_lifts_the_disable() {
    let f = setup();
    f.give();
    f.client().disable_distributor();
    let replacement = Address::generate(&f.env);
    let after = f
        .client()
        .propose_change(&Change::SetDistributor(replacement.clone()));
    assert!(f.client().is_distributor_disabled());
    f.past_timelock(after);
    f.client().execute_change();
    assert_eq!(f.client().distributor(), replacement);
    assert!(!f.client().is_distributor_disabled());

    let mut payload = f.payload(Category::Poor, 10, 0);
    payload.expiry_ledger = f.env.ledger().sequence() + 100;
    let signed = f.signed(&payload, &[0, 1]);
    f.client()
        .distribute(&f.recipient, &f.asset, &10, &Category::Poor, &signed);
    let (who, _) = f.env.auths().first().cloned().unwrap();
    assert_eq!(who, replacement);
}

#[test]
fn governance_cannot_become_the_distributor() {
    let f = setup();
    let after = f
        .client()
        .propose_change(&Change::SetDistributor(f.governance.clone()));
    f.past_timelock(after);
    assert_eq!(
        f.client().try_execute_change(),
        Err(Ok(Error::RolesOverlap))
    );
}

#[test]
fn a_queued_change_survives_in_instance_storage() {
    let f = setup();
    let change = Change::SetAllocation(next_allocation(&f));
    let execute_after = f.client().propose_change(&change);
    f.env.as_contract(&f.pool, || {
        assert!(f.env.storage().instance().has(&DataKey::PendingChange));
        assert!(!f.env.storage().temporary().has(&DataKey::PendingChange));
        assert!(f
            .env
            .storage()
            .persistent()
            .has(&DataKey::CategoryBalances(f.asset.clone())));
    });
    assert_eq!(
        f.client().pending_change(),
        Some(PendingChange {
            change,
            execute_after,
        })
    );
}

// --- the solvency invariant ----------------------------------------------------

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

fn assert_invariant(f: &Fixture, asset: &Address) {
    let claimed: i128 = f.client().balances(asset).iter().sum();
    let held = token::Client::new(&f.env, asset).balance(&f.pool);
    assert!(
        claimed <= held,
        "buckets {} above balance {}",
        claimed,
        held
    );
    assert!(f.client().balances(asset).iter().all(|bucket| bucket >= 0));
}

/// Runs a seeded mix of gifts, payouts, oversized payouts and direct transfers,
/// checking after every step that the buckets never exceed the balance.
fn run_invariant(seed: u64, steps: u32) {
    let f = setup();
    f.env.cost_estimate().budget().reset_unlimited();
    token::StellarAssetClient::new(&f.env, &f.asset).mint(&f.donor, &(i64::MAX as i128));
    let mut rng = Rng(seed);
    let mut sequence = 0u64;
    let mut surplus = 0i128;
    let mut paid = 0i128;
    let mut given = 0i128;

    for _ in 0..steps {
        match rng.next() % 4 {
            0 | 1 => {
                let amount = (rng.next() % 5_000_000) as i128 + 1;
                f.client().contribute(&f.donor, &f.asset, &amount);
                given += amount;
            }
            2 => {
                let index = (rng.next() % 8) as u32;
                let bucket = f.client().balances(&f.asset).get_unchecked(index);
                let amount = (rng.next() as i128) % (bucket * 2 + 1) + 1;
                let category: Category = ALL[index as usize];
                let payload = f.payload(category, amount, sequence);
                let signed = f.signed(&payload, &[0, 2]);
                let result =
                    f.client()
                        .try_distribute(&f.recipient, &f.asset, &amount, &category, &signed);
                if amount <= bucket {
                    assert!(result.is_ok());
                    sequence += 1;
                    paid += amount;
                } else {
                    assert_eq!(result, Err(Ok(Error::InsufficientBucket)));
                }
            }
            _ => {
                let extra = (rng.next() % 1_000) as i128;
                if extra > 0 {
                    f.token().transfer(&f.donor, &f.pool, &extra);
                    surplus += extra;
                }
            }
        }
        assert_invariant(&f, &f.asset);
        let claimed: i128 = f.client().balances(&f.asset).iter().sum();
        assert_eq!(claimed, given - paid);
        assert_eq!(f.token().balance(&f.pool), given - paid + surplus);
    }
}

const ALL: [Category; 8] = [
    Category::Poor,
    Category::Needy,
    Category::Administrators,
    Category::Reconciliation,
    Category::Captives,
    Category::Debtors,
    Category::CauseOfGod,
    Category::Wayfarers,
];

#[test]
fn the_buckets_never_exceed_the_balance_across_seeded_runs() {
    for seed in [1u64, 2, 3, 0xC1F4E7, 0xDEADBEEF] {
        run_invariant(seed, 60);
    }
}

#[test]
fn the_contract_refuses_when_the_balance_falls_under_the_buckets() {
    // Only a token misbehaving outside the pool can cause this. The assert
    // inside `contribute` must catch it rather than record it.
    let f = setup();
    f.give();
    f.env.as_contract(&f.pool, || {
        let mut inflated: Vec<i128> = f
            .env
            .storage()
            .persistent()
            .get(&DataKey::CategoryBalances(f.asset.clone()))
            .unwrap();
        inflated.set(0, inflated.get_unchecked(0) + 1);
        f.env
            .storage()
            .persistent()
            .set(&DataKey::CategoryBalances(f.asset.clone()), &inflated);
    });
    assert_eq!(
        f.client().try_contribute(&f.donor, &f.asset, &CONTRIBUTION),
        Err(Ok(Error::Insolvent))
    );
}

#[test]
fn each_assets_solvency_stands_alone() {
    let f = setup();
    let second = f
        .env
        .register_stellar_asset_contract_v2(Address::generate(&f.env))
        .address();
    token::StellarAssetClient::new(&f.env, &second).mint(&f.donor, &1_000);
    let after = f
        .client()
        .propose_change(&Change::ApproveAsset(second.clone()));
    f.past_timelock(after);
    f.client().execute_change();
    f.give();
    f.client().contribute(&f.donor, &second, &1_000);
    assert_invariant(&f, &f.asset);
    assert_invariant(&f, &second);

    // A signature for the first asset does not spend the second.
    let mut payload = f.payload(Category::Poor, 100, 0);
    payload.expiry_ledger = f.env.ledger().sequence() + 100;
    let signed = f.signed(&payload, &[0, 1]);
    assert_eq!(
        f.client()
            .try_distribute(&f.recipient, &second, &100, &Category::Poor, &signed),
        Err(Ok(Error::WrongAsset))
    );
}
