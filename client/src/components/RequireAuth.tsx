import { Navigate, Outlet, useLocation } from 'react-router';
import type { Role } from '../../../shared/types';
import { homePathFor, useAuth } from '../context/AuthContext';
import { PageLoader } from './Button';

/** Protège un groupe de routes : connexion obligatoire, et rôle précis si demandé. */
export function RequireAuth({ role }: { role?: Role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (role && user.role !== role) return <Navigate to={homePathFor(user)} replace />;
  return <Outlet />;
}
