# Notiva task runner. Run `just` to list the recipes.
# Install just with `brew install just`.

manifest := "src-tauri/Cargo.toml"

# List the recipes
default:
    @just --list --unsorted

# Install the frontend dependencies
install:
    pnpm install

# Run the desktop app with hot reload
dev:
    pnpm tauri dev

# Run only the frontend against the in-memory fake backend (http://localhost:1430)
dev-fake:
    pnpm dev:fake

# Typecheck and build the frontend
build:
    pnpm build

# Build the app bundle (.app and .dmg)
bundle:
    pnpm tauri build

# Format the frontend and the Rust code
fmt:
    pnpm format
    cargo fmt --manifest-path {{ manifest }}

# Lint, check formatting and types on both sides; changes nothing
lint:
    pnpm lint
    pnpm format:check
    pnpm typecheck
    cargo fmt --manifest-path {{ manifest }} --check
    cargo clippy --manifest-path {{ manifest }} --all-targets -- -D warnings

# Run the frontend unit and component tests
test-frontend *args:
    pnpm test {{ args }}

# Run the Rust unit and repository tests
test-rust *args:
    cargo test --manifest-path {{ manifest }} {{ args }}

# Run the end-to-end tests in WebKit against the fake backend (E2E_PORT picks the port)
test-e2e *args:
    pnpm test:e2e {{ args }}

# Run the frontend and the Rust tests
test: test-frontend test-rust

# Run everything CI runs: build, lint, all tests
check: build lint test test-e2e

# Run the 10,000 page benchmark and print its timings
benchmark:
    cargo test --manifest-path {{ manifest }} --profile benchmark -- --ignored --nocapture benchmark
