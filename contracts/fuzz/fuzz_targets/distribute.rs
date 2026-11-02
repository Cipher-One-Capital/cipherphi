// SPDX-License-Identifier: Apache-2.0

//! `distribute` under arbitrary payouts, signers and tampering. A payout goes
//! through only if it is untampered, signed by 2 of 3, on the current sequence,
//! and covered by its bucket. The buckets never exceed the balance.

#![no_main]

use cipherphi_fuzz::{Harness, ALL, START_LEDGER};
use libfuzzer_sys::{arbitrary, fuzz_target};
use soroban_sdk::{testutils::Address as _, token, Address, BytesN};
use zakat_pool::Attestation;

#[derive(arbitrary::Arbitrary, Debug)]
struct Payout {
    category: u8,
    amount: i128,
    signer_mask: u8,
    /// Which binding to break, if any.
    tamper: u8,
    sequence_offset: u8,
}

#[derive(arbitrary::Arbitrary, Debug)]
struct Input {
    gifts: Vec<u32>,
    payouts: Vec<Payout>,
}

fuzz_target!(|input: Input| {
    let h = Harness::new([3000, 2000, 1000, 500, 500, 1500, 1000, 500]);
    let client = h.client();

    for gift in input.gifts.iter().take(4) {
        if *gift > 0 {
            client.contribute(&h.donor, &h.asset, &(*gift as i128));
        }
    }

    for payout in input.payouts.iter().take(8) {
        let category = ALL[(payout.category % 8) as usize];
        let sequence = client.distribution_seq();
        let bucket = client.balances(&h.asset).get_unchecked(category as u32);
        let paid_before = token::Client::new(&h.env, &h.asset).balance(&h.recipient);

        let mut payload = Attestation {
            recipient: h.recipient.clone(),
            asset: h.asset.clone(),
            category,
            amount: payout.amount,
            sequence: sequence + payout.sequence_offset as u64,
            expiry_ledger: START_LEDGER + 1_000,
            pool: h.pool.clone(),
            network_id: h.env.ledger().network_id(),
        };
        let tampered = match payout.tamper % 8 {
            1 => {
                payload.recipient = Address::generate(&h.env);
                true
            }
            2 => {
                payload.asset = Address::generate(&h.env);
                true
            }
            3 => {
                payload.pool = Address::generate(&h.env);
                true
            }
            4 => {
                payload.network_id = BytesN::from_array(&h.env, &[9u8; 32]);
                true
            }
            5 => {
                payload.expiry_ledger = START_LEDGER;
                true
            }
            _ => false,
        };

        let signed = h.sign(&payload, payout.signer_mask);
        let signers = (payout.signer_mask & 0b111).count_ones();
        let result =
            client.try_distribute(&h.recipient, &h.asset, &payout.amount, &category, &signed);

        let should_pay = !tampered
            && signers >= 2
            && payout.sequence_offset == 0
            && payout.amount > 0
            && payout.amount <= bucket;
        assert_eq!(result.is_ok(), should_pay, "{payout:?}");

        let paid = token::Client::new(&h.env, &h.asset).balance(&h.recipient) - paid_before;
        if should_pay {
            assert_eq!(paid, payout.amount);
            assert_eq!(client.distribution_seq(), sequence + 1);
        } else {
            assert_eq!(paid, 0);
            assert_eq!(client.distribution_seq(), sequence);
        }
        h.assert_invariant();
    }
});
