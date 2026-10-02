import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, QUESTION_TYPES } from '../../../shared/constants';
import { QUESTION_TYPE_DEFINITIONS } from '../../../shared/questionTypes';
import { questionProblem } from '../../../shared/quizRules';
import type { BankFolder, BankQuestion, Difficulty, QuestionInput, QuestionType } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { bankApi } from '../api/endpoints';
import { Button, PageLoader } from '../components/Button';
import { Segmented } from '../components/Form';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';
import { createQuestion, questionToDraft, questionToInput, type DraftQuestion } from '../editor/draft';
import { QuestionEditor, TYPE_ICONS } from '../editor/QuestionEditor';
import { QuestionPreview } from '../editor/QuestionPreview';
import { TagsInput } from '../editor/TagsInput';
import { FiltersBar, FolderSelect, QuestionList } from './components';
import { allTags, DEFAULT_FILTERS, filterQuestions, type BankFilters } from './model';

/* ───── Classement d'une question : dossier, tags, difficulté ───── */

interface Classification {
  folderId: string | null;
  tags: string[];
  difficulty: Difficulty | null;
}

function ClassificationFields({ value, onChange, folders, tagSuggestions }: { value: Classification; onChange: (value: Classification) => void; folders: BankFolder[]; tagSuggestions: string[] }) {
  return (
    <div className="stack">
      <FolderSelect folders={folders} value={value.folderId} onChange={(folderId) => onChange({ ...value, folderId })} label="Dossier" />
      <TagsInput tags={value.tags} onChange={(tags) => onChange({ ...value, tags })} suggestions={tagSuggestions} />
      <div className="field">
        <span className="field-label">Difficulté</span>
        <Segmented<Difficulty | 'none'>
          label="Difficulté"
          className="chips"
          value={value.difficulty ?? 'none'}
          onChange={(d) => onChange({ ...value, difficulty: d === 'none' ? null : d })}
          options={[{ value: 'none', label: 'Non précisée' }, ...(['easy', 'medium', 'hard'] as const).map((d) => ({ value: d, label: DIFFICULTY_LABELS[d] }))]}
        />
      </div>
    </div>
  );
}

export function TypePicker({ onPick }: { onPick: (type: QuestionType) => void }) {
  return (
    <div className="type-picker">
      {QUESTION_TYPES.map((type) => (
        <button key={type} type="button" className="type-option" onClick={() => onPick(type)}>
          <Icon name={TYPE_ICONS[type]} size={28} />
          <b>{QUESTION_TYPE_LABELS[type]}</b>
          <span className="type-option-desc">{QUESTION_TYPE_DEFINITIONS[type].description}</span>
        </button>
      ))}
    </div>
  );
}

/* ───── Création / modification d'une question de la banque ───── */

interface BankQuestionModalProps {
  item: BankQuestion | null;
  folders: BankFolder[];
  tagSuggestions: string[];
  defaultFolderId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

export function BankQuestionModal({ item, folders, tagSuggestions, defaultFolderId, onClose, onSaved }: BankQuestionModalProps) {
  const toast = useToast();
  const [draft, setDraft] = useState<DraftQuestion | null>(() => (item ? questionToDraft(item.question) : null));
  const [meta, setMeta] = useState<Classification>(() => ({
    folderId: item ? item.folderId : defaultFolderId,
    tags: item?.tags ?? [],
    difficulty: item?.difficulty ?? null,
  }));
  const [preview, setPreview] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!draft) return;
    const question = questionToInput(draft);
    const problem = questionProblem(question);
    if (problem) return toast.error(problem);
    setSaving(true);
    try {
      if (item) await bankApi.update(item.id, { question, ...meta });
      else await bankApi.add([question], meta);
      toast.success(item ? 'Question modifiée' : 'Question ajoutée à la banque');
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={item ? 'Modifier la question' : 'Nouvelle question'}
      onClose={onClose}
      wide
      actions={
        draft && (
          <>
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" icon="check" loading={saving} onClick={() => void save()}>
              Enregistrer
            </Button>
          </>
        )
      }
    >
      {!draft ? (
        <TypePicker onPick={(type) => setDraft(createQuestion(type))} />
      ) : preview ? (
        <div className="stack">
          <Button variant="ghost" icon="arrowLeft" onClick={() => setPreview(false)}>
            Retour à l’édition
          </Button>
          <QuestionPreview question={questionToInput(draft)} index={0} total={1} />
        </div>
      ) : (
        <div className="bank-question-form">
          <QuestionEditor question={draft} onChange={setDraft} heading={item ? 'Question' : QUESTION_TYPE_LABELS[draft.type]} onPreview={() => setPreview(true)} />
          <aside className="bank-question-meta card">
            <h3 className="editor-subheading">
              <Icon name="folder" size={18} /> Classement
            </h3>
            <ClassificationFields value={meta} onChange={setMeta} folders={folders} tagSuggestions={tagSuggestions} />
          </aside>
        </div>
      )}
    </Modal>
  );
}

/* ───── Depuis l'éditeur de quiz : ajouter la question courante à la banque ───── */

export function SaveToBankModal({ question, source, onClose }: { question: QuestionInput; source: string; onClose: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<{ folders: BankFolder[]; tags: string[] } | null>(null);
  const [meta, setMeta] = useState<Classification>({ folderId: null, tags: [], difficulty: null });
  const [saving, setSaving] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    bankApi
      .list()
      .then(({ folders, questions }) => setData({ folders, tags: allTags(questions) }))
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        closeRef.current();
      });
  }, [toast]);

  const save = async () => {
    setSaving(true);
    try {
      await bankApi.add([question], { ...meta, source });
      toast.success('Question ajoutée à la banque');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Ajouter à la banque de questions"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" icon="folder" loading={saving} disabled={!data} onClick={() => void save()}>
            Ajouter
          </Button>
        </>
      }
    >
      {!data ? (
        <PageLoader />
      ) : (
        <div className="stack">
          <p className="bank-quote">« {question.text} »</p>
          <ClassificationFields value={meta} onChange={setMeta} folders={data.folders} tagSuggestions={data.tags} />
          <p className="muted small">Une copie est enregistrée : modifier ensuite le quiz ne change pas la banque.</p>
        </div>
      )}
    </Modal>
  );
}

/* ───── Depuis l'éditeur de quiz : insérer des questions de la banque ───── */

export function BankPicker({ remaining, onClose, onInsert }: { remaining: number; onClose: () => void; onInsert: (questions: QuestionInput[]) => void }) {
  const toast = useToast();
  const [data, setData] = useState<{ questions: BankQuestion[]; folders: BankFolder[] } | null>(null);
  const [filters, setFilters] = useState<BankFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewing, setPreviewing] = useState<BankQuestion | null>(null);
  const [inserting, setInserting] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    bankApi
      .list()
      .then(setData)
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        closeRef.current();
      });
  }, [toast]);

  const visible = useMemo(() => (data ? filterQuestions(data.questions, data.folders, filters) : []), [data, filters]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const toggleAll = () =>
    setSelected((current) => (visible.every((item) => current.includes(item.id)) ? current.filter((id) => !visible.some((item) => item.id === id)) : [...new Set([...current, ...visible.map((item) => item.id)])]));

  const insert = async () => {
    if (selected.length > remaining) return toast.error(`Ce quiz peut encore recevoir ${remaining} question${remaining > 1 ? 's' : ''}`);
    setInserting(true);
    try {
      const { questions } = await bankApi.use(selected);
      onInsert(questions);
    } catch (error) {
      toast.error(errorMessage(error));
      setInserting(false);
    }
  };

  return (
    <Modal
      title="Insérer depuis la banque"
      onClose={onClose}
      wide
      actions={
        <>
          <span className="muted small spacer">{selected.length > 0 ? `${selected.length} sélectionnée${selected.length > 1 ? 's' : ''} — insérées dans l’ordre de sélection` : ''}</span>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" icon="plus" loading={inserting} disabled={selected.length === 0} onClick={() => void insert()}>
            Insérer
          </Button>
        </>
      }
    >
      {!data ? (
        <PageLoader />
      ) : data.questions.length === 0 ? (
        <p className="muted">
          Votre banque est vide. Ajoutez-y des questions depuis l’éditeur (bouton <Icon name="folder" size={14} />) ou depuis la page « Banque ».
        </p>
      ) : previewing ? (
        <div className="stack">
          <Button variant="ghost" icon="arrowLeft" onClick={() => setPreviewing(null)}>
            Retour à la liste
          </Button>
          <QuestionPreview question={previewing.question} index={0} total={1} />
        </div>
      ) : (
        <div className="stack" style={{ '--gap': '12px' } as CSSProperties}>
          <FiltersBar filters={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} tags={allTags(data.questions)} folders={data.folders} />
          <div className="bank-picker-list">
            <QuestionList items={visible} folders={data.folders} selected={selectedSet} onToggle={toggle} onToggleAll={toggleAll} onPreview={setPreviewing} />
          </div>
        </div>
      )}
    </Modal>
  );
}
