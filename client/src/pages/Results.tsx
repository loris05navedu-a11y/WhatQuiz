import { useEffect, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router';
import { QUESTION_TYPE_LABELS } from '../../../shared/constants';
import type { GameResults, QuestionStat } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { gameApi } from '../api/endpoints';
import { Button, LinkButton, PageLoader } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Icon, type IconName } from '../components/Icon';
import { useToast } from '../context/ToastContext';
import { Podium } from '../game/Leaderboard';
import { formatDateTime, formatNumber, formatPercent, formatSeconds, plural } from '../lib/format';

const SCORING_LABELS = { speed: 'Bonus rapidité', fixed: 'Points fixes', none: 'Sans score' };

export function ResultsPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [results, setResults] = useState<GameResults | null>(null);

  useEffect(() => {
    gameApi
      .results(id)
      .then(({ results: loaded }) => setResults(loaded))
      .catch((error: unknown) => {
        toast.error(errorMessage(error));
        navigate('/history', { replace: true });
      });
  }, [id, navigate, toast]);

  if (!results) return <PageLoader />;
  const { game, players, questions, totals, settings } = results;

  return (
    <div className="stack results" style={{ '--gap': '28px' } as CSSProperties}>
      <div className="page-header">
        <div>
          <p className="muted">
            {formatDateTime(game.createdAt)} · code {game.code} · {SCORING_LABELS[settings.scoringMode]}
          </p>
          <h1 className="page-title">{game.quizTitle}</h1>
        </div>
        <div className="row">
          <Button icon="download" onClick={() => downloadCsv(results)} disabled={players.length === 0}>
            Export CSV
          </Button>
          {game.quizId && (
            <LinkButton to={`/quizzes/${game.quizId}/launch`} variant="primary" icon="refresh">
              Rejouer
            </LinkButton>
          )}
        </div>
      </div>

      {players.length === 0 ? (
        <EmptyState icon="users" title="Aucun joueur">
          Cette partie s’est terminée sans participant.
        </EmptyState>
      ) : (
        <>
          <div className="stats-grid">
            <Kpi icon="target" label="Taux de réussite" value={formatPercent(totals.successRate)} />
            <Kpi icon="users" label="Joueurs" value={formatNumber(players.length)} />
            <Kpi icon="checkSquare" label="Réponses" value={formatNumber(totals.answerCount)} />
            <Kpi icon="clock" label="Temps moyen" value={formatSeconds(totals.avgResponseMs)} />
          </div>

          <div className="results-highlights">
            {totals.hardest && <Highlight tone="danger" icon="alert" title="Question la plus difficile" stat={totals.hardest} />}
            {totals.easiest && <Highlight tone="success" icon="star" title="Question la plus facile" stat={totals.easiest} />}
          </div>

          <section className="card stack" aria-labelledby="ranking-title">
            <h2 id="ranking-title" className="section-title">
              Classement
            </h2>
            {settings.scoringMode !== 'none' && (
              <Podium
                entries={players.slice(0, 3).map((p) => ({ playerId: p.playerId, nickname: p.nickname, score: p.score, rank: p.rank, previousRank: null }))}
              />
            )}
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th className="num">Rang</th>
                    <th>Joueur</th>
                    <th className="num">Score</th>
                    <th className="num">Réussite</th>
                    <th className="num">Réponses</th>
                    <th className="num">Temps moyen</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((player) => (
                    <tr key={player.playerId}>
                      <td className="num">{player.rank}</td>
                      <td>
                        <b>{player.nickname}</b>
                      </td>
                      <td className="num">{formatNumber(player.score)}</td>
                      <td className="num">{formatPercent(game.questionCount ? player.correctCount / game.questionCount : null)}</td>
                      <td className="num">
                        {player.answeredCount}/{game.questionCount}
                      </td>
                      <td className="num">{formatSeconds(player.avgResponseMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card stack" aria-labelledby="questions-title">
            <h2 id="questions-title" className="section-title">
              Réussite par question
            </h2>
            <ol className="question-stats">
              {questions.map((question) => (
                <li key={question.index}>
                  <div className="row" style={{ '--gap': '8px' } as CSSProperties}>
                    <span className="badge">Q{question.index + 1}</span>
                    <span className="question-stats-text">{question.text}</span>
                    <span className="spacer" />
                    <b>{formatPercent(question.successRate)}</b>
                  </div>
                  <div className="progress" aria-hidden="true">
                    <span style={{ width: `${Math.round(question.successRate * 100)}%`, background: rateColor(question.successRate) }} />
                  </div>
                  <p className="muted small">
                    {QUESTION_TYPE_LABELS[question.type]} · {plural(question.answeredCount, 'réponse')} · {plural(question.correctCount, 'bonne réponse', 'bonnes réponses')} · temps moyen{' '}
                    {formatSeconds(question.avgResponseMs)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </div>
  );
}

const rateColor = (rate: number) => (rate >= 0.7 ? 'var(--success)' : rate >= 0.4 ? 'var(--warning)' : 'var(--danger)');

function Kpi({ icon, label, value }: { icon: IconName; label: string; value: string }) {
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

function Highlight({ tone, icon, title, stat }: { tone: 'danger' | 'success'; icon: IconName; title: string; stat: QuestionStat }) {
  return (
    <div className={`card highlight highlight-${tone}`}>
      <p className="highlight-title">
        <Icon name={icon} size={18} /> {title}
      </p>
      <p className="highlight-question">
        Q{stat.index + 1}. {stat.text}
      </p>
      <p className="muted small">{formatPercent(stat.successRate)} de réussite</p>
    </div>
  );
}

function downloadCsv(results: GameResults): void {
  const escape = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [
    ['Rang', 'Pseudo', 'Score', 'Bonnes réponses', 'Réponses', 'Temps moyen (s)'],
    ...results.players.map((p) => [p.rank, p.nickname, p.score, p.correctCount, p.answeredCount, p.avgResponseMs === null ? '' : (p.avgResponseMs / 1000).toFixed(1)]),
  ];
  const csv = '﻿' + rows.map((row) => row.map(escape).join(';')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `whatquiz-${results.game.quizTitle.replace(/[^\w-]+/g, '_')}-${results.game.code}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}
