import { useState } from 'react';
import type { QuestionInput } from '../../../shared/types';
import { Switch } from '../components/Form';
import { ChoiceTile } from '../game/ChoiceTile';
import { QuestionMeta, QuestionStatement } from '../game/QuestionView';

interface QuestionPreviewProps {
  question: QuestionInput;
  index: number;
  total: number;
  showAnswerToggle?: boolean;
}

/** Rendu d'une question tel que les élèves le verront, avec affichage optionnel de la correction. */
export function QuestionPreview({ question, index, total, showAnswerToggle = true }: QuestionPreviewProps) {
  const [showAnswer, setShowAnswer] = useState(!showAnswerToggle);
  return (
    <div className="stage stage-inline">
      <div className="question-phase">
        <QuestionMeta question={{ index, total, type: question.type, points: question.points, pointsEnabled: question.pointsEnabled }} />
        <QuestionStatement text={question.text || 'Énoncé de la question'} imageUrl={question.imageUrl} />
        {question.type === 'text' ? (
          <div className="text-answers">
            <input className="input" disabled placeholder="Tapez votre réponse…" aria-label="Zone de réponse (aperçu)" />
            {showAnswer && (
              <p>
                Réponses acceptées : <b>{question.answers.map((a) => a.text).filter(Boolean).join(' / ') || '—'}</b>
              </p>
            )}
          </div>
        ) : (
          <div className={`choices choices-${question.answers.length}${question.type === 'truefalse' ? ' choices-tf' : ''} choices-compact`}>
            {question.answers.map((answer, i) => (
              <ChoiceTile key={i} index={i} text={answer.text || '…'} state={showAnswer ? (answer.isCorrect ? 'correct' : 'dimmed') : 'idle'} />
            ))}
          </div>
        )}
        {showAnswerToggle && (
          <div className="preview-toggle">
            <Switch label="Afficher la bonne réponse" checked={showAnswer} onChange={setShowAnswer} />
          </div>
        )}
      </div>
    </div>
  );
}
