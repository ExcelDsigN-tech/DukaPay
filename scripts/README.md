# DukaPay Deployment Scripts

Automated scripts for building and deploying Soroban smart contracts.

## Scripts

### 1. Build Script (`build.sh`)
Builds all contracts in the workspace and generates WASM files.

```bash
./scripts/build.sh
```

### 2. Deployment Script (`deploy.ts`)
Deploys contracts with atomic constructors and links them on Stellar networks.

```bash
# Install dependencies (first time)
cd scripts && npm install

# Run deployment to testnet
SECRET_KEY=S... npm run deploy -- testnet
```

## Configuration

- `deploy-config.json`: Contains network RPC URLs, passphrase, and initial contract parameters.
- `.env`: (Optional) Can store `SECRET_KEY`, the deployer's secret key. Network settings (RPC URL, passphrase) are read from `deploy-config.json`.

### Before you deploy

Replace the placeholders in the `deploy-config.json` block for your network. `deploy.ts`
validates them before uploading any WASM and exits with an error naming each bad field.

- `admin`: admin `G...` key. `YOUR_ADMIN_PUBLIC_KEY` falls back to the deployer's key.
- `token`: pool token contract `C...` (`mainnet` ships `YOUR_MAINNET_POOL_TOKEN_ADDRESS`).
- `contracts.circuit_breaker.signers`: distinct `G...` keys replacing `YOUR_SIGNER_N_PUBLIC_KEY`;
  `threshold` must be between 1 and the number of signers.
- `contracts.oracle.sources`: at least 2 entries, each with its own signing key:

  ```json
  "sources": [
    { "source": "binance", "address": "G..." },
    { "source": "coinbase", "address": "G..." }
  ]
  ```

  `source` is a Soroban symbol (1-32 characters of `[A-Za-z0-9_]`); two sources may not share an `address`.

## Workflow

1. **Build**: Run `./scripts/build.sh`.
2. **Configure**: Fill in the placeholders in `scripts/deploy-config.json` (see [Before you deploy](#before-you-deploy)).
3. **Deploy**: Run `SECRET_KEY=... npm run deploy -- testnet` from the `scripts` directory.
4. **Verify**: Check `frontend/.env.local` and `backend/.env` for updated contract IDs.

## Load Testing

Load testing lives in `tests/load` and runs on the `Load Tests` GitHub Actions
workflow. That suite authenticates against the API (see
`tests/load/utils/auth.js`) and targets real, scope-checked routes, so it is the
only supported load-test entrypoint.

To run locally:
```bash
# Install k6 (https://k6.io/docs/get-started/installation/)
cd tests/load
TEST_ENV=local LOAD_PROFILE=smoke k6 run scenarios/api-read.js
```

