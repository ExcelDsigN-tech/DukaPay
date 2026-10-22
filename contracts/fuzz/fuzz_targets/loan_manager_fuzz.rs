#![no_main]

use arbitrary::Arbitrary;
use lending_pool::LendingPool;
use libfuzzer_sys::fuzz_target;
use loan_manager::{LoanManager, LoanManagerClient};
use remittance_nft::{RemittanceNFT, RemittanceNFTClient};
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, BytesN, Env, IntoVal, Symbol, Val};

const N_USERS: usize = 8;

macro_rules! rcall {
    ($env:expr, $client:expr, $func:expr, ($($arg:expr),*)) => {
        $env.try_invoke_contract::<Val, Val>(
            &$client.address,
            &Symbol::new($env, $func),
            ($($arg.clone(),)*).into_val($env)
        )
    };
}

#[derive(Arbitrary, Debug)]
enum FuzzAction {
    RequestLoan {
        user_id: u8,
        amount: i128,
        score: u32,
    },
    ApproveLoan {
        loan_id: u32,
    },
    Repay {
        user_id: u8,
        amount: i128,
        initial_score: u32,
    },
    MultipleOperations {
        operations: Vec<LoanOperation>,
    },
}

fn user_of(users: &[Address], idx: u8) -> Address {
    users[(idx as usize) % N_USERS].clone()
}

#[derive(Arbitrary, Debug)]
struct LoanOperation {
    user_id: u8,
    amount: i128,
    score: u32,
    operation_type: u8, // 0: request, 1: repay
}

fuzz_target!(|data: FuzzAction| {
    let env = Env::default();
    env.mock_all_auths();

    // 1. Setup RemittanceNFT
    let admin = Address::generate(&env);
    let nft_id = env.register(RemittanceNFT, (&admin,));
    let nft_client = RemittanceNFTClient::new(&env, &nft_id);

    // 2. Setup LoanManager. constructor takes (nft_contract, lending_pool, token, admin, governance).
    let pool_admin = Address::generate(&env);
    let lending_pool_id = env.register(LendingPool, (&pool_admin,));
    let token_admin = Address::generate(&env);
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_id = token_contract_id.address();
    let governance = Address::generate(&env);
    let loan_manager_id = env.register(
        LoanManager,
        (&nft_id, &lending_pool_id, &token_id, &admin, &governance),
    );
    let loan_manager_client = LoanManagerClient::new(&env, &loan_manager_id);

    // Authorize LoanManager to update scores in NFT contract
    nft_client.authorize_minter(&loan_manager_id);

    // A stable pool of users so separate operations in one run hit the same accounts.
    let users: std::vec::Vec<Address> = (0..N_USERS).map(|_| Address::generate(&env)).collect();

    match data {
        FuzzAction::RequestLoan {
            user_id,
            amount,
            score,
        } => {
            let user = user_of(&users, user_id);

            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // Mint NFT for user with specific score
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(
                &user,
                &score,
                &history_hash,
                &soroban_sdk::String::from_str(&env, "ipfs://test"),
                &BytesN::from_array(&env, &[0u8; 32]),
                &None,
            );

            let result = rcall!(&env, loan_manager_client, "request_loan", (user, amount));

            if result.is_ok() {
                // Verify invariants if any (e.g. loan created)
            } else {
                // Verify invariant: score should be >= 500 for loan approval
                if score < 500 {
                    // This is expected failure
                }
            }
        }

        FuzzAction::ApproveLoan { loan_id } => {
            let _ = rcall!(&env, loan_manager_client, "approve_loan", (loan_id));
        }

        FuzzAction::Repay {
            user_id,
            amount,
            initial_score,
        } => {
            let user = user_of(&users, user_id);

            // Skip invalid amounts
            if amount <= 0 {
                return;
            }

            // Mint NFT for user
            let history_hash = BytesN::from_array(&env, &[0u8; 32]);
            nft_client.mint(
                &user,
                &initial_score,
                &history_hash,
                &soroban_sdk::String::from_str(&env, "ipfs://test"),
                &BytesN::from_array(&env, &[0u8; 32]),
                &None,
            );

            let score_before = nft_client.get_score(&user);
            let result = rcall!(&env, loan_manager_client, "repay", (user, amount));

            if result.is_ok() {
                let score_after = nft_client.get_score(&user);

                // Verify invariant: score should be updated (increased by 1 per 100 units)
                let expected_increase = (amount / 100) as u32;
                assert_eq!(
                    score_after,
                    score_before + expected_increase,
                    "Score should increase correctly after repayment"
                );
            }
        }

        FuzzAction::MultipleOperations { operations } => {
            let mut initialized = [false; N_USERS];

            for op in operations {
                let user_addr = user_of(&users, op.user_id);
                let user_idx = (op.user_id as usize) % N_USERS;
                if !initialized[user_idx] {
                    let history_hash = BytesN::from_array(&env, &[0u8; 32]);
                    // Initialize the user once, with the score from their first operation.
                    nft_client.mint(
                        &user_addr,
                        &op.score,
                        &history_hash,
                        &soroban_sdk::String::from_str(&env, "ipfs://test"),
                        &BytesN::from_array(&env, &[0u8; 32]),
                        &None,
                    );
                    initialized[user_idx] = true;
                }

                match op.operation_type % 2 {
                    0 if op.amount > 0 => {
                        // Request loan
                        let _ = rcall!(
                            &env,
                            loan_manager_client,
                            "request_loan",
                            (user_addr, op.amount)
                        );
                    }
                    1 if op.amount > 0 => {
                        // Repay
                        let _ = rcall!(&env, loan_manager_client, "repay", (user_addr, op.amount));
                    }
                    _ => {}
                }
            }
        }
    }
});
