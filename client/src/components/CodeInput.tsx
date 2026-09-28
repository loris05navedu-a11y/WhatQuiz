import { useState, type FormEvent } from 'react';
import { GAME_CODE_LENGTH } from '../../../shared/constants';
import { Button } from './Button';

interface CodeInputProps {
  onSubmit: (code: string) => void;
  loading?: boolean;
  error?: string | null;
  initial?: string;
  autoFocus?: boolean;
}

/** Saisie du code de partie : clavier numérique sur tablette, 6 chiffres. */
export function CodeInput({ onSubmit, loading, error, initial = '', autoFocus }: CodeInputProps) {
  const [code, setCode] = useState(initial);
  const complete = code.length === GAME_CODE_LENGTH;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (complete) onSubmit(code);
  };

  return (
    <form className="code-form" onSubmit={submit}>
      <label htmlFor="game-code" className="sr-only">
        Code de partie
      </label>
      <input
        id="game-code"
        className="input code-input"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        placeholder="Code de partie"
        maxLength={GAME_CODE_LENGTH}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, GAME_CODE_LENGTH))}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? 'game-code-error' : undefined}
        autoFocus={autoFocus}
      />
      <Button type="submit" variant="primary" size="lg" block loading={loading} disabled={!complete}>
        Rejoindre
      </Button>
      {error && (
        <p id="game-code-error" className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
