import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LIMITS } from '../../../shared/constants';
import { errorMessage } from '../api/client';
import { accountApi } from '../api/endpoints';
import { Button } from '../components/Button';
import { Segmented, TextField } from '../components/Form';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { formatDate } from '../lib/format';

export function SettingsPage() {
  const { user } = useAuth();
  if (!user) return null;
  return (
    <div className="stack settings" style={{ maxWidth: 720, margin: '0 auto' }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres du compte</h1>
          <p className="muted">
            Compte {user.role === 'teacher' ? 'professeur' : 'élève'} créé le {formatDate(user.createdAt)}
          </p>
        </div>
      </div>
      {user.isDemo && <p className="alert alert-info">Le compte démo ne peut pas être modifié. Créez un compte pour conserver vos quiz.</p>}
      <ProfileForm />
      <PasswordForm />
      <AppearanceCard />
      <DangerZone />
    </div>
  );
}

function ProfileForm() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user!.displayName);
  const [email, setEmail] = useState(user!.email);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const { user: updated } = await accountApi.updateProfile({ displayName, email });
      setUser(updated);
      toast.success('Profil mis à jour');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 className="card-title">Profil</h2>
      <TextField label="Nom affiché" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={LIMITS.displayName} required disabled={user!.isDemo} />
      <TextField label="Adresse e-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={user!.isDemo} />
      <div>
        <Button type="submit" variant="primary" loading={saving} disabled={user!.isDemo}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

function PasswordForm() {
  const { user } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await accountApi.changePassword(current, next);
      setCurrent('');
      setNext('');
      toast.success('Mot de passe modifié. Vos autres sessions ont été déconnectées.');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={submit}>
      <h2 className="card-title">Mot de passe</h2>
      <TextField label="Mot de passe actuel" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required disabled={user!.isDemo} />
      <TextField
        label="Nouveau mot de passe"
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        autoComplete="new-password"
        minLength={LIMITS.minPassword}
        hint={`${LIMITS.minPassword} caractères minimum`}
        required
        disabled={user!.isDemo}
      />
      <div>
        <Button type="submit" variant="primary" loading={saving} disabled={user!.isDemo}>
          Changer le mot de passe
        </Button>
      </div>
    </form>
  );
}

function AppearanceCard() {
  const { preference, setPreference } = useTheme();
  return (
    <div className="card stack">
      <h2 className="card-title">Apparence</h2>
      <Segmented<ThemePreference>
        label="Thème"
        value={preference}
        onChange={setPreference}
        options={[
          { value: 'system', label: 'Automatique', icon: 'sliders' },
          { value: 'light', label: 'Clair', icon: 'sun' },
          { value: 'dark', label: 'Sombre', icon: 'moon' },
        ]}
      />
    </div>
  );
}

function DangerZone() {
  const { logout, setUser } = useAuth();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const toast = useToast();

  const remove = async () => {
    const ok = await confirm({
      title: 'Supprimer votre compte ?',
      message: 'Tous vos quiz et l’historique de vos parties seront définitivement supprimés.',
      confirmLabel: 'Supprimer mon compte',
      danger: true,
    });
    if (!ok) return;
    try {
      await accountApi.remove();
      setUser(null);
      navigate('/');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="card stack">
      <h2 className="card-title">Session</h2>
      <div className="row">
        <Button icon="logout" onClick={() => logout().then(() => navigate('/'))}>
          Se déconnecter
        </Button>
        <Button variant="danger" icon="trash" onClick={remove}>
          Supprimer mon compte
        </Button>
      </div>
    </div>
  );
}
