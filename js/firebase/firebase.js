/* ============================================================
   Horizon City — js/firebase/firebase.js
   Firebase app initialisation, Authentication (Google,
   GitHub, Email/Password), and the SaveManager cloud-sync
   bridge for cross-device saves via Firestore.

   Dependencies: Firebase SDK v10 compat loaded via CDN
   script tags in index.html before this module runs.
   No imports from other game files — this is a foundation layer.
   ============================================================ */

import { saveManager } from '../save/SaveManager.js';

// ─── Firebase project config ────────────────────────────────
// Injected at deploy time by GitHub Actions from repository secrets.
// Never commit real values — edit config.js only via the workflow.
import { firebaseConfig } from '../config.js';

// ─── Exported singletons ────────────────────────────────────
export let firebaseApp  = null;
export let auth         = null;
export let db           = null;
export let currentUser  = null;   // null = guest/offline

// ─── Auth providers (lazy-initialised inside initFirebase) ──
let googleProvider  = null;
let githubProvider  = null;

// ─── Internal helpers ────────────────────────────────────────

/**
 * Read the cloud save for the currently signed-in user.
 * Returns the save object or null if none exists yet.
 * Defined early so the onAuthStateChanged bridge can call it.
 */
async function _pullSave() {
  if (!currentUser) return null;
  try {
    const doc = await db
      .collection('users')
      .doc(currentUser.uid)
      .collection('saveData')
      .doc('save')
      .get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    console.warn('[Firebase] pullSave failed:', err);
    return null;
  }
}

/**
 * Write a save object to Firestore for the current user.
 * Uses merge so partial writes never wipe existing fields.
 */
async function _pushSave(saveData) {
  if (!currentUser) return;
  try {
    await db
      .collection('users')
      .doc(currentUser.uid)
      .collection('saveData')
      .doc('save')
      .set(saveData, { merge: true });
  } catch (err) {
    console.warn('[Firebase] pushSave failed:', err);
  }
}

// ─── Exported API ────────────────────────────────────────────

/**
 * initFirebase()
 * Initialises the Firebase app and Auth, then sets up the
 * onAuthStateChanged listener that drives the cloud-save bridge.
 * Call once from main.js before anything else.
 */
export async function initFirebase() {
  // Guard against double-init (hot-reload scenarios)
  if (firebaseApp) return;

  // Skip Firebase entirely if config is placeholder (local dev / undeployed build)
  if (!firebaseConfig.apiKey || firebaseConfig.apiKey === 'PLACEHOLDER') {
    console.warn('[Firebase] Placeholder config detected — running in offline/guest mode. Cloud saves disabled.');
    return;
  }

  try {
  firebaseApp = firebase.initializeApp(firebaseConfig);
  auth        = firebase.auth();
  db          = firebase.firestore();

  googleProvider = new firebase.auth.GoogleAuthProvider();
  githubProvider = new firebase.auth.GithubAuthProvider();

  // Auth state bridge — runs once on page load (existing session)
  // and again any time the user signs in or out.
  await new Promise((resolve) => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      currentUser = user;

      if (user) {
        console.log('[Firebase] Signed in as', user.displayName ?? user.email);

        // Try to load cloud save and overwrite local if found.
        const cloudSave = await _pullSave();
        if (cloudSave) {
          saveManager.importJSON(cloudSave);
          console.log('[Firebase] Cloud save loaded.');
        } else {
          // No cloud save yet — seed it from local data.
          await _pushSave(saveManager.exportJSON());
          console.log('[Firebase] Local save seeded to cloud.');
        }
      } else {
        console.log('[Firebase] Signed out / guest mode.');
      }

      // Resolve on first auth state resolution so main.js can await.
      unsubscribe();
      resolve();
    });
  });
  } catch (err) {
    console.warn('[Firebase] init failed — running in offline/guest mode.', err.message);
    firebaseApp = null; auth = null; db = null;
  }
}

/**
 * signInWithGoogle()
 * Opens the Google OAuth popup and waits for the result.
 */
export async function signInWithGoogle() {
  try {
    const result = await auth.signInWithPopup(googleProvider);
    currentUser = result.user;
    return result;
  } catch (err) {
    console.error('[Firebase] Google sign-in failed:', err);
    throw err;
  }
}

/**
 * signInWithGitHub()
 * Opens the GitHub OAuth popup and waits for the result.
 */
export async function signInWithGitHub() {
  try {
    const result = await auth.signInWithPopup(githubProvider);
    currentUser = result.user;
    return result;
  } catch (err) {
    console.error('[Firebase] GitHub sign-in failed:', err);
    throw err;
  }
}

/**
 * signInWithEmail(email, password)
 * Signs in with email/password credentials.
 * Returns the UserCredential or throws on failure.
 */
export async function signInWithEmail(email, password) {
  try {
    const result = await auth.signInWithEmailAndPassword(email, password);
    currentUser = result.user;
    return result;
  } catch (err) {
    console.error('[Firebase] Email sign-in failed:', err);
    throw err;
  }
}

/**
 * createAccount(email, password)
 * Creates a new email/password account.
 * Returns the UserCredential or throws on failure.
 */
export async function createAccount(email, password) {
  try {
    const result = await auth.createUserWithEmailAndPassword(email, password);
    currentUser = result.user;
    return result;
  } catch (err) {
    console.error('[Firebase] Account creation failed:', err);
    throw err;
  }
}

/**
 * signOut()
 * Signs the current user out and clears currentUser.
 */
export async function signOut() {
  try {
    await auth.signOut();
    currentUser = null;
  } catch (err) {
    console.error('[Firebase] Sign-out failed:', err);
    throw err;
  }
}

/**
 * pushSaveToCloud(saveData)
 * Writes saveData to Firestore at users/{uid}/saveData/save.
 * Merges so partial writes never wipe existing fields.
 * No-ops silently if the player is offline / not signed in.
 */
export async function pushSaveToCloud(saveData) {
  await _pushSave(saveData);
}

/**
 * pullSaveFromCloud()
 * Reads users/{uid}/saveData/save from Firestore.
 * Returns the save object, or null if no cloud save exists yet.
 * Called by main.js after auth resolves on startup.
 */
export async function pullSaveFromCloud() {
  return await _pullSave();
}
