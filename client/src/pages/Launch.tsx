import { useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { DEFAULT_GAME_SETTINGS, LIMITS } from '../../../shared/constants';
import type { GameSettings, ScoringMode } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { gameApi } from '../api/endpoints';
import { Button, PageLoader } from '../components/Button';
import { Switch, TextField } from '../components/Form';
import { Icon, type IconName } from '../components/Icon';
import { useToast } from '../context/ToastContext';
import { plural } from '../lib/format';
import { useQuiz } from '../lib/useQuiz';

const SCORING: { value: ScoringMode; icon: IconName; title: string; text: string }[] = [
  { value: 'speed', icon: 'zap', title: 'Bonus rapidité', text: 'Plus la réponse est rapide, plus elle rapporte (de 100 % à 50 %).' },
  { value: 'fixed', icon: 'target', title: 'Points fixes', text: 'Chaque bonne réponse rapporte tous ses points.' },
  { value: 'none', icon: 'eyeOff', title: 'Sans score', text: 'Aucun point ni classement : idéal pour une évaluation formative.' },
];

export function LaunchPage() {
  const id = Number(useParams().id);
  const quiz = useQuiz(id);
  const navigate = useNavigate();
  const toast = useToast();
  const [settings, setSettings] = useState<GameSettings>({ ...DEFAULT_GAME_SETTINGS });
  const [launching, setLaunching] = useState(false);

  if (!quiz) return <PageLoader />;
  const set = (patch: Partial<GameSettings>) => setSettings((current) => ({ ...current, ...patch }));

  const launch = async () => {
    setLaunching(true);
    try {
      const { code } = await gameApi.create(id, 'live', settings);
      navigate(`/host/${code}`);
    } catch (error) {
      toast.error(errorMessage(error));
      setLaunching(false);
    }
  };

  return (
    <div className="stack launch" style={{ maxWidth: 820, margin: '0 auto', '--gap': '24px' } as CSSProperties}>
      <div>
        <p className="muted">Lancer une partie · {plural(quiz.questions.length, 'question')}</p>
        <h1 className="page-title">{quiz.title}</h1>
      </div>

      <section className="stack" aria-labelledby="scoring-title">
        <h2 id="scoring-title" className="section-title">
          Mode de score
        </h2>
        <div className="scoring-options" role="radiogroup" aria-labelledby="scoring-title">
          {SCORING.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={settings.scoringMode === option.value}
              className="scoring-option card"
              onClick={() => set({ scoringMode: option.value })}
            >
              <span className="stat-icon">
                <Icon name={option.icon} />
              </span>
              <b>{option.title}</b>
              <span className="muted small">{option.text}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card stack" aria-labelledby="options-title">
        <h2 id="options-title" className="section-title">
          Déroulement
        </h2>
        <Switch
          label="Terminer la question quand tout le monde a répondu"
          checked={settings.endWhenAllAnswered}
          onChange={(v) => set({ endWhenAllAnswered: v })}
        />
        <Switch
          label="Montrer la correction automatiquement"
          description="Sinon, vous choisissez quand l’afficher sur les appareils des élèves."
          checked={settings.autoRevealAnswers}
          onChange={(v) => set({ autoRevealAnswers: v })}
        />
        <Switch
          label="Autoriser la modification des réponses"
          description="Tant que le temps n’est pas écoulé."
          checked={settings.allowAnswerChange}
          onChange={(v) => set({ allowAnswerChange: v })}
        />
        <Switch label="Autoriser le retour à la question précédente" checked={settings.allowBack} onChange={(v) => set({ allowBack: v })} />
        <Switch
          label="Avance automatique"
          description="La partie s’enchaîne seule : pratique pour un travail en autonomie."
          checked={settings.autoAdvance}
          onChange={(v) => set({ autoAdvance: v })}
        />
        <TextField
          label="Nombre maximum de joueurs"
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.maxPlayers}
          value={settings.maxPlayers}
          onChange={(e) => set({ maxPlayers: Math.min(LIMITS.maxPlayers, Math.max(1, Number(e.target.value) || 1)) })}
          style={{ maxWidth: 160 }}
        />
      </section>

      <Button variant="primary" size="lg" icon="play" block loading={launching} onClick={launch}>
        Créer la salle et afficher le code
      </Button>
    </div>
  );
}
