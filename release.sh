#!/usr/bin/env bash

set -euo pipefail

# ============================================================
# Tauri Release Script
#
# Usage:
#
#   ./release.sh auto
#   ./release.sh patch
#   ./release.sh minor
#   ./release.sh major
#
#   ./release.sh auto --push
#
# auto:
#   BREAKING CHANGE / feat!: => major
#   feat:                    => minor
#   others                   => patch
#
# Example:
#
#   Current: 1.2.3
#
#   fix: xxx
#     => 1.2.4
#
#   feat: xxx
#     => 1.3.0
#
#   feat!: xxx
#     => 2.0.0
#
# ============================================================

BUMP_TYPE="${1:-auto}"
PUSH=false

if [[ "${2:-}" == "--push" ]]; then
  PUSH=true
fi

# ------------------------------------------------------------
# Colors
# ------------------------------------------------------------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info() {
  echo -e "${BLUE}==>${NC} $1"
}

success() {
  echo -e "${GREEN}✔${NC} $1"
}

warn() {
  echo -e "${YELLOW}⚠${NC} $1"
}

error() {
  echo -e "${RED}✘${NC} $1"
  exit 1
}

# ------------------------------------------------------------
# Validate arguments
# ------------------------------------------------------------

case "$BUMP_TYPE" in
  auto|patch|minor|major)
    ;;
  *)
    error "Invalid release type: $BUMP_TYPE. Use auto, patch, minor or major."
    ;;
esac

# ------------------------------------------------------------
# Check dependencies
# ------------------------------------------------------------

command -v git >/dev/null 2>&1 || error "git is required"
command -v node >/dev/null 2>&1 || error "node is required"

[[ -f "package.json" ]] \
  || error "package.json not found"

[[ -f "src-tauri/tauri.conf.json" ]] \
  || error "src-tauri/tauri.conf.json not found"

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || error "Current directory is not a git repository"

# ------------------------------------------------------------
# Ensure working tree is clean
# ------------------------------------------------------------

if [[ -n "$(git status --porcelain)" ]]; then
  error "Git working tree is not clean. Commit or stash changes first."
fi

# ------------------------------------------------------------
# Find previous tag
# ------------------------------------------------------------

PREVIOUS_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"

if [[ -n "$PREVIOUS_TAG" ]]; then
  info "Previous tag: $PREVIOUS_TAG"

  CURRENT_VERSION="${PREVIOUS_TAG#v}"
  COMMIT_RANGE="${PREVIOUS_TAG}..HEAD"
else
  warn "No previous tag found."

  CURRENT_VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
  COMMIT_RANGE="HEAD"
fi

# ------------------------------------------------------------
# Validate current version
# ------------------------------------------------------------

if [[ ! "$CURRENT_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  error "Invalid current version: $CURRENT_VERSION"
fi

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

info "Current version: $CURRENT_VERSION"

# ------------------------------------------------------------
# Detect release type
# ------------------------------------------------------------

DETECTED_TYPE="$BUMP_TYPE"

if [[ "$BUMP_TYPE" == "auto" ]]; then

  info "Detecting version bump from commits..."

  if [[ -n "$PREVIOUS_TAG" ]]; then

    COMMIT_MESSAGES="$(git log "$PREVIOUS_TAG"..HEAD \
      --format='%s%n%b')"

  else

    COMMIT_MESSAGES="$(git log \
      --format='%s%n%b')"

  fi

  if [[ -z "$COMMIT_MESSAGES" ]]; then
    error "No commits found since last release."
  fi

  # -----------------------------------------
  # MAJOR
  #
  # feat!: ...
  # fix!: ...
  #
  # BREAKING CHANGE:
  # -----------------------------------------

  if echo "$COMMIT_MESSAGES" | grep -Eq \
    '^[a-zA-Z]+(\([^)]+\))?!:'; then

    DETECTED_TYPE="major"

  elif echo "$COMMIT_MESSAGES" | grep -Eq \
    '^BREAKING[ -]CHANGE:'; then

    DETECTED_TYPE="major"

  # -----------------------------------------
  # MINOR
  #
  # feat:
  # feat(scope):
  # -----------------------------------------

  elif echo "$COMMIT_MESSAGES" | grep -Eq \
    '^feat(\([^)]+\))?:'; then

    DETECTED_TYPE="minor"

  # -----------------------------------------
  # PATCH
  # -----------------------------------------

  else

    DETECTED_TYPE="patch"

  fi

fi

success "Release type: $DETECTED_TYPE"

# ------------------------------------------------------------
# Calculate next version
# ------------------------------------------------------------

case "$DETECTED_TYPE" in

  major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;

  minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;

  patch)
    PATCH=$((PATCH + 1))
    ;;

esac

VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${VERSION}"

echo
echo "--------------------------------------------"
echo "Current version : $CURRENT_VERSION"
echo "Release type    : $DETECTED_TYPE"
echo "Next version    : $VERSION"
echo "Tag             : $TAG"
echo "--------------------------------------------"
echo

# ------------------------------------------------------------
# Ensure tag doesn't exist
# ------------------------------------------------------------

if git rev-parse "$TAG" >/dev/null 2>&1; then
  error "Tag $TAG already exists"
fi

# ------------------------------------------------------------
# Update package.json
# ------------------------------------------------------------

info "Updating package.json..."

node - "$VERSION" <<'NODE'
const fs = require("fs");

const version = process.argv[2];
const file = "package.json";

const json = JSON.parse(
  fs.readFileSync(file, "utf8")
);

json.version = version;

fs.writeFileSync(
  file,
  JSON.stringify(json, null, 2) + "\n"
);
NODE

success "package.json → $VERSION"

# ------------------------------------------------------------
# Update tauri.conf.json
# ------------------------------------------------------------

info "Updating tauri.conf.json..."

node - "$VERSION" <<'NODE'
const fs = require("fs");

const version = process.argv[2];
const file = "src-tauri/tauri.conf.json";

const json = JSON.parse(
  fs.readFileSync(file, "utf8")
);

json.version = version;

fs.writeFileSync(
  file,
  JSON.stringify(json, null, 2) + "\n"
);
NODE

success "tauri.conf.json → $VERSION"

# ------------------------------------------------------------
# Update Cargo.toml
# ------------------------------------------------------------

if [[ -f "src-tauri/Cargo.toml" ]]; then

  info "Updating Cargo.toml..."

  node - "$VERSION" <<'NODE'
const fs = require("fs");

const version = process.argv[2];
const file = "src-tauri/Cargo.toml";

let content = fs.readFileSync(file, "utf8");

const packageIndex = content.indexOf("[package]");

if (packageIndex !== -1) {

  const before = content.slice(0, packageIndex);
  let after = content.slice(packageIndex);

  after = after.replace(
    /^version\s*=\s*"[^"]+"/m,
    `version = "${version}"`
  );

  fs.writeFileSync(
    file,
    before + after
  );
}
NODE

  success "Cargo.toml → $VERSION"

fi

# ------------------------------------------------------------
# Generate CHANGELOG
# ------------------------------------------------------------

info "Generating CHANGELOG.md..."

DATE="$(date '+%Y-%m-%d')"
TMP_CHANGELOG="$(mktemp)"

# ------------------------------------------------------------
# Get commits
# ------------------------------------------------------------

if [[ -n "$PREVIOUS_TAG" ]]; then

  GIT_LOG="$(git log "${PREVIOUS_TAG}..HEAD" \
    --pretty=format:'%s|%h' \
    --no-merges)"

else

  GIT_LOG="$(git log \
    --pretty=format:'%s|%h' \
    --no-merges)"

fi

# ------------------------------------------------------------
# Changelog section
# ------------------------------------------------------------

{
  echo "## [$VERSION] - $DATE"
  echo

  # Features
  FEATURES="$(echo "$GIT_LOG" |
    grep -E '^feat(\([^)]+\))?!?:' || true)"

  if [[ -n "$FEATURES" ]]; then

    echo "### ✨ Features"
    echo

    while IFS='|' read -r message hash; do

      message="$(echo "$message" |
        sed -E 's/^feat(\([^)]+\))?!?:[[:space:]]*//')"

      echo "- $message ($hash)"

    done <<< "$FEATURES"

    echo
  fi

  # Fixes
  FIXES="$(echo "$GIT_LOG" |
    grep -E '^fix(\([^)]+\))?!?:' || true)"

  if [[ -n "$FIXES" ]]; then

    echo "### 🐛 Bug Fixes"
    echo

    while IFS='|' read -r message hash; do

      message="$(echo "$message" |
        sed -E 's/^fix(\([^)]+\))?!?:[[:space:]]*//')"

      echo "- $message ($hash)"

    done <<< "$FIXES"

    echo
  fi

  # Performance
  PERF="$(echo "$GIT_LOG" |
    grep -E '^perf(\([^)]+\))?!?:' || true)"

  if [[ -n "$PERF" ]]; then

    echo "### ⚡ Performance"
    echo

    while IFS='|' read -r message hash; do

      message="$(echo "$message" |
        sed -E 's/^perf(\([^)]+\))?!?:[[:space:]]*//')"

      echo "- $message ($hash)"

    done <<< "$PERF"

    echo
  fi

  # Refactor
  REFACTOR="$(echo "$GIT_LOG" |
    grep -E '^refactor(\([^)]+\))?!?:' || true)"

  if [[ -n "$REFACTOR" ]]; then

    echo "### ♻️ Refactor"
    echo

    while IFS='|' read -r message hash; do

      message="$(echo "$message" |
        sed -E 's/^refactor(\([^)]+\))?!?:[[:space:]]*//')"

      echo "- $message ($hash)"

    done <<< "$REFACTOR"

    echo
  fi

  # Other
  OTHER="$(echo "$GIT_LOG" |
    grep -Ev \
    '^(feat|fix|perf|refactor)(\([^)]+\))?!?:' \
    || true)"

  if [[ -n "$OTHER" ]]; then

    echo "### 📦 Other Changes"
    echo

    while IFS='|' read -r message hash; do

      echo "- $message ($hash)"

    done <<< "$OTHER"

    echo
  fi

} > "$TMP_CHANGELOG"

# ------------------------------------------------------------
# Prepend changelog
# ------------------------------------------------------------

if [[ -f "CHANGELOG.md" ]]; then

  OLD_CHANGELOG="$(mktemp)"

  # Remove existing title
  tail -n +2 CHANGELOG.md > "$OLD_CHANGELOG"

  {
    echo "# Changelog"
    echo
    cat "$TMP_CHANGELOG"
    cat "$OLD_CHANGELOG"
  } > CHANGELOG.md

  rm "$OLD_CHANGELOG"

else

  {
    echo "# Changelog"
    echo
    cat "$TMP_CHANGELOG"
  } > CHANGELOG.md

fi

rm "$TMP_CHANGELOG"

success "CHANGELOG.md generated"

# ------------------------------------------------------------
# Show changelog preview
# ------------------------------------------------------------

echo
echo "============ CHANGELOG ============"
echo

awk '
  /^## \[/ {
    if (++count > 1) exit
  }
  { print }
' CHANGELOG.md

echo
echo "==================================="
echo

# ------------------------------------------------------------
# Stage files
# ------------------------------------------------------------

git add \
  package.json \
  src-tauri/tauri.conf.json \
  CHANGELOG.md

if [[ -f "src-tauri/Cargo.toml" ]]; then
  git add src-tauri/Cargo.toml
fi

if [[ -f "package-lock.json" ]]; then
  npm install \
    --package-lock-only \
    --ignore-scripts \
    >/dev/null

  git add package-lock.json
fi

# ------------------------------------------------------------
# Commit
# ------------------------------------------------------------

info "Creating release commit..."

git commit \
  -m "chore(release): $TAG"

success "Release commit created"

# ------------------------------------------------------------
# Create tag
# ------------------------------------------------------------

info "Creating tag $TAG..."

git tag \
  -a "$TAG" \
  -m "Release $TAG"

success "Tag created: $TAG"

# ------------------------------------------------------------
# Push
# ------------------------------------------------------------

if [[ "$PUSH" == true ]]; then

  CURRENT_BRANCH="$(git branch --show-current)"

  if [[ -z "$CURRENT_BRANCH" ]]; then
    error "Cannot determine current branch."
  fi

  info "Pushing $CURRENT_BRANCH..."

  git push origin "$CURRENT_BRANCH"

  info "Pushing $TAG..."

  git push origin "$TAG"

  success "Release pushed successfully."

else

  echo
  warn "Release created locally but NOT pushed."
  echo
  echo "Review it with:"
  echo
  echo "  git show $TAG"
  echo
  echo "  git log ${PREVIOUS_TAG:-HEAD~10}..HEAD --oneline"
  echo
  echo "Then push:"
  echo
  echo "  git push origin $(git branch --show-current)"
  echo "  git push origin $TAG"
fi

echo
echo "============================================"
success "Release completed"
echo
echo "Version : $VERSION"
echo "Tag     : $TAG"
echo "Type    : $DETECTED_TYPE"
echo "============================================"
