import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getLang } from './i18n';
import { captureInstallPrompt } from './screens/InstallGuide';
import './styles/global.css';
import './styles/app.css';

document.documentElement.lang = getLang();
captureInstallPrompt();

// Service worker : fonctionnement hors-ligne et installation (production uniquement).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      reg?.addEventListener('updatefound', () => {
        const sw = reg.installing;
        sw?.addEventListener('statechange', () => {
          // Nouvelle version : activée au prochain lancement, sans interrompre un relevé.
          if (sw.state === 'installed' && navigator.serviceWorker.controller) sw.postMessage('skipWaiting');
        });
      });
    }).catch(() => undefined); // hébergement sans service worker : l'appli fonctionne quand même en ligne
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
