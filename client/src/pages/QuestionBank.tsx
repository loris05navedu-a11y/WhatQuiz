import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LIMITS } from '../../../shared/constants';
import type { BankFolder, BankQuestion } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { bankApi } from '../api/endpoints';
import { BankQuestionModal } from '../bank/BankModals';
import { FiltersBar, FolderSelect, FolderTree, QuestionList } from '../bank/components';
import { allTags, DEFAULT_FILTERS, filterQuestions, folderCounts, folderPath, folderWithDescendants, type BankFilters } from '../bank/model';
import { Button, PageLoader } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { TextField } from '../components/Form';
import { Icon } from '../components/Icon';
import { Modal } from '../components/Modal';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { QuestionPreview } from '../editor/QuestionPreview';
import { TagsInput } from '../editor/TagsInput';
import { useSyncRefresh } from '../lib/useSyncRefresh';

type Dialog =
  | { kind: 'question'; item: BankQuestion | null }
  | { kind: 'preview'; item: BankQuestion }
  | { kind: 'folder'; folder: BankFolder | null; parentId: string | null }
  | { kind: 'quiz' }
  | { kind: 'tag' }
  | null;

/** Banque de questions : dossiers, filtres, sélection multiple, création d'un quiz à partir d'une sélection. */
export function QuestionBankPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [data, setData] = useState<{ questions: BankQuestion[]; folders: BankFolder[] } | null>(null);
  const [filters, setFilters] = useState<BankFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<string[]>([]);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);

  const load = useCallback(
    () =>
      bankApi
        .list()
        .then((result) => {
          setData(result);
          // Les questions supprimées sortent de la sélection.
          setSelected((current) => current.filter((id) => result.questions.some((q) => q.id === id)));
          setFilters((f) => (f.folder !== 'all' && f.folder !== 'none' && !result.folders.some((folder) => folder.id === f.folder) ? { ...f, folder: 'all' } : f));
        })
        .catch((error: unknown) => toast.error(errorMessage(error))),
    [toast],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useSyncRefresh(load);

  const questions = useMemo(() => data?.questions ?? [], [data]);
  const folders = useMemo(() => data?.folders ?? [], [data]);
  const visible = useMemo(() => filterQuestions(questions, folders, filters), [questions, folders, filters]);
  const tags = useMemo(() => allTags(questions), [questions]);
  const counts = useMemo(() => folderCounts(questions, folders), [questions, folders]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const currentFolder = folders.find((f) => f.id === filters.folder) ?? null;

  if (!data) return <PageLoader />;

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      toast.success(success);
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
  const toggleAll = () =>
    setSelected((current) =>
      visible.every((item) => current.includes(item.id)) ? current.filter((id) => !visible.some((item) => item.id === id)) : [...new Set([...current, ...visible.map((item) => item.id)])],
    );

  const removeQuestion = async (item: BankQuestion) => {
    const ok = await confirm({ title: 'Supprimer cette question de la banque ?', message: `« ${item.question.text} » — les quiz qui l’utilisent déjà ne sont pas modifiés.`, confirmLabel: 'Supprimer', danger: true });
    if (ok) await run(() => bankApi.remove(item.id), 'Question supprimée');
  };

  const removeSelection = async () => {
    const ok = await confirm({
      title: `Supprimer ${selected.length} question${selected.length > 1 ? 's' : ''} ?`,
      message: 'Elles sont retirées de la banque. Les quiz qui les utilisent déjà ne sont pas modifiés.',
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (ok) await run(() => bankApi.removeMany(selected), 'Questions supprimées');
  };

  const removeFolder = async (folder: BankFolder) => {
    const ok = await confirm({
      title: `Supprimer le dossier « ${folder.name} » ?`,
      message: 'Ses questions et sous-dossiers ne sont pas supprimés : ils remontent dans le dossier parent.',
      confirmLabel: 'Supprimer le dossier',
      danger: true,
    });
    if (ok) await run(() => bankApi.removeFolder(folder.id), 'Dossier supprimé');
  };

  return (
    <div className="stack" style={{ '--gap': '20px' } as CSSProperties}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Banque de questions</h1>
          <p className="muted">Vos questions réutilisables, rangées par dossiers et tags. Sélectionnez-en pour créer un quiz en un clic.</p>
        </div>
        <div className="row">
          <Button icon="folder" onClick={() => setDialog({ kind: 'folder', folder: null, parentId: currentFolder?.id ?? null })} disabled={folders.length >= LIMITS.bankFolders}>
            Nouveau dossier
          </Button>
          <Button variant="primary" icon="plus" onClick={() => setDialog({ kind: 'question', item: null })}>
            Nouvelle question
          </Button>
        </div>
      </div>

      {questions.length === 0 && folders.length === 0 ? (
        <EmptyState icon="folder" title="Votre banque est vide">
          Ajoutez une question depuis l’éditeur de quiz (bouton « Ajouter à la banque »), toutes les questions d’un quiz depuis le tableau de bord (menu « … »), ou
          créez-en une ici avec « Nouvelle question ».
        </EmptyState>
      ) : (
        <div className="bank-layout">
          <aside className="bank-sidebar">
            <FolderTree
              folders={folders}
              counts={counts}
              total={questions.length}
              unfiled={questions.filter((q) => q.folderId === null).length}
              value={filters.folder}
              onChange={(folder) => setFilters((f) => ({ ...f, folder }))}
            />
            {currentFolder && (
              <div className="bank-folder-actions">
                <Button size="sm" variant="ghost" icon="edit" onClick={() => setDialog({ kind: 'folder', folder: currentFolder, parentId: currentFolder.parentId })}>
                  Renommer / déplacer
                </Button>
                <Button size="sm" variant="ghost" icon="plus" onClick={() => setDialog({ kind: 'folder', folder: null, parentId: currentFolder.id })}>
                  Sous-dossier
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => void removeFolder(currentFolder)}>
                  Supprimer
                </Button>
              </div>
            )}
          </aside>

          <section className="stack bank-main" style={{ '--gap': '12px' } as CSSProperties} aria-label="Questions">
            <FiltersBar filters={filters} onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))} tags={tags} />

            {selected.length > 0 && (
              <div className="bank-selection card" role="region" aria-label="Actions sur la sélection">
                <b>
                  {selected.length} sélectionnée{selected.length > 1 ? 's' : ''}
                </b>
                <Button size="sm" variant="primary" icon="play" onClick={() => setDialog({ kind: 'quiz' })} disabled={selected.length > LIMITS.questionsPerQuiz}>
                  Créer un quiz
                </Button>
                <div className="bank-move">
                  <FolderSelect folders={folders} value={moveTo} onChange={setMoveTo} label="Déplacer vers" rootLabel="Sans dossier" />
                  <Button size="sm" icon="folder" onClick={() => void run(() => bankApi.move(selected, moveTo), 'Questions déplacées')}>
                    Déplacer
                  </Button>
                </div>
                <Button size="sm" icon="tag" onClick={() => setDialog({ kind: 'tag' })}>
                  Ajouter un tag
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => void removeSelection()}>
                  Supprimer
                </Button>
                <Button size="sm" variant="ghost" icon="x" onClick={() => setSelected([])}>
                  Désélectionner
                </Button>
              </div>
            )}

            {currentFolder && <p className="muted small">Dossier : {folderPath(folders, currentFolder.id)} (sous-dossiers compris)</p>}
            {visible.length === 0 ? (
              <p className="muted bank-empty">Aucune question ne correspond à ces filtres.</p>
            ) : (
              <QuestionList
                items={visible}
                folders={folders}
                selected={selectedSet}
                onToggle={toggle}
                onToggleAll={toggleAll}
                onPreview={(item) => setDialog({ kind: 'preview', item })}
                onEdit={(item) => setDialog({ kind: 'question', item })}
                onDelete={(item) => void removeQuestion(item)}
              />
            )}
          </section>
        </div>
      )}

      {dialog?.kind === 'question' && (
        <BankQuestionModal
          item={dialog.item}
          folders={folders}
          tagSuggestions={tags}
          defaultFolderId={currentFolder?.id ?? null}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}

      {dialog?.kind === 'preview' && (
        <Modal title="Aperçu élève" onClose={() => setDialog(null)} wide>
          <QuestionPreview question={dialog.item.question} index={0} total={1} />
        </Modal>
      )}

      {dialog?.kind === 'folder' && (
        <FolderDialog
          folder={dialog.folder}
          parentId={dialog.parentId}
          folders={folders}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void load();
          }}
        />
      )}

      {dialog?.kind === 'quiz' && (
        <CreateQuizDialog
          count={selected.length}
          defaultTitle={currentFolder?.name ?? ''}
          onClose={() => setDialog(null)}
          onCreate={async (title) => {
            try {
              const { quiz } = await bankApi.createQuiz(selected, title);
              toast.success(`Quiz « ${quiz.title} » créé (brouillon)`);
              navigate(`/quizzes/${quiz.id}/edit`);
            } catch (error) {
              toast.error(errorMessage(error));
            }
          }}
        />
      )}

      {dialog?.kind === 'tag' && (
        <TagDialog
          suggestions={tags}
          onClose={() => setDialog(null)}
          onApply={async (newTags) => {
            setDialog(null);
            await run(() => bankApi.tag(selected, newTags), 'Tags ajoutés');
          }}
        />
      )}
    </div>
  );
}

function FolderDialog({ folder, parentId, folders, onClose, onSaved }: { folder: BankFolder | null; parentId: string | null; folders: BankFolder[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(folder?.name ?? '');
  const [parent, setParent] = useState<string | null>(parentId);
  const [saving, setSaving] = useState(false);
  // Un dossier ne peut pas être rangé dans lui-même ni dans ses sous-dossiers.
  const excluded = folder ? folderWithDescendants(folders, folder.id) : undefined;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (folder) await bankApi.updateFolder(folder.id, { name, parentId: parent });
      else await bankApi.createFolder(name, parent);
      toast.success(folder ? 'Dossier modifié' : 'Dossier créé');
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error));
      setSaving(false);
    }
  };

  return (
    <Modal title={folder ? 'Modifier le dossier' : 'Nouveau dossier'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <TextField label="Nom du dossier" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.folderName} placeholder="Ex. : Fractions" autoFocus required />
        <FolderSelect folders={folders} value={parent} onChange={setParent} label="Dans le dossier" rootLabel="À la racine" exclude={excluded} />
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" icon="check" loading={saving} disabled={!name.trim()}>
            {folder ? 'Enregistrer' : 'Créer'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CreateQuizDialog({ count, defaultTitle, onClose, onCreate }: { count: number; defaultTitle: string; onClose: () => void; onCreate: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState(defaultTitle);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onCreate(title.trim());
    setSaving(false);
  };
  return (
    <Modal title="Créer un quiz" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <p>
          Un nouveau quiz (brouillon privé) sera créé avec les {count} question{count > 1 ? 's' : ''} sélectionnée{count > 1 ? 's' : ''}, dans l’ordre de sélection.
        </p>
        <TextField label="Titre du quiz" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={LIMITS.quizTitle} placeholder="Quiz depuis la banque" autoFocus />
        <div className="modal-actions">
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" icon="check" loading={saving}>
            Créer le quiz
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function TagDialog({ suggestions, onClose, onApply }: { suggestions: string[]; onClose: () => void; onApply: (tags: string[]) => Promise<void> }) {
  const [tags, setTags] = useState<string[]>([]);
  return (
    <Modal
      title="Ajouter des tags à la sélection"
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" icon="tag" disabled={tags.length === 0} onClick={() => void onApply(tags)}>
            Ajouter
          </Button>
        </>
      }
    >
      <TagsInput tags={tags} onChange={setTags} suggestions={suggestions} />
      <p className="muted small">
        <Icon name="info" size={14} /> Les tags existants des questions sont conservés.
      </p>
    </Modal>
  );
}
