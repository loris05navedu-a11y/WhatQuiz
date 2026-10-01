import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, SHARE_CODE_LENGTH } from '../../../shared/constants';
import { normalizeShareCode } from '../../../shared/quizMeta';
import { normalizeText } from '../../../shared/text';
import type { Quiz, QuizSummary } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { quizApi } from '../api/endpoints';
import { Button, PageLoader } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { MediaImg } from '../components/Media';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';
import { STANDALONE } from '../lib/backend';
import { formatRelative, plural } from '../lib/format';

type LibraryQuiz = QuizSummary & { ownerName: string };

/** Bibliothèque : quiz publics des autres professeurs, et quiz partagés ouverts avec leur code d'accès. */
export function LibraryPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [quizzes, setQuizzes] = useState<LibraryQuiz[] | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [code, setCode] = useState(() => normalizeShareCode(params.get('code') ?? ''));
  const [opening, setOpening] = useState(false);
  const [shown, setShown] = useState<{ code: string; quiz: Quiz } | null>(null);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    quizApi
      .library()
      .then(({ quizzes: list }) => setQuizzes(list))
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        setQuizzes([]);
      });
  }, [toast]);

  const open = async (shareCode: string) => {
    setOpening(true);
    try {
      const { quiz } = await quizApi.shared(shareCode);
      setShown({ code: shareCode, quiz });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setOpening(false);
    }
  };

  // Lien direct « …/library?code=ABC123 » : le quiz s'ouvre dès l'arrivée sur la page.
  useEffect(() => {
    const fromLink = normalizeShareCode(params.get('code') ?? '');
    if (fromLink.length === SHARE_CODE_LENGTH) void open(fromLink);
  }, []);

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    if (code.length === SHARE_CODE_LENGTH) void open(code);
  };

  const copy = async () => {
    if (!shown) return;
    setCopying(true);
    try {
      const { quiz } = await quizApi.copyShared(shown.code);
      toast.success(`« ${quiz.title} » ajouté à vos quiz (brouillon privé)`);
      navigate(`/quizzes/${quiz.id}/edit`);
    } catch (error) {
      toast.error(errorMessage(error));
      setCopying(false);
    }
  };

  const categories = useMemo(() => [...new Set((quizzes ?? []).map((q) => q.category).filter(Boolean))].sort(), [quizzes]);
  const visible = useMemo(() => {
    const term = normalizeText(search);
    return (quizzes ?? []).filter(
      (quiz) =>
        (!category || quiz.category === category) &&
        (!term || normalizeText([quiz.title, quiz.description, quiz.subcategory, quiz.ownerName, ...quiz.tags].join(' ')).includes(term)),
    );
  }, [quizzes, search, category]);

  return (
    <div className="stack" style={{ '--gap': '24px' } as CSSProperties}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bibliothèque</h1>
          <p className="muted">Quiz partagés par d’autres professeurs : consultez-les puis copiez-les pour les adapter.</p>
        </div>
      </div>

      <form className="card library-code" onSubmit={submitCode}>
        <Icon name="key" size={22} />
        <label htmlFor="share-code" className="library-code-label">
          <b>Ouvrir avec un code</b>
          <span className="muted small">Un collègue vous a donné le code d’un quiz ?</span>
        </label>
        <input
          id="share-code"
          className="input library-code-input"
          value={code}
          onChange={(e) => {
            const value = normalizeShareCode(e.target.value).slice(0, SHARE_CODE_LENGTH);
            setCode(value);
            if (params.has('code')) setParams({}, { replace: true });
          }}
          placeholder="ABC123"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          inputMode="text"
        />
        <Button type="submit" variant="primary" icon="search" loading={opening} disabled={code.length !== SHARE_CODE_LENGTH}>
          Ouvrir
        </Button>
      </form>

      {STANDALONE && (
        <p className="alert alert-info">
          <Icon name="info" size={18} /> Sans serveur WhatQuiz, la bibliothèque contient les quiz partagés par les comptes de cet appareil uniquement.
        </p>
      )}

      {!quizzes ? (
        <PageLoader />
      ) : quizzes.length === 0 ? (
        <EmptyState icon="book" title="La bibliothèque est vide pour l’instant">
          Les quiz publiés en visibilité « Public » par les autres professeurs apparaîtront ici. Rendez les vôtres publics depuis leurs paramètres.
        </EmptyState>
      ) : (
        <section className="stack" aria-label="Quiz publics">
          <div className="quiz-filters library-filters">
            <div className="input-with-icon">
              <Icon name="search" />
              <input className="input" type="search" placeholder="Titre, tag, auteur…" aria-label="Rechercher dans la bibliothèque" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <select className="select" aria-label="Filtrer par catégorie" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Toutes les catégories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {visible.length === 0 ? (
            <p className="muted">Aucun quiz ne correspond à cette recherche.</p>
          ) : (
            <div className="quiz-grid">
              {visible.map((quiz) => (
                <article key={quiz.id} className="card quiz-card">
                  <button type="button" className="quiz-card-cover" onClick={() => quiz.accessCode && void open(quiz.accessCode)} aria-label={`Consulter ${quiz.title}`}>
                    {quiz.imageUrl ? <MediaImg url={quiz.imageUrl} loading="lazy" /> : <span aria-hidden="true">{quiz.title.charAt(0).toUpperCase()}</span>}
                  </button>
                  <div className="quiz-card-body">
                    <div className="quiz-card-badges">
                      {quiz.category && <span className="badge badge-brand">{quiz.subcategory ? `${quiz.category} · ${quiz.subcategory}` : quiz.category}</span>}
                      {quiz.level && <span className="badge">{quiz.level}</span>}
                      {quiz.difficulty && <span className="badge">{DIFFICULTY_LABELS[quiz.difficulty]}</span>}
                    </div>
                    <h3 className="quiz-card-title">{quiz.title}</h3>
                    <p className="muted small">
                      par {quiz.ownerName} · {plural(quiz.questionCount, 'question')} · mis à jour {formatRelative(quiz.updatedAt)}
                    </p>
                    {quiz.tags.length > 0 && <p className="small library-tags">{quiz.tags.map((t) => `#${t}`).join(' ')}</p>}
                  </div>
                  <div className="quiz-card-actions">
                    <Button icon="eye" disabled={!quiz.accessCode} onClick={() => quiz.accessCode && void open(quiz.accessCode)}>
                      Consulter
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {shown && (
        <Modal
          title={shown.quiz.title}
          onClose={() => setShown(null)}
          wide
          actions={
            <>
              <Button variant="ghost" onClick={() => setShown(null)}>
                Fermer
              </Button>
              <Button variant="primary" icon="copy" loading={copying} onClick={() => void copy()}>
                Copier dans mes quiz
              </Button>
            </>
          }
        >
          <div className="stack">
            {shown.quiz.description && <p>{shown.quiz.description}</p>}
            <p className="muted small">
              {plural(shown.quiz.questions.length, 'question')}
              {shown.quiz.category && ` · ${shown.quiz.category}`}
              {shown.quiz.level && ` · ${shown.quiz.level}`} · code {shown.code}
            </p>
            <ol className="library-questions">
              {shown.quiz.questions.map((question) => (
                <li key={question.id}>
                  <span className="badge">{QUESTION_TYPE_LABELS[question.type]}</span> {question.text}
                </li>
              ))}
            </ol>
            <p className="muted small">La copie est un brouillon privé : vous pourrez la modifier librement, l’original n’est pas touché.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
