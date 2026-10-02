import { PRESENCE_BEAT_MS, PRESENCE_BLUR_GRACE_MS, PRESENCE_SEVERITY, stateForReason, type AwayReason, type PresenceReport } from '../../../shared/presence';
import { androidInMultiWindow, androidIsPinned, isAndroidApp, NATIVE_EVENT, type NativeSignal } from '../lib/android';

export interface PresenceWatchOptions {
  send(report: PresenceReport): void;
  /** L'élève vient de quitter la partie (première sortie d'une absence). */
  onAway?(reason: AwayReason): void;
  /** L'élève revient (fin de l'absence). */
  onBack?(reason: AwayReason): void;
}

export interface PresenceWatch {
  /** Renvoie l'état courant (après une reconnexion). */
  resync(): void;
  stop(): void;
}

/** Élément qui garde légitimement le focus hors de la page : vidéo intégrée, liste déroulante, sélecteur de fichier. */
function focusStaysInPage(): boolean {
  const element = document.activeElement;
  if (!element) return false;
  if (element.tagName === 'IFRAME' || element.tagName === 'SELECT') return true;
  return element instanceof HTMLInputElement && element.type === 'file';
}

/**
 * Détecte, sur l'appareil de l'élève, toute sortie de la partie et la signale à l'hôte :
 * onglet ou application en arrière-plan, page fermée, autre fenêtre au premier plan, écran partagé,
 * plus les signaux du système quand la page tourne dans l'application Android.
 * Un signe de vie part toutes les 2 s : s'il cesse, l'hôte déclare l'élève injoignable de lui-même.
 */
export function watchPresence({ send, onAway, onBack }: PresenceWatchOptions): PresenceWatch {
  const app = isAndroidApp();
  let away: AwayReason | null = null;
  let multiWindow = app && androidInMultiWindow();
  let lostFocusAt: number | null = null;
  let blurTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const report = (reason: AwayReason) => {
    if (stopped) return;
    if (away !== null && PRESENCE_SEVERITY[stateForReason(reason)] <= PRESENCE_SEVERITY[stateForReason(away)]) return;
    const first = away === null;
    away = reason;
    send({ s: 'away', r: reason, app });
    if (first) onAway?.(reason);
  };

  const clear = () => {
    if (stopped || away === null) return;
    const reason = away;
    away = null;
    lostFocusAt = null;
    send({ s: 'back', app });
    onBack?.(reason);
  };

  const cancelBlur = () => {
    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = null;
  };

  /** Perte de focus : signalée seulement si elle dure (menus, clavier, boîtes de dialogue système). */
  const scheduleBlurCheck = (reason: 'blur' | 'app-unfocus') => {
    lostFocusAt ??= Date.now();
    cancelBlur();
    blurTimer = setTimeout(() => {
      blurTimer = null;
      if (document.visibilityState === 'visible' && !document.hasFocus() && !focusStaysInPage()) report(reason);
    }, PRESENCE_BLUR_GRACE_MS);
  };

  /** État réel de la page à cet instant : présent seulement si visible, au premier plan et sans écran partagé. */
  const evaluate = () => {
    if (stopped) return;
    if (document.visibilityState !== 'visible') return report('hidden');
    if (multiWindow) return report('split-screen');
    if (document.hasFocus() || focusStaysInPage()) {
      cancelBlur();
      lostFocusAt = null;
      return clear();
    }
    scheduleBlurCheck(app ? 'app-unfocus' : 'blur');
  };

  const beat = () => {
    if (stopped) return;
    // Filet de sécurité : focus perdu sans événement (ex. : focus parti dans une vidéo intégrée, puis autre fenêtre).
    if (away === null && document.visibilityState === 'visible' && !document.hasFocus() && !focusStaysInPage()) {
      lostFocusAt ??= Date.now();
      if (Date.now() - lostFocusAt >= PRESENCE_BLUR_GRACE_MS) report(app ? 'app-unfocus' : 'blur');
    } else if (document.hasFocus()) {
      lostFocusAt = null;
    }
    const pinned = app ? androidIsPinned() : undefined;
    send({ s: 'beat', v: away === null, ...(app ? { app } : {}), ...(pinned !== undefined ? { pinned } : {}) });
  };

  const onVisibility = () => evaluate();
  const onPageHide = () => report('pagehide');
  const onPageShow = () => evaluate();
  const onBlur = () => scheduleBlurCheck(app ? 'app-unfocus' : 'blur');
  const onFocus = () => evaluate();
  const onFreeze = () => report('hidden');
  const onNative = (event: Event) => {
    const signal = (event as CustomEvent<NativeSignal>).detail;
    switch (signal) {
      case 'leave':
        return report('app-leave');
      case 'pause':
      case 'stop':
        return report('app-pause');
      case 'screen-off':
        return report('screen-off');
      case 'unfocus':
        return scheduleBlurCheck('app-unfocus');
      case 'multiwindow-on':
        multiWindow = true;
        return report('split-screen');
      case 'multiwindow-off':
        multiWindow = false;
        return evaluate();
      case 'resume':
      case 'focus':
        return evaluate();
      case 'pinned':
      case 'unpinned':
        return beat();
    }
  };

  document.addEventListener('visibilitychange', onVisibility);
  document.addEventListener('freeze', onFreeze);
  document.addEventListener('resume', onPageShow);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  window.addEventListener(NATIVE_EVENT, onNative);
  const heartbeat = setInterval(beat, PRESENCE_BEAT_MS);
  evaluate();
  beat();

  return {
    resync() {
      if (away !== null) send({ s: 'away', r: away, app });
      evaluate();
      beat();
    },
    stop() {
      stopped = true;
      cancelBlur();
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('freeze', onFreeze);
      document.removeEventListener('resume', onPageShow);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NATIVE_EVENT, onNative);
    },
  };
}
