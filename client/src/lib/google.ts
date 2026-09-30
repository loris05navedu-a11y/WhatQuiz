import { ApiError } from '../api/errors';
import { STANDALONE } from './backend';

/**
 * Connexion Google via Firebase Authentication, sur le même projet que Furious-Tube : un compte Google
 * est reconnu sur les deux sites. Firebase vérifie l'identité auprès de Google ; WhatQuiz ouvre ensuite
 * (ou crée) le compte correspondant sur cet appareil.
 */
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCwx5B5bNhENGsUZfeIyXnlBQ8y2ii9Czk',
  authDomain: 'furioustube-9d498.firebaseapp.com',
  projectId: 'furioustube-9d498',
  appId: '1:639306506723:web:e641526bf652cbc60700d6',
};

export interface GoogleProfile {
  uid: string;
  email: string;
  displayName: string;
}

/** Google refuse la connexion dans une WebView (l'APK Android) : le bouton n'y est pas proposé. */
export const GOOGLE_AVAILABLE = STANDALONE && typeof navigator !== 'undefined' && !navigator.userAgent.includes('WhatQuizAndroid');

type FirebaseAuth = typeof import('firebase/auth');
let loaded: Promise<{ auth: import('firebase/auth').Auth; sdk: FirebaseAuth }> | null = null;

/** À appeler à l'affichage de la page : la fenêtre Google doit s'ouvrir dès le clic, sans attendre un téléchargement. */
export function preloadGoogle() {
  loaded ??= Promise.all([import('firebase/app'), import('firebase/auth')]).then(([app, sdk]) => {
    const auth = sdk.getAuth(app.initializeApp(FIREBASE_CONFIG, 'whatquiz'));
    auth.languageCode = 'fr';
    return { auth, sdk };
  });
  return loaded;
}

const MESSAGES: Record<string, string> = {
  'auth/popup-closed-by-user': 'Connexion Google annulée',
  'auth/cancelled-popup-request': 'Connexion Google annulée',
  'auth/popup-blocked': 'Le navigateur a bloqué la fenêtre Google : autorisez les fenêtres pour ce site puis réessayez',
  'auth/network-request-failed': 'Problème de connexion Internet',
  'auth/operation-not-allowed': 'La connexion Google n’est pas encore activée dans Firebase (Authentication → Sign-in method → Google)',
  'auth/unauthorized-domain': 'Ce site n’est pas autorisé dans Firebase (Authentication → Paramètres → Domaines autorisés)',
};

export async function signInWithGoogle(): Promise<GoogleProfile> {
  const { auth, sdk } = await preloadGoogle();
  try {
    const provider = new sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const { user } = await sdk.signInWithPopup(auth, provider);
    if (!user.email || !user.emailVerified) throw new ApiError(400, 'Ce compte Google n’a pas d’adresse e-mail vérifiée');
    return { uid: user.uid, email: user.email, displayName: user.displayName ?? user.email.split('@')[0] };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const code = (error as { code?: string }).code ?? '';
    throw new ApiError(0, MESSAGES[code] ?? 'Connexion Google impossible, réessayez');
  }
}

export async function signOutGoogle(): Promise<void> {
  if (!loaded) return;
  const { auth, sdk } = await loaded;
  await sdk.signOut(auth).catch(() => undefined);
}
