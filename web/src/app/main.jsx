import { createRoot } from 'react-dom/client';
import App from './App';
import './app.css';

createRoot(document.getElementById('root')).render(<App />);

// Makes the web app installable as a desktop/phone app (not in `npm run dev`,
// where a cached copy would hide your changes)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('../sw.js', { scope: './' }).catch(() => {});
  });
}
