import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { LIMITS } from '../../../shared/constants';
import type { PublicQuestion, SubmittedAnswer } from '../../../shared/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { formatValue } from '../questionTypes/meta';
import { ChoiceTile } from './ChoiceTile';

interface AnswerInputProps {
  question: PublicQuestion;
  disabled: boolean;
  onSubmit: (answer: SubmittedAnswer) => void;
}

/** Zone de réponse de l'élève, adaptée au type de question. Les indices envoyés suivent l'ordre affiché. */
export function AnswerInput(props: AnswerInputProps) {
  // Une nouvelle question remet la saisie à zéro.
  const key = `${props.question.index}-${props.question.type}`;
  switch (props.question.type) {
    case 'text':
      return <TextAnswer key={key} {...props} maxLength={LIMITS.answerText} placeholder="Tapez votre réponse…" />;
    case 'wordcloud':
      return <TextAnswer key={key} {...props} maxLength={LIMITS.wordcloudAnswer} placeholder="Un mot ou une courte expression…" />;
    case 'numeric':
      return <NumberAnswer key={key} {...props} />;
    case 'slider':
      return <SliderAnswer key={key} {...props} />;
    case 'order':
    case 'ranking':
      return <OrderAnswer key={key} {...props} />;
    case 'match':
      return <MatchAnswer key={key} {...props} />;
    default:
      return <ChoiceAnswer key={key} {...props} />;
  }
}

function TextAnswer({ disabled, onSubmit, maxLength, placeholder }: AnswerInputProps & { maxLength: number; placeholder: string }) {
  const [text, setText] = useState('');
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
        placeholder={placeholder}
        maxLength={maxLength}
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

function NumberAnswer({ question, disabled, onSubmit }: AnswerInputProps) {
  const [text, setText] = useState('');
  const value = Number(text.replace(',', '.').replace(/\s/g, ''));
  const valid = text.trim() !== '' && Number.isFinite(value);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onSubmit({ kind: 'number', value });
  };
  return (
    <form className="text-answer" onSubmit={submit}>
      <label htmlFor="number-answer" className="sr-only">
        Votre réponse (nombre)
      </label>
      <div className="number-answer">
        <input
          id="number-answer"
          className="input"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value.replace(/[^\d.,\s-]/g, ''))}
          placeholder="Votre nombre…"
          autoComplete="off"
          autoFocus
          disabled={disabled}
        />
        {question.unit && <span className="number-unit">{question.unit}</span>}
      </div>
      <Button type="submit" variant="primary" size="lg" icon="check" disabled={disabled || !valid}>
        Envoyer
      </Button>
    </form>
  );
}

function SliderAnswer({ question, disabled, onSubmit }: AnswerInputProps) {
  const { min, max, step } = question.range ?? { min: 0, max: 100, step: 1 };
  const [value, setValue] = useState(() => Math.round(((min + max) / 2 - min) / step) * step + min);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
  const rounded = Math.round(value * 1e6) / 1e6;
  return (
    <div className="slider-answer">
      <output className="slider-value" htmlFor="slider-answer" aria-live="polite">
        {formatValue(rounded, question.unit)}
      </output>
      <div className="slider-row">
        <Button variant="ghost" className="btn-inverse" icon="chevronLeft" aria-label="Diminuer" disabled={disabled || value <= min} onClick={() => setValue((v) => clamp(v - step))} />
        <input
          id="slider-answer"
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(Number(e.target.value))}
          aria-label="Choisissez une valeur"
        />
        <Button variant="ghost" className="btn-inverse" icon="chevronRight" aria-label="Augmenter" disabled={disabled || value >= max} onClick={() => setValue((v) => clamp(v + step))} />
      </div>
      <div className="slider-bounds" aria-hidden="true">
        <span>{formatValue(min, question.unit)}</span>
        <span>{formatValue(max, question.unit)}</span>
      </div>
      <Button variant="primary" size="lg" icon="check" block disabled={disabled} onClick={() => onSubmit({ kind: 'number', value: rounded })}>
        Valider ma réponse
      </Button>
    </div>
  );
}

function OrderAnswer({ question, disabled, onSubmit }: AnswerInputProps) {
  const [order, setOrder] = useState(() => question.choices.map((_, i) => i));
  const move = (from: number, to: number) =>
    setOrder((current) => {
      if (to < 0 || to >= current.length) return current;
      const copy = [...current];
      const [item] = copy.splice(from, 1);
      copy.splice(to, 0, item);
      return copy;
    });
  return (
    <div className="stack" style={{ '--gap': '14px' } as CSSProperties}>
      <p className="answer-hint">
        {question.type === 'ranking' ? 'Classez du premier au dernier selon votre avis' : 'Remettez les éléments dans le bon ordre'} avec les flèches, puis validez.
      </p>
      <ol className="order-answer">
        {order.map((item, place) => (
          <li key={item} className="order-item">
            <span className="order-rank">{place + 1}</span>
            <span className="order-text">{question.choices[item]}</span>
            <Button variant="ghost" className="btn-inverse" icon="chevronUp" aria-label={`Monter « ${question.choices[item]} »`} disabled={disabled || place === 0} onClick={() => move(place, place - 1)} />
            <Button
              variant="ghost"
              className="btn-inverse"
              icon="chevronDown"
              aria-label={`Descendre « ${question.choices[item]} »`}
              disabled={disabled || place === order.length - 1}
              onClick={() => move(place, place + 1)}
            />
          </li>
        ))}
      </ol>
      <Button variant="primary" size="lg" icon="check" block disabled={disabled} onClick={() => onSubmit({ kind: 'order', order })}>
        Valider cet ordre
      </Button>
    </div>
  );
}

function MatchAnswer({ question, disabled, onSubmit }: AnswerInputProps) {
  const options = question.options ?? [];
  const [pairs, setPairs] = useState<(number | null)[]>(() => question.choices.map(() => null));
  const complete = pairs.every((p) => p !== null);
  return (
    <div className="stack" style={{ '--gap': '14px' } as CSSProperties}>
      <p className="answer-hint">Associez chaque élément à sa correspondance, puis validez.</p>
      <div className="match-answer">
        {question.choices.map((left, i) => (
          <label key={i} className="match-row">
            <span className="match-left">{left}</span>
            <Icon name="link" size={18} />
            <select
              className="input match-select"
              value={pairs[i] ?? ''}
              disabled={disabled}
              onChange={(e) => setPairs((current) => current.map((p, j) => (j === i ? (e.target.value === '' ? null : Number(e.target.value)) : p)))}
            >
              <option value="">Choisir…</option>
              {options.map((option, o) => (
                <option key={o} value={o}>
                  {option}
                  {pairs.includes(o) && pairs[i] !== o ? ' (déjà utilisé)' : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <Button variant="primary" size="lg" icon="check" block disabled={disabled || !complete} onClick={() => onSubmit({ kind: 'match', pairs: pairs as number[] })}>
        Valider les associations
      </Button>
    </div>
  );
}

function ChoiceAnswer({ question, disabled, onSubmit }: AnswerInputProps) {
  const [selected, setSelected] = useState<number[]>([]);
  useEffect(() => setSelected([]), [question.index]);
  const multiple = question.type === 'multiple';
  const toggle = (index: number) => {
    if (!multiple) return onSubmit({ kind: 'choice', choices: [index] });
    setSelected((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index]));
  };

  return (
    <div className="stack" style={{ '--gap': '14px' } as CSSProperties}>
      {multiple && <p className="answer-hint">Plusieurs réponses possibles — sélectionnez-les puis validez.</p>}
      {question.type === 'poll' && <p className="answer-hint">Sondage : pas de bonne ou de mauvaise réponse.</p>}
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
