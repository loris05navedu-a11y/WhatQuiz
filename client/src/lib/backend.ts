import { readStorage, writeStorage } from './storage';

/**
 * Adresse du serveur WhatQuiz quand le site est hébergé ailleurs (GitHub Pages) : définie à la compilation par
 * VITE_API_URL. Vide = le site est servi par le serveur lui-même (Termux, PC…) et tout passe par la même origine.
 */
export const API_ORIGIN = (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '');

/** Le site est hébergé séparément du serveur : l'authentification passe par un jeton et non par un cookie. */
export const SEPARATE_BACKEND = API_ORIGIN !== '';

/** Chemin de base du site (ex. /WhatQuiz/ sur GitHub Pages). */
export const BASE_PATH = import.meta.env.BASE_URL;

const TOKEN_KEY = 'wq:token';

export const getToken = (): string | null => (SEPARATE_BACKEND ? readStorage('local', TOKEN_KEY) : null);
export const setToken = (token: string | null): void => writeStorage('local', TOKEN_KEY, token);

/** Les images envoyées (/uploads/…) sont stockées sur le serveur, pas sur le site statique. */
export function assetUrl(url: string): string;
export function assetUrl(url: string | null): string | null;
export function assetUrl(url: string | null): string | null {
  return url && SEPARATE_BACKEND && url.startsWith('/uploads/') ? API_ORIGIN + url : url;
}

/** Adresse publique du site, à communiquer aux élèves (code QR). */
export const siteOrigin = (): string => window.location.origin + BASE_PATH.replace(/\/$/, '');
