import type { CSSProperties } from 'react';
import { LIMITS, POINTS_OPTIONS, QUESTION_TYPE_LABELS, QUESTION_TYPES, TIME_LIMITS } from '../../../shared/constants';
import { questionProblem } from '../../../shared/quizRules';
import type { AnswerInput, QuestionType } from '../../../shared/types';
import { Button } from '../components/Button';
import { Segmented, Switch, TextAreaField } from '../components/Form';
import { Icon, type IconName } from '../components/Icon';
import { CHOICE_LETTERS } from '../game/ChoiceTile';
import { convertQuestion, type DraftQuestion } from './draft';
import { ImagePicker } from './ImagePicker';

export const TYPE_ICONS: Record<QuestionType, IconName> = {
  single: 'circleDot',
  multiple: 'checkSquare',
  truefalse: 'toggle',
  text: 'text',
};

interface QuestionEditorProps {
  question: DraftQuestion;
  index: number;
  total: number;
  onChange: (question: DraftQuestion) => void;
  onMove: (delta: -1 | 1) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPreview: () => void;
}

export function QuestionEditor({ question, index, total, onChange, onMove, onDuplicate, onDelete, onPreview }: QuestionEditorProps) {
  const problem = questionProblem(question);
  const update = (patch: Partial<DraftQuestion>) => onChange({ ...question, ...patch });

  return (
    <div className="question-editor animate-in" key={question.key}>
      <div className="editor-toolbar">
        <h2 className="editor-heading">Question {index + 1}</h2>
        <span className="spacer" />
        <Button size="sm" variant="ghost" icon="chevronUp" aria-label="Monter la question" disabled={index === 0} onClick={() => onMove(-1)} />
        <Button size="sm" variant="ghost" icon="chevronDown" aria-label="Descendre la question" disabled={index === total - 1} onClick={() => onMove(1)} />
        <Button size="sm" variant="ghost" icon="copy" aria-label="Dupliquer la question" title="Dupliquer" onClick={onDuplicate} />
        <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer la question" title="Supprimer" onClick={onDelete} />
        <Button size="sm" variant="soft" icon="eye" onClick={onPreview}>
          Aperçu
        </Button>
      </div>

      {problem && (
        <p className="alert alert-warning" role="status">
          <Icon name="alert" size={18} /> {problem}
        </p>
      )}

      <div className="field">
        <span className="field-label">Type de question</span>
        <Segmented
          label="Type de question"
          value={question.type}
          onChange={(type) => onChange(convertQuestion(question, type))}
          options={QUESTION_TYPES.map((type) => ({ value: type, label: QUESTION_TYPE_LABELS[type], icon: TYPE_ICONS[type] }))}
        />
      </div>

      <TextAreaField
        label="Énoncé"
        value={question.text}
        onChange={(e) => update({ text: e.target.value })}
        maxLength={LIMITS.questionText}
        placeholder="Écrivez votre question…"
        rows={3}
        className="question-input"
        hint={`${question.text.length}/${LIMITS.questionText}`}
      />

      <ImagePicker label="Ajouter une image" value={question.imageUrl} onChange={(imageUrl) => update({ imageUrl })} />

      <AnswersEditor question={question} onChange={(answers) => update({ answers })} />

      <div className="editor-settings">
        <div className="field">
          <span className="field-label">
            <Icon name="clock" size={16} /> Temps limite
          </span>
          <Segmented
            label="Temps limite"
            className="chips"
            value={question.timeLimit}
            onChange={(timeLimit) => update({ timeLimit })}
            options={TIME_LIMITS.map((t) => ({ value: t, label: t < 60 ? `${t} s` : `${t / 60} min` }))}
          />
        </div>
        <div className="field">
          <span className="field-label">
            <Icon name="star" size={16} /> Points
          </span>
          <Switch label="Compter les points" checked={question.pointsEnabled} onChange={(pointsEnabled) => update({ pointsEnabled })} />
          {question.pointsEnabled && (
            <Segmented
              label="Nombre de points"
              className="chips"
              value={question.points}
              onChange={(points) => update({ points })}
              options={POINTS_OPTIONS.map((p) => ({ value: p, label: p === 1000 ? '1000 (standard)' : p === 2000 ? '2000 (double)' : `${p}` }))}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function AnswersEditor({ question, onChange }: { question: DraftQuestion; onChange: (answers: AnswerInput[]) => void }) {
  const { answers, type } = question;
  const setAnswer = (index: number, patch: Partial<AnswerInput>) => onChange(answers.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  if (type === 'text') {
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
                onChange={(e) => setAnswer(index, { text: e.target.value })}
              />
              {answers.length > 1 && (
                <Button variant="ghost" icon="x" aria-label={`Retirer la réponse ${index + 1}`} onClick={() => onChange(answers.filter((_, i) => i !== index))} />
              )}
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

  const toggleCorrect = (index: number) => {
    if (type === 'multiple') setAnswer(index, { isCorrect: !answers[index].isCorrect });
    else onChange(answers.map((a, i) => ({ ...a, isCorrect: i === index })));
  };

  return (
    <div className="field">
      <span className="field-label">Réponses</span>
      <span className="field-hint">
        {type === 'multiple' ? 'Touchez ✓ pour marquer toutes les bonnes réponses.' : 'Touchez ✓ pour choisir la bonne réponse.'}
      </span>
      <div className="answer-editor-grid">
        {answers.map((answer, index) => (
          <div key={index} className={`answer-editor choice-${index}${answer.isCorrect ? ' is-correct' : ''}`}>
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
            <button
              type="button"
              className="correct-toggle"
              aria-pressed={answer.isCorrect}
              aria-label={`Réponse ${CHOICE_LETTERS[index]} correcte`}
              onClick={() => toggleCorrect(index)}
            >
              <Icon name="check" size={22} strokeWidth={3} />
            </button>
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
