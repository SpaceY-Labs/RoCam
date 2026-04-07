#!/usr/bin/env bash
# Author: Jianqing Liu
# Date: 2026-01-27
# Purpose: Start the labelling app backend server with GC exposure enabled.
set -euo pipefail

node --expose-gc dist/index.js
