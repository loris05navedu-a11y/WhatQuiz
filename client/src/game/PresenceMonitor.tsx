import { useEffect, useMemo, useRef, useState } from 'react';
import {
  formatAwayDuration,
  PRESENCE_REASON_LABELS,
  PRESENCE_SEVERITY,
  PRESENCE_STATE_LABELS,
  type AwayReason,
  type PresenceEvent,
  type PresenceState,
} from '../../../shared/presence';
import type { GameSettings, HostAction, HostPlayer, HostView } from '../../../shared/types';
import { Button } from '../components/Button';
import { Switch } from '../components/Form';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { readStorage, writeStorage } from '../lib/storage';

/* ───────────── Préférences d'affichage (propres à cet appareil) ───────────── */

export interface PresencePrefs {
  sound: boolean;
  banners: boolean;
}

export function usePresencePrefs(): [PresencePrefs, (patch: Partial<PresencePrefs>) => void] {
  const [prefs, setPrefs] = useState<PresencePrefs>(() => ({
    sound: readStorage('local', 'wq:presence-sound') !== 'off',
    banners: readStorage('local', 'wq:presence-banners') !== 'off',
  }));
  const update = (patch: Partial<PresencePrefs>) =>
    setPrefs((current) => {
      const next = { ...current, ...patch };
      writeStorage('local', 'wq:presence-sound', next.sound ? null : 'off');
      writeStorage('local', 'wq:presence-banners', next.banners ? null : 'off');
      return next;
    });
  return [prefs, update];
}

/* ───────────── Son d'alerte (synthétisé, aucun fichier) ───────────── */

let audio: AudioContext | null = null;

/** Le navigateur n'autorise le son qu'après un geste : on prépare le contexte audio au premier clic. */
function unlockAudio() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function playAlert() {
  try {
    audio ??= new AudioContext();
    if (audio.state === 'suspended') void audio.resume();
    const start = audio.currentTime + 0.02;
    [880, 660, 880].forEach((frequency, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = 'square';
      osc.frequency.value = frequency;
      const t = start + i * 0.16;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    });
  } catch {
    // Pas de son disponible : l'alerte visuelle suffit.
  }
}

/* ───────────── Alertes en direct ───────────── */

export interface PresenceAlert {
  playerId: string;
  nickname: string;
  reason: AwayReason | null;
  state: PresenceState;
  since: number;
  /** Retour constaté : durée de l'absence (l'alerte disparaît peu après). */
  backAfterMs?: number;
}

const BACK_VISIBLE_MS = 5_000;
const FLASH_VISIBLE_MS = 9_000;

/**
 * Transforme le journal de surveillance en alertes : une carte par élève sorti, tant qu'il n'est pas revenu.
 * À l'ouverture de l'écran, les élèves déjà absents apparaissent (sans son) ; l'historique n'est pas rejoué.
 */
export function usePresenceAlerts(view: HostView, prefs: PresencePrefs): PresenceAlert[] {
  const [alerts, setAlerts] = useState<PresenceAlert[]>([]);
  const lastSeen = useRef<number | null>(null);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const soundRef = useRef(prefs.sound);
  soundRef.current = prefs.sound;

  useEffect(() => {
    window.addEventListener('pointerdown', unlockAudio);
    const pending = timers.current;
    return () => {
      window.removeEventListener('pointerdown', unlockAudio);
      pending.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    const log = view.presenceLog;
    const removeLater = (playerId: string, since: number, delay: number) => {
      const timer = setTimeout(() => {
        timers.current.delete(timer);
        setAlerts((list) => list.filter((a) => !(a.playerId === playerId && a.since === since && (a.backAfterMs !== undefined || a.reason === 'unpinned'))));
      }, delay);
      timers.current.add(timer);
    };

    if (lastSeen.current === null) {
      lastSeen.current = log.at(-1)?.id ?? 0;
      if (!isRunning(view)) return;
      setAlerts(
        view.players
          .filter((p) => !p.isBot && p.presence.state !== 'present')
          .map((p) => ({ playerId: p.id, nickname: p.nickname, reason: p.presence.reason, state: p.presence.state, since: p.presence.since ?? view.serverNow })),
      );
      return;
    }
    const fresh = log.filter((event) => event.id > lastSeen.current!);
    if (fresh.length === 0) return;
    lastSeen.current = fresh[fresh.length - 1].id;
    let ring = false;
    setAlerts((current) => {
      let list = [...current];
      for (const event of fresh) {
        const index = list.findIndex((a) => a.playerId === event.playerId);
        if (event.kind === 'away') {
          const existing = index >= 0 ? list[index] : null;
          if (existing && existing.backAfterMs === undefined) {
            // Absence qui s'aggrave : même carte, raison mise à jour.
            if (PRESENCE_SEVERITY[event.state] >= PRESENCE_SEVERITY[existing.state]) list[index] = { ...existing, reason: event.reason, state: event.state };
            continue;
          }
          const alert: PresenceAlert = { playerId: event.playerId, nickname: event.nickname, reason: event.reason, state: event.state, since: event.at };
          list = [alert, ...list.filter((a) => a.playerId !== event.playerId)];
          ring = true;
          if (event.reason === 'unpinned') removeLater(event.playerId, event.at, FLASH_VISIBLE_MS);
        } else if (index >= 0 && list[index].backAfterMs === undefined) {
          list[index] = { ...list[index], backAfterMs: event.durationMs ?? 0 };
          removeLater(event.playerId, list[index].since, BACK_VISIBLE_MS);
        }
      }
      return list;
    });
    if (ring && soundRef.current) playAlert();
  }, [view.presenceLog, view.players, view.serverNow]);

  // Un élève exclu ou parti de la partie n'a plus d'alerte.
  const ids = useMemo(() => new Set(view.players.map((p) => p.id)), [view.players]);
  return alerts.filter((a) => ids.has(a.playerId));
}

/** Horloge locale recalée sur celle de l'hôte, rafraîchie chaque seconde pour les durées en direct. */
export function useHostNow(clockOffset: number, active: boolean): number {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    setNow(Date.now() + clockOffset);
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now() + clockOffset), 1000);
    return () => clearInterval(timer);
  }, [clockOffset, active]);
  return now;
}

const MAX_CARDS = 5;

export function PresenceAlertStack({ alerts, now, onOpen }: { alerts: PresenceAlert[]; now: number; onOpen: () => void }) {
  if (alerts.length === 0) return null;
  const shown = alerts.slice(0, MAX_CARDS);
  return (
    <div className="presence-alerts" role="log" aria-live="assertive" aria-label="Alertes de surveillance">
      {shown.map((alert) => {
        const back = alert.backAfterMs !== undefined;
        return (
          <button key={`${alert.playerId}-${alert.since}`} type="button" className={`presence-alert is-${back ? 'back' : alert.state}`} onClick={onOpen}>
            <Icon name={back ? 'check' : 'alert'} size={22} />
            <span className="presence-alert-text">
              <b>{alert.nickname}</b>{' '}
              {back ? `est de retour dans la partie (absence : ${formatAwayDuration(alert.backAfterMs!)})` : alert.reason ? PRESENCE_REASON_LABELS[alert.reason] : 'a quitté la partie'}
            </span>
            {!back && alert.reason !== 'unpinned' && <span className="presence-alert-time">{formatAwayDuration(Math.max(0, now - alert.since))}</span>}
          </button>
        );
      })}
      {alerts.length > MAX_CARDS && (
        <button type="button" className="presence-alert is-more" onClick={onOpen}>
          + {alerts.length - MAX_CARDS} autre{alerts.length - MAX_CARDS > 1 ? 's' : ''} élève{alerts.length - MAX_CARDS > 1 ? 's' : ''}
        </button>
      )}
    </div>
  );
}

const isRunning = (view: HostView) => view.settings.presenceWatch && (view.phase === 'ready' || view.phase === 'question' || view.phase === 'reveal');

/** Pastille de l'en-tête : nombre d'élèves actuellement hors de la partie. */
export function PresenceChip({ view, onClick }: { view: HostView; onClick: () => void }) {
  const out = isRunning(view) ? view.players.filter((p) => !p.isBot && p.presence.state !== 'present').length : 0;
  const exits = view.players.reduce((sum, p) => sum + p.presence.exits, 0);
  if (!view.settings.presenceWatch) {
    return <Button variant="ghost" className="btn-inverse" icon="eyeOff" onClick={onClick} aria-label="Surveillance désactivée" title="Surveillance désactivée" />;
  }
  return (
    <button
      type="button"
      className={`presence-chip${out > 0 ? ' is-alert' : ''}`}
      onClick={onClick}
      aria-label={out > 0 ? `${out} élève${out > 1 ? 's' : ''} hors de la partie` : 'Surveillance : tous les élèves sont dans la partie'}
      title="Surveillance des sorties"
    >
      <Icon name="eye" size={18} />
      {out > 0 ? (
        <span>
          {out} hors partie
        </span>
      ) : (
        <span>{exits > 0 ? `${exits} sortie${exits > 1 ? 's' : ''}` : 'Tous présents'}</span>
      )}
    </button>
  );
}

/* ───────────── Panneau de surveillance ───────────── */

const STATE_ORDER: Record<PresenceState, number> = { away: 0, lost: 1, unfocused: 2, present: 3 };
const timeFormatter = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function totalAway(player: HostPlayer, now: number): number {
  const { presence } = player;
  return presence.awayMs + (presence.state !== 'present' && presence.since !== null ? Math.max(0, now - presence.since) : 0);
}

interface PresencePanelProps {
  view: HostView;
  now: number;
  prefs: PresencePrefs;
  onPrefs: (patch: Partial<PresencePrefs>) => void;
  act: (action: HostAction) => Promise<void>;
  onClose: () => void;
}

export function PresencePanel({ view, now, prefs, onPrefs, act, onClose }: PresencePanelProps) {
  const update = (settings: Partial<GameSettings>) => act({ type: 'updateSettings', settings });
  const ended = view.phase === 'ended';
  const humans = view.players.filter((p) => !p.isBot);
  const sorted = [...humans].sort(
    (a, b) => STATE_ORDER[a.presence.state] - STATE_ORDER[b.presence.state] || b.presence.exits - a.presence.exits || a.nickname.localeCompare(b.nickname, 'fr'),
  );
  const journal = [...view.presenceLog].reverse();

  return (
    <Modal title="Surveillance des sorties" onClose={onClose} wide>
      <div className="stack presence-panel">
        <div className="presence-settings">
          <Switch
            label="Prévenir quand un élève quitte la partie"
            description="Onglet ou application quittés, page fermée, autre fenêtre, écran partagé, appareil qui ne répond plus."
            checked={view.settings.presenceWatch}
            onChange={(presenceWatch) => update({ presenceWatch })}
            disabled={ended}
          />
          <Switch
            label="Épingler l’application Android pendant la partie"
            description="Dans l’APK, l’élève doit accepter l’épinglage : il ne peut plus changer d’application sans le geste système, et tout désépinglage vous est signalé."
            checked={view.settings.pinApp}
            onChange={(pinApp) => update({ pinApp })}
            disabled={ended || !view.settings.presenceWatch}
          />
          <Switch label="Son à chaque sortie" checked={prefs.sound} onChange={(sound) => onPrefs({ sound })} />
          <Switch label="Bandeaux d’alerte à l’écran" description="Désactivez-les si l’écran est projeté devant la classe." checked={prefs.banners} onChange={(banners) => onPrefs({ banners })} />
        </div>

        <h3 className="section-title">Élèves</h3>
        {humans.length === 0 ? (
          <p className="muted">Aucun élève dans la partie.</p>
        ) : (
          <div className="presence-table-wrap">
            <table className="presence-table">
              <thead>
                <tr>
                  <th>Élève</th>
                  <th>État</th>
                  <th>Sorties</th>
                  <th>Temps dehors</th>
                  <th>Appareil</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((player) => {
                  const { presence } = player;
                  return (
                    <tr key={player.id} className={presence.state !== 'present' ? 'is-out' : undefined}>
                      <td>
                        <b>{player.nickname}</b>
                      </td>
                      <td>
                        <span className={`presence-state is-${presence.state}`}>{PRESENCE_STATE_LABELS[presence.state]}</span>
                        {presence.state !== 'present' && presence.reason && (
                          <span className="muted small presence-reason">
                            {PRESENCE_REASON_LABELS[presence.reason]}
                            {presence.since !== null && ` · depuis ${formatAwayDuration(Math.max(0, now - presence.since))}`}
                          </span>
                        )}
                      </td>
                      <td className="num">{presence.exits}</td>
                      <td className="num">{formatAwayDuration(totalAway(player, now))}</td>
                      <td>
                        {presence.app ? 'Appli Android' : 'Navigateur'}
                        {presence.app && view.settings.pinApp && <span className={`badge ${presence.pinned ? 'badge-success' : 'badge-warning'}`}>{presence.pinned ? 'Épinglée' : 'Non épinglée'}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="section-title">Journal</h3>
        {journal.length === 0 ? (
          <p className="muted">Aucune sortie pour l’instant.</p>
        ) : (
          <ol className="presence-journal">
            {journal.map((event) => (
              <JournalLine key={event.id} event={event} />
            ))}
          </ol>
        )}

        <p className="muted small presence-limits">
          <Icon name="info" size={14} /> Les heures et durées sont mesurées par {view.isTest ? 'cet appareil' : 'l’hôte de la partie'}, pas par les appareils des élèves. La
          surveillance ne voit pas un second appareil (téléphone posé à côté) ; dans un navigateur, un élève très averti pourrait modifier la page : l’application
          Android, avec l’épinglage, est la solution la plus sûre.
        </p>
      </div>
    </Modal>
  );
}

function JournalLine({ event }: { event: PresenceEvent }) {
  const away = event.kind === 'away';
  return (
    <li className={away ? 'is-away' : 'is-back'}>
      <time>{timeFormatter.format(new Date(event.at))}</time>
      <Icon name={away ? 'alert' : 'check'} size={16} />
      <span>
        <b>{event.nickname}</b> {away ? (event.reason ? PRESENCE_REASON_LABELS[event.reason] : 'a quitté la partie') : `est de retour (absence : ${formatAwayDuration(event.durationMs ?? 0)})`}
      </span>
      {event.question > 0 && <span className="muted small">Q{event.question}</span>}
    </li>
  );
}
