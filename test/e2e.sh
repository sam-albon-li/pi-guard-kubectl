#!/usr/bin/env bash
#
# End-to-end test for the kubectl modification guard package.
#
# Verifies the package is installed (or installs it locally for the duration
# of the run), stashes the conflicting global extension copy while running,
# and restores everything on exit. On failure the work dir is kept and its
# path printed so the out-N.txt outputs can be inspected.
#
# Requirements:
#   - pi CLI on PATH with a working default model (pi -p must run)
#   - kubectl binary on PATH (blocked scenarios never reach execution; the
#     passing scenarios use a fake context that exists in no real kubeconfig,
#     so no real cluster is ever contacted)
#
# Usage: bash test/e2e.sh
#
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/kgd-e2e.XXXXXX")"
CONFIG="$WORK/config.json"
PROMPT="$WORK/prompt.txt"
STASH_DIR="$WORK/stash"
mkdir -p "$STASH_DIR"

INSTALLED_BY_US=0
PASS=0
FAIL=0
FAILED_NAMES=()

cleanup() {
	# Restore the stashed global extension copy
	for f in "$STASH_DIR"/*; do
		[ -e "$f" ] || continue
		mv -f "$f" "$HOME/.pi/agent/extensions/$(basename "$f")" 2>/dev/null || true
	done
	# Remove the package install only if we added it
	if [ "$INSTALLED_BY_US" = "1" ]; then
		pi remove "$REPO" >/dev/null 2>&1 || true
	fi
	if [ "$FAIL" -gt 0 ]; then
		echo "work dir kept: $WORK"
	else
		rm -rf "$WORK"
	fi
}
trap cleanup EXIT

echo "== kubectl modification guard e2e =="
command -v pi >/dev/null || { echo "FAIL: pi CLI not found on PATH"; exit 1; }
command -v kubectl >/dev/null || { echo "FAIL: kubectl binary not found on PATH"; exit 1; }

# ── Ensure the package is installed ─────────────────────────────────────────
# Exact token match: the bare name must not be a prefix of another package
# name (e.g. pi-guard-kubectl-context) or part of a longer identifier.
PKG="$(basename "$REPO")"
if pi list 2>/dev/null | grep -qE "(^|[^a-z0-9-])$PKG([^a-z0-9-]|$)"; then
	echo "-- package already installed"
else
	echo "-- installing package from $REPO"
	pi install "$REPO" >/dev/null 2>&1 || { echo "FAIL: pi install failed"; exit 1; }
	INSTALLED_BY_US=1
fi

# ── Isolate: stash the global copy of this extension (restored on exit) ────
if [ -e "$HOME/.pi/agent/extensions/kubectl-guard.ts" ]; then
	echo "-- stashing kubectl-guard.ts"
	mv "$HOME/.pi/agent/extensions/kubectl-guard.ts" "$STASH_DIR/kubectl-guard.ts"
fi

# Marker config so the context guard passes through every scenario
printf '{"allowedContexts": ["fake-e2e-ctx"]}\n' > "$CONFIG"

run_scenario() {
	# $1=index  $2=command to run in the headless pi session
	local idx="$1" cmd="$2"
	printf 'Run exactly this bash command and report its full output verbatim, including any block or error messages: %s\n' "$cmd" > "$PROMPT"
	PI_KUBECTL_CONTEXTS_FILE="$CONFIG" timeout 180 pi -p "$(cat "$PROMPT")" > "$WORK/out-$idx.txt" 2>&1 || true
}

check() {
	# $1=name  $2=index  $3=pattern that MUST match (ERE)  [$4=pattern that must NOT match]
	local name="$1" idx="$2" must="$3" mustnot="${4:-}"
	local out="$WORK/out-$idx.txt"
	if ! grep -qE "$must" "$out"; then
		echo "FAIL: $name (no match for: $must)"
		FAIL=$((FAIL + 1)); FAILED_NAMES+=("$name")
		return
	fi
	if [ -n "$mustnot" ] && grep -qE "$mustnot" "$out"; then
		echo "FAIL: $name (unexpected match for: $mustnot)"
		FAIL=$((FAIL + 1)); FAILED_NAMES+=("$name")
		return
	fi
	echo "PASS: $name"
	PASS=$((PASS + 1))
}

echo
echo "-- scenario 1: read-only verb passes"
run_scenario 1 "kubectl get pods --context fake-e2e-ctx"
check "read verb is not blocked" 1 \
	"" \
	"blocked"

echo "-- scenario 2: modification blocked in headless session"
run_scenario 2 "kubectl delete pod foo --context fake-e2e-ctx"
check "delete blocked with no-UI reason" 2 \
	"no UI for confirmation" \
	""

echo "-- scenario 3: --allow-kubectl one-shot bypass"
run_scenario 3 "kubectl delete pod foo --context fake-e2e-ctx --allow-kubectl"
check "bypass is not blocked" 3 \
	"" \
	"blocked"

echo "-- scenario 4: unknown verb treated as modification"
run_scenario 4 "kubectl frobnicate thing --context fake-e2e-ctx"
check "unknown verb blocked with no-UI reason" 4 \
	"no UI for confirmation" \
	""

echo "-- scenario 5: kubectl-guard status control command"
run_scenario 5 "kubectl-guard status --context fake-e2e-ctx"
check "status reports ON and confirm mode" 5 \
	"ON" \
	""
if grep -q "confirm" "$WORK/out-5.txt"; then
	echo "PASS: status reports confirm mode"
	PASS=$((PASS + 1))
else
	echo "FAIL: status does not report confirm mode"
	FAIL=$((FAIL + 1)); FAILED_NAMES+=("status mode")
fi

echo
echo "== results: $PASS passed, $FAIL failed =="
if [ "$FAIL" -gt 0 ]; then
	printf 'failed: %s\n' "${FAILED_NAMES[@]}"
	exit 1
fi
exit 0
