/**
 * Cash pickup redemption (#950) marks a claim redeemed after the agent's signed
 * transaction confirms, so the backend must check that transaction is exactly
 * burn_float(agent, claim amount) on the agent vault before submitting it.
 */
import { jest } from '@jest/globals';
import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';

const VAULT = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 8));
process.env.AGENT_VAULT_CONTRACT_ID = VAULT;

jest.unstable_mockModule('../config/stellar.js', () => ({
  createSorobanRpcServer: jest.fn(),
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  getStellarRpcUrl: () => 'http://localhost:8000',
}));

const { sorobanService } = await import('../services/sorobanService.js');

const agent = Keypair.random();
const other = Keypair.random();
const AMOUNT = 500_000_000n;

function signed(
  signer: Keypair,
  {
    contract = VAULT,
    fn = 'burn_float',
    agentArg = signer.publicKey(),
    amount = AMOUNT,
  }: { contract?: string; fn?: string; agentArg?: string; amount?: bigint } = {},
): string {
  const tx = new TransactionBuilder(new Account(signer.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract,
        function: fn,
        args: [Address.fromString(agentArg).toScVal(), nativeToScVal(amount, { type: 'i128' })],
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(signer);
  return tx.toXDR();
}

describe('sorobanService.validateBurnFloatTx', () => {
  it('accepts burn_float(agent, amount) on the agent vault from the agent', () => {
    expect(() =>
      sorobanService.validateBurnFloatTx(signed(agent), agent.publicKey(), AMOUNT),
    ).not.toThrow();
  });

  it('rejects a smaller burn than the claim amount', () => {
    expect(() =>
      sorobanService.validateBurnFloatTx(signed(agent, { amount: 1n }), agent.publicKey(), AMOUNT),
    ).toThrow(/contract arguments/);
  });

  it('rejects another function on the vault', () => {
    expect(() =>
      sorobanService.validateBurnFloatTx(
        signed(agent, { fn: 'mint_float' }),
        agent.publicKey(),
        AMOUNT,
      ),
    ).toThrow(/contract function/);
  });

  it('rejects a call to another contract', () => {
    expect(() =>
      sorobanService.validateBurnFloatTx(
        signed(agent, { contract: OTHER_CONTRACT }),
        agent.publicKey(),
        AMOUNT,
      ),
    ).toThrow(/contract address/);
  });

  it('rejects a transaction from another account', () => {
    expect(() =>
      sorobanService.validateBurnFloatTx(signed(other), agent.publicKey(), AMOUNT),
    ).toThrow(/source account/);
  });

  it("rejects a burn of another agent's float", () => {
    expect(() =>
      sorobanService.validateBurnFloatTx(
        signed(agent, { agentArg: other.publicKey() }),
        agent.publicKey(),
        AMOUNT,
      ),
    ).toThrow(/contract arguments/);
  });
});
