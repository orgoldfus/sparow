# Phase 1 Foundation Architecture

## Purpose
Phase 1 proves the app shell and the rules that protect responsiveness. It is intentionally more about boundaries and observability than feature depth.

## Runtime Boundary
- React owns layout, interaction state, and rendering.
- Rust owns persistence, background tasks, logging, and future database integrations.
- Tauri commands expose one-shot requests.
- Tauri events expose long-running job progress.
- Cancellation is a first-class command, not a UI-only state change.

## Directory Responsibilities
- `src/App.tsx`: bootstraps the shell and subscribes to job events.
- `src/lib/contracts.ts`: TypeScript contract shapes and runtime guards.
- `src/lib/ipc.ts`: the only place frontend code talks to Tauri APIs.
- `src/features/`: shell regions and diagnostics surfaces.
- `src-tauri/src/commands/`: Tauri command entrypoints.
- `src-tauri/src/foundation/`: app state, typed Rust payloads, job lifecycle, logging.
- `src-tauri/src/persistence/`: SQLite repository and migrations.

## Data Flow
1. The React app calls `bootstrap_app`.
2. Rust returns storage paths, diagnostics state, and sample counts.
3. The UI renders a shell with stable regions and a diagnostics panel.
4. The user starts `start_mock_job`.
5. Rust spawns a background task, emits progress events, and records history.
6. The UI remains interactive while it listens for `foundation://job-progress`.
7. `cancel_mock_job` stops active work via a cancellation token.

## Design Constraints
- Keep file formats and payloads readable from a terminal.
- Every boundary shape must be testable without launching the full desktop shell.
- Prefer explicit state transitions over framework magic.
- Failures should surface with correlation ids and predictable log/database paths.
