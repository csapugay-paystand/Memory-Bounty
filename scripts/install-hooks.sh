#!/bin/bash
# Installs the memory-bounty git hooks by symlinking them into .git/hooks/.
# Run once after cloning: bash scripts/install-hooks.sh
# Or via npm: npm run install-hooks

set -e

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SCRIPTS_DIR="$REPO_ROOT/scripts"

if [ ! -d "$HOOKS_DIR" ]; then
  echo "Error: .git/hooks directory not found. Are you inside a git repo?"
  exit 1
fi

install_hook() {
  local name="$1"
  local src="$SCRIPTS_DIR/$name"
  local dest="$HOOKS_DIR/$name"

  if [ ! -f "$src" ]; then
    echo "Warning: $src not found, skipping."
    return
  fi

  chmod +x "$src"

  if [ -L "$dest" ]; then
    rm "$dest"
  elif [ -f "$dest" ]; then
    echo "Warning: $dest already exists and is not a symlink — backing up to $dest.bak"
    mv "$dest" "$dest.bak"
  fi

  ln -s "$src" "$dest"
  echo "✓ installed $name → .git/hooks/$name"
}

install_hook "post-commit"

echo ""
echo "Git hooks installed. Make sure WORKER_URL is set in your .env file."
echo "Logs will be written to .memory-bounty.log after each commit."
