// Google sign-in for the phone app. Gives an access token for reading the
// user's YouTube playlists (read-only).
//
// The sign-in library is native code, so it only exists in the installed app
// (EAS build). In Expo Go it is missing and sign-in shows a friendly message.
import { GOOGLE_WEB_CLIENT_ID } from './config';
import { YOUTUBE_SCOPE } from './ytsync';

let GoogleSignin = null;
try {
  GoogleSignin = require('@react-native-google-signin/google-signin').GoogleSignin;
} catch {}

export const googleAvailable = !!GoogleSignin;

let configured = false;
function setup() {
  if (!GoogleSignin) throw new Error('YouTube sign-in works in the installed TubeTunes app, not in Expo Go.');
  if (!GOOGLE_WEB_CLIENT_ID) throw new Error('Google sign-in is not set up yet: add the Client ID in src/config.js.');
  if (!configured) {
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, scopes: [YOUTUBE_SCOPE] });
    configured = true;
  }
}

// interactive: false = only use an existing sign-in (for background syncs)
export async function getAccessToken({ interactive = true } = {}) {
  setup();
  let signedIn = false;
  try {
    signedIn = (await GoogleSignin.signInSilently()).type === 'success';
  } catch {}
  if (!signedIn) {
    if (!interactive) throw new Error('Not signed in.');
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') throw new Error('Sign-in was cancelled.');
  }
  const { accessToken } = await GoogleSignin.getTokens();
  return accessToken;
}

// Forget a token YouTube rejected, so the next request gets a fresh one
export async function dropToken(token) {
  try {
    await GoogleSignin.clearCachedAccessToken(token);
  } catch {}
}

export async function signOutGoogle() {
  if (!GoogleSignin) return;
  try {
    setup();
    await GoogleSignin.revokeAccess();
  } catch {}
  try {
    await GoogleSignin.signOut();
  } catch {}
}
