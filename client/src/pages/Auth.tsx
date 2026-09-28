import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LIMITS } from '../../../shared/constants';
import type { Role } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { Segmented, TextField } from '../components/Form';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { homePathFor, useAuth } from '../context/AuthContext';

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-top">
        <Logo />
        <ThemeToggle />
      </div>
      <div className="auth-card card animate-in">
        <h1 className="auth-title">{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

/** Redirection sûre après connexion : uniquement vers une page interne. */
function safeNext(value: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null;
}

export function LoginPage() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user) return <Navigate to={safeNext(params.get('next')) ?? homePathFor(user)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const logged = await login(email, password);
      navigate(safeNext(params.get('next')) ?? homePathFor(logged), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Connexion" subtitle="Heureux de vous revoir !">
      <form className="stack" onSubmit={submit}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <TextField label="Adresse e-mail" type="email" icon="user" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        <TextField label="Mot de passe" type="password" icon="lock" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Se connecter
        </Button>
        <p className="muted center">
          Pas encore de compte ? <Link to="/register">Créer un compte</Link>
        </p>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const { user, register, loading } = useAuth();
  const navigate = useNavigate();
  const [role, setRole] = useState<Role>('teacher');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && user && !user.isDemo) return <Navigate to={homePathFor(user)} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < LIMITS.minPassword) {
      setError(`Le mot de passe doit contenir au moins ${LIMITS.minPassword} caractères`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const created = await register({ email, password, displayName, role });
      navigate(homePathFor(created), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout title="Créer un compte" subtitle="Gratuit, sans publicité, vos données restent sur votre serveur.">
      <form className="stack" onSubmit={submit}>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="field">
          <span className="field-label">Je suis</span>
          <Segmented
            label="Type de compte"
            value={role}
            onChange={setRole}
            options={[
              { value: 'teacher', label: 'Professeur', icon: 'edit' },
              { value: 'student', label: 'Élève', icon: 'user' },
            ]}
          />
        </div>
        <TextField
          label={role === 'teacher' ? 'Nom affiché' : 'Prénom'}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={LIMITS.displayName}
          autoComplete="name"
          required
        />
        <TextField label="Adresse e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        <TextField
          label="Mot de passe"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint={`${LIMITS.minPassword} caractères minimum`}
          required
        />
        <Button type="submit" variant="primary" size="lg" block loading={submitting}>
          Créer mon compte
        </Button>
        <p className="muted center">
          Déjà inscrit ? <Link to="/login">Se connecter</Link>
        </p>
      </form>
    </AuthLayout>
  );
}
