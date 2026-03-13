import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ResultViewerHarness } from './features/query/ResultViewerHarness';
import { ShellHarness } from './features/shell/ShellHarness';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root was not found.');
}

const params = new URL(window.location.href).searchParams;
const isResultViewerHarness = params.get('harness') === 'results';
const isShellHarness = params.get('harness') === 'shell';

createRoot(container).render(
  isResultViewerHarness ? (
    <ResultViewerHarness />
  ) : isShellHarness ? (
    <ShellHarness />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
