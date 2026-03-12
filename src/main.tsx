import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { ResultViewerHarness } from './features/query/ResultViewerHarness';
import './styles.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container #root was not found.');
}

const params = new URL(window.location.href).searchParams;
const isResultViewerHarness = params.get('harness') === 'results';

createRoot(container).render(
  <StrictMode>
    {isResultViewerHarness ? <ResultViewerHarness /> : <App />}
  </StrictMode>,
);
