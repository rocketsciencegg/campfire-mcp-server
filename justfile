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

# Clean build artifacts
clean:
    rm -rf build coverage
