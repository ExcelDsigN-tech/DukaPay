#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLBACK_SCRIPT="$SCRIPT_DIR/rollback-blue-green.sh"

TMP_DIR=$(mktemp -d)
trap 'rm -rf "$TMP_DIR"' EXIT

export LISTENER_ARN="arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/dukapay/mock"
export BLUE_TG_ARN="arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/blue/mock"
export GREEN_TG_ARN="arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/green/mock"

run_case() {
  local active_color="$1"
  local expected_previous="$2"
  local expected_blue_weight="$3"
  local expected_green_weight="$4"

  local case_dir="$TMP_DIR/$active_color"
  mkdir -p "$case_dir"

  cat > "$case_dir/aws" <<EOF_AWS
#!/bin/bash
set -euo pipefail

if [[ "\$*" == *"describe-listener-rules"* ]]; then
  if [[ "$active_color" == "blue" ]]; then
    echo "100"
  else
    echo "0"
  fi
elif [[ "\$*" == *"describe-services"* ]]; then
  echo "2"
elif [[ "\$*" == *"modify-listener"* ]]; then
  printf '%s\n' "\$*" > "$case_dir/modify-listener.args"
else
  echo "Unexpected mocked AWS command: \$*" >&2
  exit 1
fi
EOF_AWS

  chmod +x "$case_dir/aws"

  PATH="$case_dir:$PATH" bash "$ROLLBACK_SCRIPT" production \
    > "$case_dir/output.log"

  grep -q "Current active environment: $active_color" "$case_dir/output.log"
  grep -q "Rolling back to previous environment: $expected_previous" "$case_dir/output.log"
  grep -q "Rollback completed successfully" "$case_dir/output.log"

  grep -q "TargetGroupArn=$BLUE_TG_ARN,Weight=$expected_blue_weight" \
    "$case_dir/modify-listener.args"
  grep -q "TargetGroupArn=$GREEN_TG_ARN,Weight=$expected_green_weight" \
    "$case_dir/modify-listener.args"

  echo "PASS: active=$active_color rollback=$expected_previous"
}

run_case blue green 0 100
run_case green blue 100 0

echo "Mocked rollback verification passed."
