# Dependency Policy

## Rule
Use the latest stable version of every dependency unless the newest stable release is incompatible with the current stack or machine constraints. If a compatibility pin is required, record the reason in `todo.md`.

## Current Baseline
- The repo now targets Node `24` and includes a root `.node-version` file for `fnm`.
- Current latest stable frontend selections under that baseline are `vite 7.3.1`, `@vitejs/plugin-react 5.1.4`, `tailwindcss 4.2.1`, `@tailwindcss/vite 4.2.1`, `jsdom 28.1.0`, and `vitest 4.0.18`.

## Selection Habit
1. Query the registry for the latest stable release.
2. Check runtime/tooling compatibility on the current machine.
3. If `fnm` is available, run `fnm use` so the shell picks up the repo’s Node baseline before installing or verifying.
4. Pin the newest compatible stable version only if the absolute latest stable release is not usable, and record the reason immediately.
