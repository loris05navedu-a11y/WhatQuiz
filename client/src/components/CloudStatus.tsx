import { useEffect, useState, type FormEvent } from 'react';
import { authApi } from '../api/endpoints';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { STANDALONE } from '../lib/backend';
import { connectOnlineAccount, signInWithEmail } from '../lib/firebaseAccount';
import { formatDateTime } from '../lib/format';
import { cloudStatus, onCloudStatus, type CloudStatus } from '../standalone/cloudStatus';

/** Le moteur de synchronisation n'est chargé qu'à la demande (comptes sauvegardés en ligne). */
const resumeCloudSync = () => void import('../standalone/cloud').then((m) => m.resumeCloudSync());
const syncNow = () => void import('../standalone/cloud').then((m) => m.syncNow());
import { Button } from './Button';
import { TextField } from './Form';
import { Icon } from './Icon';
import { Modal } from './Modal';

const LABELS: Record<CloudStatus['state'], string> = {
  off: 'Sauvegarde sur cet appareil seulement',
  connecting: 'Connexion à la sauvegarde en ligne…',
  syncing: 'Synchronisation…',
  synced: 'Sauvegardé en ligne',
  offline: 'Hors ligne',
  error: 'Synchronisation interrompue',
};

export function useCloudStatus(): CloudStatus {
  const [status, setStatus] = useState(cloudStatus);
  useEffect(() => onCloudStatus(setStatus), []);
  return status;
}

/**
 * Pastille de la barre du haut (mode sans serveur) : état de la sauvegarde en ligne du compte, partagée entre le
 * site et l'application Android. Ouvre une fenêtre pour synchroniser, se reconnecter ou activer la sauvegarde.
 */
export function CloudStatusButton() {
  const { user } = useAuth();
  const status = useCloudStatus();
  const [open, setOpen] = useState(false);
  if (!STANDALONE || !user || user.isDemo) return null;
  const tone = status.state === 'synced' ? 'ok' : status.state === 'error' || status.state === 'off' ? 'warn' : 'busy';
  return (
    <>
      <button type="button" className={`cloud-status is-${tone}`} onClick={() => setOpen(true)} aria-label={LABELS[status.state]} title={LABELS[status.state]}>
        <Icon name="cloud" size={20} />
        <span className="cloud-status-dot" aria-hidden="true" />
      </button>
      {open && <CloudDialog status={status} onClose={() => setOpen(false)} />}
    </>
  );
}

function CloudDialog({ status, onClose }: { status: CloudStatus; onClose: () => void }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const needsPassword = status.state === 'off' || status.reconnect;

  /** Compte local seulement, ou session en ligne expirée : on (re)connecte le compte en ligne avec le mot de passe. */
  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setBusy(true);
    try {
      const { uid } = await authApi.cloud();
      if (uid) {
        const profile = await signInWithEmail(user.email, password);
        if (profile.uid !== uid) throw new Error('Ce mot de passe ouvre un autre compte en ligne');
        resumeCloudSync();
      } else {
        const profile = await connectOnlineAccount(user.email, password, user.displayName);
        if (!profile) throw new Error('Cette adresse est déjà utilisée par un compte en ligne avec un autre mot de passe');
        if (profile.email.toLowerCase() !== user.email.toLowerCase()) throw new Error('Le mot de passe n'est pas valide pour ce compte');
        const { user: linked } = await authApi.linkCloud(profile.uid);
        setUser(linked);
      }
      toast.success('Sauvegarde en ligne activée');
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Connexion impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Sauvegarde en ligne" onClose={onClose}>
      <div className="stack">
        <p className={`cloud-state is-${status.state}`}>
          <Icon name="cloud" size={18} /> <b>{LABELS[status.state]}</b>
        </p>
        {status.message && <p className="muted">{status.message}</p>}
        {status.syncedAt && <p className="muted small">Dernière synchronisation : {formatDateTime(status.syncedAt)}</p>}
        <p className="small">
          Vos quiz, résultats, banque de questions et historique sont enregistrés en ligne et suivent votre compte : connectez-vous avec la même adresse et
          le même mot de passe sur le site et dans l’application Android, tout est synchronisé automatiquement.
        </p>
        {needsPassword ? (
          <form className="stack" onSubmit={connect}>
            <TextField
              label={status.reconnect ? 'Mot de passe (pour vous reconnecter)' : 'Mot de passe du compte (pour activer la sauvegarde en ligne)'}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" variant="primary" icon="cloud" loading={busy} disabled={!password}>
              {status.reconnect ? 'Se reconnecter' : 'Activer la sauvegarde en ligne'}
            </Button>
          </form>
        ) : (
          <Button icon="refresh" onClick={() => (syncNow(), toast.success('Synchronisation lancée'))} disabled={status.state === 'connecting'}>
            Synchroniser maintenant
          </Button>
        )}
      </div>
    </Modal>
  );
}
