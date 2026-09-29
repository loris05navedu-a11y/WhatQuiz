import { useMemo, useState } from 'react';
import { LIMITS } from '../../../shared/constants';
import { parseTextQuestions, TEXT_IMPORT_EXAMPLE } from '../../../shared/textImport';
import type { QuestionInput } from '../../../shared/types';
import { Button } from '../components/Button';
import { TextAreaField } from '../components/Form';
import { Modal } from '../components/Modal';
import { plural } from '../lib/format';

interface TextImportModalProps {
  remaining: number;
  onImport: (questions: QuestionInput[]) => void;
  onClose: () => void;
}

export function TextImportModal({ remaining, onImport, onClose }: TextImportModalProps) {
  const [text, setText] = useState('');
  const result = useMemo(() => parseTextQuestions(text), [text]);
  const accepted = result.questions.slice(0, remaining);
  const overflow = result.questions.length - accepted.length;

  return (
    <Modal
      title="Importer des questions depuis un texte"
      onClose={onClose}
      wide
      actions={
        <>
          <Button onClick={onClose}>Annuler</Button>
          <Button variant="primary" icon="plus" disabled={accepted.length === 0} onClick={() => onImport(accepted)}>
            {accepted.length > 0 ? `Ajouter ${plural(accepted.length, 'question')}` : 'Ajouter'}
          </Button>
        </>
      }
    >
      <div className="text-import">
        <div className="stack">
          <TextAreaField
            label="Vos questions"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={12}
            placeholder={TEXT_IMPORT_EXAMPLE}
            spellCheck={false}
            className="text-import-area"
          />
          <p className="small" aria-live="polite">
            {text.trim() ? (
              <b>{plural(result.questions.length, 'question reconnue', 'questions reconnues')}</b>
            ) : (
              <span className="muted">Collez ou tapez vos questions, séparées par une ligne vide.</span>
            )}
            {overflow > 0 && <span style={{ color: 'var(--danger)' }}> · {overflow} au-delà de la limite de {LIMITS.questionsPerQuiz} questions</span>}
          </p>
          {result.errors.length > 0 && (
            <ul className="text-import-errors" role="alert">
              {result.errors.slice(0, 6).map((error) => (
                <li key={error}>{error}</li>
              ))}
              {result.errors.length > 6 && <li>… et {result.errors.length - 6} autre(s)</li>}
            </ul>
          )}
        </div>
        <aside className="text-import-help">
          <b>Format</b>
          <ul>
            <li>
              1<sup>re</sup> ligne : l’énoncé, avec une durée facultative <code>(30s)</code>
            </li>
            <li>
              <code>*</code> bonne réponse, <code>-</code> mauvaise réponse
            </li>
            <li>
              <code>= Vrai</code> ou <code>= Faux</code> pour un Vrai/Faux
            </li>
            <li>
              <code>= réponse</code> pour une réponse libre (variantes séparées par <code>|</code>)
            </li>
          </ul>
          <Button size="sm" variant="soft" onClick={() => setText(TEXT_IMPORT_EXAMPLE)}>
            Voir un exemple
          </Button>
        </aside>
      </div>
    </Modal>
  );
}
