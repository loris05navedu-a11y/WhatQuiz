import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useSyncRefresh } from '../lib/useSyncRefresh';
import { useNavigate } from 'react-router';
import type { StudentHistoryEntry } from '../../../shared/types';
import { accountApi } from '../api/endpoints';
import { CodeInput } from '../components/CodeInput';
import { useAuth } from '../context/AuthContext';
import { formatDateTime, formatNumber, formatRank } from '../lib/format';

/** Espace élève : rejoindre une partie et retrouver ses résultats (quand le professeur les a affichés). */
export function StudentHomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [history, setHistory] = useState<StudentHistoryEntry[]>([]);

  const load = useCallback(
    () =>
      accountApi
        .history()
        .then(({ history: entries }) => setHistory(entries))
        .catch(() => setHistory([])),
    [],
  );
  useEffect(() => {
    void load();
  }, [load]);
  useSyncRefresh(load);

  return (
    <div className="stack" style={{ maxWidth: 720, margin: '0 auto', '--gap': '24px' } as CSSProperties}>
      <div>
        <p className="muted">Bonjour {user?.displayName} 👋</p>
        <h1 className="page-title">Prêt pour un quiz ?</h1>
      </div>
      <section className="card stack">
        <h2 className="card-title">Rejoindre une partie</h2>
        <CodeInput onSubmit={(code) => navigate(`/join?code=${code}`)} />
      </section>
      <section className="stack">
        <h2 className="section-title">Mes dernières parties</h2>
        {history.length === 0 ? (
          <p className="card muted">Vos parties apparaîtront ici lorsque vous jouerez connecté à votre compte.</p>
        ) : (
          <div className="card recent-list">
            {history.map((entry) => (
              <div key={entry.gameId} className="recent-item">
                <div className="spacer">
                  <b>{entry.quizTitle}</b>
                  <p className="muted small">
                    {entry.endedAt && formatDateTime(entry.endedAt)} · pseudo « {entry.nickname} »
                  </p>
                </div>
                {entry.rank !== null && entry.score !== null ? (
                  <span className="badge badge-brand">
                    {formatRank(entry.rank)}/{entry.playerCount} · {formatNumber(entry.score)} pts
                  </span>
                ) : (
                  <span className="badge">Résultats non publiés</span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
