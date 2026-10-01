import { useMemo, useState } from 'react';
import { questionType } from '../../../shared/questionTypes';
import { pointsForGrade } from '../../../shared/scoring';
import type { PublicQuestion, QuestionInput, SubmittedAnswer } from '../../../shared/types';
import { Button } from '../components/Button';
import { Switch } from '../components/Form';
import { Icon } from '../components/Icon';
import { AnswerInput } from '../game/AnswerInput';
import { QuestionMeta, QuestionStatement } from '../game/QuestionView';
import { formatNumber } from '../lib/format';
import { describeAnswer } from '../questionTypes/meta';
import { Explanation, PlayerCorrection } from '../questionTypes/results';

interface QuestionPreviewProps {
  question: QuestionInput;
  index: number;
  total: number;
  showAnswerToggle?: boolean;
}

/** Générateur pseudo-aléatoire reproductible : le mélange de l'aperçu ne change pas à chaque frappe. */
function seededRandom(seed: string): () => number {
  let state = [...seed].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 2654435761) >>> 0, 2166136261) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Aperçu interactif d'une question, tel que les élèves la verront : on peut y répondre et voir la correction,
 * calculée exactement comme pendant une partie (même registre de types).
 */
export function QuestionPreview({ question, index, total, showAnswerToggle = true }: QuestionPreviewProps) {
  const definition = questionType(question.type);
  const layout = useMemo(() => definition.layout(question, seededRandom(question.answers.map((a) => a.text).join('|')), false), [definition, question]);
  const publicQuestion: PublicQuestion = {
    index,
    total,
    type: question.type,
    text: question.text || 'Énoncé de la question',
    imageUrl: question.imageUrl,
    ...definition.publicPart(question, layout),
    timeLimit: question.timeLimit,
    points: question.bonus ? question.points * 2 : question.points,
    pointsEnabled: question.pointsEnabled && definition.scored,
    bonus: question.bonus,
    media: question.media,
    scored: definition.scored,
  };
  const correction = { ...definition.correction(question, layout), explanation: question.explanation };
  const [showAnswer, setShowAnswer] = useState(!showAnswerToggle);
  const [answer, setAnswer] = useState<SubmittedAnswer | null>(null);

  const accepted = answer ? definition.accept(answer, question, layout) : null;
  const grade = accepted ? definition.grade(question, accepted) : null;
  const points = grade
    ? pointsForGrade(grade, { basePoints: question.points, pointsEnabled: publicQuestion.pointsEnabled, bonus: question.bonus, mode: 'fixed', responseMs: 0, timeLimitMs: 1 })
    : 0;
  const revealed = showAnswer || answer !== null;

  return (
    <div className="stage stage-inline">
      <div className="question-phase">
        <QuestionMeta question={publicQuestion} />
        <QuestionStatement text={publicQuestion.text} imageUrl={question.imageUrl} media={question.media} />
        {answer === null && !showAnswer && <AnswerInput key={JSON.stringify(layout) + question.type} question={publicQuestion} disabled={false} onSubmit={setAnswer} />}
        {answer !== null && (
          <div className={`outcome outcome-${!definition.scored ? 'noted' : grade?.correct ? 'right' : (grade?.ratio ?? 0) > 0 ? 'partial' : 'wrong'}`} role="status">
            <Icon name={grade?.correct || !definition.scored ? 'check' : 'x'} size={30} strokeWidth={3} />
            <div>
              <h2>{!definition.scored ? 'Réponse enregistrée' : grade?.correct ? 'Bonne réponse !' : (grade?.ratio ?? 0) > 0 ? `Presque ! ${Math.round(grade!.ratio * 100)} % juste` : 'Mauvaise réponse'}</h2>
              <p className="stage-sub">{describeAnswer(answer, publicQuestion)}</p>
              {points > 0 && <p className="outcome-points">+{formatNumber(points)} points (sans bonus de rapidité)</p>}
            </div>
          </div>
        )}
        {revealed && definition.scored && (
          <PlayerCorrection question={publicQuestion} correction={correction} mine={answer ? definition.toDisplay(accepted ?? answer, layout) : null} />
        )}
        {revealed && <Explanation text={question.explanation} />}
        {showAnswerToggle && (
          <div className="preview-toggle row">
            {answer !== null && (
              <Button size="sm" variant="ghost" className="btn-inverse" icon="refresh" onClick={() => setAnswer(null)}>
                Réessayer
              </Button>
            )}
            <Switch label="Afficher la bonne réponse" checked={showAnswer} onChange={setShowAnswer} />
          </div>
        )}
      </div>
    </div>
  );
}
