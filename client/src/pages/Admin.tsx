import { useCallback, useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import type { AdminUserRow } from '../../../shared/types';
import { api, errorMessage } from '../api/client';
import { Button, PageLoader } from '../components/Button';
import { Icon } from '../components/Icon';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { formatDateTime } from '../lib/format';

/** Panneau d'administration : liste des comptes et suppression (libère l'adresse e-mail). */
export function AdminPage() {
  const { user } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(
    () =>
      api<{ users: AdminUserRow[] }>('GET', '/admin/users')
        .then(({ users: list }) => setUsers(list))
        .catch((error: unknown) => toast.error(errorMessage(error))),
    [toast],
  );

  useEffect(() => {
    if (user?.isAdmin) void load();
  }, [user?.isAdmin, load]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (users ?? []).filter((u) => !term || u.email.toLowerCase().includes(term) || u.displayName.toLowerCase().includes(term));
  }, [users, search]);

  if (!user?.isAdmin) return <Navigate to="/" replace />;
  if (!users) return <PageLoader />;

  const remove = async (target: AdminUserRow) => {
    const ok = await confirm({
      title: `Supprimer ${target.email} ?`,
      message: `Le compte, ses ${target.quizCount} quiz et l’historique de ses parties seront définitivement supprimés. L’adresse e-mail pourra être réutilisée.`,
      confirmLabel: 'Supprimer le compte',
      danger: true,
    });
    if (!ok) return;
    try {
      await api('DELETE', `/admin/users/${target.id}`);
      toast.success('Compte supprimé');
      void load();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="stack">
      <div className="page-header">
        <div>
          <p className="muted">Administration</p>
          <h1 className="page-title">Comptes ({users.length})</h1>
        </div>
      </div>
      <div className="input-with-icon" style={{ maxWidth: 420 }}>
        <Icon name="search" />
        <input className="input" type="search" placeholder="Rechercher un e-mail ou un nom…" aria-label="Rechercher un compte" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Type</th>
              <th>Créé le</th>
              <th className="num">Quiz</th>
              <th className="num">Parties</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((u) => (
              <tr key={u.id}>
                <td>
                  <b>{u.displayName}</b>
                  <div className="muted small">{u.email}</div>
                </td>
                <td>
                  {u.isAdmin ? <span className="badge badge-brand">Admin</span> : u.isDemo ? <span className="badge badge-warning">Démo</span> : <span className="badge">{u.role === 'teacher' ? 'Professeur' : 'Élève'}</span>}
                </td>
                <td>{formatDateTime(u.createdAt)}</td>
                <td className="num">{u.quizCount}</td>
                <td className="num">{u.gameCount}</td>
                <td className="num">
                  {!u.isAdmin && u.id !== user.id && <Button size="sm" variant="ghost" icon="trash" aria-label={`Supprimer ${u.email}`} onClick={() => remove(u)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 && <p className="muted" style={{ padding: 12 }}>Aucun compte trouvé.</p>}
      </div>
    </div>
  );
}
