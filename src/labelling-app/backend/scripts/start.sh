#!/usr/bin/env bash
set -euo pipefail

node --expose-gc --max-old-space-size=8192 dist/index.js
