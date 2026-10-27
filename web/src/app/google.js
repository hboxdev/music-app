// Google sign-in for the website, using Google Identity Services (token model).
// Gives a short-lived access token for reading the user's YouTube playlists.
import { YOUTUBE_SCOPE } from '../shared/ytsync';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
export const googleConfigured = !!GOOGLE_CLIENT_ID;

const TOKEN_KEY = 'tubetunes:token';
let client = null;
let pending = null;

function readToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    return t && t.expiresAt > Date.now() + 60000 ? t : null;
  } catch {
    return null;
  }
}

// Load Google's script ahead of time: the sign-in popup must open
// straight from a click, with no waiting in between.
export function initGoogle() {
  if (!googleConfigured) return Promise.resolve(false);
  return new Promise((resolve) => {
    const start = () => {
      client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: YOUTUBE_SCOPE,
        callback: (r) => {
          if (!pending) return;
          if (r.error) pending.reject(new Error(r.error_description || 'Google sign-in failed.'));
          else {
            const t = { value: r.access_token, expiresAt: Date.now() + r.expires_in * 1000 };
            try {
              sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t));
            } catch {}
            pending.resolve(t.value);
          }
          pending = null;
        },
        error_callback: (e) => {
          if (!pending) return;
          pending.reject(new Error(e && e.type === 'popup_closed' ? 'Sign-in was cancelled.' : 'Google sign-in failed or the popup was blocked.'));
          pending = null;
        },
      });
      resolve(true);
    };
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return start();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = start;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

// Call directly from a click handler
export function getAccessToken({ forceNew = false } = {}) {
  const cached = !forceNew && readToken();
  if (cached) return Promise.resolve(cached.value);
  if (!client) return Promise.reject(new Error('Google sign-in is still loading. Try again in a moment.'));
  return new Promise((resolve, reject) => {
    pending = { resolve, reject };
    client.requestAccessToken({ prompt: '' });
  });
}

export function signOutGoogle() {
  const t = readToken();
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
  if (t && window.google && window.google.accounts) window.google.accounts.oauth2.revoke(t.value, () => {});
}
