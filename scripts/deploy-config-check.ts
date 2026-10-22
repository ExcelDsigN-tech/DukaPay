import { StrKey } from '@stellar/stellar-sdk';

// Matches MIN_SOURCES in contracts/oracle/src/lib.rs: the oracle will not
// return a median with fewer fresh sources than this.
export const MIN_ORACLE_SOURCES = 2;

// deploy.ts uses the deployer's own key as admin when config.admin is this.
export const ADMIN_PLACEHOLDER = 'YOUR_ADMIN_PUBLIC_KEY';

// Soroban Symbol rules: at most 32 characters from [a-zA-Z0-9_].
const SYMBOL_RE = /^[A-Za-z0-9_]{1,32}$/;

export interface OracleSource {
    source: string;
    address: string;
}

function isPublicKey(value: unknown): value is string {
    return typeof value === 'string' && StrKey.isValidEd25519PublicKey(value);
}

// Check the admin, token, circuit breaker and oracle settings for one network
// before anything is uploaded. Returns one message per problem, each naming
// the config field to fix; an empty list means the config is usable.
export function checkDeployConfig(config: any, network: string): string[] {
    const errors: string[] = [];
    const at = (field: string) => `${network}.contracts.${field}`;

    const admin = config?.admin;
    if (admin !== ADMIN_PLACEHOLDER && !isPublicKey(admin)) {
        errors.push(
            `${network}.admin must be a valid G... public key or ${ADMIN_PLACEHOLDER}, got ${JSON.stringify(admin)}`,
        );
    }

    const token = config?.token;
    if (typeof token !== 'string' || !StrKey.isValidContract(token)) {
        errors.push(`${network}.token is not a valid C... contract address: ${JSON.stringify(token)}`);
    }

    const breaker = config?.contracts?.circuit_breaker;
    if (!breaker) {
        errors.push(`${at('circuit_breaker')} is missing`);
    } else {
        const signers: unknown[] = Array.isArray(breaker.signers) ? breaker.signers : [];
        if (signers.length === 0) {
            errors.push(`${at('circuit_breaker.signers')} must list at least one G... public key`);
        }
        signers.forEach((signer, i) => {
            if (!isPublicKey(signer)) {
                errors.push(
                    `${at(`circuit_breaker.signers[${i}]`)} is not a valid G... public key: ${JSON.stringify(signer)}`,
                );
            }
        });
        if (new Set(signers).size !== signers.length) {
            errors.push(`${at('circuit_breaker.signers')} contains duplicate keys`);
        }
        const threshold = breaker.threshold;
        if (!Number.isInteger(threshold) || threshold < 1 || threshold > signers.length) {
            errors.push(
                `${at('circuit_breaker.threshold')} must be an integer between 1 and ${signers.length} (the number of signers), got ${JSON.stringify(threshold)}`,
            );
        }
    }

    const oracle = config?.contracts?.oracle;
    if (!oracle) {
        errors.push(`${at('oracle')} is missing`);
    } else {
        const sources: unknown[] = Array.isArray(oracle.sources) ? oracle.sources : [];
        if (sources.length < MIN_ORACLE_SOURCES) {
            errors.push(
                `${at('oracle.sources')} must list at least ${MIN_ORACLE_SOURCES} { "source", "address" } entries, got ${sources.length}`,
            );
        }
        const names = new Set<string>();
        const addresses = new Set<string>();
        sources.forEach((entry, i) => {
            const field = at(`oracle.sources[${i}]`);
            if (typeof entry !== 'object' || entry === null) {
                errors.push(`${field} must be an object { "source": "...", "address": "G..." }`);
                return;
            }
            const { source, address } = entry as Partial<OracleSource>;
            if (typeof source !== 'string' || !SYMBOL_RE.test(source)) {
                errors.push(`${field}.source must be 1-32 characters of [A-Za-z0-9_], got ${JSON.stringify(source)}`);
            } else if (names.has(source)) {
                errors.push(`${field}.source duplicates an earlier source: ${source}`);
            } else {
                names.add(source);
            }
            if (!isPublicKey(address)) {
                errors.push(`${field}.address is not a valid G... public key: ${JSON.stringify(address)}`);
            } else if (addresses.has(address)) {
                errors.push(`${field}.address is already used by another source; each source needs its own key`);
            } else {
                addresses.add(address);
            }
        });
    }

    return errors;
}
