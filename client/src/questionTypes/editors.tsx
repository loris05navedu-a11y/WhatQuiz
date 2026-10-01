import { useId, useState, type CSSProperties } from 'react';
import { LIMITS } from '../../../shared/constants';
import type { AnswerInput, QuestionConfig } from '../../../shared/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import type { DraftQuestion } from '../editor/draft';
import { CHOICE_LETTERS } from '../game/ChoiceTile';
import { formatValue } from './meta';

export interface AnswersEditorProps {
  question: DraftQuestion;
  onChange: (patch: Partial<DraftQuestion>) => void;
}

/** Saisie des réponses, propre à chaque type de question. */
export function AnswersEditor({ question, onChange }: AnswersEditorProps) {
  const setAnswers = (answers: AnswerInput[]) => onChange({ answers });
  switch (question.type) {
    case 'single':
    case 'multiple':
    case 'truefalse':
    case 'poll':
      return <ChoiceAnswers question={question} onChange={setAnswers} />;
    case 'text':
      return <AcceptedAnswers answers={question.answers} onChange={setAnswers} />;
    case 'order':
    case 'ranking':
      return <ItemsEditor question={question} onChange={setAnswers} />;
    case 'match':
      return <PairsEditor answers={question.answers} onChange={setAnswers} />;
    case 'numeric':
      return <NumberConfig config={question.config ?? {}} onChange={(config) => onChange({ config })} />;
    case 'slider':
      return <SliderConfig config={question.config ?? {}} onChange={(config) => onChange({ config })} />;
    case 'wordcloud':
      return (
        <p className="field-hint editor-note">
          <Icon name="cloud" size={18} /> Chaque élève propose un mot ou une courte expression ({LIMITS.wordcloudAnswer} caractères maximum).
          Les réponses les plus fréquentes s’affichent en grand. Pas de bonne réponse, pas de points.
        </p>
      );
  }
}

function ChoiceAnswers({ question, onChange }: { question: DraftQuestion; onChange: (answers: AnswerInput[]) => void }) {
  const { answers, type } = question;
  const setAnswer = (index: number, patch: Partial<AnswerInput>) => onChange(answers.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  const isPoll = type === 'poll';
  const toggleCorrect = (index: number) => {
    if (type === 'multiple') setAnswer(index, { isCorrect: !answers[index].isCorrect });
    else onChange(answers.map((a, i) => ({ ...a, isCorrect: i === index })));
  };

  return (
    <div className="field">
      <span className="field-label">{isPoll ? 'Choix proposés' : 'Réponses'}</span>
      <span className="field-hint">
        {isPoll
          ? 'Sondage : aucune bonne réponse, la répartition des votes est affichée à la fin.'
          : type === 'multiple'
            ? 'Touchez ✓ pour marquer toutes les bonnes réponses.'
            : 'Touchez ✓ pour choisir la bonne réponse.'}
      </span>
      <div className="answer-editor-grid">
        {answers.map((answer, index) => (
          <div key={index} className={`answer-editor choice-${index}${answer.isCorrect && !isPoll ? ' is-correct' : ''}`}>
            <span className="choice-letter" aria-hidden="true">
              {CHOICE_LETTERS[index]}
            </span>
            <input
              className="answer-editor-input"
              value={answer.text}
              maxLength={LIMITS.answerText}
              placeholder={`Réponse ${CHOICE_LETTERS[index]}`}
              aria-label={`Texte de la réponse ${CHOICE_LETTERS[index]}`}
              readOnly={type === 'truefalse'}
              onChange={(e) => setAnswer(index, { text: e.target.value })}
            />
            {!isPoll && (
              <button
                type="button"
                className="correct-toggle"
                aria-pressed={answer.isCorrect}
                aria-label={`Réponse ${CHOICE_LETTERS[index]} correcte`}
                onClick={() => toggleCorrect(index)}
              >
                <Icon name="check" size={22} strokeWidth={3} />
              </button>
            )}
            {type !== 'truefalse' && answers.length > LIMITS.minChoices && (
              <button type="button" className="answer-remove" aria-label={`Supprimer la réponse ${CHOICE_LETTERS[index]}`} onClick={() => onChange(answers.filter((_, i) => i !== index))}>
                <Icon name="x" size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
      {type !== 'truefalse' && answers.length < LIMITS.maxChoices && (
        <Button variant="ghost" icon="plus" onClick={() => onChange([...answers, { text: '', isCorrect: false }])}>
          Ajouter une réponse
        </Button>
      )}
    </div>
  );
}

function AcceptedAnswers({ answers, onChange }: { answers: AnswerInput[]; onChange: (answers: AnswerInput[]) => void }) {
  const setAnswer = (index: number, text: string) => onChange(answers.map((a, i) => (i === index ? { ...a, text } : a)));
  return (
    <div className="field">
      <span className="field-label">Réponses acceptées</span>
      <span className="field-hint">Majuscules, accents et espaces en trop sont ignorés. Ajoutez des variantes si besoin.</span>
      <div className="stack" style={{ '--gap': '8px' } as CSSProperties}>
        {answers.map((answer, index) => (
          <div key={index} className="row accepted-row">
            <input
              className="input"
              value={answer.text}
              maxLength={LIMITS.answerText}
              placeholder={index === 0 ? 'Réponse attendue' : 'Variante acceptée'}
              aria-label={`Réponse acceptée ${index + 1}`}
              onChange={(e) => setAnswer(index, e.target.value)}
            />
            {answers.length > 1 && <Button variant="ghost" icon="x" aria-label={`Retirer la réponse ${index + 1}`} onClick={() => onChange(answers.filter((_, i) => i !== index))} />}
          </div>
        ))}
      </div>
      {answers.length < LIMITS.maxAcceptedAnswers && (
        <Button variant="ghost" icon="plus" onClick={() => onChange([...answers, { text: '', isCorrect: true }])}>
          Ajouter une variante
        </Button>
      )}
    </div>
  );
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

function ItemsEditor({ question, onChange }: { question: DraftQuestion; onChange: (answers: AnswerInput[]) => void }) {
  const { answers } = question;
  const isOrder = question.type === 'order';
  return (
    <div className="field">
      <span className="field-label">{isOrder ? 'Éléments, dans le bon ordre' : 'Éléments à classer'}</span>
      <span className="field-hint">
        {isOrder
          ? 'Saisissez les éléments dans l’ordre attendu : ils seront mélangés pour les élèves. Points partiels pour chaque élément bien placé.'
          : 'Chaque élève classera ces éléments selon son avis ; le classement moyen de la classe s’affiche ensuite.'}
      </span>
      <ol className="items-editor">
        {answers.map((answer, index) => (
          <li key={index} className="item-row">
            <span className="item-rank">{index + 1}</span>
            <input
              className="input"
              value={answer.text}
              maxLength={LIMITS.answerText}
              placeholder={`Élément ${index + 1}`}
              aria-label={`Élément ${index + 1}`}
              onChange={(e) => onChange(answers.map((a, i) => (i === index ? { ...a, text: e.target.value } : a)))}
            />
            <Button size="sm" variant="ghost" icon="chevronUp" aria-label={`Monter l’élément ${index + 1}`} disabled={index === 0} onClick={() => onChange(move(answers, index, index - 1))} />
            <Button size="sm" variant="ghost" icon="chevronDown" aria-label={`Descendre l’élément ${index + 1}`} disabled={index === answers.length - 1} onClick={() => onChange(move(answers, index, index + 1))} />
            {answers.length > LIMITS.minItems && (
              <Button size="sm" variant="ghost" icon="x" aria-label={`Supprimer l’élément ${index + 1}`} onClick={() => onChange(answers.filter((_, i) => i !== index))} />
            )}
          </li>
        ))}
      </ol>
      {answers.length < LIMITS.maxItems && (
        <Button variant="ghost" icon="plus" onClick={() => onChange([...answers, { text: '', isCorrect: true }])}>
          Ajouter un élément
        </Button>
      )}
    </div>
  );
}

function PairsEditor({ answers, onChange }: { answers: AnswerInput[]; onChange: (answers: AnswerInput[]) => void }) {
  const set = (index: number, patch: Partial<AnswerInput>) => onChange(answers.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  return (
    <div className="field">
      <span className="field-label">Paires à associer</span>
      <span className="field-hint">Les éléments de droite seront mélangés. Points partiels pour chaque paire juste.</span>
      <div className="pairs-editor">
        {answers.map((answer, index) => (
          <div key={index} className="pair-row">
            <input className="input" value={answer.text} maxLength={LIMITS.answerText} placeholder="Élément" aria-label={`Élément ${index + 1}`} onChange={(e) => set(index, { text: e.target.value })} />
            <Icon name="link" size={18} className="pair-link" />
            <input
              className="input"
              value={answer.match ?? ''}
              maxLength={LIMITS.answerText}
              placeholder="Correspondance"
              aria-label={`Correspondance de l’élément ${index + 1}`}
              onChange={(e) => set(index, { match: e.target.value })}
            />
            {answers.length > LIMITS.minItems && (
              <Button size="sm" variant="ghost" icon="x" aria-label={`Supprimer la paire ${index + 1}`} onClick={() => onChange(answers.filter((_, i) => i !== index))} />
            )}
          </div>
        ))}
      </div>
      {answers.length < LIMITS.maxChoices && (
        <Button variant="ghost" icon="plus" onClick={() => onChange([...answers, { text: '', isCorrect: true, match: '' }])}>
          Ajouter une paire
        </Button>
      )}
    </div>
  );
}

/** Champ numérique tolérant la virgule ; vide = valeur absente. */
function NumberInput({ label, value, onChange, hint, min }: { label: string; value: number | undefined; onChange: (value: number | undefined) => void; hint?: string; min?: number }) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // Valeur changée de l'extérieur (annulation, changement de question) : on resynchronise le champ.
    setLastValue(value);
    if (Number(text.replace(',', '.')) !== value) setText(value === undefined ? '' : String(value));
  }
  const id = useId();
  return (
    <div className="field number-field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <input
        id={id}
        className="input"
        inputMode="decimal"
        value={text}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,-]/g, '');
          setText(raw);
          const parsed = raw.trim() === '' || raw === '-' ? undefined : Number(raw.replace(',', '.'));
          const next = parsed === undefined || Number.isNaN(parsed) ? undefined : min !== undefined ? Math.max(min, parsed) : parsed;
          setLastValue(next);
          onChange(next);
        }}
      />
      {hint && (
        <span id={`${id}-hint`} className="field-hint">
          {hint}
        </span>
      )}
    </div>
  );
}

function NumberConfig({ config, onChange }: { config: QuestionConfig; onChange: (config: QuestionConfig) => void }) {
  const set = (patch: Partial<QuestionConfig>) => onChange({ ...config, ...patch });
  return (
    <div className="field">
      <span className="field-label">Réponse attendue</span>
      <div className="number-grid">
        <NumberInput label="Valeur" value={config.answer} onChange={(answer) => set({ answer })} />
        <NumberInput label="Marge acceptée (±)" value={config.tolerance} min={0} onChange={(tolerance) => set({ tolerance: tolerance ?? 0 })} hint="0 = valeur exacte" />
        <label className="field number-field">
          <span className="field-label">Unité</span>
          <input className="input" value={config.unit ?? ''} maxLength={LIMITS.unit} placeholder="cm, €, °C…" onChange={(e) => set({ unit: e.target.value })} />
        </label>
      </div>
    </div>
  );
}

function SliderConfig({ config, onChange }: { config: QuestionConfig; onChange: (config: QuestionConfig) => void }) {
  const set = (patch: Partial<QuestionConfig>) => onChange({ ...config, ...patch });
  const { min = 0, max = 100, step = 1, answer, unit } = config;
  return (
    <div className="field">
      <span className="field-label">Curseur</span>
      <div className="number-grid">
        <NumberInput label="Minimum" value={config.min} onChange={(value) => set({ min: value })} />
        <NumberInput label="Maximum" value={config.max} onChange={(value) => set({ max: value })} />
        <NumberInput label="Pas" value={config.step} onChange={(value) => set({ step: value })} hint="Écart entre deux positions" />
        <NumberInput label="Bonne réponse" value={config.answer} onChange={(value) => set({ answer: value })} />
        <NumberInput label="Marge acceptée (±)" value={config.tolerance} min={0} onChange={(tolerance) => set({ tolerance: tolerance ?? 0 })} />
        <label className="field number-field">
          <span className="field-label">Unité</span>
          <input className="input" value={unit ?? ''} maxLength={LIMITS.unit} placeholder="%, km…" onChange={(e) => set({ unit: e.target.value })} />
        </label>
      </div>
      {min < max && step > 0 && answer !== undefined && (
        <div className="slider-preview" aria-hidden="true">
          <input type="range" min={min} max={max} step={step} value={answer} readOnly tabIndex={-1} />
          <span>
            {formatValue(min, unit)} · <b>{formatValue(answer, unit)}</b> · {formatValue(max, unit)}
          </span>
        </div>
      )}
    </div>
  );
}
