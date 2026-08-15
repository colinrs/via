SHELL := /bin/sh

NPM ?= npm
CARGO ?= cargo
TAURI := $(CARGO) tauri
TAURI_DIR := src-tauri
APP_BUNDLE := $(TAURI_DIR)/target/release/bundle/macos/Via.app

.DEFAULT_GOAL := help

.PHONY: help install dev build format test check package clean clean-all

help: ## Show available commands.
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install pinned JavaScript dependencies.
	$(NPM) ci

dev: ## Run the Via desktop app in development mode.
	$(TAURI) dev --config $(TAURI_DIR)/tauri.conf.json

build: ## Build the frontend and compile the Rust desktop binary.
	$(NPM) run build
	$(CARGO) build --manifest-path $(TAURI_DIR)/Cargo.toml

format: ## Format TypeScript (Prettier) and Rust (cargo fmt) source code.
	$(NPM) run format
	$(CARGO) fmt --manifest-path $(TAURI_DIR)/Cargo.toml

test: ## Run all frontend and Rust tests.
	$(NPM) run test
	$(NPM) run typecheck
	$(CARGO) fmt --manifest-path $(TAURI_DIR)/Cargo.toml --check
	$(CARGO) clippy --manifest-path $(TAURI_DIR)/Cargo.toml --all-targets -- -D warnings
	$(CARGO) test --manifest-path $(TAURI_DIR)/Cargo.toml

check: ## Run the same quality checks as CI without producing a frontend bundle.
	$(NPM) run typecheck
	$(CARGO) check --manifest-path $(TAURI_DIR)/Cargo.toml
	$(CARGO) clippy --manifest-path $(TAURI_DIR)/Cargo.toml --all-targets -- -D warnings

package: ## Create and locally ad-hoc-sign a macOS .app bundle.
	$(TAURI) build --config $(TAURI_DIR)/tauri.conf.json
	codesign --force --deep --sign - $(APP_BUNDLE)
	codesign --verify --deep --strict --verbose=2 $(APP_BUNDLE)

clean: ## Remove generated frontend and Rust build artifacts.
	rm -rf dist
	$(CARGO) clean --manifest-path $(TAURI_DIR)/Cargo.toml

clean-all: clean ## Also remove installed JavaScript dependencies.
	rm -rf node_modules
