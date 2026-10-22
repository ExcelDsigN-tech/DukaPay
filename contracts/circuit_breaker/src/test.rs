use crate::{
    CircuitBreaker, CircuitBreakerClient, CircuitBreakerError, OverrideTarget, MAX_SIGNERS,
    MIN_OVERRIDE_TIMELOCK, PAUSE_DURATION_SECONDS,
};
use soroban_sdk::testutils::storage::Instance as _;
use soroban_sdk::testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke};
use soroban_sdk::{Address, Env, FromVal, IntoVal, InvokeError, Symbol, Val, Vec};

fn setup() -> (Env, Address, Address, Vec<Address>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let s1 = Address::generate(&env);
    let s2 = Address::generate(&env);
    let s3 = Address::generate(&env);
    let s4 = Address::generate(&env);
    let s5 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(s1);
    signers.push_back(s2);
    signers.push_back(s3);
    signers.push_back(s4);
    signers.push_back(s5);
    let contract_id = env.register(CircuitBreaker, (&admin, signers.clone(), 3u32, 86_400u64));
    (env, contract_id, admin, signers)
}

#[test]
fn init_stores_config() {
    let (_env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&_env, &contract_id);
    assert_eq!(client.get_threshold(), 3);
    assert_eq!(client.get_override_timelock(), 86_400);
    assert_eq!(client.get_signers(), signers);
    assert!(!client.is_globally_paused());
}

#[test]
fn test_no_callable_initializer_after_deploy() {
    let (env, contract_id, admin, signers) = setup();
    let result = env.try_invoke_contract::<Val, Val>(
        &contract_id,
        &Symbol::new(&env, "initialize"),
        (admin, signers, 3u32, 86_400u64).into_val(&env),
    );
    assert!(
        result.is_err(),
        "old initialize entrypoint is still callable"
    );
}

#[test]
#[should_panic(expected = "duplicate signer")]
fn duplicate_signer_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let s1 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(s1.clone());
    signers.push_back(s1);
    env.register(CircuitBreaker, (&admin, signers, 1u32, 3_600u64));
}

#[test]
#[should_panic(expected = "#5004")]
fn non_signer_cannot_pause() {
    let (_env, contract_id, _admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&_env, &contract_id);
    let stranger = Address::generate(&_env);
    let target = Address::generate(&_env);
    client.pause_contract(&stranger, &target);
}

#[test]
fn global_pause_blocks_then_expires() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    client.pause_all(&signers.get(0).unwrap());
    assert!(client.is_globally_paused());
    let target = Address::generate(&env);
    assert!(client.is_blocked(&target, &Symbol::new(&env, "deposit")));
    // Advance past 72h auto-expiry.
    env.ledger().set_timestamp(PAUSE_DURATION_SECONDS + 1);
    assert!(!client.is_globally_paused());
    assert!(!client.is_blocked(&target, &Symbol::new(&env, "deposit")));
}

#[test]
fn contract_pause_is_independent_of_function_pause() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    client.pause_function(
        &signers.get(0).unwrap(),
        &target,
        &Symbol::new(&env, "withdraw"),
    );
    assert!(client.is_function_paused(&target, &Symbol::new(&env, "withdraw")));
    assert!(!client.is_contract_paused(&target));
    assert!(client.is_blocked(&target, &Symbol::new(&env, "withdraw")));
    // A different function is not blocked.
    assert!(!client.is_blocked(&target, &Symbol::new(&env, "deposit")));
}

#[test]
fn contract_wildcard_pause_blocks_all_functions() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    client.pause_contract(&signers.get(0).unwrap(), &target);
    assert!(client.is_contract_paused(&target));
    assert!(client.is_blocked(&target, &Symbol::new(&env, "deposit")));
    assert!(client.is_blocked(&target, &Symbol::new(&env, "withdraw")));
}

#[test]
fn override_lifts_global_pause_after_timelock_and_quorum() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    client.pause_all(&signers.get(0).unwrap());
    let id = client.propose_override(&signers.get(1).unwrap(), &OverrideTarget::Global);
    // Not enough approvals yet.
    client.approve_override(&signers.get(1).unwrap(), &id);
    client.approve_override(&signers.get(2).unwrap(), &id);
    // Timelock not elapsed.
    assert_eq!(
        client.try_execute_override(&Address::generate(&env), &id),
        Err(Ok(CircuitBreakerError::TimelockNotElapsed))
    );
    // Advance past the override timelock (24h) but still within pause window.
    env.ledger().set_timestamp(86_400 + 1);
    // Third approval reaches the 3-of-5 threshold.
    client.approve_override(&signers.get(3).unwrap(), &id);
    client.execute_override(&Address::generate(&env), &id);
    assert!(!client.is_globally_paused());
}

#[test]
fn override_requires_quorum() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    client.pause_contract(&signers.get(0).unwrap(), &target);
    let id = client.propose_override(
        &signers.get(1).unwrap(),
        &OverrideTarget::Contract(target.clone()),
    );
    env.ledger().set_timestamp(86_400 + 1);
    client.approve_override(&signers.get(1).unwrap(), &id);
    client.approve_override(&signers.get(2).unwrap(), &id);
    assert_eq!(
        client.try_execute_override(&Address::generate(&env), &id),
        Err(Ok(CircuitBreakerError::ThresholdNotMet))
    );
    assert!(client.is_contract_paused(&target));
}

#[test]
fn admin_can_cancel_override() {
    let (env, contract_id, admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    client.pause_all(&signers.get(0).unwrap());
    let id = client.propose_override(&signers.get(1).unwrap(), &OverrideTarget::Global);
    client.cancel_override(&admin, &id);
    env.ledger().set_timestamp(86_400 + 1);
    // A cancelled proposal can no longer be executed.
    assert_eq!(
        client.try_execute_override(&Address::generate(&env), &id),
        Err(Ok(CircuitBreakerError::ProposalNotActive))
    );
    assert!(client.is_globally_paused());
}

#[test]
fn expired_override_cannot_execute() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    client.pause_all(&signers.get(0).unwrap());
    let id = client.propose_override(&signers.get(1).unwrap(), &OverrideTarget::Global);
    // Advance beyond pause window + override timelock so the proposal is stale.
    env.ledger()
        .set_timestamp(PAUSE_DURATION_SECONDS + 86_400 + 1);
    client.approve_override(&signers.get(1).unwrap(), &id);
    client.approve_override(&signers.get(2).unwrap(), &id);
    client.approve_override(&signers.get(3).unwrap(), &id);
    assert_eq!(
        client.try_execute_override(&Address::generate(&env), &id),
        Err(Ok(CircuitBreakerError::ProposalExpired))
    );
}

#[test]
fn function_override_lifts_only_that_function() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    let dep = Symbol::new(&env, "deposit");
    let wit = Symbol::new(&env, "withdraw");
    client.pause_function(&signers.get(0).unwrap(), &target, &dep.clone());
    client.pause_function(&signers.get(0).unwrap(), &target, &wit.clone());
    let id = client.propose_override(
        &signers.get(1).unwrap(),
        &OverrideTarget::Function(target.clone(), dep.clone()),
    );
    env.ledger().set_timestamp(86_400 + 1);
    client.approve_override(&signers.get(1).unwrap(), &id);
    client.approve_override(&signers.get(2).unwrap(), &id);
    client.approve_override(&signers.get(3).unwrap(), &id);
    client.execute_override(&Address::generate(&env), &id);
    assert!(!client.is_function_paused(&target, &dep));
    // The other paused function remains blocked.
    assert!(client.is_function_paused(&target, &wit));
}

#[test]
fn expired_pauses_are_cleaned_up_on_is_blocked() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    let func = Symbol::new(&env, "deposit");
    client.pause_function(&signers.get(0).unwrap(), &target, &func.clone());
    assert!(client.is_blocked(&target, &func.clone()));
    // Advance past 72h auto-expiry.
    env.ledger().set_timestamp(PAUSE_DURATION_SECONDS + 1);
    // is_blocked cleans up the expired entry.
    assert!(!client.is_blocked(&target, &func));
}

#[test]
fn test_is_blocked_extends_instance_ttl() {
    let (env, contract_id, _admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);

    // Advance into the bump threshold's re-extension window (TTL_BUMP -
    // TTL_THRESHOLD = 518_400 - 17_280 = 501_120), so the instance is close
    // to expiring, then call is_blocked again. `extend_ttl` only re-extends
    // once an entry is within its threshold of expiry, so this is the only
    // way to observe a real bump rather than natural decay.
    env.ledger()
        .set_sequence_number(env.ledger().sequence() + 510_000);
    client.is_blocked(&target, &Symbol::new(&env, "deposit"));

    let ttl_after = env.as_contract(&contract_id, || env.storage().instance().get_ttl());
    // Without a bump this would be left at roughly 8,400 ledgers remaining
    // (518,400 - 510,000) — the archived-instance failure described in #790.
    assert!(ttl_after > 400_000);
}

#[test]
fn active_pauses_preserved_during_cleanup() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    let deposit = Symbol::new(&env, "deposit");
    let withdraw = Symbol::new(&env, "withdraw");
    // Pause both functions.
    client.pause_function(&signers.get(0).unwrap(), &target, &deposit.clone());
    client.pause_function(&signers.get(0).unwrap(), &target, &withdraw.clone());
    assert!(client.is_blocked(&target, &deposit.clone()));
    assert!(client.is_blocked(&target, &withdraw.clone()));
    // Advance part way through the pause duration (half of 72h).
    env.ledger().set_timestamp(PAUSE_DURATION_SECONDS / 2);
    // Both should still be active.
    assert!(client.is_blocked(&target, &deposit));
    assert!(client.is_blocked(&target, &withdraw));
}

#[test]
fn global_pause_cleanup_on_is_blocked() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let target = Address::generate(&env);
    client.pause_all(&signers.get(0).unwrap());
    assert!(client.is_globally_paused());
    // Advance past expiry.
    env.ledger().set_timestamp(PAUSE_DURATION_SECONDS + 1);
    // Cleanup happens in is_blocked.
    assert!(!client.is_blocked(&target, &Symbol::new(&env, "any_function")));
    assert!(!client.is_globally_paused());
}

// ── Admin setters (#848) ──────────────────────────────────────────────────────

fn generate_signers(env: &Env, count: u32) -> Vec<Address> {
    let mut signers = Vec::new(env);
    for _ in 0..count {
        signers.push_back(Address::generate(env));
    }
    signers
}

/// Authorizes only `signer` for `fn_name(args)`. The setters call
/// `require_auth` on both `caller` and the stored admin, and each
/// authorization entry matches once, so two copies are supplied: the call
/// passes only when `signer` is the stored admin. A missing admin auth is
/// narrowed by the host to `Error(Context, InvalidAction)` across `try_call`,
/// which the client surfaces as `InvokeError::Abort`.
fn authorize_only(
    env: &Env,
    contract_id: &Address,
    signer: &Address,
    fn_name: &str,
    args: Vec<Val>,
) {
    let invoke = MockAuthInvoke {
        contract: contract_id,
        fn_name,
        args,
        sub_invokes: &[],
    };
    env.mock_auths(&[
        MockAuth {
            address: signer,
            invoke: &invoke,
        },
        MockAuth {
            address: signer,
            invoke: &invoke,
        },
    ]);
}

#[test]
fn set_admin_updates_admin_and_emits_event() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let new_admin = Address::generate(&env);

    client.set_admin(&admin, &new_admin);

    // Events are only visible from the latest invocation, so read them first.
    let events = env.events().all();
    let (emitter, topics, data) = events.get(events.len() - 1).unwrap();
    assert_eq!(emitter, contract_id);
    assert_eq!(
        Symbol::from_val(&env, &topics.get(0).unwrap()),
        Symbol::new(&env, "BreakerAdmin")
    );
    let (caller, emitted_admin): (Address, Address) = FromVal::from_val(&env, &data);
    assert_eq!((caller, emitted_admin), (admin, new_admin.clone()));

    assert_eq!(client.get_admin(), new_admin);
}

#[test]
fn set_admin_rejects_non_admin() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let stranger = Address::generate(&env);

    authorize_only(
        &env,
        &contract_id,
        &stranger,
        "set_admin",
        (stranger.clone(), stranger.clone()).into_val(&env),
    );
    assert_eq!(
        client.try_set_admin(&stranger, &stranger),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn old_admin_loses_access_after_set_admin() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let new_admin = Address::generate(&env);
    client.set_admin(&admin, &new_admin);

    authorize_only(
        &env,
        &contract_id,
        &admin,
        "set_override_timelock",
        (admin.clone(), MIN_OVERRIDE_TIMELOCK).into_val(&env),
    );
    assert_eq!(
        client.try_set_override_timelock(&admin, &MIN_OVERRIDE_TIMELOCK),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(client.get_override_timelock(), 86_400);

    // The same call authorized by the new admin alone succeeds.
    authorize_only(
        &env,
        &contract_id,
        &new_admin,
        "set_override_timelock",
        (new_admin.clone(), MIN_OVERRIDE_TIMELOCK).into_val(&env),
    );
    client.set_override_timelock(&new_admin, &MIN_OVERRIDE_TIMELOCK);
    assert_eq!(client.get_override_timelock(), MIN_OVERRIDE_TIMELOCK);
}

#[test]
fn set_signers_updates_signers_and_threshold() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let new_signers = generate_signers(&env, 2);

    client.set_signers(&admin, &new_signers, &2);

    assert_eq!(client.get_signers(), new_signers);
    assert_eq!(client.get_threshold(), 2);
}

#[test]
fn set_signers_rejects_non_admin() {
    let (env, contract_id, _admin, signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let stranger = Address::generate(&env);
    let new_signers = generate_signers(&env, 1);

    authorize_only(
        &env,
        &contract_id,
        &stranger,
        "set_signers",
        (stranger.clone(), new_signers.clone(), 1u32).into_val(&env),
    );
    assert_eq!(
        client.try_set_signers(&stranger, &new_signers, &1),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(client.get_signers(), signers);
    assert_eq!(client.get_threshold(), 3);
}

#[test]
fn set_signers_rejects_empty_list() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    assert_eq!(
        client.try_set_signers(&admin, &Vec::new(&env), &1),
        Err(Ok(CircuitBreakerError::EmptySignerList))
    );
}

#[test]
fn set_signers_rejects_too_many_signers() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    assert_eq!(
        client.try_set_signers(&admin, &generate_signers(&env, MAX_SIGNERS + 1), &1),
        Err(Ok(CircuitBreakerError::TooManySigners))
    );
}

#[test]
fn set_signers_rejects_duplicate_signer() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let mut duplicated = generate_signers(&env, 2);
    duplicated.push_back(duplicated.get(0).unwrap());
    assert_eq!(
        client.try_set_signers(&admin, &duplicated, &1),
        Err(Ok(CircuitBreakerError::DuplicateSigner))
    );
}

#[test]
fn set_signers_rejects_zero_threshold() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    assert_eq!(
        client.try_set_signers(&admin, &generate_signers(&env, 2), &0),
        Err(Ok(CircuitBreakerError::ThresholdTooLow))
    );
}

#[test]
fn set_signers_rejects_threshold_above_signer_count() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    assert_eq!(
        client.try_set_signers(&admin, &generate_signers(&env, 2), &3),
        Err(Ok(CircuitBreakerError::ThresholdExceedsSigners))
    );
}

#[test]
fn set_override_timelock_accepts_minimum() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);

    client.set_override_timelock(&admin, &MIN_OVERRIDE_TIMELOCK);

    assert_eq!(client.get_override_timelock(), MIN_OVERRIDE_TIMELOCK);
}

#[test]
fn set_override_timelock_rejects_below_minimum() {
    let (env, contract_id, admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    assert_eq!(
        client.try_set_override_timelock(&admin, &(MIN_OVERRIDE_TIMELOCK - 1)),
        Err(Ok(CircuitBreakerError::TimelockTooShort))
    );
    assert_eq!(client.get_override_timelock(), 86_400);
}

#[test]
fn set_override_timelock_rejects_non_admin() {
    let (env, contract_id, _admin, _signers) = setup();
    let client = CircuitBreakerClient::new(&env, &contract_id);
    let stranger = Address::generate(&env);

    authorize_only(
        &env,
        &contract_id,
        &stranger,
        "set_override_timelock",
        (stranger.clone(), MIN_OVERRIDE_TIMELOCK).into_val(&env),
    );
    assert_eq!(
        client.try_set_override_timelock(&stranger, &MIN_OVERRIDE_TIMELOCK),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(client.get_override_timelock(), 86_400);
}
