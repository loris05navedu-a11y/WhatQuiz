import { LIMITS, POINTS_OPTIONS, QUESTION_TYPE_LABELS, QUESTION_TYPES, TIME_LIMITS } from '../../../shared/constants';
import { QUESTION_TYPE_DEFINITIONS } from '../../../shared/questionTypes';
import { questionProblem } from '../../../shared/quizRules';
import type { QuestionType } from '../../../shared/types';
import { Button } from '../components/Button';
import { Segmented, Switch, TextAreaField } from '../components/Form';
import { Icon } from '../components/Icon';
import { AnswersEditor } from '../questionTypes/editors';
import { TYPE_ICONS } from '../questionTypes/meta';
import { convertQuestion, type DraftQuestion } from './draft';
import { ImagePicker } from './ImagePicker';

export { TYPE_ICONS };

const formatTime = (t: number) => (t < 60 ? `${t} s` : t % 60 === 0 ? `${t / 60} min` : `${Math.floor(t / 60)} min ${t % 60}`);

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

      <label className="field">
        <span className="field-label">Type de question</span>
        <span className="type-select">
          <Icon name={TYPE_ICONS[question.type]} size={20} />
          <select className="input" value={question.type} onChange={(e) => onChange(convertQuestion(question, e.target.value as QuestionType))}>
            {QUESTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {QUESTION_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </span>
        <span className="field-hint">{QUESTION_TYPE_DEFINITIONS[question.type].description}</span>
      </label>

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

      <AnswersEditor question={question} onChange={update} />

      <TextAreaField
        label="Explication (facultatif)"
        value={question.explanation ?? ''}
        onChange={(e) => update({ explanation: e.target.value })}
        maxLength={LIMITS.explanation}
        placeholder="Affichée avec la correction : pourquoi c’est la bonne réponse…"
        rows={2}
        hint={`${(question.explanation ?? '').length}/${LIMITS.explanation}`}
      />

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
            options={TIME_LIMITS.map((t) => ({ value: t, label: formatTime(t) }))}
          />
        </div>
        <div className="field">
          <span className="field-label">
            <Icon name="star" size={16} /> Points
          </span>
          {!QUESTION_TYPE_DEFINITIONS[question.type].scored ? (
            <span className="field-hint">Pas de points : ce type de question n’a pas de bonne réponse.</span>
          ) : (
            <Switch label="Compter les points" checked={question.pointsEnabled} onChange={(pointsEnabled) => update({ pointsEnabled })} />
          )}
          {question.pointsEnabled && QUESTION_TYPE_DEFINITIONS[question.type].scored && (
            <Segmented
              label="Nombre de points"
              className="chips"
              value={question.points}
              onChange={(points) => update({ points })}
              options={POINTS_OPTIONS.map((p) => ({ value: p, label: p === 1000 ? '1000 (standard)' : p === 2000 ? '2000 (double)' : `${p}` }))}
            />
          )}
          {question.pointsEnabled && QUESTION_TYPE_DEFINITIONS[question.type].scored && (
            <Switch
              label="Question bonus"
              description="Points doublés, annoncée aux élèves par un bandeau « Bonus »."
              checked={question.bonus ?? false}
              onChange={(bonus) => update({ bonus })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
