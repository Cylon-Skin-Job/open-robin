import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import '@views/settings/styles/views.css';
import './styles/document.css';
import 'highlight.js/styles/github-dark.css';
import App from './components/App';
import { startClipboardMonitor } from './clipboard';

// Start monitoring clipboard for new content
// This requires clipboard read permission which the user may need to grant
startClipboardMonitor();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
