import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';

export const CHOICE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

type TileState = 'idle' | 'selected' | 'correct' | 'wrong' | 'dimmed';

interface ChoiceTileProps {
  index: number;
  text: string;
  state?: TileState;
  onClick?: () => void;
  disabled?: boolean;
  multiple?: boolean;
  /** Pour l'écran professeur : nombre de réponses et barre de répartition. */
  count?: number;
  total?: number;
  footer?: ReactNode;
}

/** Tuile de réponse : couleur + lettre (l'information ne repose jamais sur la couleur seule). */
export function ChoiceTile({ index, text, state = 'idle', onClick, disabled, multiple, count, total, footer }: ChoiceTileProps) {
  const interactive = Boolean(onClick);
  const content = (
    <>
      <span className="choice-letter" aria-hidden="true">
        {CHOICE_LETTERS[index]}
      </span>
      <span className="choice-text">{text}</span>
      {state === 'correct' && <Icon name="check" size={26} strokeWidth={3} className="choice-status" />}
      {state === 'wrong' && <Icon name="x" size={26} strokeWidth={3} className="choice-status" />}
      {multiple && interactive && (
        <span className={`choice-check${state === 'selected' ? ' on' : ''}`} aria-hidden="true">
          {state === 'selected' && <Icon name="check" size={18} strokeWidth={3} />}
        </span>
      )}
      {count !== undefined && (
        <>
          <b className="choice-count" aria-label={`${count} réponse${count > 1 ? 's' : ''}`}>
            {count}
          </b>
          <span className="choice-count-bar" style={{ width: `${total ? (count / total) * 100 : 0}%` }} aria-hidden="true" />
        </>
      )}
      {footer}
    </>
  );
  const className = `choice choice-${index} is-${state}`;
  if (!interactive) return <div className={className}>{content}</div>;
  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={multiple ? state === 'selected' : undefined}
      aria-label={`Réponse ${CHOICE_LETTERS[index]} : ${text}`}
    >
      {content}
    </button>
  );
}
