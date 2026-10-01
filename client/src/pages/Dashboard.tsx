import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router';
import { QUIZ_FILE_EXTENSION } from '../../../shared/quizFile';
import { DIFFICULTY_LABELS } from '../../../shared/constants';
import { normalizeText } from '../../../shared/text';
import type { DashboardStats, QuizStatus, QuizSummary, QuizVisibility } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { gameApi, quizApi, type ActiveGame } from '../api/endpoints';
import { Button, LinkButton, PageLoader } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon, type IconName } from '../components/Icon';
import { Menu } from '../components/Menu';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { formatDateTime, formatNumber, formatPercent, formatRelative, plural } from '../lib/format';
import { exportQuiz, importQuizFile } from '../lib/quizTransfer';
import { useTestLauncher } from '../lib/useTestLauncher';
import { MediaImg } from '../components/Media';

type SortKey = 'updated' | 'title' | 'games';

const VISIBILITY: Record<QuizVisibility, { icon: IconName; label: string }> = {
  private: { icon: 'lock', label: 'Privé' },
  code: { icon: 'key', label: 'Partagé avec un code' },
  public: { icon: 'globe', label: 'Public' },
};

const PHASE_LABELS: Record<ActiveGame['phase'], string> = {
  lobby: 'Salle d’attente',
  ready: 'En cours',
  question: 'Question en cours',
  reveal: 'En cours',
  ended: 'Terminée',
};

export function DashboardPage() {
  const { user } = useAuth();
  const toast = useToast();
  const [quizzes, setQuizzes] = useState<QuizSummary[] | null>(null);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [active, setActive] = useState<ActiveGame[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<QuizStatus | ''>('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(
    () =>
      Promise.all([quizApi.list(), gameApi.stats(), gameApi.list()])
        .then(([q, s, g]) => {
          setQuizzes(q.quizzes);
          setStats(s.stats);
          setActive(g.active);
        })
        .catch((error: unknown) => toast.error(errorMessage(error))),
    [toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const categories = useMemo(() => [...new Set((quizzes ?? []).map((q) => q.category).filter(Boolean))].sort(), [quizzes]);

  const visible = useMemo(() => {
    // Recherche sans accents ni majuscules, dans le titre, la description, la sous-catégorie et les tags.
    const term = normalizeText(search);
    const filtered = (quizzes ?? []).filter(
      (quiz) =>
        (!category || quiz.category === category) &&
        (!status || quiz.status === status) &&
        (!term || normalizeText([quiz.title, quiz.description, quiz.subcategory, ...quiz.tags].join(' ')).includes(term)),
    );
    return filtered.sort((a, b) =>
      sort === 'title' ? a.title.localeCompare(b.title, 'fr') : sort === 'games' ? b.gameCount - a.gameCount : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [quizzes, search, category, status, sort]);

  if (!quizzes || !stats) return <PageLoader />;

  const addDemo = async () => {
    try {
      await quizApi.addDemo();
      toast.success('Quiz de démonstration ajouté');
      await load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const importFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImporting(true);
    try {
      const { quiz, lostImages } = await importQuizFile(file);
      toast.success(`« ${quiz.title} » importé`);
      if (lostImages > 0) toast.error(lostImages === 1 ? '1 média n’a pas pu être importé' : `${lostImages} médias n’ont pas pu être importés`);
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import impossible');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="stack" style={{ '--gap': '28px' } as CSSProperties}>
      <input ref={fileInput} type="file" accept={`${QUIZ_FILE_EXTENSION},.json,application/json`} hidden onChange={importFile} />
      <div className="page-header">
        <div>
          <p className="muted">Bonjour {user?.displayName} 👋</p>
          <h1 className="page-title">Tableau de bord</h1>
        </div>
        <div className="row">
          <LinkButton to="/join" icon="play">
            Rejoindre une partie
          </LinkButton>
          <LinkButton to="/library" icon="book" title="Quiz partagés par d’autres professeurs">
            Bibliothèque
          </LinkButton>
          <Button icon="fileUp" loading={importing} onClick={() => fileInput.current?.click()} title="Importer un quiz exporté depuis WhatQuiz">
            Importer
          </Button>
          <LinkButton to="/quizzes/new" variant="primary" icon="plus">
            Créer un quiz
          </LinkButton>
        </div>
      </div>

      <div className="stats-grid">
        <StatCard icon="list" value={formatNumber(stats.quizCount)} label="Quiz" />
        <StatCard icon="play" value={formatNumber(stats.gameCount)} label="Parties jouées" />
        <StatCard icon="users" value={formatNumber(stats.playerCount)} label="Participations" />
        <StatCard icon="target" value={formatPercent(stats.avgSuccessRate)} label="Réussite moyenne" />
      </div>

      {active.length > 0 && (
        <section className="stack">
          <h2 className="section-title">Parties en cours</h2>
          {active.map((game) => (
            <div key={game.id} className="card active-game">
              <span className="live-dot" aria-hidden="true" />
              <div className="spacer">
                <b>{game.quizTitle}</b>
                <p className="muted small">
                  Code {game.code} · {PHASE_LABELS[game.phase]} · {plural(game.playerCount, 'joueur')}
                </p>
              </div>
              <LinkButton to={`/host/${game.code}`} variant="primary" icon="play">
                Reprendre
              </LinkButton>
            </div>
          ))}
        </section>
      )}

      <div className="dashboard-grid">
        <section className="stack" aria-labelledby="quiz-list-title">
          <div className="row">
            <h2 id="quiz-list-title" className="section-title">
              Mes quiz
            </h2>
            <span className="badge">{quizzes.length}</span>
          </div>
          {quizzes.length > 0 && (
            <div className="quiz-filters">
              <div className="input-with-icon">
                <Icon name="search" />
                <input className="input" type="search" placeholder="Rechercher un quiz…" aria-label="Rechercher un quiz" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <select className="select" aria-label="Filtrer par catégorie" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Toutes les catégories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select className="select" aria-label="Filtrer par statut" value={status} onChange={(e) => setStatus(e.target.value as QuizStatus | '')}>
                <option value="">Tous les statuts</option>
                <option value="published">Publiés</option>
                <option value="draft">Brouillons</option>
              </select>
              <select className="select" aria-label="Trier" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                <option value="updated">Modifiés récemment</option>
                <option value="title">Titre (A → Z)</option>
                <option value="games">Les plus joués</option>
              </select>
            </div>
          )}
          {quizzes.length === 0 ? (
            <EmptyState
              icon="edit"
              title="Aucun quiz pour l’instant"
              actions={
                <>
                  <LinkButton to="/quizzes/new" variant="primary" icon="plus">
                    Créer mon premier quiz
                  </LinkButton>
                  <Button icon="star" onClick={addDemo}>
                    Ajouter le quiz de démo
                  </Button>
                </>
              }
            >
              Créez un quiz en quelques minutes, ou partez du quiz de démonstration pour découvrir WhatQuiz.
            </EmptyState>
          ) : visible.length === 0 ? (
            <p className="muted">Aucun quiz ne correspond à votre recherche.</p>
          ) : (
            <div className="quiz-grid">
              {visible.map((quiz) => (
                <QuizCard key={quiz.id} quiz={quiz} onChanged={load} />
              ))}
            </div>
          )}
        </section>

        <aside className="stack" aria-labelledby="recent-title">
          <div className="row">
            <h2 id="recent-title" className="section-title">
              Parties récentes
            </h2>
            <span className="spacer" />
            <Link to="/history" className="small">
              Tout voir
            </Link>
          </div>
          {stats.recentGames.length === 0 ? (
            <div className="card muted small">Vos parties terminées apparaîtront ici avec leurs résultats.</div>
          ) : (
            <div className="card recent-list">
              {stats.recentGames.map((game) => (
                <Link key={game.id} to={`/games/${game.id}/results`} className="recent-item">
                  <div className="spacer">
                    <b>{game.quizTitle}</b>
                    <p className="muted small">
                      {formatDateTime(game.createdAt)} · {plural(game.playerCount, 'joueur')}
                    </p>
                  </div>
                  {game.status === 'ended' ? <span className="badge badge-success">{formatPercent(game.successRate)}</span> : <span className="badge">Annulée</span>}
                </Link>
              ))}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function StatCard({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  return (
    <div className="card stat">
      <div className="stat-icon">
        <Icon name={icon} />
      </div>
      <div>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

function QuizCard({ quiz, onChanged }: { quiz: QuizSummary; onChanged: () => void }) {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();
  const { launchTest, pending } = useTestLauncher();
  const empty = quiz.questionCount === 0;

  const duplicate = async () => {
    try {
      await quizApi.duplicate(quiz.id);
      toast.success('Quiz dupliqué');
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const exportFile = async () => {
    try {
      await exportQuiz(quiz.id);
      toast.success('Quiz exporté');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Supprimer ce quiz ?',
      message: `« ${quiz.title} » sera définitivement supprimé. L’historique des parties est conservé.`,
      confirmLabel: 'Supprimer',
      danger: true,
    });
    if (!ok) return;
    try {
      await quizApi.remove(quiz.id);
      toast.success('Quiz supprimé');
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <article className="card quiz-card">
      <Link to={`/quizzes/${quiz.id}/edit`} className="quiz-card-cover" aria-label={`Modifier ${quiz.title}`}>
        {quiz.imageUrl ? <MediaImg url={quiz.imageUrl} loading="lazy" /> : <span aria-hidden="true">{quiz.title.charAt(0).toUpperCase()}</span>}
      </Link>
      <div className="quiz-card-body">
        <div className="quiz-card-badges">
          {quiz.status === 'draft' && <span className="badge badge-warning">Brouillon</span>}
          {quiz.category && <span className="badge badge-brand">{quiz.subcategory ? `${quiz.category} · ${quiz.subcategory}` : quiz.category}</span>}
          {quiz.level && <span className="badge">{quiz.level}</span>}
          {quiz.difficulty && <span className="badge">{DIFFICULTY_LABELS[quiz.difficulty]}</span>}
          <span className="quiz-card-visibility" title={VISIBILITY[quiz.visibility].label}>
            <Icon name={VISIBILITY[quiz.visibility].icon} size={16} aria-label={VISIBILITY[quiz.visibility].label} />
          </span>
        </div>
        <h3 className="quiz-card-title">{quiz.title}</h3>
        <p className="muted small">
          {plural(quiz.questionCount, 'question')} · {plural(quiz.gameCount, 'partie')} · modifié {formatRelative(quiz.updatedAt)}
        </p>
      </div>
      <div className="quiz-card-actions">
        <Button variant="primary" icon="play" disabled={empty} onClick={() => navigate(`/quizzes/${quiz.id}/launch`)} title={empty ? 'Ajoutez des questions pour lancer une partie' : undefined}>
          Lancer
        </Button>
        <LinkButton to={`/quizzes/${quiz.id}/edit`} icon="edit" aria-label="Modifier" title="Modifier" />
        <Menu trigger={(props) => <Button icon="flask" aria-label="Tester" title="Tester" disabled={empty || pending !== null} {...props} />}>
          {(close) => (
            <>
              <div className="menu-label">Tester sans enregistrer de résultats</div>
              <button role="menuitem" className="menu-item" onClick={() => (close(), launchTest(quiz.id, 'teacher'))}>
                <Icon name="sliders" /> Mode professeur
              </button>
              <button role="menuitem" className="menu-item" onClick={() => (close(), launchTest(quiz.id, 'student'))}>
                <Icon name="user" /> Mode élève
              </button>
              <Link role="menuitem" className="menu-item" to={`/quizzes/${quiz.id}/preview`} onClick={close}>
                <Icon name="eye" /> Aperçu des questions
              </Link>
            </>
          )}
        </Menu>
        <Menu trigger={(props) => <Button icon="more" aria-label="Plus d’actions" title="Plus d’actions" {...props} />}>
          {(close) => (
            <>
              <button role="menuitem" className="menu-item" onClick={() => (close(), duplicate())}>
                <Icon name="copy" /> Dupliquer
              </button>
              <button role="menuitem" className="menu-item" onClick={() => (close(), exportFile())}>
                <Icon name="download" /> Exporter (fichier)
              </button>
              <button role="menuitem" className="menu-item danger" onClick={() => (close(), remove())}>
                <Icon name="trash" /> Supprimer
              </button>
            </>
          )}
        </Menu>
      </div>
    </article>
  );
}
