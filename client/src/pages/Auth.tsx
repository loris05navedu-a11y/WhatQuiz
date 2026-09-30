import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { LIMITS } from '../../../shared/constants';
import type { PublicUser, Role } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { Segmented, TextField } from '../components/Form';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { homePathFor, useAuth } from '../context/AuthContext';
import { STANDALONE } from '../lib/backend';
import { GOOGLE_AVAILABLE, preloadGoogle } from '../lib/google';

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

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Bouton « Continuer avec Google » (même compte Google que sur Furious-Tube). */
function GoogleButton({ role, onDone, onError }: { role: Role; onDone: (user: PublicUser) => void; onError: (message: string) => void }) {
  const { loginWithGoogle } = useAuth();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (GOOGLE_AVAILABLE) void preloadGoogle().catch(() => undefined);
  }, []);
  if (!GOOGLE_AVAILABLE) return null;

  const start = async () => {
    setPending(true);
    try {
      onDone(await loginWithGoogle(role));
    } catch (err) {
      onError(errorMessage(err));
      setPending(false);
    }
  };

  return (
    <>
      <Button type="button" variant="soft" size="lg" block loading={pending} onClick={start} className="google-button">
        <GoogleLogo /> Continuer avec Google
      </Button>
      <p className="auth-separator muted small">
        <span>ou avec une adresse e-mail</span>
      </p>
    </>
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
        <GoogleButton
          role="teacher"
          onDone={(logged) => navigate(safeNext(params.get('next')) ?? homePathFor(logged), { replace: true })}
          onError={setError}
        />
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
    <AuthLayout
      title="Créer un compte"
      subtitle={
        STANDALONE
          ? 'Gratuit, sans publicité. Le compte et vos quiz restent dans ce navigateur, sur cet appareil.'
          : 'Gratuit, sans publicité, vos données restent sur votre serveur.'
      }
    >
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
        <GoogleButton role={role} onDone={(created) => navigate(homePathFor(created), { replace: true })} onError={setError} />
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
