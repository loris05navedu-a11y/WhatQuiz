import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import type { PublicQuestion, SubmittedAnswer } from '../../../shared/types';
import { Button } from '../components/Button';
import { ChoiceTile } from './ChoiceTile';

interface AnswerInputProps {
  question: PublicQuestion;
  disabled: boolean;
  onSubmit: (answer: SubmittedAnswer) => void;
}

/** Zone de réponse de l'élève, adaptée au type de question. */
export function AnswerInput({ question, disabled, onSubmit }: AnswerInputProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const [text, setText] = useState('');

  useEffect(() => {
    setSelected([]);
    setText('');
  }, [question.index]);

  if (question.type === 'text') {
    const submit = (event: FormEvent) => {
      event.preventDefault();
      if (text.trim()) onSubmit({ kind: 'text', text: text.trim() });
    };
    return (
      <form className="text-answer" onSubmit={submit}>
        <label htmlFor="text-answer" className="sr-only">
          Votre réponse
        </label>
        <input
          id="text-answer"
          className="input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tapez votre réponse…"
          maxLength={120}
          autoComplete="off"
          autoCapitalize="off"
          autoFocus
          disabled={disabled}
        />
        <Button type="submit" variant="primary" size="lg" icon="check" disabled={disabled || !text.trim()}>
          Envoyer
        </Button>
      </form>
    );
  }

  const multiple = question.type === 'multiple';
  const toggle = (index: number) => {
    if (!multiple) return onSubmit({ kind: 'choice', choices: [index] });
    setSelected((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index]));
  };

  return (
    <div className="stack" style={{ '--gap': '14px' } as CSSProperties}>
      {multiple && <p className="answer-hint">Plusieurs réponses possibles — sélectionnez-les puis validez.</p>}
      <div className={`choices choices-${question.choices.length}${question.type === 'truefalse' ? ' choices-tf' : ''}`}>
        {question.choices.map((choice, index) => (
          <ChoiceTile
            key={index}
            index={index}
            text={choice}
            multiple={multiple}
            state={selected.includes(index) ? 'selected' : 'idle'}
            disabled={disabled}
            onClick={() => toggle(index)}
          />
        ))}
      </div>
      {multiple && (
        <Button variant="primary" size="lg" icon="check" block disabled={disabled || selected.length === 0} onClick={() => onSubmit({ kind: 'choice', choices: selected })}>
          Valider ma réponse
        </Button>
      )}
    </div>
  );
}
