import { jest } from '@jest/globals';
import {
  Account,
  Address,
  BASE_FEE,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';

const mockQuery = jest.fn();
const mockBuildAgentVaultTx = jest.fn();
const mockSubmitSignedTx = jest.fn();
const mockValidateBurnFloatTx = jest.fn();

const agentKeypair = Keypair.random();
const otherAgent = Keypair.random();
const recipientKeypair = Keypair.random();

jest.unstable_mockModule('../db/connection.js', () => ({
  default: { query: mockQuery },
  pool: { query: mockQuery, connect: jest.fn(), end: jest.fn() },
  query: mockQuery,
  getClient: jest.fn(),
  closePool: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.unstable_mockModule('../config/stellar.js', () => ({
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  createSorobanRpcServer: jest.fn(),
}));

jest.unstable_mockModule('../services/sorobanService.js', () => ({
  sorobanService: {
    buildAgentVaultTx: mockBuildAgentVaultTx,
    submitSignedTx: mockSubmitSignedTx,
    validateBurnFloatTx: mockValidateBurnFloatTx,
  },
}));

const { cashPickupService } = await import('../services/cashPickupService.js');

const creditedClaim = {
  id: '11111111-1111-4111-8111-111111111111',
  remittance_id: '22222222-2222-4222-8222-222222222222',
  recipient_address: recipientKeypair.publicKey(),
  agent_address: agentKeypair.publicKey(),
  amount_stroops: '500000000',
  status: 'credited',
  redeem_code: 'ABCD2345',
  mint_tx_hash: 'tx-mint-1',
  burn_tx_hash: null,
  mint_attempts: 1,
  mint_error: null,
  credited_at: new Date(),
  redeemed_at: null,
  created_at: new Date(),
  updated_at: new Date(),
};

function signedBurnTx(signer: Keypair) {
  const tx = new TransactionBuilder(new Account(signer.publicKey(), '1'), {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4',
        function: 'burn_float',
        args: [
          Address.fromString(signer.publicKey()).toScVal(),
          nativeToScVal(500000000n, { type: 'i128' }),
        ],
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(signer);
  return tx.toXDR();
}

describe('Cash pickup redeem with one-time code and burn_float (#950)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('recipient sees credited balance and one-time code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [creditedClaim] });

    const claims = await cashPickupService.getClaimsForRecipient(recipientKeypair.publicKey());

    expect(claims).toHaveLength(1);
    expect(claims[0]?.amount).toBe(50);
    expect(claims[0]?.redeemCode).toBe('ABCD2345');
  });

  it('builds burn_float for exact claim amount_stroops when code matches', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [creditedClaim] });
    mockBuildAgentVaultTx.mockResolvedValueOnce({ unsignedTxXdr: 'unsigned-xdr' });

    const res = await cashPickupService.buildRedeemBurnFloatTx(
      creditedClaim.id,
      agentKeypair.publicKey(),
      'abcd2345',
    );

    expect(res.amountStroops).toBe('500000000');
    expect(mockBuildAgentVaultTx).toHaveBeenCalledWith(
      agentKeypair.publicKey(),
      'burn_float',
      agentKeypair.publicKey(),
      500000000n,
    );
  });

  it('transitions claim to redeemed only after burn_float confirms', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [creditedClaim] }).mockResolvedValueOnce({
      rows: [{ ...creditedClaim, status: 'redeemed', burn_tx_hash: 'tx-burn-1' }],
    });
    mockSubmitSignedTx.mockResolvedValueOnce({ txHash: 'tx-burn-1', status: 'SUCCESS' });

    const redeemed = await cashPickupService.confirmRedeemBurnFloat(
      creditedClaim.id,
      agentKeypair.publicKey(),
      'ABCD2345',
      signedBurnTx(agentKeypair),
    );

    expect(redeemed.status).toBe('redeemed');
    expect(redeemed.burnTxHash).toBe('tx-burn-1');
    expect(mockValidateBurnFloatTx).toHaveBeenCalledWith(
      expect.any(String),
      agentKeypair.publicKey(),
      500000000n,
    );
  });

  it('does not submit or redeem when the signed tx is not the exact burn_float', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [creditedClaim] });
    mockValidateBurnFloatTx.mockImplementationOnce(() => {
      throw new Error('signedTxXdr does not match burn_float: contract arguments');
    });

    await expect(
      cashPickupService.confirmRedeemBurnFloat(
        creditedClaim.id,
        agentKeypair.publicKey(),
        'ABCD2345',
        signedBurnTx(agentKeypair),
      ),
    ).rejects.toThrow(/contract arguments/);
    expect(mockSubmitSignedTx).not.toHaveBeenCalled();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('rejects double redemption and wrong agent or wrong code', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ ...creditedClaim, status: 'redeemed' }] });
    await expect(
      cashPickupService.buildRedeemBurnFloatTx(
        creditedClaim.id,
        agentKeypair.publicKey(),
        'ABCD2345',
      ),
    ).rejects.toThrow(/already been redeemed/);

    mockQuery.mockResolvedValueOnce({ rows: [creditedClaim] });
    await expect(
      cashPickupService.buildRedeemBurnFloatTx(
        creditedClaim.id,
        otherAgent.publicKey(),
        'ABCD2345',
      ),
    ).rejects.toThrow(/not the assigned agent/);

    mockQuery.mockResolvedValueOnce({ rows: [creditedClaim] });
    await expect(
      cashPickupService.buildRedeemBurnFloatTx(
        creditedClaim.id,
        agentKeypair.publicKey(),
        'WRONGCOD',
      ),
    ).rejects.toThrow(/Invalid one-time redemption code/);
  });
});
