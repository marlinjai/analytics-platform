#!/bin/sh
set -e

PROJECT_ID="45b9c32b-3deb-42ef-ad8a-9a931b86c01a"
DOMAIN="https://infisical.lumitra.co"

# Authenticate with Infisical via machine identity (Universal Auth)
INFISICAL_TOKEN=$(infisical login \
  --method=universal-auth \
  --client-id="$INFISICAL_CLIENT_ID" \
  --client-secret="$INFISICAL_CLIENT_SECRET" \
  --domain "$DOMAIN" \
  --silent --plain)

# Pass the token via the environment, NOT --token: argv is visible to every
# process in the container (ps, /proc/*/cmdline). `env -u` strips it from the
# app process again so it lives only in the infisical wrapper.
export INFISICAL_TOKEN

# Inject secrets and start the app
exec infisical run \
  --env=prod \
  --projectId="$PROJECT_ID" \
  --domain "$DOMAIN" \
  -- env -u INFISICAL_TOKEN node packages/dashboard/server.js
