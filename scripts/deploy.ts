import {
    Keypair,
    Operation,
    TransactionBuilder,
    rpc as Rpc,
    Address,
    nativeToScVal,
    xdr,
    StrKey,
    Contract,
    hash,
} from '@stellar/stellar-sdk';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const CONFIG_PATH = path.join(__dirname, 'deploy-config.json');
const POLL_INTERVAL_MS = 2000;

// Compute the SHA-256 hash of WASM bytes — this is the on-chain upload key.
function computeWasmHash(wasm: Buffer): Buffer {
    return createHash('sha256').update(wasm).digest();
}

// Deterministic per-contract salt so re-runs don't stomp each other's addresses.
function contractSalt(name: string): Buffer {
    return createHash('sha256').update(`dukapay:${name}`).digest();
}

// The address a contract gets when `deployer` creates it with `salt`. It is
// fixed by those inputs, so a re-run can find a contract an earlier run made.
function expectedContractId(deployer: string, salt: Buffer, networkPassphrase: string): string {
    const preimage = xdr.HashIdPreimage.envelopeTypeContractId(
        new xdr.HashIdPreimageContractId({
            networkId: hash(Buffer.from(networkPassphrase)),
            contractIdPreimage: xdr.ContractIdPreimage.contractIdPreimageFromAddress(
                new xdr.ContractIdPreimageFromAddress({
                    address: Address.fromString(deployer).toScAddress(),
                    salt,
                }),
            ),
        }),
    );
    return StrKey.encodeContract(hash(preimage.toXDR()));
}

async function contractExists(server: Rpc.Server, contractId: string): Promise<boolean> {
    const { entries } = await server.getLedgerEntries(new Contract(contractId).getFootprint());
    return entries.length > 0;
}

async function sendTx(
    server: Rpc.Server,
    tx: ReturnType<TransactionBuilder['build']>,
    account: Keypair,
): Promise<Rpc.Api.GetSuccessfulTransactionResponse> {
    const sim = await server.simulateTransaction(tx);
    if (Rpc.Api.isSimulationError(sim)) {
        throw new Error(`Simulation failed: ${JSON.stringify(sim.error, null, 2)}`);
    }

    const preparedTx = await server.prepareTransaction(tx);
    preparedTx.sign(account);

    const sendResponse = await server.sendTransaction(preparedTx);
    if (sendResponse.status !== 'PENDING') {
        throw new Error(`Send failed: ${JSON.stringify(sendResponse, null, 2)}`);
    }

    console.log(`    tx ${sendResponse.hash} … polling`);

    let txResponse = await server.getTransaction(sendResponse.hash);
    while (txResponse.status === 'NOT_FOUND') {
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
        txResponse = await server.getTransaction(sendResponse.hash);
    }

    if (txResponse.status !== 'SUCCESS') {
        throw new Error(`Transaction failed: ${JSON.stringify(txResponse, null, 2)}`);
    }

    return txResponse as Rpc.Api.GetSuccessfulTransactionResponse;
}

// Upload WASM bytecode to the network and return its SHA-256 hash.
// If the same WASM was uploaded before the hash is already indexed, but the
// operation is idempotent and safe to repeat.
async function uploadWasm(
    server: Rpc.Server,
    wasmPath: string,
    account: Keypair,
    networkPassphrase: string,
): Promise<Buffer> {
    const wasm = await fs.readFile(wasmPath);
    const wasmHash = computeWasmHash(wasm);

    console.log(`  uploading ${path.basename(wasmPath)} (hash ${wasmHash.toString('hex').slice(0, 12)}…)`);

    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(Operation.uploadContractWasm({ wasm }))
        .setTimeout(30)
        .build();

    await sendTx(server, tx, account);
    return wasmHash;
}

// Instantiate a contract from an uploaded WASM hash. Returns the contract ID.
// If an earlier run already created it, reuse it instead of failing.
async function createInstance(
    server: Rpc.Server,
    wasmHash: Buffer,
    salt: Buffer,
    account: Keypair,
    networkPassphrase: string,
): Promise<string> {
    const contractId = expectedContractId(account.publicKey(), salt, networkPassphrase);
    if (await contractExists(server, contractId)) {
        console.log('    already exists from an earlier run, reusing');
        return contractId;
    }

    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(
            Operation.createCustomContract({
                address: Address.fromString(account.publicKey()),
                wasmHash,
                salt,
            }),
        )
        .setTimeout(30)
        .build();

    const result = await sendTx(server, tx, account);
    // createCustomContract returns the new contract's address.
    const created = result.returnValue ? Address.fromScVal(result.returnValue).toString() : null;
    if (created !== contractId) {
        throw new Error(`Created contract ${created} but expected ${contractId}`);
    }
    return contractId;
}

// Convert an argument to ScVal. Public-key / contract-address strings
// (G…/C… keys) become Address ScVals so contract functions taking `Address`
// parameters decode correctly; everything else goes through nativeToScVal,
// which also understands { type, value } hints (u32, i128, …).
function toContractScVal(arg: unknown): xdr.ScVal {
    if (
        typeof arg === 'string' &&
        (StrKey.isValidEd25519PublicKey(arg) || StrKey.isValidContract(arg))
    ) {
        return Address.fromString(arg).toScVal();
    }
    return nativeToScVal(arg);
}

// Call a contract function with positional arguments.
async function invoke(
    server: Rpc.Server,
    contractId: string,
    method: string,
    args: unknown[],
    account: Keypair,
    networkPassphrase: string,
): Promise<void> {
    const source = await server.getAccount(account.publicKey());
    const tx = new TransactionBuilder(source, { fee: '100000', networkPassphrase })
        .addOperation(
            Operation.invokeHostFunction({
                func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                    new xdr.InvokeContractArgs({
                        contractAddress: Address.fromString(contractId).toScAddress(),
                        functionName: method,
                        args: args.map(toContractScVal),
                    }),
                ),
                auth: [],
            }),
        )
        .setTimeout(30)
        .build();

    await sendTx(server, tx, account);
}

// Run an initializer, treating the contract's AlreadyInitialized error as done
// so a deploy that stopped half way can simply be run again.
async function initOnce(label: string, alreadyInitializedCode: number, run: () => Promise<unknown>) {
    console.log(`  ${label}`);
    try {
        await run();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes(`Error(Contract, #${alreadyInitializedCode})`)) {
            console.log('    already initialized by an earlier run, skipping');
            return;
        }
        throw error;
    }
}

async function main() {
    const network = process.argv[2] || 'testnet';
    const config = (await fs.readJson(CONFIG_PATH))[network];
    if (!config) throw new Error(`No config for network: ${network}`);

    const secretKey = process.env.SECRET_KEY;
    if (!secretKey) throw new Error('SECRET_KEY environment variable is required');

    const account = Keypair.fromSecret(secretKey);
    // Fall back to the deployer's own key when admin is not set in config.
    const adminAddr =
        config.admin === 'YOUR_ADMIN_PUBLIC_KEY' ? account.publicKey() : config.admin;

    const server = new Rpc.Server(config.rpcUrl);
    const passphrase = config.networkPassphrase;

    console.log(`\nDukaPay deployment → ${network}`);
    console.log(`admin : ${adminAddr}`);
    console.log(`token : ${config.token}\n`);

    // ── 1. Upload all WASM binaries ─────────────────────────────────────────────
    console.log('[1/4] Uploading WASM binaries…');
    const nftWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.remittance_nft.wasm),
        account,
        passphrase,
    );
    const poolWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.lending_pool.wasm),
        account,
        passphrase,
    );
    const managerWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.loan_manager.wasm),
        account,
        passphrase,
    );
    const govWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.multisig_governance.wasm),
        account,
        passphrase,
    );
    const registryWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.agent_registry.wasm),
        account,
        passphrase,
    );
    const vaultWasmHash = await uploadWasm(
        server,
        path.resolve(__dirname, config.contracts.agent_vault.wasm),
        account,
        passphrase,
    );

    // ── 2. Instantiate contracts ────────────────────────────────────────────────
    console.log('\n[2/4] Creating contract instances…');

    console.log('  RemittanceNFT');
    const nftContractId = await createInstance(server, nftWasmHash, contractSalt('nft'), account, passphrase);
    console.log(`    → ${nftContractId}`);

    console.log('  LendingPool');
    const poolContractId = await createInstance(server, poolWasmHash, contractSalt('pool'), account, passphrase);
    console.log(`    → ${poolContractId}`);

    console.log('  LoanManager');
    const managerContractId = await createInstance(server, managerWasmHash, contractSalt('manager'), account, passphrase);
    console.log(`    → ${managerContractId}`);

    console.log('  Governance');
    const govContractId = await createInstance(server, govWasmHash, contractSalt('governance'), account, passphrase);
    console.log(`    → ${govContractId}`);

    console.log('  AgentRegistry');
    const registryContractId = await createInstance(server, registryWasmHash, contractSalt('agent_registry'), account, passphrase);
    console.log(`    → ${registryContractId}`);

    console.log('  AgentVault');
    const vaultContractId = await createInstance(server, vaultWasmHash, contractSalt('agent_vault'), account, passphrase);
    console.log(`    → ${vaultContractId}`);

    // ── 3. Initialize in dependency order ──────────────────────────────────────
    //
    // Ordering constraints:
    //   a. NFT must be initialized before authorize_minter can be called.
    //   b. authorize_minter(LoanManager) must run BEFORE LoanManager.initialize,
    //      because LoanManager.initialize asserts it is already an authorized minter.
    //   c. LendingPool has no dependency on NFT or LoanManager at init time.
    //   d. LoanManager.initialize takes (nft, pool, token, admin) so both NFT and
    //      Pool addresses must be known first.
    //   e. Governance.initialize takes (admin, target_contract). We point it at
    //      LoanManager as the primary governed contract.
    //
    console.log('\n[3/4] Initializing contracts…');

    // NFT
    await initOnce('NFT.initialize', 1, () =>
        invoke(server, nftContractId, 'initialize', [adminAddr], account, passphrase),
    );

    // Authorize LoanManager as minter BEFORE LoanManager.initialize checks for it.
    console.log('  NFT.authorize_minter(LoanManager)');
    await invoke(server, nftContractId, 'authorize_minter', [managerContractId], account, passphrase);

    // LendingPool
    // initialize(admin): the pool takes the token per call, not at setup.
    await initOnce('LendingPool.initialize', 1, () =>
        invoke(server, poolContractId, 'initialize', [adminAddr], account, passphrase),
    );

    // LoanManager — validates minter authorization on-chain during this call.
    // initialize(nft, pool, token, admin, governance)
    await initOnce('LoanManager.initialize', 1, () =>
        invoke(
            server,
            managerContractId,
            'initialize',
            [nftContractId, poolContractId, config.token, adminAddr, govContractId],
            account,
            passphrase,
        ),
    );

    // Let the pool accept yield/loss accounting updates only from this manager.
    console.log('  LendingPool.set_loan_manager(LoanManager)');
    await invoke(server, poolContractId, 'set_loan_manager', [managerContractId], account, passphrase);

    // Governance — target is LoanManager (the core protocol contract).
    await initOnce('Governance.initialize(target=LoanManager)', 4001, () =>
        invoke(server, govContractId, 'initialize', [adminAddr, managerContractId], account, passphrase),
    );

    // AgentRegistry — no cross-contract deps. Deployer acts as operator for now.
    await initOnce('AgentRegistry.init(owner=admin, operator=admin)', 1, () =>
        invoke(server, registryContractId, 'init', [adminAddr, adminAddr], account, passphrase),
    );

    // AgentVault — USDC collateral vault backing agent float.
    await initOnce('AgentVault.init(owner=admin, operator=admin, token, max_haircut, min_collateral)', 1, () =>
        invoke(
            server,
            vaultContractId,
            'init',
            [
                adminAddr,
                adminAddr,
                config.token,
                { type: 'u32', value: config.contracts.agent_vault.max_haircut_bps },
                { type: 'i128', value: config.contracts.agent_vault.min_collateral },
            ],
            account,
            passphrase,
        ),
    );

    // ── 4. Persist contract IDs ─────────────────────────────────────────────────
    console.log('\n[4/4] Writing contract addresses to .env files…');

    // Variable names each app reads (docs/ENVIRONMENT.md).
    const header = `\n# DukaPay contracts — ${network} — ${new Date().toISOString()}`;
    const frontendEnv = [
        header,
        `NEXT_PUBLIC_NFT_CONTRACT_ID=${nftContractId}`,
        `NEXT_PUBLIC_LOAN_MANAGER_CONTRACT_ID=${managerContractId}`,
        `NEXT_PUBLIC_MANAGER_CONTRACT_ID=${managerContractId}`,
        '',
    ].join('\n');
    const backendEnv = [
        header,
        `REMITTANCE_NFT_CONTRACT_ID=${nftContractId}`,
        `LENDING_POOL_CONTRACT_ID=${poolContractId}`,
        `LOAN_MANAGER_CONTRACT_ID=${managerContractId}`,
        `MULTISIG_GOVERNANCE_CONTRACT_ID=${govContractId}`,
        `AGENT_REGISTRY_CONTRACT_ID=${registryContractId}`,
        `AGENT_VAULT_CONTRACT_ID=${vaultContractId}`,
        `POOL_TOKEN_ADDRESS=${config.token}`,
        '',
    ].join('\n');

    await fs.appendFile(path.join(__dirname, '../frontend/.env.local'), frontendEnv);
    await fs.appendFile(path.join(__dirname, '../backend/.env'), backendEnv);

    console.log('\nDeployment complete.');
    console.log(`  RemittanceNFT  : ${nftContractId}`);
    console.log(`  LendingPool    : ${poolContractId}`);
    console.log(`  LoanManager    : ${managerContractId}`);
    console.log(`  Governance     : ${govContractId}`);
    console.log(`  AgentRegistry  : ${registryContractId}`);
    console.log(`  AgentVault     : ${vaultContractId}`);
}

main().catch(error => {
    console.error('\nDeployment failed:', error instanceof Error ? error.message : error);
    process.exit(1);
});
