# Phase 1 Todo

## Objective
Build the Phase 1 foundation for Sparow: a runnable Tauri desktop shell with a React UI, Rust-owned persistence and background tasks, typed IPC contracts, deterministic mock workflows, and AI-friendly verification/documentation.

## Checklist
- [completed] Create phase-1 tracking and inspect current repo constraints
- [completed] Select latest stable compatible dependency versions
- [completed] Scaffold Tauri + React + TypeScript project structure
- [completed] Implement typed IPC contracts and frontend IPC layer
- [completed] Implement Rust error model, logging, and diagnostics plumbing
- [completed] Implement SQLite persistence with plain SQL migrations
- [completed] Implement deterministic mock background job and cancellation
- [completed] Build the app shell UI and development diagnostics surface
- [completed] Add fixtures, contract tests, Rust tests, and shell smoke coverage
- [completed] Add AI/developer docs and final verification scripts

## Blockers And Decisions
- Package manager: `npm` unless a compatibility issue forces a change.
- Local store: `SQLite`.
- IPC strategy: explicit hand-authored TS + Rust contracts, no codegen.
- Node baseline: `.node-version` now targets `24` for `fnm`, which allows the latest stable frontend toolchain to be used directly.
- Current blocker: none.

## Verification
- `npm run typecheck` ✅
- `npm run lint` ✅
- `npm run test` ✅
- `npm run smoke:foundation` ✅
- `cargo test --manifest-path src-tauri/Cargo.toml` ✅
- `npm run verify` ✅
- `npm run build` ✅
- Verification rerun after switching to Node `24` and reinstalling dependencies cleanly ✅
- `npm run tauri -- --version` ✅

## Dependency Notes
- Frontend versions selected from npm registry on 2026-03-08: React 19.2.4, TypeScript 5.9.3, Tauri API/CLI 2.10.1.
- Latest stable frontend selections with Node `24`: Vite 7.3.1, `@vitejs/plugin-react` 5.1.4, Tailwind 4.2.1, `@tailwindcss/vite` 4.2.1, Vitest 4.0.18, JSDOM 28.1.0.
- Added the missing local Tauri CLI package so `npm run tauri dev` resolves through `node_modules/.bin`.
- Rust versions selected from crates.io on 2026-03-08: tauri 2.10.3, tauri-build 2.5.6, rusqlite 0.38.0, tokio 1.50.0, tokio-util 0.7.18, tracing 0.1.44, tracing-subscriber 0.3.22, thiserror 2.0.18, uuid 1.22.0.
