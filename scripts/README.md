# DukaPay Deployment Scripts

Automated scripts for building and deploying Soroban smart contracts.

## Scripts

### 1. Build Script (`build.sh`)
Builds all contracts in the workspace and generates WASM files.

```bash
./scripts/build.sh
```

### 2. Deployment Script (`deploy.ts`)
Deploys, initializes, and links contracts on Stellar networks.

```bash
# Install dependencies (first time)
cd scripts && npm install

# Run deployment to testnet
SECRET_KEY=S... npm run deploy -- testnet
```

## Configuration

- `deploy-config.json`: Contains network RPC URLs, passphrase, and initial contract parameters.
- `.env`: (Optional) Can store `SECRET_KEY`, the deployer's secret key. Network settings (RPC URL, passphrase) are read from `deploy-config.json`.

## Workflow

1. **Build**: Run `./scripts/build.sh`.
2. **Configure**: Update `scripts/deploy-config.json` if needed (admin address, token address).
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

