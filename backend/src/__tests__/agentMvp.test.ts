/**
 * Agent MVP (#775): the registry needs operator auth on `register`, so only the
 * configured operator may build a registration, and the backend signs only the
 * operator's own auth entry in the returned XDR.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  Account,
  Address,
  Keypair,
  Networks,
  StrKey,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';

const OPERATOR = Keypair.random();
const OTHER_ADMIN = Keypair.random().publicKey();
const AGENT = Keypair.random().publicKey();
const BORROWER = Keypair.random().publicKey();

process.env.JWT_SECRET = 'test-jwt-secret-min-32-chars-long!!';
process.env.ADMIN_WALLETS = `${OPERATOR.publicKey()},${OTHER_ADMIN}`;
process.env.AGENT_WALLETS = AGENT;
process.env.AGENT_OPERATOR_PUBLIC_KEY = OPERATOR.publicKey();
process.env.AGENT_OPERATOR_SECRET = OPERATOR.secret();
process.env.AGENT_REGISTRY_CONTRACT_ID = StrKey.encodeContract(Buffer.alloc(32, 7));

function addressAuth(publicKey: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(publicKey).toScAddress(),
        nonce: xdr.Int64.fromString('1'),
        signatureExpirationLedger: 0,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(
            process.env.AGENT_REGISTRY_CONTRACT_ID as string,
          ).toScAddress(),
          functionName: 'register',
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

// Stand-in for simulation: attach the auth entries the registry asks for.
jest.unstable_mockModule('../config/stellar.js', () => ({
  createSorobanRpcServer: () => ({
    getAccount: async (key: string) => new Account(key, '1'),
    getLatestLedger: async () => ({ sequence: 100 }),
    prepareTransaction: async (tx: { toEnvelope: () => xdr.TransactionEnvelope }) => {
      const envelope = tx.toEnvelope();
      envelope
        .v1()
        .tx()
        .operations()[0]
        .body()
        .invokeHostFunctionOp()
        .auth([addressAuth(OPERATOR.publicKey()), addressAuth(BORROWER)]);
      return TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
    },
  }),
  getStellarNetworkPassphrase: () => Networks.TESTNET,
  getStellarRpcUrl: () => 'http://localhost:8000',
}));

jest.unstable_mockModule('../db/connection.js', () => ({
  query: jest.fn(async () => ({ rows: [], rowCount: 0 })),
}));

const { default: agentRoutes } = await import('../routes/agentRoutes.js');
const { errorHandler } = await import('../middleware/errorHandler.js');
const { generateJwtToken } = await import('../services/authService.js');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentRoutes);
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    errorHandler(err, req, res, next);
  });
  return app;
}

const body = {
  agentPublicKey: AGENT,
  kycRef: 'KYC1',
  region: 'LAGOS',
  bond: '100',
  licenseExpiry: String(Math.floor(Date.now() / 1000) + 86_400),
};

function register(caller: string) {
  return request(buildApp())
    .post('/api/agents/register')
    .set('Authorization', `Bearer ${generateJwtToken(caller)}`)
    .send(body);
}

describe('POST /api/agents/register', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['the agent registering itself', AGENT],
    ['a borrower', BORROWER],
    ['an admin that is not the operator', OTHER_ADMIN],
  ])('returns 403 for %s', async (_label, caller) => {
    const res = await register(caller);
    expect(res.status).toBe(403);
  });

  it('signs only the operator auth entry for the operator', async () => {
    const res = await register(OPERATOR.publicKey());
    expect(res.status).toBe(200);

    const tx = TransactionBuilder.fromXDR(res.body.unsignedTxXdr, Networks.TESTNET);
    const auth = tx.toEnvelope().v1().tx().operations()[0].body().invokeHostFunctionOp().auth();
    const signature = (entry: xdr.SorobanAuthorizationEntry) =>
      entry.credentials().address().signature().switch();

    expect(signature(auth[0])).not.toBe(xdr.ScValType.scvVoid());
    expect(signature(auth[1])).toBe(xdr.ScValType.scvVoid());
  });
});
