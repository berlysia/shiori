#!/usr/bin/env bash
# Download baseline scan artifact from the latest successful workflow run.
# Uses gh CLI (pre-installed on GitHub-hosted runners) with GITHUB_TOKEN.
#
# Usage: download-baseline.sh <repo> <branch> <workflow-name> <artifact-name> <output-dir>
# Requires: GH_TOKEN environment variable

set -euo pipefail

REPO="$1"
BRANCH="$2"
WORKFLOW_NAME="$3"
ARTIFACT_NAME="$4"
OUTPUT_DIR="$5"

mkdir -p "$OUTPUT_DIR"

echo "::group::Download baseline artifact"
echo "Repository: $REPO"
echo "Branch: $BRANCH"
echo "Workflow: $WORKFLOW_NAME"
echo "Artifact: $ARTIFACT_NAME"

# Find the workflow ID by name
WORKFLOW_ID=$(gh api "repos/$REPO/actions/workflows" --jq ".workflows[] | select(.name == \"$WORKFLOW_NAME\") | .id" 2>/dev/null || true)

if [ -z "$WORKFLOW_ID" ]; then
  echo "::warning::No workflow named '$WORKFLOW_NAME' found. Skipping baseline download."
  echo "::endgroup::"
  exit 0
fi

# Find the latest successful run on the target branch
RUN_ID=$(gh api "repos/$REPO/actions/workflows/$WORKFLOW_ID/runs?branch=$BRANCH&status=success&per_page=1" --jq '.workflow_runs[0].id' 2>/dev/null || true)

if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
  echo "::warning::No successful runs found for workflow '$WORKFLOW_NAME' on branch '$BRANCH'. Skipping baseline download."
  echo "::endgroup::"
  exit 0
fi

# Find the artifact in that run
ARTIFACT_ID=$(gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" --jq ".artifacts[] | select(.name == \"$ARTIFACT_NAME\") | .id" 2>/dev/null || true)

if [ -z "$ARTIFACT_ID" ] || [ "$ARTIFACT_ID" = "null" ]; then
  echo "::warning::No artifact named '$ARTIFACT_NAME' found in run $RUN_ID. Skipping baseline download."
  echo "::endgroup::"
  exit 0
fi

# Download and extract the artifact
ZIP_PATH="$OUTPUT_DIR/$ARTIFACT_NAME.zip"
gh api "repos/$REPO/actions/artifacts/$ARTIFACT_ID/zip" > "$ZIP_PATH"
unzip -o "$ZIP_PATH" -d "$OUTPUT_DIR"
rm -f "$ZIP_PATH"

echo "Baseline artifact downloaded successfully to $OUTPUT_DIR"
echo "::endgroup::"
