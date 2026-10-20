#![no_std]
//! DukaPay agent registry contract.
//!
//! Onboards and tracks agents. An agent is a KYC'd, bonded shop owner who
//! operates a float vault. The registry is permissioned: only the trusted
//! operator (the DukaPay deployment backend) can register/activate/suspend;
//! the agent must authorize their own registration.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, BytesN, Env, Symbol,
};

mod events;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum RegistryError {
    NotInitialized = 2,
    Unauthorized = 3,
    AgentAlreadyRegistered = 4,
    AgentNotFound = 5,
    InvalidBond = 6,
    MissingKyc = 7,
    InvalidStatusTransition = 8,
    BondFrozen = 9,
    LicenseExpired = 10,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum AgentStatus {
    Pending,
    Active,
    Suspended,
    Expired,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AgentInfo {
    pub status: AgentStatus,
    /// Reference to the agent's KYC/AML attestation (off-chain record).
    pub kyc_ref: Symbol,
    /// USDC bond locked at onboarding. Custody lives in agent-vault; the
    /// registry is the source of truth for the "bonded" invariant.
    pub bond_amount: i128,
    pub license_expiry: u64,
    pub region: Symbol,
    pub reputation: i128,
}

#[contracttype]
pub enum DataKey {
    Owner,
    Operator,
    Agent(Address),
    /// Monotonic contract version, bumped by [`AgentRegistry::upgrade`].
    Version,
}

#[contract]
pub struct AgentRegistry;

#[contractimpl]
impl AgentRegistry {
    /// Contract version written at `init` and incremented on every upgrade.
    const CURRENT_VERSION: u32 = 1;
    /// TTL constants mirroring agent_vault's bump pattern (#790).
    const INSTANCE_TTL_THRESHOLD: u32 = 17_280;
    const INSTANCE_TTL_BUMP: u32 = 518_400;
    const PERSISTENT_TTL_THRESHOLD: u32 = 17_280;
    const PERSISTENT_TTL_BUMP: u32 = 518_400;

    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(Self::INSTANCE_TTL_THRESHOLD, Self::INSTANCE_TTL_BUMP);
    }

    fn bump_persistent_ttl(env: &Env, key: &DataKey) {
        env.storage().persistent().extend_ttl(
            key,
            Self::PERSISTENT_TTL_THRESHOLD,
            Self::PERSISTENT_TTL_BUMP,
        );
    }

    pub fn __constructor(env: Env, owner: Address, operator: Address) {
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Operator, &operator);
        env.storage()
            .instance()
            .set(&DataKey::Version, &Self::CURRENT_VERSION);
        Self::bump_instance_ttl(&env);
    }

    fn owner(env: &Env) -> Result<Address, RegistryError> {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Owner)
            .ok_or(RegistryError::NotInitialized)
    }

    fn operator(env: &Env) -> Result<Address, RegistryError> {
        Self::bump_instance_ttl(env);
        env.storage()
            .instance()
            .get(&DataKey::Operator)
            .ok_or(RegistryError::NotInitialized)
    }

    fn require_operator(env: &Env) -> Result<(), RegistryError> {
        Self::operator(env)?.require_auth();
        Ok(())
    }

    fn get_info(env: &Env, agent: &Address) -> Result<AgentInfo, RegistryError> {
        let key = DataKey::Agent(agent.clone());
        let info = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(RegistryError::AgentNotFound)?;
        Self::bump_persistent_ttl(env, &key);
        Ok(info)
    }

    fn set_info(env: &Env, agent: &Address, info: &AgentInfo) {
        let key = DataKey::Agent(agent.clone());
        env.storage().persistent().set(&key, info);
        Self::bump_persistent_ttl(env, &key);
    }

    /// Operator registers an agent on behalf of the shop owner. The agent
    /// authorizes their own onboarding. Bond must be positive; the real USDC
    /// custody is held by agent-vault.
    pub fn register(
        env: Env,
        agent: Address,
        kyc_ref: Symbol,
        region: Symbol,
        bond_amount: i128,
        license_expiry: u64,
    ) -> Result<(), RegistryError> {
        agent.require_auth();
        Self::require_operator(&env)?;
        if bond_amount <= 0 {
            return Err(RegistryError::InvalidBond);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Agent(agent.clone()))
        {
            return Err(RegistryError::AgentAlreadyRegistered);
        }
        let info = AgentInfo {
            status: AgentStatus::Pending,
            kyc_ref,
            bond_amount,
            license_expiry,
            region,
            reputation: 0,
        };
        Self::set_info(&env, &agent, &info);
        events::agent_registered(&env, &agent, &info);
        Ok(())
    }

    /// Checks shared by `activate` and `reinstate`: no active agent without
    /// a bond, a kyc_ref, and a license that has not already lapsed (#789).
    fn validate_eligible_for_active(
        env: &Env,
        info: &AgentInfo,
    ) -> Result<(), RegistryError> {
        if info.kyc_ref == Symbol::new(env, "") {
            return Err(RegistryError::MissingKyc);
        }
        if info.bond_amount <= 0 {
            return Err(RegistryError::InvalidBond);
        }
        if info.license_expiry <= env.ledger().timestamp() {
            return Err(RegistryError::LicenseExpired);
        }
        Ok(())
    }

    /// Operator activates a Pending agent. Invariant: no active agent
    /// without a bond and a kyc_ref.
    pub fn activate(env: Env, agent: Address) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        if info.status != AgentStatus::Pending {
            return Err(RegistryError::InvalidStatusTransition);
        }
        Self::validate_eligible_for_active(&env, &info)?;
        let from = info.status;
        info.status = AgentStatus::Active;
        Self::set_info(&env, &agent, &info);
        events::agent_status_changed(&env, &agent, from, info.status);
        Ok(())
    }

    /// Permissionless: moves an Active agent whose license has lapsed to
    /// Expired. Anyone may call it since it only applies an already-true
    /// fact; it is a no-op (well, an error) on any agent not currently
    /// Active-and-lapsed (#789).
    pub fn expire(env: Env, agent: Address) -> Result<(), RegistryError> {
        let mut info = Self::get_info(&env, &agent)?;
        if info.status != AgentStatus::Active || info.license_expiry > env.ledger().timestamp() {
            return Err(RegistryError::InvalidStatusTransition);
        }
        let from = info.status;
        info.status = AgentStatus::Expired;
        Self::set_info(&env, &agent, &info);
        events::agent_status_changed(&env, &agent, from, info.status);
        Ok(())
    }

    /// Operator reinstates a Suspended agent back to Active, re-checking
    /// the same eligibility `activate` requires (#789).
    pub fn reinstate(env: Env, agent: Address) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        if info.status != AgentStatus::Suspended {
            return Err(RegistryError::InvalidStatusTransition);
        }
        Self::validate_eligible_for_active(&env, &info)?;
        let from = info.status;
        info.status = AgentStatus::Active;
        Self::set_info(&env, &agent, &info);
        events::agent_status_changed(&env, &agent, from, info.status);
        Ok(())
    }

    /// Operator suspends an agent (e.g. AML flag). Bond stays frozen.
    pub fn suspend(env: Env, agent: Address) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        if info.status == AgentStatus::Suspended {
            return Err(RegistryError::InvalidStatusTransition);
        }
        let from = info.status;
        info.status = AgentStatus::Suspended;
        Self::set_info(&env, &agent, &info);
        events::agent_status_changed(&env, &agent, from, info.status);
        Ok(())
    }

    /// Operator updates an agent's reputation score (post-transaction trust).
    pub fn set_reputation(env: Env, agent: Address, reputation: i128) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        let old_reputation = info.reputation;
        info.reputation = reputation;
        Self::set_info(&env, &agent, &info);
        events::reputation_updated(&env, &agent, old_reputation, reputation);
        Ok(())
    }

    /// Operator renews an agent's license.
    pub fn renew_license(
        env: Env,
        agent: Address,
        license_expiry: u64,
    ) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        if license_expiry <= env.ledger().timestamp() {
            return Err(RegistryError::LicenseExpired);
        }
        let mut info = Self::get_info(&env, &agent)?;
        let old_expiry = info.license_expiry;
        info.license_expiry = license_expiry;
        Self::set_info(&env, &agent, &info);
        events::license_renewed(&env, &agent, old_expiry, license_expiry);
        Ok(())
    }

    /// Operator increases an agent's bond. Bond is frozen while the agent is
    /// Active (float in circulation); increase is always allowed.
    pub fn top_up_bond(env: Env, agent: Address, amount: i128) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        if amount <= 0 {
            return Err(RegistryError::InvalidBond);
        }
        let mut info = Self::get_info(&env, &agent)?;
        info.bond_amount = info
            .bond_amount
            .checked_add(amount)
            .ok_or(RegistryError::InvalidBond)?;
        Self::set_info(&env, &agent, &info);
        events::bond_updated(&env, &agent, info.bond_amount);
        Ok(())
    }

    /// Operator withdraws an agent's bond. Frozen while the agent is Active:
    /// a live agent must stay bonded. (The vault enforces float == 0 before
    /// releasing custody on the real USDC.)
    pub fn withdraw_bond(env: Env, agent: Address) -> Result<(), RegistryError> {
        Self::require_operator(&env)?;
        let mut info = Self::get_info(&env, &agent)?;
        if info.status == AgentStatus::Active {
            return Err(RegistryError::BondFrozen);
        }
        info.bond_amount = 0;
        Self::set_info(&env, &agent, &info);
        events::bond_updated(&env, &agent, 0);
        Ok(())
    }

    /// Read an agent's record.
    pub fn get_agent(env: Env, agent: Address) -> Result<AgentInfo, RegistryError> {
        Self::get_info(&env, &agent)
    }

    pub fn get_operator(env: Env) -> Result<Address, RegistryError> {
        Self::operator(&env)
    }

    pub fn get_owner(env: Env) -> Result<Address, RegistryError> {
        Self::owner(&env)
    }

    /// Current contract version. Starts at [`Self::CURRENT_VERSION`] and is
    /// bumped by each successful [`Self::upgrade`].
    pub fn version(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Version).unwrap_or(0)
    }

    /// Patch the contract in place, replacing the installed WASM with
    /// `new_wasm_hash`. Owner-gated: state is preserved, so agent records,
    /// bonds and KYC references survive the upgrade.
    ///
    /// Mirrors the lending-pool upgrade pattern: bump the stored version and
    /// emit an event before handing control to the deployer, so the version a
    /// reader sees always matches the WASM that will run next.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), RegistryError> {
        Self::owner(&env)?.require_auth();
        let old_version = Self::version(env.clone());
        let new_version = old_version.saturating_add(1);
        env.storage()
            .instance()
            .set(&DataKey::Version, &new_version);
        events::contract_upgraded(&env, old_version, new_version);
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test;
