// SPDX-License-Identifier: Apache-2.0
#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, Env, IntoVal, Vec,
};

use crate::{
    Allocation, Category, DischargeTiming, Error, NisabBasis, Parameters, Policy, PolicyArgs,
    PolicyClient, MAX_AMIL_CAP_BPS, MAX_RATE_BPS,
};

const PLACEHOLDER: [u32; 8] = [3000, 2000, 1000, 500, 500, 1500, 1000, 500];

fn allocation(env: &Env, split: &[u32], remainder: Category) -> Allocation {
    Allocation {
        split_bps: Vec::from_slice(env, split),
        remainder,
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

fn setup() -> (Env, Address, Address) {
    let env = Env::default();
    let controller = Address::generate(&env);
    let id = env.register(
        Policy,
        PolicyArgs::__constructor(
            &controller,
            &allocation(&env, &PLACEHOLDER, Category::Poor),
            &parameters(),
        ),
    );
    (env, id, controller)
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

fn refused_at_construction(split: &[u32], remainder: Category, p: Parameters, want: Error) {
    let env = Env::default();
    let controller = Address::generate(&env);
    let value = allocation(&env, split, remainder);
    let message = refusal_of(|| {
        env.register(Policy, PolicyArgs::__constructor(&controller, &value, &p));
    });
    assert_refused(&message, want as u32);
}

#[test]
fn constructor_stores_the_placeholders() {
    let (env, id, controller) = setup();
    let client = PolicyClient::new(&env, &id);
    assert_eq!(client.controller(), controller);
    assert_eq!(
        client.allocation(),
        allocation(&env, &PLACEHOLDER, Category::Poor)
    );
    assert_eq!(client.parameters(), parameters());
}

#[test]
fn allocate_follows_the_placeholder_split() {
    let (env, id, _) = setup();
    assert_eq!(
        PolicyClient::new(&env, &id).allocate(&1_000_000),
        vec![&env, 300_000, 200_000, 100_000, 50_000, 50_000, 150_000, 100_000, 50_000]
    );
}

#[test]
fn the_rounding_remainder_goes_to_the_configured_category() {
    let (env, id, _) = setup();
    // 1 stroop: every floor is zero, so the remainder takes it all.
    assert_eq!(
        PolicyClient::new(&env, &id).allocate(&1),
        vec![&env, 1, 0, 0, 0, 0, 0, 0, 0]
    );
}

#[test]
fn the_remainder_category_is_a_setting() {
    let env = Env::default();
    let id = env.register(
        Policy,
        PolicyArgs::__constructor(
            &Address::generate(&env),
            &allocation(&env, &PLACEHOLDER, Category::Wayfarers),
            &parameters(),
        ),
    );
    assert_eq!(
        PolicyClient::new(&env, &id).allocate(&1),
        vec![&env, 0, 0, 0, 0, 0, 0, 0, 1]
    );
}

#[test]
fn split_sums_to_the_input() {
    let (env, id, _) = setup();
    let client = PolicyClient::new(&env, &id);
    for amount in [
        1i128,
        3,
        7,
        9_999,
        10_000,
        10_001,
        123_456_789,
        i128::MAX / 10_000,
    ] {
        let parts = client.allocate(&amount);
        assert_eq!(parts.len(), 8);
        assert_eq!(parts.iter().sum::<i128>(), amount);
        assert!(parts.iter().all(|part| part >= 0));
    }
}

#[test]
fn zero_and_negative_amounts_are_refused() {
    let (env, id, _) = setup();
    let client = PolicyClient::new(&env, &id);
    assert_eq!(client.try_allocate(&0), Err(Ok(Error::InvalidAmount)));
    assert_eq!(client.try_allocate(&-1), Err(Ok(Error::InvalidAmount)));
}

#[test]
fn an_overflowing_amount_is_refused() {
    let (env, id, _) = setup();
    assert_eq!(
        PolicyClient::new(&env, &id).try_allocate(&i128::MAX),
        Err(Ok(Error::Overflow))
    );
}

#[test]
fn a_split_of_seven_or_nine_is_refused() {
    refused_at_construction(
        &[3000, 2000, 1000, 500, 500, 1500, 1500],
        Category::Poor,
        parameters(),
        Error::SplitLength,
    );
    refused_at_construction(
        &[3000, 2000, 1000, 500, 500, 1500, 1000, 400, 100],
        Category::Poor,
        parameters(),
        Error::SplitLength,
    );
}

#[test]
fn a_split_that_does_not_sum_to_unity_is_refused() {
    refused_at_construction(
        &[3000, 2000, 1000, 500, 500, 1500, 1000, 499],
        Category::Poor,
        parameters(),
        Error::SplitSum,
    );
    refused_at_construction(
        &[3000, 2000, 1000, 500, 500, 1500, 1000, 501],
        Category::Poor,
        parameters(),
        Error::SplitSum,
    );
}

#[test]
fn a_split_that_overflows_u32_is_refused() {
    refused_at_construction(
        &[u32::MAX, 1, 0, 0, 0, 0, 0, 10_000],
        Category::Poor,
        parameters(),
        Error::SplitSum,
    );
}

#[test]
fn a_remainder_with_no_share_is_refused() {
    refused_at_construction(
        &[5000, 2000, 1000, 500, 500, 1000, 0, 0],
        Category::Wayfarers,
        parameters(),
        Error::RemainderWithoutShare,
    );
}

#[test]
fn an_amil_cap_above_its_band_is_refused() {
    let mut p = parameters();
    p.amil_cap_bps = MAX_AMIL_CAP_BPS + 1;
    refused_at_construction(&PLACEHOLDER, Category::Poor, p, Error::AmilCapOutOfBand);
}

#[test]
fn a_rate_outside_its_band_is_refused() {
    let mut p = parameters();
    p.rate_bps = 0;
    refused_at_construction(
        &PLACEHOLDER,
        Category::Poor,
        p.clone(),
        Error::RateOutOfBand,
    );
    p.rate_bps = MAX_RATE_BPS + 1;
    refused_at_construction(&PLACEHOLDER, Category::Poor, p, Error::RateOutOfBand);
}

#[test]
fn an_administrators_share_above_the_cap_is_refused() {
    let mut p = parameters();
    p.amil_cap_bps = 999;
    refused_at_construction(
        &PLACEHOLDER,
        Category::Poor,
        p,
        Error::AdministratorsAboveCap,
    );
}

#[test]
fn the_controller_can_set_valid_values() {
    let (env, id, _) = setup();
    env.mock_all_auths();
    let client = PolicyClient::new(&env, &id);

    let next = allocation(
        &env,
        &[2500, 2500, 1000, 500, 500, 1500, 1000, 500],
        Category::Needy,
    );
    client.set_allocation(&next);
    assert_eq!(client.allocation(), next);

    let mut p = parameters();
    p.nisab_basis = NisabBasis::Silver;
    p.discharge_timing = DischargeTiming::Delivered;
    client.set_parameters(&p);
    assert_eq!(client.parameters(), p);
}

#[test]
fn the_setters_apply_the_same_bounds() {
    let (env, id, _) = setup();
    env.mock_all_auths();
    let client = PolicyClient::new(&env, &id);
    let before = client.allocation();

    assert_eq!(
        client.try_set_allocation(&allocation(&env, &[1; 8], Category::Poor)),
        Err(Ok(Error::SplitSum))
    );
    // A split above the live cap, and a cap below the live split.
    assert_eq!(
        client.try_set_allocation(&allocation(
            &env,
            &[2000, 2000, 2000, 500, 500, 1500, 1000, 500],
            Category::Poor
        )),
        Err(Ok(Error::AdministratorsAboveCap))
    );
    let mut p = parameters();
    p.amil_cap_bps = 500;
    assert_eq!(
        client.try_set_parameters(&p),
        Err(Ok(Error::AdministratorsAboveCap))
    );

    assert_eq!(client.allocation(), before);
    assert_eq!(client.parameters(), parameters());
}

#[test]
fn a_caller_other_than_the_controller_cannot_set_anything() {
    let (env, id, _) = setup();
    let client = PolicyClient::new(&env, &id);
    let stranger = Address::generate(&env);
    let next = allocation(
        &env,
        &[2500, 2500, 1000, 500, 500, 1500, 1000, 500],
        Category::Poor,
    );

    env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "set_allocation",
            args: (next.clone(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_set_allocation(&next).is_err());

    env.mock_auths(&[MockAuth {
        address: &stranger,
        invoke: &MockAuthInvoke {
            contract: &id,
            fn_name: "set_parameters",
            args: (parameters(),).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    assert!(client.try_set_parameters(&parameters()).is_err());
}
