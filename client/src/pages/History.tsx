import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { GameSummary } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { gameApi } from '../api/endpoints';
import { Button, LinkButton, PageLoader } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { formatDateTime, formatPercent, plural } from '../lib/format';

export function HistoryPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const [games, setGames] = useState<GameSummary[] | null>(null);

  const load = useCallback(
    () =>
      gameApi
        .list()
        .then(({ games: list }) => setGames(list))
        .catch((error: unknown) => toast.error(errorMessage(error))),
    [toast],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (game: GameSummary) => {
    const ok = await confirm({ title: 'Supprimer cette partie de l’historique ?', message: 'Ses résultats seront définitivement effacés.', confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    try {
      await gameApi.remove(game.id);
      toast.success('Partie supprimée');
      void load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (!games) return <PageLoader />;

  return (
    <div className="stack">
      <div className="page-header">
        <h1 className="page-title">Historique des parties</h1>
      </div>
      {games.length === 0 ? (
        <EmptyState icon="history" title="Aucune partie pour le moment" actions={<LinkButton to="/dashboard" variant="primary">Choisir un quiz à lancer</LinkButton>}>
          Les résultats de chaque partie en direct seront conservés ici.
        </EmptyState>
      ) : (
        <div className="card table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Quiz</th>
                <th>Date</th>
                <th className="num">Joueurs</th>
                <th className="num">Questions</th>
                <th className="num">Réussite</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {games.map((game) => (
                <tr key={game.id}>
                  <td>
                    {game.status === 'ended' ? <Link to={`/games/${game.id}/results`}>{game.quizTitle}</Link> : game.quizTitle}{' '}
                    {game.status !== 'ended' && <span className="badge">Annulée</span>}
                  </td>
                  <td>{formatDateTime(game.createdAt)}</td>
                  <td className="num">{game.playerCount}</td>
                  <td className="num">{game.questionCount}</td>
                  <td className="num">{formatPercent(game.successRate)}</td>
                  <td className="num">
                    <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                      {game.status === 'ended' && <LinkButton to={`/games/${game.id}/results`} size="sm" icon="chart" aria-label={`Résultats de ${game.quizTitle}`} />}
                      <Button size="sm" variant="ghost" icon="trash" aria-label={`Supprimer la partie ${game.quizTitle}`} onClick={() => remove(game)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small" style={{ marginTop: 12 }}>
            {plural(games.length, 'partie')}
          </p>
        </div>
      )}
    </div>
  );
}
