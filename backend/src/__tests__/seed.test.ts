import { describe, it, expect } from '@jest/globals';
import { StrKey } from '@stellar/stellar-sdk';
import { devUsers, CONTRACT_ID, DEV_LENDER } from '../seed/index.js';

describe('Dev Seed Script (#766)', () => {
  it('has valid Stellar addresses for all demo users and lender', () => {
    expect(StrKey.isValidContract(CONTRACT_ID)).toBe(true);
    expect(StrKey.isValidEd25519PublicKey(DEV_LENDER)).toBe(true);

    for (const user of devUsers) {
      expect(StrKey.isValidEd25519PublicKey(user.publicKey)).toBe(true);
      expect(StrKey.isValidEd25519PublicKey(user.userId)).toBe(true);
    }
  });
});
