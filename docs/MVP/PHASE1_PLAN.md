# Phase 1 Plan: Foundation, App Shell, and AI-Friendly Workflow

## Summary
Phase 1 should produce a runnable desktop shell with a strict architecture boundary between React UI and Rust services, a local SQLite-backed metadata store, deterministic mocked background work, and heavy debugging/testing scaffolding aimed at AI-agent development. The implementing agent must also create a root `todo.md` and keep it updated as the single progress ledger for the phase. All dependencies introduced in Phase 1 should use the latest stable versions available at implementation time, unless a newer version is blocked by Tauri or platform compatibility.

## Key Decisions And Defaults
- Use `Tauri + React + TypeScript + Vite` for the desktop shell and UI.
- Use `SQLite` for local app data and metadata.
- Use a heavy upfront AI-guardrail approach: repo playbooks, deterministic fixtures, unified verification scripts, and explicit architecture rules are part of Phase 1 deliverables.
- Use a contract-first testing posture: typed contract checks, component tests, persistence tests, and one automated shell smoke path before broader E2E coverage.
- Prefer explicit code over magic: no IPC code generation in Phase 1. Keep TS types and Rust payloads hand-authored, then enforce parity with fixture-based contract tests.
- Use the latest stable dependency versions at implementation time and record the chosen versions plus any compatibility pinning rationale in `todo.md` or the setup docs.

## Implementation Plan

### 1. Scaffold the repo and establish progress tracking
- Create the desktop app baseline with a React frontend and a Rust Tauri backend.
- Create a root `todo.md` before any substantial implementation work. It should contain:
  - a short Phase 1 objective,
  - an ordered checklist of deliverables,
  - current status markers for each item,
  - a blockers/decisions section,
  - a verification section listing commands and latest results.
- Treat `todo.md` as required workflow infrastructure: update it when starting a task, when completing a task, when discovering a blocker, and after each verification run.
- Establish a directory structure that is obvious to humans and agents: frontend app code, backend commands/services/persistence/tasks, shared contract types on the frontend, test fixtures, scripts, and docs.

### 2. Define the architecture rules and dependency policy on day one
- Document a short architecture contract in `docs/architecture` and mirror the key rules in the root `AGENTS.md` or equivalent repo guidance.
- The core rule is: React never performs heavy work directly and never owns persistence or database logic; Rust owns background tasks, persistence, and future database operations.
- Standardize three backend interaction patterns only:
  1. one-shot command returning a typed result,
  2. long-running job that emits progress events,
  3. cancellation of a long-running job.
- Standardize one frontend rule: UI components consume typed hooks/state only and do not call raw Tauri APIs directly except inside a dedicated IPC layer.
- Add an explicit dependency-selection rule: when adding any crate or package, choose the latest stable release compatible with the stack, avoid prereleases by default, and record exceptions with justification.

### 3. Lock the minimal shared contracts that future phases will extend
- Define the phase-1 contract shapes in TypeScript and Rust with matching names and field semantics.
- The minimum contracts to finalize now are:
  - `AppBootstrap`: app version, platform, environment, and feature flags.
  - `AppError`: stable error code, user-safe message, technical detail, retryable flag, and correlation id.
  - `BackgroundJobRequest`, `BackgroundJobStatus`, and `BackgroundJobProgressEvent`.
  - `ConnectionProfile` and `SecretRef` as placeholder future-facing models.
  - `HistoryEntry`, `SavedQuery`, and `SchemaCacheEntry` as persistence-facing records for later phases.
- Add JSON fixtures for each public payload shape and use them in tests so contract drift is obvious to AI agents.

### 4. Build the local persistence layer now
- Implement a Rust-owned SQLite layer with plain SQL migrations and a small repository API. Keep the schema human-readable and easy to inspect from the command line.
- Create the initial tables for app settings, saved connection metadata, saved queries, query history, schema cache, and migration state.
- Phase 1 only needs to actively use a subset of this storage, such as app settings and one demo history/event record, but the schema should be ready for later phases without redesign.
- Add a resettable dev database path and a deterministic seed path so tests and AI agents can recreate a known-good local state quickly.

### 5. Create an app shell that proves the future product layout
- Build a minimal but polished shell with stable layout regions for:
  - left sidebar for connections and schema,
  - top workspace/tab bar,
  - main editor area,
  - bottom results panel,
  - status bar for connection/job state.
- These regions can use placeholder content in Phase 1, but they must be real components with test ids, keyboard focus order, and clear ownership so later phases replace content rather than rewrite layout.
- Include a top-level error boundary, empty/loading/error UI states, and a visible debug/dev status indicator in development mode.

### 6. Prove responsiveness with mocked background work and cancellation
- Implement one deterministic long-running backend job, such as a mock query task, that emits progress on a timer and can be canceled.
- The UI should be able to start the job, show progress, cancel it, and remain interactive while the job is running. This is the acceptance proof for the “no UI freezes” architecture rule.
- Use this flow to validate the eventing model, correlation ids, loading state handling, and error presentation before any real PostgreSQL work begins.

### 7. Add first-class observability and debugging primitives
- Implement structured Rust logging with timestamps, levels, subsystem names, and correlation ids. Logs should go to stdout in development and to a predictable file location for later support/debug use.
- Add a small frontend logging utility that stamps feature name and action context, and forwards command/job correlation ids into UI-visible errors.
- Include a simple in-app developer diagnostics surface in development mode that shows recent job events, the current local DB path, and the last error.
- Write a short debugging playbook that tells an AI agent exactly where to look first: logs, local DB, contract fixtures, smoke scripts, `todo.md`, and the command that failed.

### 8. Make the repo easy for AI agents to verify without guessing
- Add one canonical verification entrypoint, for example `npm run verify`, that runs frontend typecheck/tests plus backend tests/checks in a deterministic order.
- Add one canonical shell smoke command, for example `npm run smoke:foundation`, that boots the app in a test-friendly mode and validates that the shell renders and the mock background job flow works.
- Add a `docs/ai/` section or equivalent with:
  - architecture summary,
  - verification commands,
  - dependency/version policy,
  - common failure modes,
  - fixture conventions,
  - rules for adding new commands/events/tests.
- Add a repo-local agent guide describing how to extend the app safely: where to put new code, how to add contracts, how to add a migration, how to add a mock before a real integration, and how to update `todo.md` during work.

## Important Public Interfaces And Conventions
- Backend commands should always return `Result<T, AppError>` semantics, never ad hoc strings or mixed payload shapes.
- Long-running work should use one job id and one correlation id consistently across logs, progress events, and UI state.
- New features in later phases must add fixture-backed contract examples before wiring UI behavior.
- Persistence migrations should be append-only and stored as plain SQL files.
- Frontend state should separate shell/UI state from backend-derived async state; avoid global state sprawl in Phase 1.
- `todo.md` is a required operational artifact for AI-agent work and should stay current throughout implementation.

## Test Plan
- Fresh clone bootstrap succeeds with one documented install/run path using current stable dependency versions.
- The desktop shell launches and renders all five layout regions.
- The mock background job can start, stream progress, complete, and cancel without freezing the UI.
- Contract tests fail if Rust and TypeScript payload shapes drift from the fixture examples.
- SQLite migrations apply cleanly on an empty database and can be rerun safely in tests.
- Error boundary and structured error UI behave correctly for a forced backend failure.
- Verification scripts run headlessly and produce deterministic pass/fail output that an AI agent can interpret without manual inspection.
- Logs include correlation ids that match the UI-visible failure or job instance.
- `todo.md` reflects the real implementation state and latest verification outcomes at the end of the phase.

## Explicit Deliverables
- Runnable Tauri app shell.
- Root `todo.md` with active progress tracking.
- Minimal persistence layer with migrations.
- Typed IPC layer and background-job event pattern.
- Structured logging and error model.
- Mock long-running task with cancellation.
- Root agent/developer guidance docs.
- AI-friendly fixtures and verification scripts.
- One architecture document that future phases must follow.
- Dependency manifests using latest stable compatible versions.

## Assumptions And Defaults
- Real PostgreSQL connectivity, schema introspection, Monaco integration, and result rendering are out of scope for Phase 1.
- Security work in Phase 1 is limited to creating the future-facing `SecretRef` contract and storage boundaries; actual keychain integration starts in Phase 2.
- The phase should optimize for debuggability over abstraction density: fewer layers, explicit names, plain SQL migrations, fixture-backed contracts, visible diagnostics, and an actively maintained `todo.md`.
- If a dependency’s latest stable version is incompatible with the selected stack, pin the newest compatible stable version and document the reason explicitly.
- If a choice is not forced by Phase 1, prefer the simpler option that is easier to test headlessly and easier for an AI agent to inspect from code, logs, scripts, and `todo.md`.
