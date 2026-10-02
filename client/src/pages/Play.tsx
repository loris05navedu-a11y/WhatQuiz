import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { ERRORS, REACTIONS } from '../../../shared/constants';
import type { PlayerView, SubmittedAnswer } from '../../../shared/types';
import { Button, LinkButton, Spinner } from '../components/Button';
import { TextField } from '../components/Form';
import { Icon, type IconName } from '../components/Icon';
import { LogoMark } from '../components/Logo';
import { homePathFor, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AnswerInput } from '../game/AnswerInput';
import { describeAnswer } from '../questionTypes/meta';
import { Explanation, PlayerCorrection } from '../questionTypes/results';
import { Leaderboard, Podium } from '../game/Leaderboard';
import { QuestionMeta, QuestionStatement } from '../game/QuestionView';
import { Timer } from '../game/Timer';
import { usePlayerGame } from '../game/usePlayerGame';
import { formatNumber, formatRank } from '../lib/format';
import { formatAwayDuration, type AwayReason } from '../../../shared/presence';
import { watchPresence, type PresenceWatch } from '../game/presenceWatch';
import { androidCanPin, androidGameMode, androidPin, isAndroidApp } from '../lib/android';

interface PlayLocationState {
  nickname?: string;
  autoJoin?: boolean;
}

export function PlayPage() {
  const { code = '' } = useParams();
  const location = useLocation();
  const state = (location.state ?? {}) as PlayLocationState;
  const game = usePlayerGame(code, state.autoJoin ? state.nickname : undefined);

  return (
    <div className="stage">
      {!game.connected && game.status === 'joined' && (
        <div className="connection-banner" role="alert">
          <Icon name="wifiOff" /> {ERRORS.connectionLost} — reconnexion…
        </div>
      )}
      <PlayContent code={code} game={game} suggestedNickname={state.nickname} />
    </div>
  );
}

type Game = ReturnType<typeof usePlayerGame>;

function PlayContent({ code, game, suggestedNickname }: { code: string; game: Game; suggestedNickname?: string }) {
  if (game.status === 'kicked') {
    return <StageMessage icon="x" title="Vous avez été exclu de la partie" action={<LinkButton to="/join" variant="primary" size="lg">Rejoindre une autre partie</LinkButton>} />;
  }
  if (game.status === 'failed') {
    return <StageMessage icon="alert" title={game.error ?? ERRORS.generic} action={<LinkButton to="/join" variant="primary" size="lg">Saisir un autre code</LinkButton>} />;
  }
  if (game.status === 'needsNickname' || (game.status === 'joining' && !game.view)) {
    return <NicknameForm code={code} game={game} suggested={suggestedNickname} />;
  }
  if (!game.view) {
    return (
      <div className="stage-center">
        <Spinner large />
      </div>
    );
  }
  return <PlayerScreen view={game.view} game={game} />;
}

function NicknameForm({ code, game, suggested }: { code: string; game: Game; suggested?: string }) {
  const { user } = useAuth();
  const [nickname, setNickname] = useState(suggested ?? user?.displayName.slice(0, 20) ?? '');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (nickname.trim()) await game.join(nickname.trim());
  };

  return (
    <div className="stage-center">
      <form className="join-card animate-in" onSubmit={submit}>
        <LogoMark size={56} />
        <div>
          <p className="muted small">Partie</p>
          <p className="join-code-display">{code}</p>
        </div>
        <TextField
          label="Votre pseudo"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={20}
          autoFocus
          autoComplete="nickname"
          placeholder="Ex. : Alex"
          error={game.error}
          className="input-xl"
        />
        <Button type="submit" variant="primary" size="lg" block loading={game.status === 'joining'} disabled={!nickname.trim()}>
          C'est parti !
        </Button>
        <Link to="/join" className="small">
          Changer de code
        </Link>
      </form>
    </div>
  );
}

function StageMessage({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="stage-center">
      <div className="stage-message animate-in">
        <div className="stage-message-icon">
          <Icon name={icon} size={36} />
        </div>
        <h1>{title}</h1>
        {children}
        {action}
      </div>
    </div>
  );
}

function PlayerHeader({ view }: { view: PlayerView }) {
  return (
    <header className="player-header">
      <LogoMark size={32} />
      <div className="player-identity">
        <b>{view.me.nickname}</b>
        {view.isTest && <span className="badge badge-warning">Test</span>}
        {view.presence && view.phase !== 'lobby' && (
          <span className="presence-badge" title="Partie surveillée : le professeur est prévenu si tu quittes la partie">
            <Icon name="eye" size={14} /> Surveillée
          </span>
        )}
      </div>
      <span className="spacer" />
      {view.questionIndex >= 0 && view.phase !== 'lobby' && view.phase !== 'ended' && (
        <span className="player-progress" aria-label={`Question ${view.questionIndex + 1} sur ${view.questionCount}`}>
          {Math.min(view.questionIndex + 1, view.questionCount)}/{view.questionCount}
        </span>
      )}
      <span className="player-score" aria-label="Votre score">
        <Icon name="star" size={16} /> {formatNumber(view.me.score)}
      </span>
    </header>
  );
}

function PlayerScreen({ view, game }: { view: PlayerView; game: Game }) {
  const guard = usePresenceGuard(view, game);
  return (
    <div className="player-screen">
      <PlayerHeader view={view} />
      <main className="player-main">
        <PhaseContent view={view} game={game} />
      </main>
      {view.phase !== 'question' && <ReactionBar onReact={game.react} />}
      {guard.returned && view.presence && <PresenceReturnOverlay reason={guard.returned} exits={view.presence.exits} awayMs={view.presence.awayMs} onResume={guard.dismiss} />}
    </div>
  );
}

const RUNNING_PHASES = new Set(['ready', 'question', 'reveal']);

/**
 * Surveillance de présence côté élève : active dès que le professeur l'a demandée. Les sorties sont signalées
 * à l'hôte ; au retour pendant la partie, un écran bloquant rappelle que le professeur a été prévenu.
 */
function usePresenceGuard(view: PlayerView, game: Game) {
  const [returned, setReturned] = useState<AwayReason | null>(null);
  const watched = game.status === 'joined' && view.presence !== null;
  const phaseRef = useRef(view.phase);
  phaseRef.current = view.phase;
  const watchRef = useRef<PresenceWatch | null>(null);
  const { sendPresence } = game;

  useEffect(() => {
    if (!watched) return;
    const watch = watchPresence({
      send: sendPresence,
      onBack: (reason) => {
        if (!RUNNING_PHASES.has(phaseRef.current)) return;
        setReturned(reason);
        navigator.vibrate?.(250);
      },
    });
    watchRef.current = watch;
    return () => {
      watch.stop();
      watchRef.current = null;
    };
  }, [watched, sendPresence]);

  // Après une reconnexion, l'hôte reçoit aussitôt l'état réel de l'élève.
  useEffect(() => {
    watchRef.current?.resync();
  }, [game.session]);

  // Pendant une partie surveillée, l'écran reste allumé : une mise en veille automatique n'est pas une sortie.
  const guarding = watched && view.phase !== 'ended';
  useEffect(() => {
    if (!guarding) return;
    androidGameMode(true);
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
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release().catch(() => undefined);
      androidGameMode(false);
    };
  }, [guarding]);

  // Application Android : épinglage de l'écran pendant la partie, si le professeur l'a demandé.
  const pin = watched && view.presence?.pinApp === true && view.phase !== 'ended' && isAndroidApp() && androidCanPin();
  useEffect(() => {
    if (!pin) return;
    androidPin(true);
    return () => void androidPin(false);
  }, [pin]);

  return { returned, dismiss: () => setReturned(null) };
}

const RETURN_MESSAGES: Record<AwayReason, string> = {
  hidden: 'Tu as quitté l’onglet ou l’application de la partie.',
  pagehide: 'Tu as fermé ou rechargé la page de la partie.',
  blur: 'Tu as ouvert une autre fenêtre.',
  'app-pause': 'Tu as quitté l’application WhatQuiz.',
  'app-leave': 'Tu as quitté l’application (bouton Accueil ou applis récentes).',
  'app-unfocus': 'Tu as ouvert quelque chose par-dessus l’application.',
  'split-screen': 'Tu as utilisé l’écran partagé avec une autre application.',
  'screen-off': 'Tu as éteint l’écran pendant la partie.',
  unpinned: 'Tu as désépinglé l’application.',
  silent: 'Ton appareil ne répondait plus.',
  disconnected: 'La connexion avec la partie a été perdue.',
};

function PresenceReturnOverlay({ reason, exits, awayMs, onResume }: { reason: AwayReason; exits: number; awayMs: number; onResume: () => void }) {
  return (
    <div className="presence-return" role="alertdialog" aria-modal="true" aria-labelledby="presence-return-title" aria-describedby="presence-return-text">
      <div className="presence-return-card animate-in">
        <div className="presence-return-icon">
          <Icon name="alert" size={40} />
        </div>
        <h1 id="presence-return-title">Tu as quitté la partie</h1>
        <p id="presence-return-text">{RETURN_MESSAGES[reason]}</p>
        <p className="presence-return-warning">
          <Icon name="bell" size={18} /> Ton professeur a été prévenu immédiatement.
        </p>
        <p className="presence-return-count">
          Sorties pendant cette partie : <b>{exits}</b>
          {awayMs > 0 && <> · temps hors de la partie : <b>{formatAwayDuration(awayMs)}</b></>}
        </p>
        <Button variant="primary" size="lg" block icon="play" onClick={onResume} autoFocus>
          Je reviens à la partie
        </Button>
      </div>
    </div>
  );
}

const REACTION_COOLDOWN_MS = 700;

/** Information donnée à l'élève avant la partie : la surveillance n'est jamais cachée. */
function PresenceNotice({ pinApp }: { pinApp: boolean }) {
  const app = isAndroidApp();
  return (
    <div className="presence-notice" role="note">
      <Icon name="eye" size={22} />
      <div>
        <b>Partie surveillée</b>
        <p>
          Reste dans {app ? 'l’application' : 'cette page'} pendant toute la partie. Si tu changes d’onglet, ouvres une autre application ou fermes la page, ton
          professeur est prévenu immédiatement.
        </p>
        {pinApp && app && <p>L’application va être épinglée à l’écran : accepte l’épinglage pour participer.</p>}
      </div>
    </div>
  );
}

function ReactionBar({ onReact }: { onReact: (emoji: string) => void }) {
  const [sent, setSent] = useState<string | null>(null);
  const lastSent = useRef(0);

  const send = (emoji: string) => {
    const now = Date.now();
    if (now - lastSent.current < REACTION_COOLDOWN_MS) return;
    lastSent.current = now;
    onReact(emoji);
    setSent(emoji);
    setTimeout(() => setSent((current) => (current === emoji ? null : current)), 400);
  };

  return (
    <div className="reaction-bar" role="group" aria-label="Envoyer une réaction au professeur">
      {REACTIONS.map((emoji) => (
        <button key={emoji} type="button" className={`reaction-btn${sent === emoji ? ' is-sent' : ''}`} onClick={() => send(emoji)} aria-label={`Réagir ${emoji}`}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

function PhaseContent({ view, game }: { view: PlayerView; game: Game }) {
  switch (view.phase) {
    case 'lobby':
      return (
        <StageMessage icon="clock" title="Vous êtes dans la partie !">
          <p className="stage-sub">En attente du professeur…</p>
          <p className="waiting-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </p>
          <p className="muted-inverse">{view.playerCount} joueur{view.playerCount > 1 ? 's' : ''} connecté{view.playerCount > 1 ? 's' : ''}</p>
          {view.presence && <PresenceNotice pinApp={view.presence.pinApp} />}
        </StageMessage>
      );
    case 'ready':
      return (
        <div className="stage-center">
          <div className="ready-card animate-in" key={view.questionIndex}>
            <p className="ready-label">Question {view.questionIndex + 1}</p>
            {view.question && <p className="ready-text">{view.question.text}</p>}
            <p className="stage-sub">Préparez-vous…</p>
          </div>
        </div>
      );
    case 'question':
      return <QuestionPhase view={view} game={game} />;
    case 'reveal':
      return <RevealPhase view={view} />;
    case 'ended':
      return <EndedPhase view={view} />;
  }
}

function QuestionPhase({ view, game }: { view: PlayerView; game: Game }) {
  const toast = useToast();
  const [sending, setSending] = useState(false);
  const [editing, setEditing] = useState(false);
  const question = view.question!;
  const paused = view.timer?.paused ?? false;

  const submit = async (answer: SubmittedAnswer) => {
    setSending(true);
    const error = await game.answer(question.index, answer);
    setSending(false);
    if (error) toast.error(error);
    else setEditing(false);
  };

  const answered = view.myAnswer !== null && !editing;

  return (
    <div className="question-phase animate-in" key={question.index}>
      <div className="question-top">
        <QuestionMeta question={question} />
        <Timer timer={view.timer} offset={game.clockOffset} variant="bar" />
      </div>
      <QuestionStatement text={question.text} imageUrl={question.imageUrl} media={question.media} />
      {paused && (
        <div className="paused-overlay" role="status">
          <Icon name="pause" size={32} /> Partie en pause
        </div>
      )}
      {answered ? (
        <div className="answer-sent animate-in" role="status">
          <div className="answer-sent-icon">
            <Icon name="check" size={40} strokeWidth={3} />
          </div>
          <h2>Réponse enregistrée</h2>
          <p className="stage-sub">{describeAnswer(view.myAnswer!, question)}</p>
          {view.allowAnswerChange && (
            <Button variant="ghost" className="btn-inverse" icon="edit" onClick={() => setEditing(true)} disabled={paused}>
              Modifier ma réponse
            </Button>
          )}
        </div>
      ) : (
        <AnswerInput question={question} disabled={sending || paused} onSubmit={submit} />
      )}
    </div>
  );
}

function RevealPhase({ view }: { view: PlayerView }) {
  const question = view.question;
  if (!view.answersVisible || !view.outcome || !question) {
    return (
      <StageMessage icon={view.myAnswer ? 'check' : 'clock'} title={view.myAnswer ? 'Réponse enregistrée' : 'Temps écoulé !'}>
        <p className="stage-sub">En attente de la correction…</p>
        {view.leaderboard && <Leaderboard entries={view.leaderboard} highlightId={view.me.id} />}
      </StageMessage>
    );
  }

  const { outcome } = view;
  const scored = outcome.scored !== false;
  const partial = scored && outcome.answered && !outcome.correct && outcome.points > 0;
  const status = !outcome.answered ? 'none' : !scored ? 'noted' : outcome.correct ? 'right' : partial ? 'partial' : 'wrong';
  const titles = {
    none: 'Pas de réponse',
    noted: 'Merci pour votre réponse !',
    right: 'Bonne réponse !',
    partial: `Presque ! ${Math.round((outcome.ratio ?? 0) * 100)} % juste`,
    wrong: 'Mauvaise réponse',
  };
  const icons = { none: 'clock', noted: 'check', right: 'check', partial: 'target', wrong: 'x' } as const;

  return (
    <div className="reveal-phase animate-in" key={question.index}>
      <div className={`outcome outcome-${status}`} role="status">
        <Icon name={icons[status]} size={34} strokeWidth={3} />
        <div>
          <h2>{titles[status]}</h2>
          {outcome.points > 0 && <p className="outcome-points">+{formatNumber(outcome.points)} points</p>}
        </div>
      </div>

      <p className="reveal-question">{question.text}</p>
      <PlayerCorrection question={question} correction={view.correction} mine={view.myAnswer} />
      <Explanation text={view.correction?.explanation} />

      {view.leaderboard && (
        <section className="stack" aria-label="Classement">
          <h3 className="section-title-inverse">Classement {view.me.rank !== null && `· vous êtes ${formatRank(view.me.rank)}`}</h3>
          <Leaderboard entries={view.leaderboard} highlightId={view.me.id} />
        </section>
      )}
    </div>
  );
}

function EndedPhase({ view }: { view: PlayerView }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  if (!view.final) {
    return (
      <StageMessage icon="flag" title="Partie terminée !" action={<Button size="lg" variant="primary" onClick={() => navigate(user ? homePathFor(user) : '/join')}>Quitter</Button>}>
        <p className="stage-sub">Merci d'avoir joué. Les résultats arrivent dès que le professeur les affiche.</p>
      </StageMessage>
    );
  }
  const { final } = view;
  return (
    <div className="ended-phase animate-in">
      <h1 className="ended-title">Partie terminée !</h1>
      <div className="final-rank">
        <span className="final-rank-value">{formatRank(final.rank)}</span>
        <span>
          sur {final.playerCount} · {formatNumber(final.score)} points
        </span>
      </div>
      <Podium entries={final.podium} />
      <Button size="lg" variant="primary" onClick={() => (view.isTest ? navigate(-1) : navigate(user ? homePathFor(user) : '/join'))}>
        {view.isTest ? 'Terminer le test' : 'Quitter'}
      </Button>
    </div>
  );
}
