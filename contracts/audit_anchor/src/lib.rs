#![no_std]

use soroban_sdk::{contract, contracterror, contractimpl, contracttype, Address, BytesN, Env};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AnchorError {
    NotInitialized = 2,
    EpochAlreadyAnchored = 3,
    EmptyEpoch = 4,
}

#[contracttype]
pub enum DataKey {
    Owner,
    Root(u64),
    LeafCount(u64),
}

#[contract]
pub struct AuditAnchor;

#[contractimpl]
impl AuditAnchor {
    /// Ledger TTL constants, matching the sibling contracts.
    /// Threshold: ~1 day (17 280 ledgers × 5 s). Bump: ~30 days (518 400 ledgers).
    const PERSISTENT_TTL_THRESHOLD: u32 = 17_280;
    const PERSISTENT_TTL_BUMP: u32 = 518_400;

    pub fn __constructor(env: Env, owner: Address) {
        env.storage().instance().set(&DataKey::Owner, &owner);
    }

    pub fn anchor(
        env: Env,
        epoch: u64,
        root: BytesN<32>,
        leaf_count: u32,
    ) -> Result<(), AnchorError> {
        let owner: Address = env
            .storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(AnchorError::NotInitialized)?;
        owner.require_auth();
        if leaf_count == 0 {
            return Err(AnchorError::EmptyEpoch);
        }
        if env.storage().persistent().has(&DataKey::Root(epoch)) {
            return Err(AnchorError::EpochAlreadyAnchored);
        }
        env.storage().persistent().set(&DataKey::Root(epoch), &root);
        env.storage()
            .persistent()
            .set(&DataKey::LeafCount(epoch), &leaf_count);

        // Extend TTL on write, matching the sibling contracts.
        env.storage().persistent().extend_ttl(
            &DataKey::Root(epoch),
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );
        env.storage().persistent().extend_ttl(
            &DataKey::LeafCount(epoch),
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );

        env.events().publish(
            (soroban_sdk::Symbol::new(&env, "auditroot"), epoch),
            (root, leaf_count),
        );
        Ok(())
    }

    pub fn get_root(env: Env, epoch: u64) -> Option<BytesN<32>> {
        env.storage().persistent().get(&DataKey::Root(epoch))
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, MockAuth, MockAuthInvoke};
    use soroban_sdk::{Address, BytesN, Env, IntoVal, InvokeError, Symbol, Val};

    fn setup() -> (Env, AuditAnchorClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let owner = Address::generate(&env);
        let contract_id = env.register(AuditAnchor, (&owner,));
        let client = AuditAnchorClient::new(&env, &contract_id);
        (env, client, owner)
    }

    // ── Happy path ───────────────────────────────────────────────────────────

    #[test]
    fn owner_can_anchor_each_epoch_once() {
        let (env, client, _owner) = setup();
        let root = BytesN::from_array(&env, &[7; 32]);
        client.anchor(&1, &root, &3);
        assert_eq!(client.get_root(&1), Some(root));
        assert!(client
            .try_anchor(&1, &BytesN::from_array(&env, &[8; 32]), &3)
            .is_err());
    }

    #[test]
    fn get_root_returns_none_for_unanchored_epoch() {
        let (_env, client, _owner) = setup();
        assert_eq!(client.get_root(&99), None);
    }

    // ── EmptyEpoch ───────────────────────────────────────────────────────────

    #[test]
    fn anchor_rejects_zero_leaf_count() {
        let (env, client, _owner) = setup();
        let root = BytesN::from_array(&env, &[1; 32]);
        let err = client.try_anchor(&1, &root, &0).unwrap_err().unwrap();
        assert_eq!(err, AnchorError::EmptyEpoch);
    }

    // ── No initializer after deploy ──────────────────────────────────────────

    #[test]
    fn test_no_callable_initializer_after_deploy() {
        let env = Env::default();
        let owner = Address::generate(&env);
        let contract_id = env.register(AuditAnchor, (&owner,));
        let result = env.try_invoke_contract::<Val, Val>(
            &contract_id,
            &Symbol::new(&env, "init"),
            (owner,).into_val(&env),
        );
        assert!(result.is_err(), "old init entrypoint is still callable");
    }

    // ── Unauthorized anchor ──────────────────────────────────────────────────

    #[test]
    fn anchor_without_owner_auth_fails() {
        let (env, client, owner) = setup();

        // Clear the blanket mock so require_auth() is actually enforced.
        env.mock_auths(&[]);

        let root = BytesN::from_array(&env, &[9; 32]);
        // Valid inputs (fresh epoch, non-zero leaf count) so auth is the only
        // failing check; contract errors return Err(Ok(AnchorError)).
        let result = client.try_anchor(&1, &root, &1);
        assert_eq!(result, Err(Err(InvokeError::Abort)));
        assert_eq!(client.get_root(&1), None);

        // A non-owner signature must also be rejected with a host auth abort.
        let stranger = Address::generate(&env);
        env.mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "anchor",
                args: (1u64, root.clone(), 1u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        let result = client.try_anchor(&1, &root, &1);
        assert_eq!(result, Err(Err(InvokeError::Abort)));
        assert_eq!(client.get_root(&1), None);

        // Authorizing as the owner succeeds for the same inputs.
        env.mock_auths(&[MockAuth {
            address: &owner,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "anchor",
                args: (1u64, root.clone(), 1u32).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.anchor(&1, &root, &1);
        assert_eq!(client.get_root(&1), Some(root));
    }
}
