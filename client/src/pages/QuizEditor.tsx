import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router';
import { LIMITS, QUESTION_TYPE_LABELS, QUESTION_TYPES } from '../../../shared/constants';
import { QUESTION_TYPE_DEFINITIONS } from '../../../shared/questionTypes';
import { questionProblem, quizProblems } from '../../../shared/quizRules';
import { normalizeText } from '../../../shared/text';
import type { QuestionInput, QuestionType, QuizVersionSummary } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { quizApi } from '../api/endpoints';
import { Button, PageLoader } from '../components/Button';
import { Icon } from '../components/Icon';
import { Menu } from '../components/Menu';
import { Modal } from '../components/Modal';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { copyQuestions, pasteQuestions } from '../editor/clipboard';
import { BankPicker, SaveToBankModal } from '../bank/BankModals';
import { createQuestion, fromInput, newKey, questionToDraft, questionToInput, toDraft, toInput, type DraftQuestion, type DraftQuiz } from '../editor/draft';
import { QuestionEditor, TYPE_ICONS } from '../editor/QuestionEditor';
import { QuestionPreview } from '../editor/QuestionPreview';
import { QuizSettingsPanel } from '../editor/QuizSettingsPanel';
import { TextImportModal } from '../editor/TextImportModal';
import { useHistory } from '../editor/useHistory';
import { moveItem, useReorder } from '../editor/useReorder';
import { formatDateTime } from '../lib/format';
import { readStorage, writeStorage } from '../lib/storage';
import { useTestLauncher } from '../lib/useTestLauncher';

const SETTINGS = 'settings';
const AUTOSAVE_DELAY_MS = 2500;
const backupKey = (id: number | null) => `wq:editor-backup:${id ?? 'new'}`;

type SaveState = 'saved' | 'dirty' | 'saving' | 'invalid' | 'error';

interface Backup {
  savedAt: string;
  draft: DraftQuiz;
}

function readBackup(id: number | null): Backup | null {
  try {
    return JSON.parse(readStorage('local', backupKey(id)) ?? 'null') as Backup | null;
  } catch {
    return null;
  }
}

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function QuizEditorPage() {
  const { id } = useParams();
  const routeId = id ? Number(id) : null;
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();
  const { launchTest, pending: testPending } = useTestLauncher();

  const history = useHistory<DraftQuiz | null>(routeId ? null : toDraft());
  const draft = history.value;
  const [quizId, setQuizId] = useState<number | null>(routeId);
  const [accessCode, setAccessCode] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>(SETTINGS);
  const [saveState, setSaveState] = useState<SaveState>(routeId ? 'saved' : 'dirty');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [importingText, setImportingText] = useState(false);
  const [preview, setPreview] = useState<DraftQuestion | null>(null);
  const [livePreview, setLivePreview] = useState(() => readStorage('local', 'wq:live-preview') === 'on');
  const [showHistory, setShowHistory] = useState(false);
  const [search, setSearch] = useState('');
  const [backup, setBackup] = useState<Backup | null>(null);
  const [bankSaving, setBankSaving] = useState<QuestionInput | null>(null);
  const [bankPicking, setBankPicking] = useState(false);

  // La version enregistrée correspond-elle encore au brouillon affiché ?
  const savedDraft = useRef<DraftQuiz | null>(null);
  const saving = useRef(false);
  const dirty = draft !== null && draft !== savedDraft.current;

  /* ───── Chargement ───── */
  useEffect(() => {
    if (!routeId || routeId === quizId && draft) return;
    quizApi
      .get(routeId)
      .then(({ quiz }) => {
        const loaded = toDraft(quiz);
        savedDraft.current = loaded;
        history.reset(loaded);
        setQuizId(quiz.id);
        setAccessCode(quiz.accessCode);
        setSavedAt(quiz.updatedAt);
        setSaveState('saved');
        setSelected(loaded.questions[0]?.key ?? SETTINGS);
        const local = readBackup(quiz.id);
        if (local && local.savedAt > quiz.updatedAt && JSON.stringify(toInput(local.draft)) !== JSON.stringify(toInput(loaded))) setBackup(local);
      })
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        navigate('/dashboard', { replace: true });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeId]);

  useEffect(() => {
    if (routeId) return;
    const local = readBackup(null);
    if (local) setBackup(local);
  }, [routeId]);

  /* ───── Sauvegarde locale (secours) : à chaque modification non enregistrée ───── */
  useEffect(() => {
    if (!draft || !dirty) return;
    const timer = setTimeout(() => writeStorage('local', backupKey(quizId), JSON.stringify({ savedAt: new Date().toISOString(), draft } satisfies Backup)), 400);
    return () => clearTimeout(timer);
  }, [draft, dirty, quizId]);

  const edit = useCallback((change: (current: DraftQuiz) => DraftQuiz, options?: { merge?: boolean }) => {
    history.set((current) => (current ? change(current) : current), options);
    setSaveState('dirty');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ───── Enregistrement (manuel ou automatique) ───── */
  const save = useCallback(
    async (mode: 'manual' | 'auto' | 'publish' = 'manual'): Promise<number | null> => {
      if (!draft || saving.current) return null;
      let target = draft;
      if (mode === 'publish' && draft.status !== 'published') target = { ...draft, status: 'published' };
      const input = toInput(target);
      const problems = input.status === 'published' ? quizProblems(input) : input.title ? [] : ['Le titre du quiz est obligatoire'];
      if (problems.length > 0) {
        if (mode === 'auto') {
          setSaveState('invalid');
          return null;
        }
        toast.error(problems[0]);
        const firstInvalid = draft.questions.find((q) => questionProblem(q));
        setSelected(input.title ? (firstInvalid?.key ?? SETTINGS) : SETTINGS);
        setSaveState('invalid');
        return null;
      }
      saving.current = true;
      setSaveState('saving');
      try {
        const { quiz } = quizId ? await quizApi.update(quizId, input, { autosave: mode === 'auto' }) : await quizApi.create(input);
        if (target !== draft) history.set(target, { merge: false });
        savedDraft.current = target;
        setAccessCode(quiz.accessCode);
        setSavedAt(quiz.updatedAt);
        setSaveState('saved');
        writeStorage('local', backupKey(quizId), null);
        if (mode !== 'auto') toast.success(mode === 'publish' ? 'Quiz publié' : 'Quiz enregistré');
        if (!quizId) {
          setQuizId(quiz.id);
          navigate(`/quizzes/${quiz.id}/edit`, { replace: true });
        }
        return quiz.id;
      } catch (error) {
        setSaveState('error');
        if (mode !== 'auto') toast.error(errorMessage(error));
        return null;
      } finally {
        saving.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, quizId],
  );

  // Enregistrement automatique quelques secondes après la dernière modification.
  useEffect(() => {
    if (!dirty || !draft?.title.trim()) return;
    const timer = setTimeout(() => void save('auto'), AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [draft, dirty, save]);

  /* ───── Protection contre la perte de modifications ───── */
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname && !nextLocation.pathname.endsWith('/edit'));
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    void confirm({
      title: 'Quitter sans enregistrer ?',
      message: 'Vos dernières modifications n’ont pas pu être enregistrées (une copie de secours reste sur cet appareil).',
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

  const questions = useMemo(() => draft?.questions ?? [], [draft]);
  const selectedIndex = questions.findIndex((q) => q.key === selected);
  const current = selectedIndex >= 0 ? questions[selectedIndex] : null;

  /* ───── Actions sur les questions ───── */
  const insertQuestions = useCallback(
    (created: DraftQuestion[]) => {
      if (!created.length) return;
      const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : questions.length;
      edit((d) => ({ ...d, questions: [...d.questions.slice(0, insertAt), ...created, ...d.questions.slice(insertAt)].slice(0, LIMITS.questionsPerQuiz) }), { merge: false });
      setSelected(created[0].key);
    },
    [edit, questions.length, selectedIndex],
  );

  const addQuestion = (type: QuestionType) => {
    insertQuestions([createQuestion(type)]);
    setAdding(false);
  };

  const importQuestions = (imported: QuestionInput[]) => {
    const created = imported.map((question) => ({ ...question, key: newKey() }));
    // Un nouveau quiz commence par une question vide : on la remplace plutôt que de la garder.
    const onlyBlank = questions.length === 1 && !questions[0].text.trim() && questions[0].answers.every((a) => !a.text.trim() || a.text === 'Vrai' || a.text === 'Faux');
    if (onlyBlank) {
      edit((d) => ({ ...d, questions: created }), { merge: false });
      setSelected(created[0].key);
    } else insertQuestions(created);
    setImportingText(false);
    toast.success(`${created.length} question${created.length > 1 ? 's' : ''} ajoutée${created.length > 1 ? 's' : ''}`);
  };

  const reorder = useCallback((from: number, to: number) => edit((d) => ({ ...d, questions: moveItem(d.questions, from, to) }), { merge: false }), [edit]);
  const { drag, register, handleProps } = useReorder(reorder);

  const moveQuestion = (delta: -1 | 1) => reorder(selectedIndex, selectedIndex + delta);

  const duplicateQuestion = () => {
    if (current) insertQuestions([{ ...structuredClone(current), key: newKey() }]);
  };

  const copyCurrent = useCallback(async () => {
    if (!current) return;
    const { key: _key, ...question } = current;
    await copyQuestions([question]);
    toast.success('Question copiée — collez-la ici ou dans un autre quiz');
  }, [current, toast]);

  const paste = useCallback(async () => {
    const pasted = await pasteQuestions();
    if (!pasted.length) return toast.error('Aucune question copiée');
    insertQuestions(pasted.map((question) => ({ ...question, key: newKey() })));
    toast.success(`${pasted.length} question${pasted.length > 1 ? 's' : ''} collée${pasted.length > 1 ? 's' : ''}`);
  }, [insertQuestions, toast]);

  const saveToBank = () => {
    if (!current) return;
    const question = questionToInput(current);
    const problem = questionProblem(question);
    if (problem) return toast.error(`Complétez la question avant de l’ajouter à la banque : ${problem}`);
    setBankSaving(question);
  };

  const insertFromBank = (picked: QuestionInput[]) => {
    insertQuestions(picked.map(questionToDraft));
    setBankPicking(false);
    toast.success(`${picked.length} question${picked.length > 1 ? 's' : ''} insérée${picked.length > 1 ? 's' : ''} depuis la banque`);
  };

  const deleteQuestion = async () => {
    if (!current) return;
    const ok = await confirm({ title: `Supprimer la question ${selectedIndex + 1} ?`, message: 'Vous pourrez l’annuler avec « Annuler ».', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    const neighbour = questions[selectedIndex + 1] ?? questions[selectedIndex - 1];
    edit((d) => ({ ...d, questions: d.questions.filter((q) => q.key !== current.key) }), { merge: false });
    setSelected(neighbour?.key ?? SETTINGS);
  };

  const undo = useCallback(() => history.undo(), [history]);
  const redo = useCallback(() => history.redo(), [history]);

  // Après une annulation, la question sélectionnée peut ne plus exister.
  useEffect(() => {
    if (selected !== SETTINGS && draft && !draft.questions.some((q) => q.key === selected)) setSelected(draft.questions[0]?.key ?? SETTINGS);
    if (draft && draft !== savedDraft.current) setSaveState((state) => (state === 'saved' ? 'dirty' : state));
  }, [draft, selected]);

  /* ───── Raccourcis clavier ───── */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void save('manual');
        return;
      }
      if (isEditable(event.target)) return;
      if (key === 'z' && !event.shiftKey) (event.preventDefault(), undo());
      else if ((key === 'z' && event.shiftKey) || key === 'y') (event.preventDefault(), redo());
      else if (key === 'c' && current && !window.getSelection()?.toString()) (event.preventDefault(), void copyCurrent());
      else if (key === 'v') (event.preventDefault(), void paste());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, undo, redo, copyCurrent, paste, current]);

  if (!draft) return <PageLoader />;

  /**
   * Les tests et lancements utilisent la version enregistrée : on enregistre d'abord si besoin. Un brouillon complet
   * peut être joué sans être publié (la publication ne concerne que le partage).
   */
  const saveThen = async (action: (id: number) => void) => {
    const problems = quizProblems(toInput(draft));
    if (problems.length > 0) {
      toast.error(`Corrigez le quiz avant de le lancer — ${problems[0]}`);
      const firstInvalid = draft.questions.find((q) => questionProblem(q));
      if (firstInvalid) setSelected(firstInvalid.key);
      return;
    }
    const savedId = dirty || !quizId ? await save('manual') : quizId;
    if (savedId) action(savedId);
  };

  const normalizedSearch = normalizeText(search);
  const matches = (question: DraftQuestion) =>
    !normalizedSearch || normalizeText([question.text, ...question.answers.flatMap((a) => [a.text, a.match ?? '']), question.explanation ?? ''].join(' ')).includes(normalizedSearch);
  const visible = questions.map((question, index) => ({ question, index })).filter(({ question }) => matches(question));

  const statusLabel = {
    saved: savedAt ? `Enregistré à ${formatDateTime(savedAt).split(' ').pop()}` : 'Tout est enregistré',
    dirty: 'Modifications en cours…',
    saving: 'Enregistrement…',
    invalid: draft.status === 'published' ? 'Erreurs à corriger avant l’enregistrement' : 'Ajoutez un titre pour enregistrer',
    error: 'Enregistrement impossible — copie locale conservée',
  }[saveState];

  const toggleLivePreview = () => {
    setLivePreview((on) => {
      writeStorage('local', 'wq:live-preview', on ? null : 'on');
      return !on;
    });
  };

  return (
    <div className={`editor${livePreview ? ' with-live-preview' : ''}`}>
      <div className="editor-topbar">
        <Link to="/dashboard" className="btn btn-ghost btn-icon" aria-label="Retour au tableau de bord">
          <Icon name="arrowLeft" />
        </Link>
        <div className="editor-topbar-title">
          <b>
            {draft.title.trim() || 'Nouveau quiz'}{' '}
            <span className={`badge ${draft.status === 'published' ? 'badge-success' : 'badge-warning'}`}>{draft.status === 'published' ? 'Publié' : 'Brouillon'}</span>
          </b>
          <span className={`muted small save-state save-${saveState}`} aria-live="polite">
            {statusLabel}
          </span>
        </div>
        <span className="spacer" />
        <div className="editor-tools" role="toolbar" aria-label="Outils de l’éditeur">
          <Button size="sm" variant="ghost" icon="undo" aria-label="Annuler (Ctrl+Z)" title="Annuler (Ctrl+Z)" disabled={!history.canUndo} onClick={undo} />
          <Button size="sm" variant="ghost" icon="redo" aria-label="Rétablir (Ctrl+Y)" title="Rétablir (Ctrl+Y)" disabled={!history.canRedo} onClick={redo} />
          <Button size="sm" variant="ghost" icon="clipboard" aria-label="Coller une question (Ctrl+V)" title="Coller une question (Ctrl+V)" onClick={() => void paste()} />
          <Button size="sm" variant={livePreview ? 'soft' : 'ghost'} icon="monitor" aria-pressed={livePreview} aria-label="Aperçu en direct" title="Aperçu en direct" onClick={toggleLivePreview} className="hide-mobile">
            Aperçu
          </Button>
          <Button size="sm" variant="ghost" icon="history" aria-label="Historique des versions" title="Historique des versions" disabled={!quizId} onClick={() => setShowHistory(true)} />
        </div>
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
        {draft.status === 'published' ? (
          <Button variant="primary" icon="check" loading={saveState === 'saving'} onClick={() => void save('manual')}>
            Enregistrer
          </Button>
        ) : (
          <Button variant="primary" icon="send" loading={saveState === 'saving'} onClick={() => void save('publish')}>
            Publier
          </Button>
        )}
      </div>

      {backup && (
        <div className="alert alert-warning editor-backup" role="status">
          <Icon name="restore" size={18} />
          <span>Une version non enregistrée du {formatDateTime(backup.savedAt)} a été retrouvée sur cet appareil.</span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              history.set(backup.draft, { merge: false });
              setSaveState('dirty');
              setBackup(null);
            }}
          >
            Restaurer
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              writeStorage('local', backupKey(quizId), null);
              setBackup(null);
            }}
          >
            Ignorer
          </Button>
        </div>
      )}

      <div className="editor-body">
        <nav className="editor-rail" aria-label="Questions du quiz">
          <button type="button" className={`rail-item rail-settings${selected === SETTINGS ? ' active' : ''}`} onClick={() => setSelected(SETTINGS)}>
            <Icon name="sliders" />
            <span>Paramètres du quiz</span>
            {!draft.title.trim() && <Icon name="alert" className="rail-warning" aria-label="Titre manquant" />}
          </button>
          {questions.length > 3 && (
            <label className="rail-search">
              <Icon name="search" size={16} />
              <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Rechercher une question…" aria-label="Rechercher dans les questions" />
            </label>
          )}
          {search && <p className="muted small">{visible.length} question{visible.length > 1 ? 's' : ''} trouvée{visible.length > 1 ? 's' : ''}</p>}
          <ol className="rail-list">
            {visible.map(({ question, index }) => {
              const problem = questionProblem(question);
              const dragging = drag?.from === index;
              const dropBefore = drag && !dragging && drag.to === index && drag.to < drag.from;
              const dropAfter = drag && !dragging && drag.to === index && drag.to > drag.from;
              return (
                <li key={question.key} ref={register(index)} className={`${dragging ? 'is-dragging' : ''}${dropBefore ? ' drop-before' : ''}${dropAfter ? ' drop-after' : ''}`}>
                  <button
                    type="button"
                    className={`rail-item${question.key === selected ? ' active' : ''}`}
                    onClick={() => setSelected(question.key)}
                    aria-current={question.key === selected ? 'true' : undefined}
                  >
                    {!search && (
                      <span className="rail-grip" aria-label={`Déplacer la question ${index + 1}`} title="Glisser pour déplacer" {...handleProps(index)}>
                        <Icon name="grip" size={16} strokeWidth={3} />
                      </span>
                    )}
                    <span className="rail-index">{index + 1}</span>
                    <Icon name={TYPE_ICONS[question.type]} size={16} aria-label={QUESTION_TYPE_LABELS[question.type]} />
                    <span className="rail-text">{question.text.trim() || 'Question sans énoncé'}</span>
                    {question.bonus && <Icon name="gift" size={14} aria-label="Question bonus" />}
                    {problem && <Icon name="alert" className="rail-warning" aria-label={problem} />}
                  </button>
                </li>
              );
            })}
          </ol>
          <Button variant="soft" icon="plus" block onClick={() => setAdding(true)} disabled={questions.length >= LIMITS.questionsPerQuiz}>
            Ajouter une question
          </Button>
          <Button variant="ghost" icon="folder" block onClick={() => setBankPicking(true)} disabled={questions.length >= LIMITS.questionsPerQuiz}>
            Depuis la banque
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
              onChange={(question) => edit((d) => ({ ...d, questions: d.questions.map((q) => (q.key === question.key ? question : q)) }))}
              onMove={moveQuestion}
              onDuplicate={duplicateQuestion}
              onCopy={() => void copyCurrent()}
              onSaveToBank={saveToBank}
              onDelete={deleteQuestion}
              onPreview={() => setPreview(current)}
            />
          ) : (
            <QuizSettingsPanel draft={draft} accessCode={accessCode} onChange={(patch) => edit((d) => ({ ...d, ...patch }))} />
          )}
        </section>

        {livePreview && (
          <aside className="editor-live-preview" aria-label="Aperçu en direct">
            <p className="muted small">
              <Icon name="eye" size={14} /> Aperçu en direct — répondez pour tester la correction
            </p>
            {current ? <QuestionPreview key={current.key} question={current} index={selectedIndex} total={questions.length} /> : <p className="muted">Sélectionnez une question.</p>}
          </aside>
        )}
      </div>

      {adding && (
        <Modal title="Nouvelle question" onClose={() => setAdding(false)} wide>
          <div className="type-picker">
            {QUESTION_TYPES.map((type) => (
              <button key={type} type="button" className="type-option" onClick={() => addQuestion(type)}>
                <Icon name={TYPE_ICONS[type]} size={28} />
                <b>{QUESTION_TYPE_LABELS[type]}</b>
                <span className="type-option-desc">{QUESTION_TYPE_DEFINITIONS[type].description}</span>
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

      {bankSaving && <SaveToBankModal question={bankSaving} source={draft.title.trim()} onClose={() => setBankSaving(null)} />}

      {bankPicking && <BankPicker remaining={LIMITS.questionsPerQuiz - questions.length} onClose={() => setBankPicking(false)} onInsert={insertFromBank} />}

      {showHistory && quizId && (
        <VersionHistory
          quizId={quizId}
          onClose={() => setShowHistory(false)}
          onRestore={(input) => {
            history.set(fromInput(input), { merge: false });
            setSelected(SETTINGS);
            setShowHistory(false);
            toast.success('Version chargée : enregistrez pour la conserver (ou annulez)');
          }}
        />
      )}
    </div>
  );
}

const REASONS: Record<QuizVersionSummary['reason'], string> = { save: 'Enregistrement', autosave: 'Enregistrement automatique', restore: 'Restauration' };

function VersionHistory({ quizId, onClose, onRestore }: { quizId: number; onClose: () => void; onRestore: (quiz: ReturnType<typeof toInput>) => void }) {
  const toast = useToast();
  const [versions, setVersions] = useState<QuizVersionSummary[] | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    quizApi
      .versions(quizId)
      .then(({ versions: list }) => setVersions(list))
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        closeRef.current();
      });
  }, [quizId, toast]);

  const restore = async (version: QuizVersionSummary) => {
    setLoading(version.id);
    try {
      const { quiz } = await quizApi.version(quizId, version.id);
      onRestore(quiz);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(null);
    }
  };

  return (
    <Modal title="Historique des modifications" onClose={onClose}>
      {!versions ? (
        <PageLoader />
      ) : versions.length === 0 ? (
        <p className="muted">Aucune version enregistrée pour l’instant.</p>
      ) : (
        <ul className="version-list">
          {versions.map((version, index) => (
            <li key={version.id}>
              <div>
                <b>{formatDateTime(version.createdAt)}</b>
                {index === 0 && <span className="badge badge-brand">Actuelle</span>}
                <p className="muted small">
                  {REASONS[version.reason]} · {version.questionCount} question{version.questionCount > 1 ? 's' : ''} · « {version.title} »
                </p>
              </div>
              {index > 0 && (
                <Button size="sm" icon="restore" loading={loading === version.id} onClick={() => void restore(version)}>
                  Charger
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
