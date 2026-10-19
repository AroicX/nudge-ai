#!/bin/sh
# Build the unpacked alpha extension and a zip with checksums.
# The pairing secret is written to release/ and is gitignored.
set -eu
cd "$(dirname "$0")/.."
version="0.1.0-alpha.1"
out="release/$version"
secret="${NUDGE_PAIRING_SECRET:-}"
if [ -z "$secret" ]; then
  secret="$(openssl rand -hex 24)"
fi
if [ "${#secret}" -lt 16 ]; then
  echo "NUDGE_PAIRING_SECRET must be at least 16 characters." >&2
  exit 1
fi
mkdir -p "$out"
umask 077
printf '%s\n' "$secret" > "$out/PAIRING.txt"
umask 022
export WXT_PUBLIC_NUDGE_PAIRING_SECRET="$secret"
export WXT_PUBLIC_NUDGE_SERVER_URL="${WXT_PUBLIC_NUDGE_SERVER_URL:-http://127.0.0.1:4317}"
pnpm --filter @nudge/extension build
rm -rf "$out/unpacked"
cp -R apps/extension/.output/chrome-mv3 "$out/unpacked"
rm -f "$out/nudge-chrome-$version.zip"
( cd "$out" && zip -qr "nudge-chrome-$version.zip" unpacked )
( cd "$out" && shasum -a 256 "nudge-chrome-$version.zip" > SHA256SUMS )
echo "Wrote $out/nudge-chrome-$version.zip"
echo "Pairing secret for this build is in $out/PAIRING.txt (not printed)."
