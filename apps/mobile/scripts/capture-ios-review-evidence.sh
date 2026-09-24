#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${KALL_IOS_APP_PATH:?KALL_IOS_APP_PATH is required}"
: "${KALL_REVIEW_EMAIL:?KALL_REVIEW_EMAIL must be stored in the EAS production environment}"
: "${KALL_REVIEW_PASSWORD:?KALL_REVIEW_PASSWORD must be stored as a sensitive EAS production variable}"

OUTPUT_DIR="${PWD}/review-capture-output"
DEVICE_NAME="Kall Review Evidence ${EAS_BUILD_ID:-local}"
DEVICE_UDID=""
VIDEO_PID=""

cleanup() {
  if [[ -n "${VIDEO_PID}" ]] && kill -0 "${VIDEO_PID}" 2>/dev/null; then
    kill -INT "${VIDEO_PID}" || true
    wait "${VIDEO_PID}" || true
  fi
  if [[ -n "${DEVICE_UDID}" ]]; then
    xcrun simctl shutdown "${DEVICE_UDID}" >/dev/null 2>&1 || true
    xcrun simctl delete "${DEVICE_UDID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ ! -d "${APP_PATH}" || "${APP_PATH}" != *.app ]]; then
  echo "Expected an extracted iOS Simulator .app bundle" >&2
  exit 1
fi

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

RUNTIME_ID="$({ xcrun simctl list runtimes --json; } | python3 -c '
import json
import re
import sys

runtimes = [item for item in json.load(sys.stdin).get("runtimes", []) if item.get("isAvailable") and "iOS" in item.get("name", "")]
if not runtimes:
    raise SystemExit("No available iOS Simulator runtime was found")

def version(item):
    return tuple(int(value) for value in re.findall(r"\d+", item.get("version", "")))

print(max(runtimes, key=version)["identifier"])
')"

DEVICE_TYPE=""
for candidate in \
  com.apple.CoreSimulator.SimDeviceType.iPhone-16-Pro-Max \
  com.apple.CoreSimulator.SimDeviceType.iPhone-16-Plus \
  com.apple.CoreSimulator.SimDeviceType.iPhone-15-Pro-Max; do
  if xcrun simctl list devicetypes | grep -Fq "${candidate}"; then
    DEVICE_TYPE="${candidate}"
    break
  fi
done
[[ -n "${DEVICE_TYPE}" ]] || { echo "No App Store-sized iPhone Simulator is installed" >&2; exit 1; }

DEVICE_UDID="$(xcrun simctl create "${DEVICE_NAME}" "${DEVICE_TYPE}" "${RUNTIME_ID}")"
xcrun simctl boot "${DEVICE_UDID}"
xcrun simctl bootstatus "${DEVICE_UDID}" -b
xcrun simctl status_bar "${DEVICE_UDID}" override --time "9:41" --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4
xcrun simctl install "${DEVICE_UDID}" "${APP_PATH}"

maestro --version

VIDEO_PATH="${OUTPUT_DIR}/kall-ios-authenticated-review-flow.mp4"
xcrun simctl io "${DEVICE_UDID}" recordVideo --codec=h264 --force "${VIDEO_PATH}" &
VIDEO_PID="$!"

capture() {
  xcrun simctl io "${DEVICE_UDID}" screenshot "${OUTPUT_DIR}/$1.png"
}

# EAS masks sensitive environment values in logs. No Maestro report containing
# the entered password is retained or uploaded.
maestro --device "${DEVICE_UDID}" test .maestro/ios-review-login.yml
capture 01-today
maestro --device "${DEVICE_UDID}" test .maestro/ios-review-work.yml
capture 02-job-and-consulting-search
maestro --device "${DEVICE_UDID}" test .maestro/ios-review-applications.yml
capture 03-applications
maestro --device "${DEVICE_UDID}" test .maestro/ios-review-billing.yml
capture 04-native-plans
maestro --device "${DEVICE_UDID}" test .maestro/ios-review-premium.yml
capture 05-native-premium
maestro --device "${DEVICE_UDID}" test .maestro/ios-review-delete-preview.yml
capture 06-delete-account

kill -INT "${VIDEO_PID}"
wait "${VIDEO_PID}" || true
VIDEO_PID=""

export KALL_REVIEW_OUTPUT_DIR="${OUTPUT_DIR}"
export KALL_CAPTURE_VIDEO="${VIDEO_PATH}"
export KALL_CAPTURE_DEVICE_TYPE="${DEVICE_TYPE}"
export KALL_CAPTURE_RUNTIME="${RUNTIME_ID}"

python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

output = Path(os.environ["KALL_REVIEW_OUTPUT_DIR"])

def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

assets = []
for path in sorted(output.glob("*.png")) + [Path(os.environ["KALL_CAPTURE_VIDEO"])]:
    assets.append({"file": path.name, "bytes": path.stat().st_size, "sha256": digest(path)})

manifest = {
    "captureType": "iOS Simulator",
    "limitations": [
        "This is simulated-device media and must not be described as physical-device evidence.",
        "The deletion screen is demonstrated without deleting the reusable reviewer account.",
        "The native plan and restore controls are shown without confirming a purchase.",
    ],
    "sourceCommit": os.environ.get("KALL_BUILD_GIT_COMMIT"),
    "easBuildId": os.environ.get("KALL_EAS_BUILD_ID"),
    "appVersion": os.environ.get("KALL_APP_VERSION"),
    "appBuildVersion": os.environ.get("KALL_APP_BUILD_VERSION"),
    "buildFingerprint": os.environ.get("KALL_BUILD_FINGERPRINT"),
    "deviceType": os.environ["KALL_CAPTURE_DEVICE_TYPE"],
    "runtime": os.environ["KALL_CAPTURE_RUNTIME"],
    "assets": assets,
}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
PY
