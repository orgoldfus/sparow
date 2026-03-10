# Sparow Agent Guide

## Guiding Document
Always read and follow `NORTH_STAR.md` before making architectural or product decisions. It defines the project vision, core principles, and constraints. When in doubt, defer to NORTH_STAR.

## Objective
Build the fastest possible path to a responsive desktop database client without hiding behavior behind magic. Speed, clarity, and usability trump feature count.

## Non-Negotiable Rules
- Update `todo.md` when work starts, when a task completes, when a blocker appears, and after every verification run.
- Keep React focused on typed presentation and state orchestration. Heavy work, persistence, and future database logic stays in Rust.
- Add new frontend/backend boundary payloads in both languages explicitly. Then add JSON fixtures and tests before wiring UI behavior.
- Keep migrations append-only and written as plain SQL.
- Prefer deterministic mocks before real integrations.
- Never block the UI thread. If something slows down the UI, treat it as a bug.

## Code Quality Standards
Write professional, production-grade code at all times. Follow these principles:

### General
- **DRY** — Don't Repeat Yourself. Extract shared logic into reusable functions/modules.
- **KISS** — Keep It Simple. Prefer straightforward solutions over clever ones.
- **YAGNI** — Don't build what isn't needed yet.
- **Single Responsibility** — Each module, function, and component should do one thing well.
- **Meaningful naming** — Variables, functions, types, and files should have clear, descriptive names.
- **Small functions** — Break complex logic into small, testable units.
- **Fail early and explicitly** — Validate inputs and surface errors at the boundary, not deep inside.

### Rust
- Use idiomatic Rust: leverage the type system, enums, pattern matching, and `Result`/`Option` over sentinel values.
- Prefer owned types at API boundaries; borrow internally.
- Use `thiserror` for library errors and `anyhow` only in top-level command handlers.
- Keep `unsafe` to an absolute minimum and document the invariant when used.
- Derive `Debug`, `Clone`, `Serialize`, `Deserialize` on public types where appropriate.
- Write doc comments (`///`) on all public items.
- Run `cargo clippy` and address all warnings.

### React / TypeScript
- Use strict TypeScript (`strict: true`). No `any` unless absolutely unavoidable (and annotated with a comment explaining why).
- Prefer functional components with hooks. No class components.
- Co-locate related code: component, styles, types, and tests together.
- Keep components small and focused. Extract logic into custom hooks.
- Memoize expensive computations (`useMemo`, `useCallback`) only when profiling shows a need — don't prematurely optimize.
- Use descriptive prop types; avoid passing generic objects.
- Accessibility matters: use semantic HTML and ARIA attributes where needed.

## Canonical Commands
- `fnm use`
- `npm run verify`
- `npm run smoke:foundation`
- `cargo test --manifest-path src-tauri/Cargo.toml`
- `npm run tauri dev`

## Repo Layout
- `.node-version`: Node runtime target for `fnm`.
- `src/`: React shell, IPC client, diagnostics UI, tests.
- `src-tauri/src/`: Rust commands, state, logging, jobs, and persistence.
- `fixtures/contracts/`: Shared JSON fixtures for boundary payloads.
- `docs/architecture/`: Architecture and module-boundary rules.
- `docs/ai/`: Verification, debugging, and dependency policy notes.

## Common Extension Workflow
1. Add or update a contract in Rust and TypeScript.
2. Add or update the matching JSON fixture.
3. Add runtime validation or deserialization tests on both sides.
4. Implement the backend behavior behind a typed command or event.
5. Wire the frontend through `src/lib/ipc.ts`, not directly from components.
6. Run `npm run verify`.
