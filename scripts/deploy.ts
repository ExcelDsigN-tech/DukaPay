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
} from "@stellar/stellar-sdk";
import { createHash } from "crypto";
import * as fs from "fs-extra";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const CONFIG_PATH = path.join(__dirname, "deploy-config.json");
const REGISTRY_PATH = path.join(__dirname, "contract-registry.json");
const POLL_INTERVAL_MS = 2000;

// Compute the SHA-256 hash of WASM bytes; this is the on-chain upload key.
function computeWasmHash(wasm: Buffer): Buffer {
  return createHash("sha256").update(wasm).digest();
}

// Deterministic per-contract salt so re-runs don't stomp each other's addresses.
function contractSalt(name: string): Buffer {
  return createHash("sha256").update(`dukapay:${name}`).digest();
}

// The address a contract gets when `deployer` creates it with `salt`. It is
// fixed by those inputs, so a re-run can find a contract an earlier run made.
function expectedContractId(
  deployer: string,
  salt: Buffer,
  networkPassphrase: string,
): string {
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

async function contractExists(
  server: Rpc.Server,
  contractId: string,
): Promise<boolean> {
  const { entries } = await server.getLedgerEntries(
    new Contract(contractId).getFootprint(),
  );
  return entries.length > 0;
}

async function sendTx(
  server: Rpc.Server,
  tx: ReturnType<TransactionBuilder["build"]>,
  account: Keypair,
): Promise<Rpc.Api.GetSuccessfulTransactionResponse> {
  const sim = await server.simulateTransaction(tx);
  if (Rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${JSON.stringify(sim.error, null, 2)}`);
  }

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(account);

  const sendResponse = await server.sendTransaction(preparedTx);
  if (sendResponse.status !== "PENDING") {
    throw new Error(`Send failed: ${JSON.stringify(sendResponse, null, 2)}`);
  }

  console.log(`    tx ${sendResponse.hash} … polling`);

  let txResponse = await server.getTransaction(sendResponse.hash);
  while (txResponse.status === "NOT_FOUND") {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    txResponse = await server.getTransaction(sendResponse.hash);
  }

  if (txResponse.status !== "SUCCESS") {
    throw new Error(
      `Transaction failed: ${JSON.stringify(txResponse, null, 2)}`,
    );
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

  console.log(
    `  uploading ${path.basename(wasmPath)} (hash ${wasmHash.toString("hex").slice(0, 12)}…)`,
  );

  const source = await server.getAccount(account.publicKey());
  const tx = new TransactionBuilder(source, {
    fee: "100000",
    networkPassphrase,
  })
    .addOperation(Operation.uploadContractWasm({ wasm }))
    .setTimeout(30)
    .build();

  await sendTx(server, tx, account);
  return wasmHash;
}

// Convert an argument to ScVal. Public-key / contract-address strings
// (G…/C… keys) become Address ScVals so contract functions taking `Address`
// parameters decode correctly; everything else goes through nativeToScVal,
// which also understands { type, value } hints (u32, i128, …).
function toContractScVal(arg: unknown): xdr.ScVal {
  if (arg instanceof xdr.ScVal) {
    return arg;
  }
  if (
    typeof arg === "string" &&
    (StrKey.isValidEd25519PublicKey(arg) || StrKey.isValidContract(arg))
  ) {
    return Address.fromString(arg).toScVal();
  }
  if (Array.isArray(arg)) {
    return xdr.ScVal.scvVec(arg.map(toContractScVal));
  }
  if (
    typeof arg === "object" &&
    arg !== null &&
    "type" in arg &&
    "value" in arg
  ) {
    const hint = arg as { type: string; value: unknown };
    return nativeToScVal(hint.value, { type: hint.type as any });
  }
  return nativeToScVal(arg);
}

// Instantiate a contract from an uploaded WASM hash with constructor args.
// Returns the new contract ID. If an earlier run already created it, reuse it.
async function createInstance(
  server: Rpc.Server,
  wasmHash: Buffer,
  salt: Buffer,
  account: Keypair,
  networkPassphrase: string,
  constructorArgs: unknown[] = [],
): Promise<string> {
  const contractId = expectedContractId(
    account.publicKey(),
    salt,
    networkPassphrase,
  );
  if (await contractExists(server, contractId)) {
    console.log("    already exists from an earlier run, reusing");
    return contractId;
  }

  const source = await server.getAccount(account.publicKey());
  const tx = new TransactionBuilder(source, {
    fee: "100000",
    networkPassphrase,
  })
    .addOperation(
      Operation.createCustomContract({
        address: Address.fromString(account.publicKey()),
        wasmHash,
        salt,
        constructorArgs: constructorArgs.map(toContractScVal),
      }),
    )
    .setTimeout(30)
    .build();

  const result = await sendTx(server, tx, account);
  // createCustomContract returns the new contract's address.
  const created = result.returnValue
    ? Address.fromScVal(result.returnValue).toString()
    : null;
  if (created !== contractId) {
    throw new Error(`Created contract ${created} but expected ${contractId}`);
  }
  return contractId;
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
  const tx = new TransactionBuilder(source, {
    fee: "100000",
    networkPassphrase,
  })
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
async function initOnce(
  label: string,
  alreadyInitializedCode: number,
  run: () => Promise<unknown>,
) {
  console.log(`  ${label}`);
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(`Error(Contract, #${alreadyInitializedCode})`)) {
      console.log("    already initialized by an earlier run, skipping");
      return;
    }
    throw error;
  }
}

async function main() {
  const network = process.argv[2] || "testnet";
  const config = (await fs.readJson(CONFIG_PATH))[network];
  if (!config) throw new Error(`No config for network: ${network}`);

  const secretKey = process.env.SECRET_KEY;
  if (!secretKey)
    throw new Error("SECRET_KEY environment variable is required");

  const account = Keypair.fromSecret(secretKey);
  // Fall back to the deployer's own key when admin is not set in config.
  const adminAddr =
    config.admin === "YOUR_ADMIN_PUBLIC_KEY"
      ? account.publicKey()
      : config.admin;

  const server = new Rpc.Server(config.rpcUrl);
  const passphrase = config.networkPassphrase;

  console.log(`\nDukaPay deployment → ${network}`);
  console.log(`admin : ${adminAddr}`);
  console.log(`token : ${config.token}\n`);

  // ── 1. Upload all WASM binaries ─────────────────────────────────────────────
  console.log("[1/4] Uploading WASM binaries…");
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
  const breakerWasmHash = await uploadWasm(
    server,
    path.resolve(__dirname, config.contracts.circuit_breaker.wasm),
    account,
    passphrase,
  );
  const oracleWasmHash = await uploadWasm(
    server,
    path.resolve(__dirname, config.contracts.oracle.wasm),
    account,
    passphrase,
  );
  const anchorWasmHash = await uploadWasm(
    server,
    path.resolve(__dirname, config.contracts.audit_anchor.wasm),
    account,
    passphrase,
  );

  // ── 2. Instantiate contracts with constructor args (atomic deploy & init) ────
  console.log("\n[2/4] Creating contract instances with constructors…");

  console.log("  CircuitBreaker");
  const breakerContractId = await createInstance(
    server,
    breakerWasmHash,
    contractSalt("circuit_breaker"),
    account,
    passphrase,
    [
      adminAddr,
      [adminAddr],
      { type: "u32", value: config.contracts.circuit_breaker?.threshold ?? 1 },
      {
        type: "u64",
        value: BigInt(
          config.contracts.circuit_breaker?.override_timelock ?? 3600,
        ),
      },
    ],
  );
  console.log(`    → ${breakerContractId}`);

  console.log("  Oracle");
  const oracleContractId = await createInstance(
    server,
    oracleWasmHash,
    contractSalt("oracle"),
    account,
    passphrase,
    [adminAddr, [xdr.ScVal.scvSymbol("binance")]],
  );
  console.log(`    → ${oracleContractId}`);

  console.log("  AuditAnchor");
  const anchorContractId = await createInstance(
    server,
    anchorWasmHash,
    contractSalt("audit_anchor"),
    account,
    passphrase,
    [adminAddr],
  );
  console.log(`    → ${anchorContractId}`);

  console.log("  RemittanceNFT");
  const nftContractId = await createInstance(
    server,
    nftWasmHash,
    contractSalt("nft"),
    account,
    passphrase,
    [adminAddr],
  );
  console.log(`    → ${nftContractId}`);

  console.log("  LendingPool");
  const poolContractId = await createInstance(
    server,
    poolWasmHash,
    contractSalt("pool"),
    account,
    passphrase,
    [adminAddr],
  );
  console.log(`    → ${poolContractId}`);

  console.log("  AgentRegistry");
  const registryContractId = await createInstance(
    server,
    registryWasmHash,
    contractSalt("agent_registry"),
    account,
    passphrase,
    [adminAddr, adminAddr],
  );
  console.log(`    → ${registryContractId}`);

  console.log("  AgentVault");
  const vaultContractId = await createInstance(
    server,
    vaultWasmHash,
    contractSalt("agent_vault"),
    account,
    passphrase,
    [
      adminAddr,
      adminAddr,
      config.token,
      { type: "u32", value: config.contracts.agent_vault.max_haircut_bps },
      {
        type: "i128",
        value: BigInt(config.contracts.agent_vault.min_collateral),
      },
    ],
  );
  console.log(`    → ${vaultContractId}`);

  // Pre-compute governance address for the LoanManager constructor (circular dep: governance also needs loan manager's ID).
  const expectedGovId = expectedContractId(
    account.publicKey(),
    contractSalt("governance"),
    passphrase,
  );
  console.log("  LoanManager");
  const managerContractId = await createInstance(
    server,
    managerWasmHash,
    contractSalt("manager"),
    account,
    passphrase,
    [nftContractId, poolContractId, config.token, adminAddr, expectedGovId],
  );
  console.log(`    → ${managerContractId}`);

  console.log("  Governance");
  const govContractId = await createInstance(
    server,
    govWasmHash,
    contractSalt("governance"),
    account,
    passphrase,
    [adminAddr, managerContractId],
  );
  console.log(`    → ${govContractId}`);

  // ── 3. Configure contract wiring ──────────────────────────────────────────
  console.log("\n[3/4] Configuring contract wiring…");

  // Authorize LoanManager as minter on RemittanceNFT
  console.log("  NFT.authorize_minter(LoanManager)");
  await invoke(
    server,
    nftContractId,
    "authorize_minter",
    [managerContractId],
    account,
    passphrase,
  );

  // Wire CircuitBreaker into AgentVault, LendingPool, and LoanManager
  console.log("  AgentVault.set_circuit_breaker");
  await invoke(
    server,
    vaultContractId,
    "set_circuit_breaker",
    [breakerContractId],
    account,
    passphrase,
  );

  console.log("  LendingPool.set_circuit_breaker");
  await invoke(
    server,
    poolContractId,
    "set_circuit_breaker",
    [breakerContractId],
    account,
    passphrase,
  );

  console.log("  LoanManager.set_circuit_breaker");
  await invoke(
    server,
    managerContractId,
    "set_circuit_breaker",
    [breakerContractId],
    account,
    passphrase,
  );

  // Wire Oracle into LoanManager
  console.log("  LoanManager.set_price_oracle");
  await invoke(
    server,
    managerContractId,
    "set_price_oracle",
    [oracleContractId],
    account,
    passphrase,
  );

  // ── 4. Persist contract IDs ─────────────────────────────────────────────────
  console.log("\n[4/4] Writing contract addresses to .env files and registry…");

  // Variable names each app reads (docs/ENVIRONMENT.md).
  const header = `\n# DukaPay contracts (${network}, ${new Date().toISOString()})`;
  const frontendEnv = [
    header,
    `NEXT_PUBLIC_NFT_CONTRACT_ID=${nftContractId}`,
    `NEXT_PUBLIC_LOAN_MANAGER_CONTRACT_ID=${managerContractId}`,
    `NEXT_PUBLIC_MANAGER_CONTRACT_ID=${managerContractId}`,
    "",
  ].join("\n");
  const backendEnv = [
    header,
    `REMITTANCE_NFT_CONTRACT_ID=${nftContractId}`,
    `LENDING_POOL_CONTRACT_ID=${poolContractId}`,
    `LOAN_MANAGER_CONTRACT_ID=${managerContractId}`,
    `MULTISIG_GOVERNANCE_CONTRACT_ID=${govContractId}`,
    `AGENT_REGISTRY_CONTRACT_ID=${registryContractId}`,
    `AGENT_VAULT_CONTRACT_ID=${vaultContractId}`,
    `CIRCUIT_BREAKER_CONTRACT_ID=${breakerContractId}`,
    `ORACLE_CONTRACT_ID=${oracleContractId}`,
    `AUDIT_ANCHOR_CONTRACT_ID=${anchorContractId}`,
    `POOL_TOKEN_ADDRESS=${config.token}`,
    "",
  ].join("\n");

  await fs.appendFile(
    path.join(__dirname, "../frontend/.env.local"),
    frontendEnv,
  );
  await fs.appendFile(path.join(__dirname, "../backend/.env"), backendEnv);

  if (await fs.pathExists(REGISTRY_PATH)) {
    const registry = await fs.readJson(REGISTRY_PATH);
    if (registry.networks?.[network]?.contracts) {
      const now = new Date().toISOString().slice(0, 10);
      const contractMap: Record<string, string> = {
        remittance_nft: nftContractId,
        lending_pool: poolContractId,
        loan_manager: managerContractId,
        multisig_governance: govContractId,
        agent_registry: registryContractId,
        agent_vault: vaultContractId,
        circuit_breaker: breakerContractId,
        oracle: oracleContractId,
        audit_anchor: anchorContractId,
      };
      for (const [name, addr] of Object.entries(contractMap)) {
        if (registry.networks[network].contracts[name]) {
          registry.networks[network].contracts[name].address = addr;
          registry.networks[network].contracts[name].deployDate = now;
          registry.networks[network].contracts[name].deployer = adminAddr;
        }
      }
      await fs.writeJson(REGISTRY_PATH, registry, { spaces: 2 });
      console.log("  contract-registry.json updated.");
    }
  }

  console.log("\nDeployment complete.");
  console.log(`  RemittanceNFT           : ${nftContractId}`);
  console.log(`  LendingPool             : ${poolContractId}`);
  console.log(`  LoanManager             : ${managerContractId}`);
  console.log(`  Governance              : ${govContractId}`);
  console.log(`  AgentRegistry           : ${registryContractId}`);
  console.log(`  AgentVault              : ${vaultContractId}`);
  console.log(`  CircuitBreaker          : ${breakerContractId}`);
  console.log(`  Oracle                  : ${oracleContractId}`);
  console.log(`  AuditAnchor             : ${anchorContractId}`);
  console.log(`  AUDIT_ANCHOR_CONTRACT_ID: ${anchorContractId}`);
}

main().catch((error) => {
  console.error(
    "\nDeployment failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
