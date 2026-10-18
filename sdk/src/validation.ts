import { ValidationError } from './errors.js';

/**
 * Validates if a string is a valid Stellar address format.
 * Stellar addresses are 56 characters long and start with 'G' (account) or 'M' (muxed account).
 */
export function isValidStellarAddress(address: unknown): boolean {
  if (typeof address !== 'string') return false;
  // Stellar addresses: 56 chars, start with G (public key) or M (muxed account)
  return (address.startsWith('G') || address.startsWith('M')) && address.length === 56;
}

/**
 * Validates if a string is a valid amount (positive decimal number).
 */
export function isValidAmount(amount: unknown): boolean {
  if (typeof amount !== 'string') return false;
  // Must be a valid number and positive (can be 0 in some contexts, but typically > 0)
  const num = parseFloat(amount);
  return !isNaN(num) && num >= 0 && amount.trim() !== '';
}

/**
 * Validates if a value is a positive integer.
 */
export function isPositiveInt(value: unknown): boolean {
  const num =
    typeof value === 'string' ? parseInt(value, 10) : typeof value === 'number' ? value : NaN;
  return Number.isInteger(num) && num > 0;
}

/**
 * Throws ValidationError if the Stellar address is invalid.
 */
export function validateStellarAddress(address: unknown, fieldName = 'address'): asserts address is string {
  if (!isValidStellarAddress(address)) {
    throw new ValidationError(
      `Invalid Stellar address format for ${fieldName}: must be a 56-character string starting with 'G' or 'M'`,
    );
  }
}

/**
 * Throws ValidationError if the amount is invalid.
 */
export function validateAmount(amount: unknown, fieldName = 'amount'): asserts amount is string {
  if (!isValidAmount(amount)) {
    throw new ValidationError(`Invalid amount for ${fieldName}: must be a positive decimal number string`);
  }
}

/**
 * Validates a token amount in whole units (e.g. 250.5 USDC): a positive
 * number with at most 7 decimal places (one stroop), as the API accepts.
 */
export function isValidTokenAmount(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value < 1e15 &&
    Number(value.toFixed(7)) === value
  );
}

/**
 * Throws ValidationError if the value is not a valid whole-unit token amount.
 */
export function validateTokenAmount(value: unknown, fieldName = 'amount'): asserts value is number {
  if (!isValidTokenAmount(value)) {
    throw new ValidationError(`Invalid ${fieldName}: must be a positive number with at most 7 decimal places`);
  }
}

/**
 * Throws ValidationError if the loan ID is not a positive integer.
 */
export function validatePositiveInt(value: unknown, fieldName = 'id'): asserts value is number | string {
  if (!isPositiveInt(value)) {
    throw new ValidationError(`Invalid ${fieldName}: must be a positive integer`);
  }
}
