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

/** À appeler à l'affichage de la page : la fenêtre Google doit s'ouvrir dès le clic, sans attendre un téléchargement. */
export function preloadFirebase() {
  loaded ??= Promise.all([import('firebase/app'), import('firebase/auth')]).then(([app, sdk]) => {
    // Application Firebase par défaut, comme Furious-Tube : la session ouverte sur l'un est reconnue par l'autre.
    const auth = sdk.getAuth(app.getApps()[0] ?? app.initializeApp(FIREBASE_CONFIG));
    auth.languageCode = 'fr';
    return { auth, sdk };
  });
  return loaded;
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
};

function readable(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string }).code ?? '';
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

/** Connexion avec l'e-mail et le mot de passe d'un compte Furious-Tube. */
export async function signInWithFuriousTube(email: string, password: string): Promise<FirebaseProfile> {
  const { auth, sdk } = await preloadFirebase();
  try {
    return toProfile((await sdk.signInWithEmailAndPassword(auth, email.trim(), password)).user);
  } catch (error) {
    throw readable(error);
  }
}
