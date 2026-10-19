#!/usr/bin/env bash
# run-dogfood.sh — Start master + worker dogfooding sessions.
#
# Usage: ./scripts/run-dogfood.sh [--timeout SECONDS]
#
# Creates a shared temp directory for the blackboard, starts master in
# background, then starts worker. The MASTER tracks completion via the
# blackboard and exits when all work is done. This script waits for the
# master process to exit (which signals all work is done).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

TIMEOUT_SECONDS=300
SHARED_DIR=""
MASTER_PID=""
WORKER_PID=""

cleanup() {
    echo "[CLEANUP] Stopping processes..."
    [[ -n "${WORKER_PID}" ]] && kill "${WORKER_PID}" 2>/dev/null || true
    [[ -n "${MASTER_PID}" ]] && kill "${MASTER_PID}" 2>/dev/null || true
    wait "${WORKER_PID}" 2>/dev/null || true
    wait "${MASTER_PID}" 2>/dev/null || true
    if [[ -n "${SHARED_DIR}" && -d "${SHARED_DIR}" ]]; then
        rm -rf "${SHARED_DIR}"
    fi
}

trap cleanup EXIT INT TERM

# Parse args
while [[ $# -gt 0 ]]; do
    case $1 in
        --timeout)
            TIMEOUT_SECONDS="$2"
            shift 2
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

echo "[DOGFOOD] Creating shared directory..."
SHARED_DIR="/tmp/gentle-cowork-dogfood"
mkdir -p "${SHARED_DIR}"
export DOG_FOOD_SHARED_DIR="${SHARED_DIR}"
echo "[DOGFOOD] Shared directory: ${SHARED_DIR}"

echo "[DOGFOOD] Starting worker FIRST (so it's ready when master starts)..."
cd "${PROJECT_ROOT}"
DOG_FOOD_SHARED_DIR="${SHARED_DIR}" npx tsx scripts/dogfood-worker.ts 2>&1 | sed 's/^/[WORKER] /' &
WORKER_PID=$!

# Give worker time to register and wait for master
sleep 2

echo "[DOGFOOD] Starting master..."
cd "${PROJECT_ROOT}"
npx tsx scripts/dogfood-master.ts 2>&1 | sed 's/^/[MASTER] /' &
MASTER_PID=$!

echo "[DOGFOOD] Both processes started. Master PID: ${MASTER_PID}, Worker PID: ${WORKER_PID}"
echo "[DOGFOOD] Timeout: ${TIMEOUT_SECONDS}s"

# Wait for MASTER to complete (it tracks completion via blackboard)
# The master exits when all work is done via blackboard polling
SECONDS=0
while (( SECONDS < TIMEOUT_SECONDS )); do
    if ! kill -0 "${MASTER_PID}" 2>/dev/null; then
        echo "[DOGFOOD] Master process exited (all work completed)"
        break
    fi
    if ! kill -0 "${WORKER_PID}" 2>/dev/null; then
        echo "[DOGFOOD] Worker process exited unexpectedly"
        # Worker might have finished early - that's OK if master is still running
    fi
    sleep 1
done

if (( SECONDS >= TIMEOUT_SECONDS )); then
    echo "[DOGFOOD] Timeout reached (${TIMEOUT_SECONDS}s)"
    exit 1
fi

wait "${MASTER_PID}" 2>/dev/null || true
wait "${WORKER_PID}" 2>/dev/null || true

echo "[DOGFOOD] Dogfooding completed successfully"