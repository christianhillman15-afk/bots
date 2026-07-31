#!/usr/bin/env bash
# Dead-simple local launcher for Oxsome Prospector.
# Mac/Linux: double-click or run `./start.sh` from a terminal.
set -e
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install the LTS version from https://nodejs.org then run this again."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run — installing dependencies..."
  npm install
fi

if [ ! -f .env ]; then
  echo "No .env found — copying .env.example. Add your GOOGLE_PLACES_API_KEY there for real data."
  cp .env.example .env
fi

echo "Starting the dashboard at http://localhost:${PORT:-4317} ..."
npm start
