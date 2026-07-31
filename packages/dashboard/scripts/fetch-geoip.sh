#!/bin/sh
# Best-effort download of the DB-IP Lite (Country) GeoIP database at image build
# time, so visitor IPs are geolocated LOCALLY and never leave the EU (replaces
# the old ip-api.com call). DB-IP publishes a dated file monthly, so we try the
# current month then fall back to the previous month.
#
# A failure here is NON-FATAL on purpose: lib/geo.ts degrades to an empty country
# if the file is missing (and logs it), so the image build must never break over
# geo data. License: DB-IP Lite is CC-BY-4.0 (attribution belongs in the docs).
#
# Usage: fetch-geoip.sh [dest-path]   (default: /app/geoip/country.mmdb)
set -u

dest="${1:-/app/geoip/country.mmdb}"
mkdir -p "$(dirname "$dest")"

y=$(date -u +%Y)
m=$(date -u +%m)
mi=$(echo "$m" | sed 's/^0*//')          # strip leading zero(s) for arithmetic
cur=$(printf '%04d-%02d' "$y" "$mi")
pmi=$((mi - 1)); py=$y
if [ "$pmi" -le 0 ]; then pmi=12; py=$((y - 1)); fi
prev=$(printf '%04d-%02d' "$py" "$pmi")

base="https://download.db-ip.com/free/dbip-country-lite"
tmp=$(mktemp)

for ym in "$cur" "$prev"; do
  echo "[geo] fetching dbip-country-lite-${ym}.mmdb.gz"
  if curl -fsSL "${base}-${ym}.mmdb.gz" -o "$tmp" && gunzip -c "$tmp" > "$dest"; then
    rm -f "$tmp"
    echo "[geo] installed $dest ($(du -h "$dest" 2>/dev/null | cut -f1))"
    exit 0
  fi
done

rm -f "$tmp"
echo "[geo] WARNING: GeoIP DB download failed (tried ${cur}, ${prev}); country enrichment disabled until a DB is provided at $dest." >&2
exit 0   # never break the image build over geo data
