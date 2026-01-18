#!/usr/bin/env sh
# This script is meant to be run on the development machine
# It fetches the pipeline dot file from the Jetson and converts it to a PNG

# Navigate to the same directory as this script
cd "$(dirname "$0")"

scp rocam@100.117.52.117:/tmp/pipeline.dot .
dot -Tpng pipeline.dot -o pipeline.png
rm pipeline.dot
echo "Generated pipeline.png"