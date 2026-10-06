import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Global styles first: component stylesheets (imported by App) must come after them in the cascade.
import './styles/theme.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/markdown.css';
import './styles/message.css';
import { App } from './App';
import { appStore, installUnloadGuard } from './state';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
// An export lives in memory only: closing or reloading the tab while one runs (or waits to be saved) needs a confirmation.
installUnloadGuard(appStore, window);
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
