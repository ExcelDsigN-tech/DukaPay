#!/usr/bin/env bash
# Run DukaPay's ci.yml checks locally, area by area.
# Usage: ./scripts/ci-local.sh <area...>
# Areas: supply money backend openapi migrations frontend e2e scripts guards
#        contracts coverage indexer images sdk
#   all   everything that needs no external services (no Postgres, no browsers)
#   full  all + migrations + e2e + coverage
# Source of truth is .github/workflows/ci.yml. If this file disagrees with it, ci.yml wins.

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
PG_URL="postgres://pguser:pgpass@localhost:5432/dukapay_test"
FAILED=()

step() { printf '\n\033[1;34m==> [%s] %s\033[0m\n' "$1" "$2"; }

area() {
  local name="$1"; shift
  # Not `if ( "$@" )`: bash ignores set -e inside an if condition, so a failing
  # step would be skipped and only the area's last command would count.
  local rc=0
  set +e; ( set -e; "$@" ); rc=$?; set -e
  if [ "$rc" -eq 0 ]; then
    printf '\033[1;32m[%s] PASS\033[0m\n' "$name"
  else
    printf '\033[1;31m[%s] FAIL\033[0m\n' "$name"
    FAILED+=("$name")
  fi
}

supply() {
  set -euo pipefail
  cd "$ROOT"
  step supply "blocked packages in lockfiles"
  for lockfile in backend/package-lock.json frontend/package-lock.json scripts/package-lock.json; do
    if [ -f "$lockfile" ] && grep -q "plain-crypto-js" "$lockfile"; then
      echo "$lockfile contains plain-crypto-js"; exit 1
    fi
  done
  if grep -r '"axios": "1\.14\.' --include="package-lock.json" .; then
    echo "axios 1.14.x detected"; exit 1
  fi
}

money() {
  set -euo pipefail
  step money "install scripts deps"; (cd "$ROOT/scripts" && npm ci)
  step money "generated money-policy files up to date"
  (cd "$ROOT/scripts" && npx ts-node gen-money.ts --check)
  step money "install backend deps"; (cd "$ROOT/backend" && npm ci)
  step money "rust money vectors"
  (cd "$ROOT/contracts" && cargo test -p money -- --test-threads=1)
  step money "backend money vectors"
  (cd "$ROOT/backend" && NODE_ENV="test" npm test -- src/money/__tests__/parity-vectors.test.ts)
  step money "cross-language parity"
  (cd "$ROOT/scripts" && npx tsx money-parity.ts --randomized 5000)
}

backend() {
  set -euo pipefail
  cd "$ROOT/backend"
  step backend "install";   npm ci
  step backend "lint";      npm run lint
  step backend "format";    npm run format:check
  step backend "build";     npm run build
  step backend "typecheck"; npm run typecheck
  step backend "tests"
  NODE_ENV="test" \
  DATABASE_URL="postgres://user:pass@localhost:5432/test" \
  REDIS_URL="redis://localhost:6379" \
  JWT_SECRET="test_jwt_secret" \
  STELLAR_RPC_URL="https://rpc.test.invalid" \
  STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015" \
  LOAN_MANAGER_CONTRACT_ID="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
  LENDING_POOL_CONTRACT_ID="CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" \
  REMITTANCE_NFT_CONTRACT_ID="CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD" \
  MULTISIG_GOVERNANCE_CONTRACT_ID="CEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE" \
  POOL_TOKEN_ADDRESS="CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC" \
  LOAN_MANAGER_ADMIN_SECRET="test_admin_secret" \
  INTERNAL_API_KEY="test_internal_api_key" \
  FRONTEND_URL="https://frontend.example.com" \
  npm test
  step backend "plaintext PII in logs"
  local found=0
  for pattern in 'logger.*\.info.*recipient_email' 'logger.*\.info.*recipient_phone' \
                 'logger.*\.info.*recipient_name' 'console\.log.*email.*@.*\.com' \
                 'console\.log.*phone.*\+[0-9]'; do
    if grep -rn "$pattern" src/ --include="*.ts" 2>/dev/null; then
      echo "PII leak in logger output: $pattern"; found=1
    fi
  done
  [ "$found" -eq 0 ]
}

openapi() {
  set -euo pipefail
  cd "$ROOT/backend"
  step openapi "install";  npm ci
  step openapi "validate"; NODE_ENV="test" npm run openapi:validate
}

migrations() {
  set -euo pipefail
  cd "$ROOT/backend"
  export DATABASE_URL="$PG_URL" PGPASSWORD="pgpass"
  step migrations "install";          npm ci
  step migrations "up from empty";    npm run migrate:up
  step migrations "down one by one"
  local count; count=$(find migrations -maxdepth 1 -name '*.cjs' | wc -l)
  for _ in $(seq 1 "$count"); do npm run migrate:down -- --count 1; done
  step migrations "up again";         npm run migrate:up
  step migrations "no plaintext PII columns"
  local found=0
  for col in recipient_email recipient_phone recipient_name plaintext_email plaintext_phone plaintext_name; do
    if [ -n "$(psql "$PG_URL" -tAc "SELECT column_name FROM information_schema.columns WHERE column_name = '$col';" 2>/dev/null)" ]; then
      echo "Plaintext PII column found: $col"; found=1
    fi
  done
  [ "$found" -eq 0 ]
}

frontend() {
  set -euo pipefail
  cd "$ROOT/frontend"
  step frontend "install";       npm ci
  step frontend "lint";          npm run lint
  step frontend "format";        npm run format:check
  step frontend "typecheck";     npm run typecheck
  step frontend "unit tests";    NODE_ENV="test" npm test
  step frontend "build";         npm run build
  step frontend "bundle budget"; npm run perf:budget
}

e2e() {
  set -euo pipefail
  cd "$ROOT/frontend"
  step e2e "install";             npm ci
  step e2e "playwright browsers"; npx playwright install --with-deps chromium
  step e2e "playwright tests";    NODE_ENV="test" CI="true" npx playwright test --project=chromium
}

scripts_area() {
  set -euo pipefail
  cd "$ROOT/scripts"
  step scripts "install";   npm ci
  step scripts "typecheck"; npm run typecheck
}

guards() {
  set -euo pipefail
  cd "$ROOT"
  step guards "env docs";            node scripts/check-env-docs.mjs
  step guards "prod flags";          node scripts/check-prod-flags.mjs
  step guards "error code mappings"; node scripts/check-error-code-mappings.mjs
  step guards "migrations unchanged"; node scripts/check-migrations-immutable.mjs
  step guards "i18n parity";         node scripts/check-i18n-parity.mjs
  step guards "i18n keys";           node scripts/check-i18n-keys.mjs
  step guards "asset sizes";         node scripts/check-asset-sizes.mjs
}

contracts() {
  set -euo pipefail
  cd "$ROOT/contracts"
  step contracts "fmt";    cargo fmt --all -- --check
  step contracts "clippy"; cargo clippy --all-targets --all-features -- -D warnings
  step contracts "test";   cargo test -- --test-threads=1
  step contracts "wasm build + 256 KiB budget"
  cargo build --target wasm32-unknown-unknown --release
  local max_bytes=$((256 * 1024))
  shopt -s nullglob
  local wasm_files=(target/wasm32-unknown-unknown/release/*.wasm)
  if [ "${#wasm_files[@]}" -eq 0 ]; then echo "No wasm artifacts were produced."; exit 1; fi
  for wasm in "${wasm_files[@]}"; do
    local size; size=$(stat -c%s "$wasm")
    echo "$(basename "$wasm"): ${size} bytes, budget ${max_bytes}"
    if [ "$size" -gt "$max_bytes" ]; then echo "$wasm exceeds the 256 KiB budget"; exit 1; fi
  done
  step contracts "fuzz targets compile"; (cd fuzz && cargo check)
}

coverage() {
  set -euo pipefail
  cd "$ROOT/contracts"
  step coverage "tarpaulin"; cargo tarpaulin --out Xml
}

indexer() {
  set -euo pipefail
  cd "$ROOT/indexer"
  step indexer "fmt";    cargo fmt --all -- --check
  step indexer "clippy"; cargo clippy --all-targets -- -D warnings
  step indexer "test";   cargo test
}

images() {
  set -euo pipefail
  cd "$ROOT"
  step images "kubernetes images pinned to sha256"
  local fail=0
  while IFS= read -r file; do
    while IFS= read -r line; do
      if echo "$line" | grep -qE '^\s+image:'; then
        local image; image=$(echo "$line" | sed 's/.*image:\s*//')
        if echo "$image" | grep -q ':latest'; then
          echo "$file: unpinned :latest tag: $image"; fail=1
        elif ! echo "$image" | grep -qE '@sha256:[a-f0-9]{64}'; then
          echo "$file: not pinned to sha256 digest: $image"; fail=1
        fi
      fi
    done < "$file"
  done < <(find infra/kubernetes -name "*.yaml" -o -name "*.yml")
  [ "$fail" -eq 0 ]
}

sdk() {
  set -euo pipefail
  cd "$ROOT/sdk"
  step sdk "install";   npm ci
  step sdk "lint";      npm run lint
  step sdk "typecheck"; npm run typecheck
  step sdk "test";      npm test
  step sdk "build";     npm run build
}

[ "$#" -eq 0 ] && { sed -n '2,8p' "$0"; exit 1; }

FAST=(supply money backend openapi frontend scripts guards contracts indexer images sdk)
case "$1" in
  all)  AREAS=("${FAST[@]}") ;;
  full) AREAS=("${FAST[@]}" migrations e2e coverage) ;;
  *)    AREAS=("$@") ;;
esac

for a in "${AREAS[@]}"; do
  case "$a" in
    supply)     area supply supply ;;
    money)      area money money ;;
    backend)    area backend backend ;;
    openapi)    area openapi openapi ;;
    migrations) area migrations migrations ;;
    frontend)   area frontend frontend ;;
    e2e)        area e2e e2e ;;
    scripts)    area scripts scripts_area ;;
    guards)     area guards guards ;;
    contracts)  area contracts contracts ;;
    coverage)   area coverage coverage ;;
    indexer)    area indexer indexer ;;
    images)     area images images ;;
    sdk)        area sdk sdk ;;
    *) echo "Unknown area: $a"; exit 1 ;;
  esac
done

echo
if [ "${#FAILED[@]}" -eq 0 ]; then
  printf '\033[1;32mAll requested areas passed.\033[0m\n'
else
  printf '\033[1;31mFailed: %s\033[0m\n' "${FAILED[*]}"
  exit 1
fi
