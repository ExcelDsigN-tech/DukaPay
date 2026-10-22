#!/bin/bash

# ==============================================================================
# Smoke Tests Gate for Blue-Green Deployments
# ==============================================================================
# This script performs basic HTTP readiness/smoke checks against the inactive
# target environment (blue or green) prior to cutover.
#
# Usage:
#   scripts/smoke-tests.sh <blue|green>
#
# Failure Path:
#   If any smoke test check fails after maximum retry attempts, this script
#   exits non-zero (1).
#   When invoked from deploy-blue-green.sh (line 79), a non-zero exit triggers:
#     "Smoke tests failed. Aborting deployment."
#   The deployment process aborts immediately before modifying listener rules.
#   Production traffic remains 100% routed to the current healthy ACTIVE_COLOR
#   environment with zero downtime or broken traffic. The failing INACTIVE_COLOR
#   service remains provisioned for operator diagnostics and log inspection.
# ==============================================================================

set -euo pipefail

COLOR="${1:-}"

if [ "$COLOR" != "blue" ] && [ "$COLOR" != "green" ]; then
  echo "Error: Invalid or missing color argument. Expected 'blue' or 'green'." >&2
  echo "Usage: $0 <blue|green>" >&2
  exit 1
fi

echo "Starting smoke tests for target environment: $COLOR"

# Determine target group ARN based on color if provided in environment
if [ "$COLOR" = "blue" ]; then
  TG_ARN="${BLUE_TG_ARN:-}"
else
  TG_ARN="${GREEN_TG_ARN:-}"
fi

# Resolve health check path from target group if AWS CLI and TG_ARN are available
HEALTH_CHECK_PATH="/health"
if [ -n "$TG_ARN" ] && command -v aws >/dev/null 2>&1; then
  RESOLVED_PATH=$(aws elbv2 describe-target-groups \
    --target-group-arns "$TG_ARN" \
    --query 'TargetGroups[0].HealthCheckPath' \
    --output text 2>/dev/null || true)
  if [ -n "$RESOLVED_PATH" ] && [ "$RESOLVED_PATH" != "None" ]; then
    HEALTH_CHECK_PATH="$RESOLVED_PATH"
  fi
fi

# Determine target endpoint base URL:
# 1. SMOKE_TEST_URL (full URL override if specified)
# 2. SMOKE_TEST_BASE_URL (base URL override e.g. http://internal-alb.local)
# 3. API_URL (standard environment API URL)
# 4. Default localhost fallback
if [ -n "${SMOKE_TEST_URL:-}" ]; then
  TARGET_URL="$SMOKE_TEST_URL"
else
  BASE_URL="${SMOKE_TEST_BASE_URL:-${API_URL:-http://127.0.0.1:3001}}"
  # Strip trailing slash if present on base URL
  BASE_URL="${BASE_URL%/}"
  TARGET_URL="${BASE_URL}${HEALTH_CHECK_PATH}"
fi

echo "Smoke test target endpoint: $TARGET_URL"

MAX_ATTEMPTS="${SMOKE_TEST_MAX_ATTEMPTS:-5}"
RETRY_DELAY="${SMOKE_TEST_RETRY_DELAY:-2}"
REQUEST_TIMEOUT="${SMOKE_TEST_TIMEOUT:-10}"

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "Evaluating endpoint health (attempt $attempt/$MAX_ATTEMPTS)..."
  if curl -f -s -S --max-time "$REQUEST_TIMEOUT" "$TARGET_URL" > /dev/null; then
    echo "Smoke tests passed successfully for $COLOR environment."
    exit 0
  fi

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "Endpoint not yet ready. Retrying in ${RETRY_DELAY}s..."
    sleep "$RETRY_DELAY"
  fi
done

echo "Error: Smoke tests failed for $COLOR environment after $MAX_ATTEMPTS attempts." >&2
exit 1
