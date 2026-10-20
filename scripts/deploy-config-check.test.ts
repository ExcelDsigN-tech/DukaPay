import assert from 'node:assert/strict';
import test from 'node:test';
import { Keypair } from '@stellar/stellar-sdk';
import deployConfig from './deploy-config.json';
import { checkDeployConfig } from './deploy-config-check';

const VALID_TOKEN = deployConfig.testnet.token;

function validNetworkConfig() {
    const s1 = Keypair.random().publicKey();
    const s2 = Keypair.random().publicKey();
    const o1 = Keypair.random().publicKey();
    const o2 = Keypair.random().publicKey();
    return {
        admin: 'YOUR_ADMIN_PUBLIC_KEY',
        token: VALID_TOKEN,
        contracts: {
            circuit_breaker: {
                signers: [s1, s2],
                threshold: 2,
            },
            oracle: {
                sources: [
                    { source: 'binance', address: o1 },
                    { source: 'coinbase', address: o2 },
                ],
            },
        },
    };
}

test('accepts YOUR_ADMIN_PUBLIC_KEY fallback placeholder and valid G... admin key', () => {
    const withPlaceholder = validNetworkConfig();
    assert.deepEqual(checkDeployConfig(withPlaceholder, 'testnet'), []);

    const withValidAdmin = {
        ...validNetworkConfig(),
        admin: Keypair.random().publicKey(),
    };
    assert.deepEqual(checkDeployConfig(withValidAdmin, 'testnet'), []);
});

test('reports invalid admin values naming the field and value', () => {
    for (const badAdmin of ['NOT_A_PUBLIC_KEY', VALID_TOKEN, '', undefined]) {
        const cfg = { ...validNetworkConfig(), admin: badAdmin };
        const errors = checkDeployConfig(cfg, 'testnet');
        assert.deepEqual(errors, [
            `testnet.admin is not a valid G... public key: ${JSON.stringify(badAdmin)}`,
        ]);
    }
});

test('reports placeholder or invalid token values naming the field and value', () => {
    for (const badToken of [
        'YOUR_MAINNET_POOL_TOKEN_ADDRESS',
        Keypair.random().publicKey(),
        'CINVALID',
        undefined,
    ]) {
        const cfg = { ...validNetworkConfig(), token: badToken };
        const errors = checkDeployConfig(cfg, 'mainnet');
        assert.deepEqual(errors, [
            `mainnet.token is not a valid C... contract address: ${JSON.stringify(badToken)}`,
        ]);
    }
});

test('shipped testnet token passes while mainnet token placeholder is reported', () => {
    const testnetErrors = checkDeployConfig(deployConfig.testnet, 'testnet');
    assert.equal(
        testnetErrors.some((e) => e.startsWith('testnet.token ') || e.startsWith('testnet.admin ')),
        false,
    );

    const mainnetErrors = checkDeployConfig(deployConfig.mainnet, 'mainnet');
    assert.equal(
        mainnetErrors.includes(
            'mainnet.token is not a valid C... contract address: "YOUR_MAINNET_POOL_TOKEN_ADDRESS"',
        ),
        true,
    );
    assert.equal(
        mainnetErrors.some((e) => e.startsWith('mainnet.admin ')),
        false,
    );
});
