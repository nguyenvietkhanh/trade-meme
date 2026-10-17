#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Interactive Railway account/workspace selection. No token is stored in this project.
npx --yes @railway/cli login
npx --yes @railway/cli init --name meme-pilot
npx --yes @railway/cli add --service meme-pilot
npx --yes @railway/cli up --service meme-pilot
npx --yes @railway/cli domain --service meme-pilot
