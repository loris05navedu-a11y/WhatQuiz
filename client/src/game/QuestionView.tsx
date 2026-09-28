import { QUESTION_TYPE_LABELS } from '../../../shared/constants';
import type { PublicQuestion } from '../../../shared/types';

export function QuestionMeta({ question }: { question: Pick<PublicQuestion, 'index' | 'total' | 'type' | 'points' | 'pointsEnabled'> }) {
  return (
    <div className="question-meta">
      <span className="badge badge-brand">
        Question {question.index + 1}/{question.total}
      </span>
      <span className="badge">{QUESTION_TYPE_LABELS[question.type]}</span>
      {question.pointsEnabled && question.points > 0 && <span className="badge">{question.points} pts</span>}
    </div>
  );
}

/** Énoncé et image d'une question (taille adaptée à l'écran, élève ou projection). */
export function QuestionStatement({ text, imageUrl, large }: { text: string; imageUrl: string | null; large?: boolean }) {
  return (
    <div className={`question-statement${large ? ' large' : ''}`}>
      <h2 className="question-text">{text}</h2>
      {imageUrl && <img className="question-image" src={imageUrl} alt="" loading="lazy" />}
    </div>
  );
}
