# campfire-mcp-server

set shell := ["bash", "-cu"]

# Default: list available commands
default:
    @just --list

# Install dependencies
install:
    npm install

# Build TypeScript
build:
    npm run build

# Run the server
start:
    npm run start

# Run tests
test:
    npm test

# Build and test
check: build test

# Bump version (major, minor, or patch) across all files
bump level="patch":
    #!/usr/bin/env bash
    set -euo pipefail
    new=$(npm version "{{level}}" --no-git-tag-version | tr -d 'v')
    echo "Bumped to $new"
    # src/index.ts — McpServer version
    sed -i '' -E "s/version: \"[0-9]+\.[0-9]+\.[0-9]+\"/version: \"$new\"/" src/index.ts
    # README.md — version tags in npx install URLs
    sed -i '' -E "s/#v[0-9]+\.[0-9]+\.[0-9]+/#v$new/g" README.md
    echo "Updated: package.json, src/index.ts, README.md → $new"

# Clean build artifacts
clean:
    rm -rf build coverage
