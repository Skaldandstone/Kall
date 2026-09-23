#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${KALL_IOS_APP_PATH:?KALL_IOS_APP_PATH is required}"
OUTPUT_DIR="${PWD}/store-capture-output"
DEVICE_NAME="Kall Store Capture ${EAS_BUILD_ID:-local}"
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
  echo "Expected an extracted iOS Simulator .app bundle, got: ${APP_PATH}" >&2
  exit 1
fi

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

RUNTIME_ID="$({ xcrun simctl list runtimes --json; } | python3 -c '
import json
import re
import sys

runtimes = [
    item for item in json.load(sys.stdin).get("runtimes", [])
    if item.get("isAvailable") and "iOS" in item.get("name", "")
]
if not runtimes:
    raise SystemExit("No available iOS Simulator runtime was found")

def version(item):
    values = re.findall(r"\d+", item.get("version", ""))
    return tuple(int(value) for value in values)

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

if [[ -z "${DEVICE_TYPE}" ]]; then
  echo "No App Store-sized iPhone Simulator device type is installed" >&2
  exit 1
fi

DEVICE_UDID="$(xcrun simctl create "${DEVICE_NAME}" "${DEVICE_TYPE}" "${RUNTIME_ID}")"
xcrun simctl boot "${DEVICE_UDID}"
xcrun simctl bootstatus "${DEVICE_UDID}" -b
xcrun simctl status_bar "${DEVICE_UDID}" override \
  --time "9:41" \
  --batteryState charged \
  --batteryLevel 100 \
  --wifiBars 3 \
  --cellularBars 4
xcrun simctl install "${DEVICE_UDID}" "${APP_PATH}"

maestro --version

VIDEO_PATH="${OUTPUT_DIR}/kall-ios-review-flow.mp4"
xcrun simctl io "${DEVICE_UDID}" recordVideo --codec=h264 --force "${VIDEO_PATH}" &
VIDEO_PID="$!"

maestro --device "${DEVICE_UDID}" test .maestro/ios-launch.yml

kill -INT "${VIDEO_PID}"
wait "${VIDEO_PID}" || true
VIDEO_PID=""

SCREENSHOT_PATH="${OUTPUT_DIR}/01-kall-sign-in.png"
xcrun simctl io "${DEVICE_UDID}" screenshot "${SCREENSHOT_PATH}"

WIDTH="$(sips -g pixelWidth "${SCREENSHOT_PATH}" | awk '/pixelWidth/{print $2}')"
HEIGHT="$(sips -g pixelHeight "${SCREENSHOT_PATH}" | awk '/pixelHeight/{print $2}')"
DIMENSIONS="${WIDTH}x${HEIGHT}"

case "${DIMENSIONS}" in
  1320x2868|1290x2796|1260x2736) ;;
  *)
    echo "Screenshot ${DIMENSIONS} is not an accepted 6.9-inch App Store size" >&2
    exit 1
    ;;
esac

export KALL_CAPTURE_SCREENSHOT="${SCREENSHOT_PATH}"
export KALL_CAPTURE_VIDEO="${VIDEO_PATH}"
export KALL_CAPTURE_DIMENSIONS="${DIMENSIONS}"
export KALL_CAPTURE_DEVICE_TYPE="${DEVICE_TYPE}"
export KALL_CAPTURE_RUNTIME="${RUNTIME_ID}"

python3 - <<'PY'
import hashlib
import json
import os
from pathlib import Path

output = Path("store-capture-output")
screenshot = Path(os.environ["KALL_CAPTURE_SCREENSHOT"])
video = Path(os.environ["KALL_CAPTURE_VIDEO"])

def digest(path: Path) -> str:
    value = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()

manifest = {
    "captureType": "iOS Simulator",
    "limitations": [
        "This is simulated-device media, not physical-device evidence.",
        "The flow proves native launch and signed-out sign-in rendering only.",
    ],
    "sourceCommit": os.environ.get("KALL_BUILD_GIT_COMMIT"),
    "easBuildId": os.environ.get("KALL_EAS_BUILD_ID"),
    "appVersion": os.environ.get("KALL_APP_VERSION"),
    "appBuildVersion": os.environ.get("KALL_APP_BUILD_VERSION"),
    "buildFingerprint": os.environ.get("KALL_BUILD_FINGERPRINT"),
    "deviceType": os.environ["KALL_CAPTURE_DEVICE_TYPE"],
    "runtime": os.environ["KALL_CAPTURE_RUNTIME"],
    "screenshot": {
        "file": screenshot.name,
        "dimensions": os.environ["KALL_CAPTURE_DIMENSIONS"],
        "bytes": screenshot.stat().st_size,
        "sha256": digest(screenshot),
    },
    "recording": {
        "file": video.name,
        "bytes": video.stat().st_size,
        "sha256": digest(video),
    },
}
(output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
PY
