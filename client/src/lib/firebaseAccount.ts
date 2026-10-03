import { ApiError } from '../api/errors';
import { STANDALONE } from './backend';

/**
 * Comptes partagés avec Furious-Tube : même projet Firebase et même adresse de site (loris05navedu-a11y.github.io),
 * donc même session. Un compte Furious-Tube (e-mail ou Google) ouvre WhatQuiz sans inscription ; Firebase vérifie
 * l'identité, puis WhatQuiz ouvre (ou crée) le compte correspondant sur cet appareil.
 */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCwx5B5bNhENGsUZfeIyXnlBQ8y2ii9Czk',
  authDomain: 'furioustube-9d498.firebaseapp.com',
  projectId: 'furioustube-9d498',
  appId: '1:639306506723:web:e641526bf652cbc60700d6',
};

export interface FirebaseProfile {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
}

/** Comptes Furious-Tube acceptés (mode sans serveur, celui de GitHub Pages). */
export const FIREBASE_ACCOUNTS = STANDALONE;
/** Google refuse sa connexion dans une WebView (l'APK Android) : le bouton Google n'y est pas proposé. */
export const GOOGLE_AVAILABLE = FIREBASE_ACCOUNTS && typeof navigator !== 'undefined' && !navigator.userAgent.includes('WhatQuizAndroid');

type Sdk = typeof import('firebase/auth');
let loaded: Promise<{ auth: import('firebase/auth').Auth; sdk: Sdk }> | null = null;

/** Tests uniquement : émulateurs Firebase locaux (jamais défini dans le site publié). */
const EMULATOR_HOST: string | undefined = import.meta.env.VITE_FIREBASE_EMULATOR || undefined;

function firebaseApp(app: typeof import('firebase/app')) {
  // Application Firebase par défaut, comme Furious-Tube : la session ouverte sur l'un est reconnue par l'autre.
  return app.getApps()[0] ?? app.initializeApp(FIREBASE_CONFIG);
}

/** À appeler à l'affichage de la page : la fenêtre Google doit s'ouvrir dès le clic, sans attendre un téléchargement. */
export function preloadFirebase() {
  loaded ??= Promise.all([import('firebase/app'), import('firebase/auth')]).then(([app, sdk]) => {
    const auth = sdk.getAuth(firebaseApp(app));
    if (EMULATOR_HOST) sdk.connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    auth.languageCode = 'fr';
    return { auth, sdk };
  });
  return loaded;
}

type StoreSdk = typeof import('firebase/firestore');
let store: Promise<{ db: import('firebase/firestore').Firestore; sdk: StoreSdk }> | null = null;

/** Base Firestore du projet (sauvegarde des comptes). Chargée seulement quand un compte synchronisé est ouvert. */
export function loadFirestore() {
  store ??= Promise.all([import('firebase/app'), import('firebase/firestore'), preloadFirebase()]).then(([app, sdk]) => {
    const db = sdk.getFirestore(firebaseApp(app));
    if (EMULATOR_HOST) sdk.connectFirestoreEmulator(db, EMULATOR_HOST, 8080);
    return { db, sdk };
  });
  return store;
}

/** Identifiant Firebase du compte connecté dans ce navigateur (null : aucun). */
export async function firebaseUid(): Promise<string | null> {
  const { auth } = await preloadFirebase();
  await auth.authStateReady();
  return auth.currentUser?.uid ?? null;
}

function toProfile(user: import('firebase/auth').User): FirebaseProfile {
  if (!user.email) throw new ApiError(400, 'Ce compte n’a pas d’adresse e-mail');
  return { uid: user.uid, email: user.email, emailVerified: user.emailVerified, displayName: user.displayName ?? user.email.split('@')[0] };
}

const MESSAGES: Record<string, string> = {
  'auth/popup-closed-by-user': 'Connexion Google annulée',
  'auth/cancelled-popup-request': 'Connexion Google annulée',
  'auth/popup-blocked': 'Le navigateur a bloqué la fenêtre Google : autorisez les fenêtres pour ce site puis réessayez',
  'auth/network-request-failed': 'Problème de connexion Internet',
  'auth/too-many-requests': 'Trop de tentatives, réessayez dans quelques minutes',
  'auth/user-disabled': 'Ce compte Furious-Tube a été désactivé',
  'auth/operation-not-allowed': 'Ce mode de connexion n’est pas activé dans Firebase (Authentication → Sign-in method)',
  'auth/unauthorized-domain': 'Ce site n’est pas autorisé dans Firebase (Authentication → Paramètres → Domaines autorisés)',
  'auth/email-already-in-use': 'Un compte existe déjà avec cette adresse : connectez-vous avec son mot de passe',
  'auth/weak-password': 'Mot de passe trop faible (6 caractères minimum)',
  'auth/invalid-email': 'Adresse e-mail invalide',
  'auth/requires-recent-login': 'Reconnectez-vous puis recommencez',
};

function readable(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string }).code ?? '';
  if (code === 'auth/email-already-in-use') return new ApiError(409, MESSAGES[code]);
  if (code === 'auth/weak-password' || code === 'auth/invalid-email') return new ApiError(400, MESSAGES[code]);
  return new ApiError(code.includes('credential') || code.includes('password') || code.includes('user-not-found') ? 401 : 0, MESSAGES[code] ?? 'Connexion impossible, réessayez');
}

/** Compte Furious-Tube déjà connecté dans ce navigateur, s'il y en a un. */
export async function currentFuriousTubeAccount(): Promise<FirebaseProfile | null> {
  const { auth } = await preloadFirebase();
  await auth.authStateReady();
  return auth.currentUser?.email ? toProfile(auth.currentUser) : null;
}

export async function signInWithGoogle(): Promise<FirebaseProfile> {
  const { auth, sdk } = await preloadFirebase();
  try {
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return toProfile((await sdk.signInWithPopup(auth, provider)).user);
  } catch (error) {
    throw readable(error);
  }
}

/** Connexion avec l'e-mail et le mot de passe d'un compte en ligne (WhatQuiz ou Furious-Tube). */
export async function signInWithFuriousTube(email: string, password: string): Promise<FirebaseProfile> {
  const { auth, sdk } = await preloadFirebase();
  try {
    return toProfile((await sdk.signInWithEmailAndPassword(auth, email.trim(), password)).user);
  } catch (error) {
    throw readable(error);
  }
}

export const signInWithEmail = signInWithFuriousTube;

/** Création du compte en ligne : le même e-mail et le même mot de passe ouvrent le compte sur le site et dans l'application. */
export async function createOnlineAccount(email: string, password: string, displayName: string): Promise<FirebaseProfile> {
  const { auth, sdk } = await preloadFirebase();
  try {
    const { user } = await sdk.createUserWithEmailAndPassword(auth, email.trim(), password);
    await sdk.updateProfile(user, { displayName }).catch(() => undefined);
    return { ...toProfile(user), displayName };
  } catch (error) {
    throw readable(error);
  }
}

/**
 * Relie un compte de cet appareil à un compte en ligne (mêmes identifiants) : connexion, ou création si l'adresse
 * est libre. Renvoie null si l'adresse appartient déjà à un compte en ligne avec un autre mot de passe.
 */
export async function connectOnlineAccount(email: string, password: string, displayName: string): Promise<FirebaseProfile | null> {
  try {
    return await signInWithEmail(email, password);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  try {
    return await createOnlineAccount(email, password, displayName);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return null;
    throw error;
  }
}

/** E-mail de réinitialisation du mot de passe du compte en ligne. */
export async function sendPasswordReset(email: string): Promise<void> {
  const { auth, sdk } = await preloadFirebase();
  try {
    await sdk.sendPasswordResetEmail(auth, email.trim());
  } catch (error) {
    throw readable(error);
  }
}

/** Mot de passe changé sur WhatQuiz : le compte en ligne suit (ajouté s'il n'en avait pas, ex. compte Google). */
export async function changeOnlinePassword(currentPassword: string, newPassword: string): Promise<void> {
  const { auth, sdk } = await preloadFirebase();
  const user = auth.currentUser;
  if (!user?.email) return;
  try {
    const hasPassword = user.providerData.some((p) => p.providerId === 'password');
    if (!hasPassword) {
      await sdk.linkWithCredential(user, sdk.EmailAuthProvider.credential(user.email, newPassword));
      return;
    }
    await sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, currentPassword));
    await sdk.updatePassword(user, newPassword);
  } catch (error) {
    throw readable(error);
  }
}
