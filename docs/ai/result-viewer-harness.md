# Result Viewer Harness

Use the browser harness when you need to inspect or iterate on the Phase 5 cached result viewer without launching Tauri or a live database session.

## Commands
- `npm run ui:harness`
  - Starts Vite on `http://127.0.0.1:4174`
  - Open `http://127.0.0.1:4174/?harness=results`
- `npm run smoke:results-browser`
  - Launches the harness in Playwright
  - Scrolls the grid, applies a quick filter, toggles sort, starts export, and writes a screenshot to `tmp/results-browser-smoke.png`

## Harness Scenarios
- `Command result`
  - Command-only query with no cached row set
- `Small completed rows`
  - Finished compact result set for density and empty-state checks
- `Large streaming rows`
  - Partial cached result with streaming copy and buffered-row counters
- `Large completed rows`
  - Full cached result for scrolling, sort, filter, and export interactions
- `Query failed`
  - Failed execution state before a usable row grid exists
- `Query cancelled`
  - Cancelled execution with partial cache metadata
- `Export running`
  - Completed result set with an active export
- `Export failed`
  - Completed result set with a failed export event

## Agent Loop
1. Run `npm run ui:harness`.
2. Open `http://127.0.0.1:4174/?harness=results` in `agent-browser` or a Playwright MCP client.
3. Select the scenario from `data-testid="harness-scenario-select"`.
4. Drive the grid with these stable targets:
   - `data-testid="query-result-grid-scroll"`
   - `data-testid="result-quick-filter"`
   - `data-testid="result-column-0"` through `data-testid="result-column-N"`
   - `data-testid="result-filter-0"` through `data-testid="result-filter-N"`
   - `data-testid="result-export-path"`
   - `data-testid="result-export-button"`
   - `data-testid="cancel-result-export-button"`
5. Capture screenshots after any meaningful interaction loop so visual regressions are inspectable in the thread.

## Debug Notes
- The harness does not call Tauri. It reuses the real `QueryResultsPanel` with deterministic mocked workspace state.
- Sort and filter semantics match Phase 5 viewer behavior: single-column sort, global quick filter, and per-column `contains` filters.
- If `npm run smoke:results-browser` fails with a Playwright executable error, install Chromium once with `npx playwright install chromium`.
