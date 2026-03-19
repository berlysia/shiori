#!/usr/bin/env bash
# Upload a file to a GitHub Gist.
#
# Usage: upload-gist.sh <gist-id> <file-path>
# Requires: GIST_TOKEN environment variable

set -euo pipefail

GIST_ID="$1"
FILE_PATH="$2"

echo "::group::Upload to Gist"

if [ -z "$GIST_ID" ]; then
  echo "::error::gist-id input is required for Gist upload"
  echo "::endgroup::"
  exit 1
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "::error::File not found: $FILE_PATH"
  echo "::endgroup::"
  exit 1
fi

FILENAME=$(basename "$FILE_PATH")
CONTENT=$(cat "$FILE_PATH")

# Use gh api with GIST_TOKEN for authentication
# GIST_TOKEN may have different permissions than GITHUB_TOKEN
GH_TOKEN="$GIST_TOKEN" gh api "gists/$GIST_ID" \
  --method PATCH \
  --raw-field "files[$FILENAME][content]=$CONTENT" \
  --silent

echo "Uploaded $FILENAME to Gist $GIST_ID"
echo "::endgroup::"
