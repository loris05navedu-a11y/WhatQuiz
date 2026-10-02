import { useId, useState, type KeyboardEvent } from 'react';
import { LIMITS } from '../../../shared/constants';
import { cleanTags } from '../../../shared/quizMeta';
import { Icon } from '../components/Icon';

interface TagsInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  placeholder?: string;
  /** Suggestions proposées pendant la saisie (tags déjà utilisés). */
  suggestions?: string[];
}

/** Saisie de tags : Entrée ou virgule pour valider, Retour arrière pour retirer le dernier. */
export function TagsInput({ tags, onChange, label = 'Tags', placeholder = 'Ex. : révision, chapitre 3 (Entrée pour valider)', suggestions = [] }: TagsInputProps) {
  const id = useId();
  const [text, setText] = useState('');
  const add = () => {
    if (!text.trim()) return;
    onChange(cleanTags([...tags, ...text.split(',')]));
    setText('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      add();
    } else if (event.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1));
  };
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="tags-input">
        {tags.map((tag) => (
          <span key={tag} className="tag-chip">
            #{tag}
            <button type="button" aria-label={`Retirer le tag ${tag}`} onClick={() => onChange(tags.filter((t) => t !== tag))}>
              <Icon name="x" size={14} />
            </button>
          </span>
        ))}
        {tags.length < LIMITS.tagsPerQuiz && (
          <input
            id={id}
            value={text}
            maxLength={LIMITS.tag}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={add}
            placeholder={tags.length ? '' : placeholder}
            list={suggestions.length ? `${id}-suggestions` : undefined}
          />
        )}
      </div>
      {suggestions.length > 0 && (
        <datalist id={`${id}-suggestions`}>
          {suggestions
            .filter((s) => !tags.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      )}
    </div>
  );
}
