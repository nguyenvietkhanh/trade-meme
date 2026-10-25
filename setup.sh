#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
python3 -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ required"'
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v
[ -e .env ] || cp .env.example .env
printf '%s\n' 'Setup complete. Scanner: .venv/bin/python run_local.py --loop' 'Public verification: python3 local_verify.py'
