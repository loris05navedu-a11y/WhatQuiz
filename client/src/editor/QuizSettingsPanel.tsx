import { CATEGORIES, DIFFICULTY_LABELS, LIMITS, SCHOOL_LEVELS, SUBCATEGORIES } from '../../../shared/constants';
import type { Difficulty, QuizStatus, QuizVisibility } from '../../../shared/types';
import { Button } from '../components/Button';
import { Segmented, TextAreaField, TextField } from '../components/Form';
import { Icon } from '../components/Icon';
import { useToast } from '../context/ToastContext';
import { STANDALONE } from '../lib/backend';
import type { DraftQuiz } from './draft';
import { ImagePicker } from './ImagePicker';
import { TagsInput } from './TagsInput';

interface QuizSettingsPanelProps {
  draft: DraftQuiz;
  accessCode: string | null;
  onChange: (patch: Partial<DraftQuiz>) => void;
}

/** Paramètres du quiz : présentation, classement (catégorie, tags, niveau, difficulté) et partage. */
export function QuizSettingsPanel({ draft, accessCode, onChange }: QuizSettingsPanelProps) {
  const toast = useToast();
  const subcategories = SUBCATEGORIES[draft.category as (typeof CATEGORIES)[number]] ?? [];
  const visibility = draft.visibility ?? 'private';

  return (
    <div className="stack animate-in">
      <h2 className="editor-heading">Paramètres du quiz</h2>
      <TextField
        label="Titre"
        value={draft.title}
        onChange={(e) => onChange({ title: e.target.value })}
        maxLength={LIMITS.quizTitle}
        placeholder="Ex. : Les fractions — 5e"
        error={draft.title.trim() ? null : 'Le titre est obligatoire'}
        autoFocus={!draft.title}
      />
      <TextAreaField
        label="Description"
        value={draft.description}
        onChange={(e) => onChange({ description: e.target.value })}
        maxLength={LIMITS.quizDescription}
        placeholder="Facultatif : objectif, niveau, consignes…"
        rows={3}
      />
      <div className="field">
        <span className="field-label">Image de couverture</span>
        <ImagePicker label="Choisir une image" value={draft.imageUrl} onChange={(imageUrl) => onChange({ imageUrl })} />
      </div>

      <h3 className="editor-subheading">
        <Icon name="tag" size={18} /> Classement
      </h3>
      <div className="settings-grid">
        <TextField label="Catégorie" value={draft.category} onChange={(e) => onChange({ category: e.target.value })} maxLength={LIMITS.category} list="quiz-categories" />
        <TextField
          label="Sous-catégorie"
          value={draft.subcategory ?? ''}
          onChange={(e) => onChange({ subcategory: e.target.value })}
          maxLength={LIMITS.subcategory}
          list="quiz-subcategories"
          placeholder={subcategories[0] ? `Ex. : ${subcategories[0]}` : 'Facultatif'}
        />
        <label className="field">
          <span className="field-label">Niveau scolaire</span>
          <select className="input" value={draft.level ?? ''} onChange={(e) => onChange({ level: e.target.value })}>
            <option value="">Non précisé</option>
            {SCHOOL_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </label>
      </div>
      <datalist id="quiz-categories">
        {CATEGORIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="quiz-subcategories">
        {subcategories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="field">
        <span className="field-label">Difficulté</span>
        <Segmented<Difficulty | 'none'>
          label="Difficulté"
          className="chips"
          value={draft.difficulty ?? 'none'}
          onChange={(value) => onChange({ difficulty: value === 'none' ? null : value })}
          options={[{ value: 'none', label: 'Non précisée' }, ...(['easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))]}
        />
      </div>
      <TagsInput tags={draft.tags ?? []} onChange={(tags) => onChange({ tags })} />

      <h3 className="editor-subheading">
        <Icon name="share" size={18} /> Publication et partage
      </h3>
      <div className="field">
        <span className="field-label">Statut</span>
        <Segmented<QuizStatus>
          label="Statut"
          value={draft.status ?? 'draft'}
          onChange={(status) => onChange({ status })}
          options={[
            { value: 'draft', label: 'Brouillon', icon: 'edit' },
            { value: 'published', label: 'Publié', icon: 'check' },
          ]}
        />
        <span className="field-hint">Un brouillon peut rester incomplet. Un quiz publié doit être entièrement valide ; seuls les quiz publiés peuvent être partagés.</span>
      </div>
      <div className="field">
        <span className="field-label">Visibilité</span>
        <Segmented<QuizVisibility>
          label="Visibilité"
          value={visibility}
          onChange={(value) => onChange({ visibility: value })}
          options={[
            { value: 'private', label: 'Privé', icon: 'lock' },
            { value: 'code', label: 'Avec un code', icon: 'key' },
            { value: 'public', label: 'Public', icon: 'globe' },
          ]}
        />
        <span className="field-hint">
          {visibility === 'private'
            ? 'Vous seul voyez ce quiz.'
            : visibility === 'code'
              ? 'Les professeurs qui ont le code peuvent consulter et copier ce quiz.'
              : 'Visible dans la bibliothèque des professeurs, qui peuvent le copier.'}
          {STANDALONE && visibility !== 'private' && ' Sans serveur, le partage concerne les comptes de cet appareil.'}
        </span>
        {visibility !== 'private' && (
          <div className="access-code">
            {accessCode ? (
              <>
                <span>Code d’accès</span>
                <b>{accessCode}</b>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="copy"
                  onClick={() => void navigator.clipboard?.writeText(accessCode).then(() => toast.success('Code copié'), () => toast.error('Copie impossible'))}
                >
                  Copier
                </Button>
              </>
            ) : (
              <span className="muted">Le code d’accès sera attribué à l’enregistrement.</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
