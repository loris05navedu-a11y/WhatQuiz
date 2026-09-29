import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ERRORS } from '../../../shared/constants';
import type { GameSettings, HostAction, HostView } from '../../../shared/types';
import { metaApi } from '../api/endpoints';
import { Button, LinkButton, Spinner } from '../components/Button';
import { Segmented, Switch } from '../components/Form';
import { Icon } from '../components/Icon';
import { Logo, LogoMark } from '../components/Logo';
import { Modal } from '../components/Modal';
import { QrCode } from '../components/QrCode';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { ChoiceTile } from '../game/ChoiceTile';
import { Leaderboard, Podium } from '../game/Leaderboard';
import { QuestionMeta, QuestionStatement } from '../game/QuestionView';
import { Timer } from '../game/Timer';
import { useHostGame, type FloatingReaction } from '../game/useHostGame';
import { readStorage, writeStorage } from '../lib/storage';
import { SEPARATE_BACKEND, siteOrigin, STANDALONE } from '../lib/backend';
import { formatNumber, formatPercent } from '../lib/format';

type Act = (action: HostAction) => Promise<void>;

export function HostPage() {
  const { code = '' } = useParams();
  const { view, error, connected, clockOffset, act: rawAct, reactions } = useHostGame(code);
  const [reactionsShown, setReactionsShown] = useState(() => readStorage('local', 'wq:reactions') !== 'off');
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  useKeepHostAlive(STANDALONE && view !== null && view.phase !== 'ended');

  const act = useCallback<Act>(
    async (action) => {
      setBusy(true);
      const failure = await rawAct(action);
      setBusy(false);
      if (failure) toast.error(failure);
    },
    [rawAct, toast],
  );

  if (error && !view) {
    return (
      <div className="stage">
        <div className="stage-center">
          <div className="stage-message">
            <div className="stage-message-icon">
              <Icon name="alert" size={36} />
            </div>
            <h1>{error}</h1>
            <LinkButton to="/dashboard" variant="primary" size="lg">
              Retour au tableau de bord
            </LinkButton>
          </div>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="stage">
        <div className="stage-center">
          <Spinner large />
        </div>
      </div>
    );
  }

  return (
    <div className="stage host">
      {!connected && (
        <div className="connection-banner" role="alert">
          <Icon name="wifiOff" /> {ERRORS.connectionLost} — reconnexion…
        </div>
      )}
      <HostHeader
        view={view}
        act={act}
        reactionsShown={reactionsShown}
        onToggleReactions={() =>
          setReactionsShown((shown) => {
            writeStorage('local', 'wq:reactions', shown ? 'off' : null);
            return !shown;
          })
        }
      />
      <main className="host-main">
        <HostPhase view={view} act={act} busy={busy} clockOffset={clockOffset} />
      </main>
      {reactionsShown && <ReactionLayer reactions={reactions} />}
    </div>
  );
}

/**
 * Mode sans serveur : la partie tourne dans cet onglet. On garde l'écran allumé et on prévient avant
 * une fermeture ou un rechargement qui mettrait fin à la partie.
 */
function useKeepHostAlive(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    let lock: WakeLockSentinel | null = null;
    let released = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      navigator.wakeLock
        .request('screen')
        .then((sentinel) => {
          if (released) void sentinel.release();
          else lock = sentinel;
        })
        .catch(() => undefined);
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      released = true;
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}

/* ───────────── En-tête et panneaux ───────────── */

function ReactionLayer({ reactions }: { reactions: FloatingReaction[] }) {
  return (
    <div className="reaction-layer" aria-hidden="true">
      {reactions.map((reaction) => (
        <span key={reaction.id} className="reaction-float" style={{ left: `${reaction.left}%` }}>
          <span className="reaction-emoji">{reaction.emoji}</span>
          <span className="reaction-name">{reaction.nickname}</span>
        </span>
      ))}
    </div>
  );
}

interface HostHeaderProps {
  view: HostView;
  act: Act;
  reactionsShown: boolean;
  onToggleReactions: () => void;
}

function HostHeader({ view, act, reactionsShown, onToggleReactions }: HostHeaderProps) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [panel, setPanel] = useState<'players' | 'settings' | null>(null);

  const leave = async () => {
    if (view.phase !== 'ended') {
      const ok = await confirm({
        title: 'Quitter l’écran de la partie ?',
        message: STANDALONE
          ? 'La partie continue sur cet appareil tant que le site reste ouvert : vous pourrez la reprendre depuis le tableau de bord.'
          : 'La partie continue sur le serveur : vous pourrez la reprendre depuis le tableau de bord.',
        confirmLabel: 'Quitter',
      });
      if (!ok) return;
    }
    navigate('/dashboard');
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  };

  return (
    <header className="host-header">
      <Logo to="/dashboard" inverse size={32} />
      <div className="host-title">
        <b>{view.quizTitle}</b>
        {view.isTest && (
          <span className="badge badge-warning" title="Les résultats de cette partie ne sont pas enregistrés">
            Mode test
          </span>
        )}
      </div>
      <span className="spacer" />
      {view.phase !== 'lobby' && (
        <span className="host-code-chip" aria-label={`Code de partie ${view.code}`}>
          Code <b>{view.code}</b>
        </span>
      )}
      <Button variant="ghost" className="btn-inverse" icon="users" onClick={() => setPanel('players')} aria-label="Joueurs">
        {view.players.length}
      </Button>
      <Button variant="ghost" className="btn-inverse" icon="sliders" onClick={() => setPanel('settings')} aria-label="Paramètres de la partie" />
      <Button
        variant="ghost"
        className="btn-inverse"
        icon={reactionsShown ? 'smile' : 'smileOff'}
        onClick={onToggleReactions}
        aria-pressed={reactionsShown}
        aria-label={reactionsShown ? 'Masquer les réactions des élèves' : 'Afficher les réactions des élèves'}
        title={reactionsShown ? 'Masquer les réactions des élèves' : 'Afficher les réactions des élèves'}
      />
      <Button variant="ghost" className="btn-inverse hide-mobile" icon="maximize" onClick={toggleFullscreen} aria-label="Plein écran" />
      <Button variant="ghost" className="btn-inverse" icon="x" onClick={leave} aria-label="Quitter l’écran de la partie" />
      {panel === 'players' && <PlayersPanel view={view} act={act} onClose={() => setPanel(null)} />}
      {panel === 'settings' && <SettingsPanel view={view} act={act} onClose={() => setPanel(null)} />}
    </header>
  );
}

function PlayersPanel({ view, act, onClose }: { view: HostView; act: Act; onClose: () => void }) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const canAddBots = (view.isTest || user?.isDemo) && view.phase !== 'ended';

  const kick = async (id: string, nickname: string) => {
    if (await confirm({ title: `Exclure ${nickname} ?`, message: 'Ce joueur ne pourra plus revenir dans cette partie.', confirmLabel: 'Exclure', danger: true })) {
      await act({ type: 'kick', playerId: id });
    }
  };

  return (
    <Modal title={`Joueurs (${view.players.length})`} onClose={onClose}>
      <div className="stack">
        <Switch
          label="Verrouiller les inscriptions"
          description="Plus aucun nouveau joueur ne peut rejoindre la partie."
          checked={view.locked}
          onChange={(value) => act({ type: 'setLocked', value })}
          disabled={view.phase === 'ended'}
        />
        {canAddBots && (
          <Button icon="bot" onClick={() => act({ type: 'addBots', count: 5 })}>
            Ajouter 5 élèves fictifs
          </Button>
        )}
        {view.players.length === 0 ? (
          <p className="muted">Aucun joueur pour le moment.</p>
        ) : (
          <ul className="player-list">
            {[...view.players]
              .sort((a, b) => b.score - a.score)
              .map((player) => (
                <li key={player.id}>
                  <span className={`status-dot${player.connected ? ' on' : ''}`} aria-label={player.connected ? 'connecté' : 'déconnecté'} />
                  <span className="player-list-name">
                    {player.nickname} {player.isBot && <Icon name="bot" size={14} aria-label="élève fictif" />}
                  </span>
                  <span className="muted small">{formatNumber(player.score)} pts</span>
                  {view.phase !== 'ended' && (
                    <Button size="sm" variant="ghost" icon="x" aria-label={`Exclure ${player.nickname}`} onClick={() => kick(player.id, player.nickname)} />
                  )}
                </li>
              ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function SettingsPanel({ view, act, onClose }: { view: HostView; act: Act; onClose: () => void }) {
  const update = (settings: Partial<GameSettings>) => act({ type: 'updateSettings', settings });
  const s = view.settings;
  const ended = view.phase === 'ended';
  return (
    <Modal title="Paramètres de la partie" onClose={onClose}>
      <div className="stack">
        <div className="field">
          <span className="field-label">Score</span>
          <Segmented
            label="Mode de score"
            value={s.scoringMode}
            onChange={(scoringMode) => view.phase === 'lobby' && update({ scoringMode })}
            options={[
              { value: 'speed', label: 'Bonus rapidité' },
              { value: 'fixed', label: 'Points fixes' },
              { value: 'none', label: 'Sans score' },
            ]}
          />
          {view.phase !== 'lobby' && <span className="field-hint">Le mode de score ne peut plus changer une fois la partie lancée.</span>}
        </div>
        <Switch label="Terminer quand tout le monde a répondu" checked={s.endWhenAllAnswered} onChange={(v) => update({ endWhenAllAnswered: v })} disabled={ended} />
        <Switch label="Autoriser la modification des réponses" checked={s.allowAnswerChange} onChange={(v) => update({ allowAnswerChange: v })} disabled={ended} />
        <Switch label="Montrer la correction automatiquement" checked={s.autoRevealAnswers} onChange={(v) => update({ autoRevealAnswers: v })} disabled={ended} />
        <Switch label="Autoriser le retour à la question précédente" checked={s.allowBack} onChange={(v) => update({ allowBack: v })} disabled={ended} />
        <Switch
          label="Avance automatique"
          description="Correction, classement et question suivante s’enchaînent seuls."
          checked={s.autoAdvance}
          onChange={(v) => update({ autoAdvance: v })}
          disabled={ended}
        />
      </div>
    </Modal>
  );
}

/* ───────────── Phases ───────────── */

interface PhaseProps {
  view: HostView;
  act: Act;
  busy: boolean;
  clockOffset: number;
}

/** Espace ou Entrée déclenchent l'action principale (pratique avec un clavier ou une télécommande). */
function usePrimaryShortcut(action: (() => void) | null) {
  useEffect(() => {
    if (!action) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, button, [role="dialog"]')) return;
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        action();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [action]);
}

function HostPhase(props: PhaseProps) {
  switch (props.view.phase) {
    case 'lobby':
      return <LobbyPhase {...props} />;
    case 'ready':
      return <ReadyPhase {...props} />;
    case 'question':
      return <QuestionPhase {...props} />;
    case 'reveal':
      return <RevealPhase {...props} />;
    case 'ended':
      return <EndedPhase {...props} />;
  }
}

function useJoinUrl(): string {
  const [base, setBase] = useState(siteOrigin());
  useEffect(() => {
    if (SEPARATE_BACKEND || STANDALONE) return;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    if (!local) return;
    metaApi
      .get()
      .then(({ lanUrls }) => lanUrls[0] && setBase(lanUrls[0]))
      .catch(() => undefined);
  }, []);
  return base;
}

function LobbyPhase({ view, act, busy }: PhaseProps) {
  const base = useJoinUrl();
  const confirm = useConfirm();
  const kick = async (id: string, nickname: string) => {
    if (await confirm({ title: `Exclure ${nickname} ?`, confirmLabel: 'Exclure', danger: true })) await act({ type: 'kick', playerId: id });
  };
  const start = view.players.length > 0 ? () => void act({ type: 'start' }) : null;
  usePrimaryShortcut(start);
  const displayUrl = base.replace(/^https?:\/\//, '');

  return (
    <div className="lobby">
      <section className="lobby-join animate-in">
        <p className="lobby-brand">WHATQUIZ</p>
        <p className="lobby-instructions">
          Rejoignez sur <b>{displayUrl}</b>
        </p>
        <p className="lobby-code-label">Code de partie</p>
        <p className="lobby-code" aria-label={`Code de partie ${view.code.split('').join(' ')}`}>
          {view.code.slice(0, 3)}
          <span />
          {view.code.slice(3)}
        </p>
        <QrCode value={`${base}/join?code=${view.code}`} label={`QR code pour rejoindre la partie ${view.code}`} />
      </section>

      <section className="lobby-players">
        <div className="row">
          <h2 className="lobby-count">
            <Icon name="users" size={26} /> {view.players.length} joueur{view.players.length > 1 ? 's' : ''}
          </h2>
          <span className="spacer" />
          <Button
            variant="ghost"
            className="btn-inverse"
            icon={view.locked ? 'lock' : 'unlock'}
            onClick={() => act({ type: 'setLocked', value: !view.locked })}
            aria-pressed={view.locked}
          >
            {view.locked ? 'Inscriptions verrouillées' : 'Verrouiller'}
          </Button>
        </div>
        {view.players.length === 0 ? (
          <div className="lobby-waiting">
            <p className="waiting-dots" aria-hidden="true">
              <span />
              <span />
              <span />
            </p>
            <p>En attente des joueurs…</p>
            {STANDALONE && !view.isTest && <p className="muted-inverse small">Gardez cette page ouverte : la partie tourne sur cet appareil.</p>}
            {view.isTest && (
              <Button variant="soft" icon="bot" onClick={() => act({ type: 'addBots', count: 5 })}>
                Ajouter des élèves fictifs
              </Button>
            )}
          </div>
        ) : (
          <ul className="lobby-chips" aria-live="polite">
            {view.players.map((player) => (
              <li key={player.id} className={player.connected ? undefined : 'offline'}>
                <button type="button" onClick={() => kick(player.id, player.nickname)} aria-label={`Exclure ${player.nickname}`} title="Toucher pour exclure">
                  {player.nickname}
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ControlBar>
        <Button variant="ghost" className="btn-inverse" icon="flag" onClick={() => act({ type: 'end' })}>
          Annuler la partie
        </Button>
        <span className="spacer" />
        <Button variant="primary" size="lg" icon="play" disabled={!start} loading={busy} onClick={start ?? undefined}>
          Démarrer la partie
        </Button>
      </ControlBar>
    </div>
  );
}

function ControlBar({ children }: { children: ReactNode }) {
  return (
    <div className="control-bar" role="toolbar" aria-label="Contrôles de la partie">
      {children}
    </div>
  );
}

function BackButton({ view, act }: { view: HostView; act: Act }) {
  if (!view.canGoBack) return null;
  return (
    <Button variant="ghost" className="btn-inverse" icon="chevronLeft" onClick={() => act({ type: 'previous' })}>
      Précédente
    </Button>
  );
}

function ReadyPhase({ view, act, busy }: PhaseProps) {
  const question = view.question!;
  const launch = useCallback(() => void act({ type: 'startQuestion' }), [act]);
  usePrimaryShortcut(launch);
  return (
    <div className="host-phase animate-in" key={`ready-${question.index}`}>
      <QuestionMeta question={question} />
      <QuestionStatement text={question.text} imageUrl={question.imageUrl} large />
      <p className="host-hint">
        <Icon name="clock" size={18} /> {question.timeLimit} secondes · les élèves voient l’énoncé et attendent votre signal
        {view.settings.autoAdvance && ' (lancement automatique)'}
      </p>
      <ControlBar>
        <Button variant="ghost" className="btn-inverse" icon="flag" onClick={() => act({ type: 'end' })}>
          Terminer la partie
        </Button>
        <BackButton view={view} act={act} />
        <span className="spacer" />
        <Button variant="primary" size="lg" icon="play" loading={busy} onClick={launch}>
          Lancer la question
        </Button>
      </ControlBar>
    </div>
  );
}

function QuestionPhase({ view, act, busy, clockOffset }: PhaseProps) {
  const question = view.question!;
  const paused = view.timer?.paused ?? false;
  const endQuestion = useCallback(() => void act({ type: 'endQuestion' }), [act]);
  usePrimaryShortcut(endQuestion);
  const expected = view.players.filter((p) => p.connected).length;

  return (
    <div className="host-phase" key={`question-${question.index}`}>
      <div className="host-question-top">
        <QuestionMeta question={question} />
        <span className="spacer" />
        <div className="answered-counter" aria-live="polite">
          <b>{view.answeredCount}</b>
          <span>
            / {expected} réponse{view.answeredCount > 1 ? 's' : ''}
          </span>
        </div>
        <Timer timer={view.timer} offset={clockOffset} size={92} />
      </div>
      <QuestionStatement text={question.text} imageUrl={question.imageUrl} large />
      {question.type === 'text' ? (
        <p className="host-hint">
          <Icon name="text" size={18} /> Les élèves saisissent leur réponse.
        </p>
      ) : (
        <div className={`choices choices-${question.choices.length}${question.type === 'truefalse' ? ' choices-tf' : ''}`}>
          {question.choices.map((choice, index) => (
            <ChoiceTile key={index} index={index} text={choice} />
          ))}
        </div>
      )}
      {paused && (
        <div className="paused-overlay" role="status">
          <Icon name="pause" size={32} /> Partie en pause
        </div>
      )}
      <ControlBar>
        <Button variant="ghost" className="btn-inverse" icon="flag" onClick={() => act({ type: 'end' })}>
          Terminer la partie
        </Button>
        <span className="spacer" />
        <Button icon={paused ? 'play' : 'pause'} size="lg" onClick={() => act({ type: paused ? 'resume' : 'pause' })}>
          {paused ? 'Reprendre' : 'Pause'}
        </Button>
        <Button variant="primary" size="lg" icon="skip" loading={busy} onClick={endQuestion}>
          Terminer la question
        </Button>
      </ControlBar>
    </div>
  );
}

function RevealPhase({ view, act, busy }: PhaseProps) {
  const question = view.question!;
  const isLast = view.questionIndex + 1 >= view.questionCount;
  const next = useCallback(() => void act({ type: 'next' }), [act]);
  usePrimaryShortcut(next);
  const answered = view.answeredCount;

  return (
    <div className="host-phase animate-in" key={`reveal-${question.index}`}>
      <div className="host-question-top">
        <QuestionMeta question={question} />
        <span className="spacer" />
        <span className="badge badge-success">
          {formatPercent(view.players.length ? (view.correctCount ?? 0) / view.players.length : 0)} de bonnes réponses
        </span>
      </div>
      <div className={`reveal-layout${view.leaderboardVisible ? ' with-board' : ''}`}>
        <div className="stack">
          <p className="reveal-question-host">{question.text}</p>
          {question.type === 'text' ? (
            <TextAnswers view={view} />
          ) : (
            <div className={`choices choices-${question.choices.length} choices-compact`}>
              {question.choices.map((choice, index) => (
                <ChoiceTile
                  key={index}
                  index={index}
                  text={choice}
                  state={question.correctChoices.includes(index) ? 'correct' : 'dimmed'}
                  count={view.distribution?.[index] ?? 0}
                  total={answered}
                />
              ))}
            </div>
          )}
        </div>
        {view.leaderboardVisible && (
          <aside className="board-panel animate-in" aria-label="Classement">
            <h3>
              <Icon name="trophy" /> Classement
            </h3>
            <Leaderboard entries={view.leaderboard} limit={8} />
          </aside>
        )}
      </div>
      <ControlBar>
        <BackButton view={view} act={act} />
        <Button
          variant="ghost"
          className="btn-inverse"
          icon={view.answersVisible ? 'eye' : 'eyeOff'}
          aria-pressed={view.answersVisible}
          onClick={() => act({ type: 'setAnswersVisible', value: !view.answersVisible })}
        >
          {view.answersVisible ? 'Correction visible' : 'Montrer la correction'}
        </Button>
        <Button
          variant="ghost"
          className="btn-inverse"
          icon="trophy"
          aria-pressed={view.leaderboardVisible}
          onClick={() => act({ type: 'setLeaderboardVisible', value: !view.leaderboardVisible })}
        >
          {view.leaderboardVisible ? 'Masquer le classement' : 'Classement'}
        </Button>
        <span className="spacer" />
        <Button variant="primary" size="lg" iconRight={isLast ? 'flag' : 'chevronRight'} loading={busy} onClick={next}>
          {isLast ? 'Voir les résultats' : 'Question suivante'}
        </Button>
      </ControlBar>
    </div>
  );
}

function TextAnswers({ view }: { view: HostView }) {
  const question = view.question!;
  return (
    <div className="text-answers">
      <p>
        Réponse attendue : <b>{question.acceptedAnswers.join(' / ')}</b>
      </p>
      {view.textAnswers && view.textAnswers.length > 0 ? (
        <ul>
          {view.textAnswers.map((answer) => (
            <li key={answer.text} className={answer.correct ? 'correct' : undefined}>
              <span>{answer.text}</span>
              <b>{answer.count}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted-inverse">Aucune réponse.</p>
      )}
    </div>
  );
}

function EndedPhase({ view, act }: PhaseProps) {
  const navigate = useNavigate();
  const podium = view.leaderboard.slice(0, 3);
  const aborted = view.questionIndex < 0;
  return (
    <div className="host-phase ended-host animate-in">
      <div className="row" style={{ justifyContent: 'center' }}>
        <LogoMark size={44} />
        <h1 className="ended-title">{aborted ? 'Partie annulée' : 'Résultats'}</h1>
      </div>
      {!aborted && podium.length > 0 && <Podium entries={podium} />}
      {!aborted && view.leaderboard.length > 3 && (
        <div className="board-panel">
          <Leaderboard entries={view.leaderboard.slice(3)} limit={20} />
        </div>
      )}
      <ControlBar>
        {!aborted && (
          <Button
            variant="ghost"
            className="btn-inverse"
            icon={view.resultsVisible ? 'eye' : 'eyeOff'}
            aria-pressed={view.resultsVisible}
            onClick={() => act({ type: 'setResultsVisible', value: !view.resultsVisible })}
          >
            {view.resultsVisible ? 'Résultats visibles par les élèves' : 'Afficher les résultats aux élèves'}
          </Button>
        )}
        <span className="spacer" />
        {view.isTest ? (
          <Button size="lg" icon="edit" onClick={() => navigate(`/quizzes/${view.quizId}/edit`)}>
            Retour à l’éditeur
          </Button>
        ) : (
          !aborted && (
            <Button size="lg" icon="chart" onClick={() => navigate(`/games/${view.gameId}/results`)}>
              Statistiques
            </Button>
          )
        )}
        <Button variant="primary" size="lg" icon="home" onClick={() => navigate('/dashboard')}>
          Tableau de bord
        </Button>
      </ControlBar>
    </div>
  );
}
