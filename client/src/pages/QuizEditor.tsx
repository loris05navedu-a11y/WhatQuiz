import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { CATEGORIES, LIMITS, QUESTION_TYPE_LABELS, QUESTION_TYPES } from '../../../shared/constants';
import { questionProblem, quizProblems } from '../../../shared/quizRules';
import type { QuestionInput, QuestionType } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { quizApi } from '../api/endpoints';
import { Button, PageLoader } from '../components/Button';
import { TextAreaField, TextField } from '../components/Form';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { createQuestion, newKey, toDraft, toInput, type DraftQuestion, type DraftQuiz } from '../editor/draft';
import { ImagePicker } from '../editor/ImagePicker';
import { QuestionEditor, TYPE_ICONS } from '../editor/QuestionEditor';
import { QuestionPreview } from '../editor/QuestionPreview';
import { TextImportModal } from '../editor/TextImportModal';
import { useTestLauncher } from '../lib/useTestLauncher';

const SETTINGS = 'settings';

export function QuizEditorPage() {
  const { id } = useParams();
  const quizId = id ? Number(id) : null;
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { launchTest, pending: testPending } = useTestLauncher();

  const [draft, setDraft] = useState<DraftQuiz | null>(quizId ? null : toDraft());
  const [selected, setSelected] = useState<string>(SETTINGS);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(false);
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  }, []);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [importingText, setImportingText] = useState(false);
  const [preview, setPreview] = useState<DraftQuestion | null>(null);

  useEffect(() => {
    if (!quizId) return;
    quizApi
      .get(quizId)
      .then(({ quiz }) => {
        const loaded = toDraft(quiz);
        setDraft(loaded);
        setSelected(loaded.questions[0]?.key ?? SETTINGS);
      })
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        navigate('/dashboard', { replace: true });
      });
  }, [quizId, navigate, toast]);

  // Protection contre la perte de modifications (navigation interne et fermeture de l'onglet).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: 'Quitter sans enregistrer ?',
      message: 'Vos dernières modifications seront perdues.',
      confirmLabel: 'Quitter',
      danger: true,
    }).then((ok) => (ok ? blocker.proceed() : blocker.reset()));
  }, [blocker, confirm]);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const edit = useCallback((change: (current: DraftQuiz) => DraftQuiz) => {
    setDraft((current) => (current ? change(current) : current));
    setDirty(true);
  }, [setDirty]);

  if (!draft) return <PageLoader />;

  const questions = draft.questions;
  const selectedIndex = questions.findIndex((q) => q.key === selected);
  const current = selectedIndex >= 0 ? questions[selectedIndex] : null;

  const updateQuestion = (question: DraftQuestion) => edit((d) => ({ ...d, questions: d.questions.map((q) => (q.key === question.key ? question : q)) }));

  const addQuestion = (type: QuestionType) => {
    const question = createQuestion(type);
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : questions.length;
    edit((d) => ({ ...d, questions: [...d.questions.slice(0, insertAt), question, ...d.questions.slice(insertAt)] }));
    setSelected(question.key);
    setAdding(false);
  };

  const importQuestions = (imported: QuestionInput[]) => {
    const created: DraftQuestion[] = imported.map((question) => ({ ...question, key: newKey() }));
    // Un nouveau quiz commence par une question vide : on la remplace plutôt que de la garder.
    const onlyBlank = questions.length === 1 && !questions[0].text.trim() && questions[0].answers.every((a) => !a.text.trim() || a.text === 'Vrai' || a.text === 'Faux');
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : questions.length;
    edit((d) => ({
      ...d,
      questions: onlyBlank ? created : [...d.questions.slice(0, insertAt), ...created, ...d.questions.slice(insertAt)],
    }));
    setSelected(created[0].key);
    setImportingText(false);
    toast.success(`${created.length} question${created.length > 1 ? 's' : ''} ajoutée${created.length > 1 ? 's' : ''}`);
  };

  const moveQuestion = (delta: -1 | 1) => {
    edit((d) => {
      const list = [...d.questions];
      const from = list.findIndex((q) => q.key === selected);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= list.length) return d;
      [list[from], list[to]] = [list[to], list[from]];
      return { ...d, questions: list };
    });
  };

  const duplicateQuestion = () => {
    if (!current) return;
    const copy = { ...structuredClone(current), key: newKey() };
    edit((d) => ({ ...d, questions: [...d.questions.slice(0, selectedIndex + 1), copy, ...d.questions.slice(selectedIndex + 1)] }));
    setSelected(copy.key);
  };

  const deleteQuestion = async () => {
    if (!current) return;
    const ok = await confirm({ title: `Supprimer la question ${selectedIndex + 1} ?`, confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    const neighbour = questions[selectedIndex + 1] ?? questions[selectedIndex - 1];
    edit((d) => ({ ...d, questions: d.questions.filter((q) => q.key !== current.key) }));
    setSelected(neighbour?.key ?? SETTINGS);
  };

  const save = async (): Promise<number | null> => {
    const input = toInput(draft);
    const problems = quizProblems(input);
    if (problems.length > 0) {
      toast.error(problems[0]);
      const firstInvalid = draft.questions.find((q) => questionProblem(q));
      setSelected(input.title ? (firstInvalid?.key ?? SETTINGS) : SETTINGS);
      return null;
    }
    setSaving(true);
    try {
      const { quiz } = quizId ? await quizApi.update(quizId, input) : await quizApi.create(input);
      setDirty(false);
      toast.success('Quiz enregistré');
      if (!quizId) navigate(`/quizzes/${quiz.id}/edit`, { replace: true });
      return quiz.id;
    } catch (error) {
      toast.error(errorMessage(error));
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** Les tests et lancements utilisent la version enregistrée : on enregistre d'abord si besoin. */
  const saveThen = async (action: (id: number) => void) => {
    const savedId = dirty || !quizId ? await save() : quizId;
    if (savedId) action(savedId);
  };

  return (
    <div className="editor">
      <div className="editor-topbar">
        <Link to="/dashboard" className="btn btn-ghost btn-icon" aria-label="Retour au tableau de bord">
          <Icon name="arrowLeft" />
        </Link>
        <div className="editor-topbar-title">
          <b>{draft.title.trim() || 'Nouveau quiz'}</b>
          <span className="muted small" aria-live="polite">
            {saving ? 'Enregistrement…' : dirty ? 'Modifications non enregistrées' : quizId ? 'Tout est enregistré' : 'Brouillon'}
          </span>
        </div>
        <span className="spacer" />
        <Menu trigger={(props) => <Button icon="flask" loading={testPending !== null} disabled={questions.length === 0} {...props}>Tester</Button>}>
          {(close) => (
            <>
              <div className="menu-label">Aucun résultat n’est enregistré</div>
              <button role="menuitem" className="menu-item" onClick={() => (close(), saveThen((qid) => launchTest(qid, 'teacher')))}>
                <Icon name="sliders" /> Mode professeur
              </button>
              <button role="menuitem" className="menu-item" onClick={() => (close(), saveThen((qid) => launchTest(qid, 'student')))}>
                <Icon name="user" /> Mode élève
              </button>
              <button role="menuitem" className="menu-item" onClick={() => (close(), saveThen((qid) => navigate(`/quizzes/${qid}/preview`)))}>
                <Icon name="eye" /> Aperçu complet
              </button>
            </>
          )}
        </Menu>
        <Button icon="play" className="hide-mobile" disabled={questions.length === 0} onClick={() => saveThen((qid) => navigate(`/quizzes/${qid}/launch`))}>
          Lancer
        </Button>
        <Button variant="primary" icon="check" loading={saving} onClick={() => void save()}>
          Enregistrer
        </Button>
      </div>

      <div className="editor-body">
        <nav className="editor-rail" aria-label="Questions du quiz">
          <button type="button" className={`rail-item rail-settings${selected === SETTINGS ? ' active' : ''}`} onClick={() => setSelected(SETTINGS)}>
            <Icon name="sliders" />
            <span>Paramètres du quiz</span>
            {!draft.title.trim() && <Icon name="alert" className="rail-warning" aria-label="Titre manquant" />}
          </button>
          <ol className="rail-list">
            {questions.map((question, index) => {
              const problem = questionProblem(question);
              return (
                <li key={question.key}>
                  <button
                    type="button"
                    className={`rail-item${question.key === selected ? ' active' : ''}`}
                    onClick={() => setSelected(question.key)}
                    aria-current={question.key === selected ? 'true' : undefined}
                  >
                    <span className="rail-index">{index + 1}</span>
                    <Icon name={TYPE_ICONS[question.type]} size={16} aria-label={QUESTION_TYPE_LABELS[question.type]} />
                    <span className="rail-text">{question.text.trim() || 'Question sans énoncé'}</span>
                    {problem && <Icon name="alert" className="rail-warning" aria-label={problem} />}
                  </button>
                </li>
              );
            })}
          </ol>
          <Button variant="soft" icon="plus" block onClick={() => setAdding(true)} disabled={questions.length >= LIMITS.questionsPerQuiz}>
            Ajouter une question
          </Button>
          <Button variant="ghost" icon="text" block onClick={() => setImportingText(true)} disabled={questions.length >= LIMITS.questionsPerQuiz}>
            Importer depuis un texte
          </Button>
        </nav>

        <section className="editor-panel card">
          {current ? (
            <QuestionEditor
              question={current}
              index={selectedIndex}
              total={questions.length}
              onChange={updateQuestion}
              onMove={moveQuestion}
              onDuplicate={duplicateQuestion}
              onDelete={deleteQuestion}
              onPreview={() => setPreview(current)}
            />
          ) : (
            <QuizSettingsEditor draft={draft} onChange={(patch) => edit((d) => ({ ...d, ...patch }))} />
          )}
        </section>
      </div>

      {adding && (
        <Modal title="Nouvelle question" onClose={() => setAdding(false)}>
          <div className="type-picker">
            {QUESTION_TYPES.map((type) => (
              <button key={type} type="button" className="type-option" onClick={() => addQuestion(type)}>
                <Icon name={TYPE_ICONS[type]} size={28} />
                <b>{QUESTION_TYPE_LABELS[type]}</b>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {importingText && (
        <TextImportModal
          remaining={LIMITS.questionsPerQuiz - questions.length + (questions.length === 1 && !questions[0].text.trim() ? 1 : 0)}
          onImport={importQuestions}
          onClose={() => setImportingText(false)}
        />
      )}

      {preview && (
        <Modal title="Aperçu élève" onClose={() => setPreview(null)} wide>
          <QuestionPreview question={preview} index={questions.findIndex((q) => q.key === preview.key)} total={questions.length} />
        </Modal>
      )}
    </div>
  );
}

function QuizSettingsEditor({ draft, onChange }: { draft: DraftQuiz; onChange: (patch: Partial<DraftQuiz>) => void }) {
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
      <TextField
        label="Catégorie"
        value={draft.category}
        onChange={(e) => onChange({ category: e.target.value })}
        maxLength={LIMITS.category}
        list="quiz-categories"
      />
      <datalist id="quiz-categories">
        {CATEGORIES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="field">
        <span className="field-label">Image de couverture</span>
        <ImagePicker label="Choisir une image" value={draft.imageUrl} onChange={(imageUrl) => onChange({ imageUrl })} />
      </div>
    </div>
  );
}
