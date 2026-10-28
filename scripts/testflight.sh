#!/usr/bin/env bash
# Archive the iOS app and upload it to TestFlight — what Product → Archive →
# Distribute App does in Xcode.
#
#   npm run testflight              build and upload
#   npm run testflight -- --no-upload   build the .ipa only (ios/build/testflight)
#
# Signing uses the Apple account signed in to Xcode. Without Xcode (CI), set an
# App Store Connect API key: ASC_KEY_PATH (.p8), ASC_KEY_ID, ASC_ISSUER_ID.
# BUILD_NUMBER overrides the default build number (UTC date + time).
set -euo pipefail
cd "$(dirname "$0")/.."

UPLOAD=1
[ "${1:-}" = "--no-upload" ] && UPLOAD=0

# .env feeds both the config (team, bundle id) and the JS bundle (EXPO_PUBLIC_*)
if [ -f .env ]; then set -a; . ./.env; set +a; fi
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 # CocoaPods needs a UTF-8 locale
export CI=1                                 # no interactive prompts from expo

TEAM_ID="${APPLE_TEAM_ID:-6PP44GSHNR}"
# Always increasing, e.g. 261028.1530 (Apple compares each part as a number)
export IOS_BUILD_NUMBER="${BUILD_NUMBER:-$(date -u +%y%m%d.%H%M)}"
VERSION="$(npx expo config --json --type public | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0, "utf8")).version)')"
OUT=ios/build/testflight
LOG="$OUT/xcodebuild.log"

AUTH=()
if [ -n "${ASC_KEY_ID:-}" ]; then
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

run() {
  if ! "$@" >>"$LOG" 2>&1; then
    tail -40 "$LOG"
    echo "✗ Failed — full log: $LOG" >&2
    exit 1
  fi
}

echo "▸ Nudge Buddy $VERSION ($IOS_BUILD_NUMBER)"

echo "▸ Generating the iOS project"
npx expo prebuild --platform ios --clean >/dev/null
mkdir -p "$OUT"
: >"$LOG"

echo "▸ Archiving (about 10–15 minutes)"
# Build settings on the command line apply to every target, so the widget
# extension's version always matches the app's (App Store Connect requires it)
run xcodebuild archive \
  -workspace ios/NudgeBuddy.xcworkspace \
  -scheme NudgeBuddy \
  -configuration Release \
  -destination generic/platform=iOS \
  -archivePath "$OUT/NudgeBuddy.xcarchive" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} \
  CURRENT_PROJECT_VERSION="$IOS_BUILD_NUMBER" \
  MARKETING_VERSION="$VERSION"

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$([ $UPLOAD = 1 ] && echo upload || echo export)</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict>
</plist>
PLIST

if [ $UPLOAD = 1 ]; then echo "▸ Uploading to App Store Connect"; else echo "▸ Exporting the .ipa"; fi
run xcodebuild -exportArchive \
  -archivePath "$OUT/NudgeBuddy.xcarchive" \
  -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" \
  -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"}

if [ $UPLOAD = 1 ]; then
  echo "✓ Uploaded $VERSION ($IOS_BUILD_NUMBER). It shows in TestFlight once Apple finishes processing (10–30 min)."
else
  echo "✓ Built $OUT/export/NudgeBuddy.ipa"
fi
