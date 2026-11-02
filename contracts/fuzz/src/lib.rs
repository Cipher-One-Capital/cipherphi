// SPDX-License-Identifier: Apache-2.0

//! The harness both fuzz targets share: the real three contracts, and the
//! solvency invariant they assert after every call.

use attestation::{Attestation as AttestationContract, AttestationArgs};
use ed25519_dalek::{Signer, SigningKey};
use policy::{Allocation, DischargeTiming, NisabBasis, Parameters, Policy, PolicyArgs};
use soroban_sdk::{
    testutils::Address as _, testutils::Ledger, token, xdr::ToXdr, Address, BytesN, Env, Vec,
};
use zakat_pool::{
    Attestation, Category, SignedAttestation, SignerSig, ZakatPool, ZakatPoolArgs, ZakatPoolClient,
    MIN_TIMELOCK_LEDGERS,
};

pub const START_LEDGER: u32 = 100;
pub const ALL: [Category; 8] = [
    Category::Poor,
    Category::Needy,
    Category::Administrators,
    Category::Reconciliation,
    Category::Captives,
    Category::Debtors,
    Category::CauseOfGod,
    Category::Wayfarers,
];

pub struct Harness {
    pub env: Env,
    pub pool: Address,
    pub asset: Address,
    pub donor: Address,
    pub recipient: Address,
    pub signers: std::vec::Vec<SigningKey>,
}

impl Harness {
    pub fn new(split: [u32; 8]) -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.cost_estimate().budget().reset_unlimited();
        env.ledger().set_sequence_number(START_LEDGER);

        let donor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let asset = env
            .register_stellar_asset_contract_v2(Address::generate(&env))
            .address();
        token::StellarAssetClient::new(&env, &asset).mint(&donor, &(i64::MAX as i128));

        let signers: std::vec::Vec<SigningKey> = [[11u8; 32], [22u8; 32], [33u8; 32]]
            .iter()
            .map(SigningKey::from_bytes)
            .collect();
        let mut authority = Vec::new(&env);
        for signer in &signers {
            authority.push_back(BytesN::from_array(&env, &signer.verifying_key().to_bytes()));
        }

        let pool = Address::generate(&env);
        let policy = env.register(
            Policy,
            PolicyArgs::__constructor(
                &pool,
                &Allocation {
                    split_bps: Vec::from_slice(&env, &split),
                    remainder: Category::Poor,
                },
                &Parameters {
                    nisab_basis: NisabBasis::Gold,
                    rate_bps: 250,
                    amil_cap_bps: 2_500,
                    discharge_timing: DischargeTiming::Received,
                },
            ),
        );
        let attestation = env.register(
            AttestationContract,
            AttestationArgs::__constructor(&authority, &2),
        );
        env.register_at(
            &pool,
            ZakatPool,
            ZakatPoolArgs::__constructor(
                &Address::generate(&env),
                &Address::generate(&env),
                &policy,
                &attestation,
                &asset,
                &MIN_TIMELOCK_LEDGERS,
            ),
        );

        Self {
            env,
            pool,
            asset,
            donor,
            recipient,
            signers,
        }
    }

    pub fn client(&self) -> ZakatPoolClient<'_> {
        ZakatPoolClient::new(&self.env, &self.pool)
    }

    pub fn claimed(&self) -> i128 {
        self.client().balances(&self.asset).iter().sum()
    }

    pub fn held(&self) -> i128 {
        token::Client::new(&self.env, &self.asset).balance(&self.pool)
    }

    /// The buckets never exceed the balance, and no bucket is negative.
    pub fn assert_invariant(&self) {
        let claimed = self.claimed();
        let held = self.held();
        assert!(claimed <= held, "buckets {claimed} above balance {held}");
        assert!(self.client().balances(&self.asset).iter().all(|b| b >= 0));
    }

    pub fn sign(&self, payload: &Attestation, signer_mask: u8) -> SignedAttestation {
        let message: std::vec::Vec<u8> = payload.clone().to_xdr(&self.env).iter().collect();
        let mut signatures = Vec::new(&self.env);
        for (index, key) in self.signers.iter().enumerate() {
            if signer_mask & (1 << index) != 0 {
                signatures.push_back(SignerSig {
                    index: index as u32,
                    signature: BytesN::from_array(&self.env, &key.sign(&message).to_bytes()),
                });
            }
        }
        SignedAttestation {
            payload: payload.clone(),
            signatures,
        }
    }
}
