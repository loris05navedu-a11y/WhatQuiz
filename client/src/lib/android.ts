/**
 * Pont avec l'application Android (APK) : `window.WhatQuizAndroid`, injecté par la WebView.
 * Les fonctions récentes peuvent manquer sur une ancienne version de l'APK : on vérifie toujours avant d'appeler.
 */
export interface AndroidBridge {
  saveFile(fileName: string, mimeType: string, base64: string): void;
  retry?(): void;
  /** Version de l'application (APK 1.2+). */
  version?(): string;
  /** Épingle (ou libère) l'application à l'écran : l'élève ne peut plus en sortir sans le geste système. */
  pin?(on: boolean): void;
  isPinned?(): boolean;
  /** L'application partage l'écran avec une autre (écran partagé, fenêtre flottante). */
  isInMultiWindow?(): boolean;
  /** Partie surveillée : écran toujours allumé et captures d'écran bloquées. */
  gameMode?(on: boolean): void;
}

declare global {
  interface Window {
    WhatQuizAndroid?: AndroidBridge;
  }
}

/** Signaux envoyés par l'application Android : `window` reçoit l'événement `whatquiz-native` (detail = signal). */
export const NATIVE_EVENT = 'whatquiz-native';
export type NativeSignal =
  | 'pause'
  | 'resume'
  | 'stop'
  | 'leave'
  | 'focus'
  | 'unfocus'
  | 'multiwindow-on'
  | 'multiwindow-off'
  | 'screen-off'
  | 'pinned'
  | 'unpinned';

export const androidBridge = (): AndroidBridge | null => (typeof window !== 'undefined' ? (window.WhatQuizAndroid ?? null) : null);

/** Le site tourne dans l'application Android (et non dans un navigateur). */
export const isAndroidApp = (): boolean =>
  androidBridge() !== null || (typeof navigator !== 'undefined' && navigator.userAgent.includes('WhatQuizAndroid'));

function call<T>(work: (bridge: AndroidBridge) => T | undefined): T | undefined {
  try {
    const bridge = androidBridge();
    return bridge ? work(bridge) : undefined;
  } catch {
    return undefined;
  }
}

export const androidPin = (on: boolean): boolean => call((b) => (typeof b.pin === 'function' ? (b.pin(on), true) : undefined)) ?? false;
export const androidIsPinned = (): boolean | undefined => call((b) => (typeof b.isPinned === 'function' ? b.isPinned() : undefined));
export const androidInMultiWindow = (): boolean => call((b) => (typeof b.isInMultiWindow === 'function' ? b.isInMultiWindow() : undefined)) ?? false;
export const androidCanPin = (): boolean => call((b) => typeof b.pin === 'function') ?? false;
export const androidGameMode = (on: boolean): void => void call((b) => (typeof b.gameMode === 'function' ? b.gameMode(on) : undefined));
