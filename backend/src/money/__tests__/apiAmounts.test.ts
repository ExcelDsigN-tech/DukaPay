import { amountToStroops, stroopsToAmount, toWholeStroops } from '../decimal.js';
import { eventAmountFields, isMoneyEvent } from '../eventAmounts.js';

describe('API amount conversion', () => {
  it('converts whole tokens to stroops and back', () => {
    expect(amountToStroops(250.5)).toBe(2_505_000_000n);
    expect(amountToStroops(0.0000001)).toBe(1n);
    expect(stroopsToAmount(2_505_000_000n)).toBe(250.5);
    expect(stroopsToAmount('1')).toBe(0.0000001);
  });

  it('reads NUMERIC strings, rounding fractional stroops to the nearest stroop', () => {
    expect(toWholeStroops('10000000000')).toBe(10_000_000_000n);
    expect(toWholeStroops('12.4')).toBe(12n);
    expect(toWholeStroops('12.6')).toBe(13n);
    expect(toWholeStroops(null)).toBe(0n);
    expect(toWholeStroops('')).toBe(0n);
    expect(stroopsToAmount(undefined)).toBe(0);
  });
});

describe('eventAmountFields', () => {
  it('converts money events and keeps the exact stroops', () => {
    expect(eventAmountFields('LoanRepaid', '2500000000')).toEqual({
      amount: 250,
      amountStroops: '2500000000',
    });
  });

  it('leaves config events raw (rates, ledgers, scores)', () => {
    expect(isMoneyEvent('InterestRateUpdated')).toBe(false);
    expect(eventAmountFields('InterestRateUpdated', '1200')).toEqual({ amount: '1200' });
    expect(eventAmountFields('ScoreUpdated', '720')).toEqual({ amount: '720' });
  });

  it('passes a missing amount through as null', () => {
    expect(eventAmountFields('LoanApproved', null)).toEqual({ amount: null });
  });
});
