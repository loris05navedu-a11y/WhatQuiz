import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { homePathFor, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { currentFuriousTubeAccount, FIREBASE_ACCOUNTS, type FirebaseProfile } from '../lib/firebaseAccount';
import { Button } from './Button';

/** Compte Furious-Tube déjà connecté dans ce navigateur : un clic suffit pour entrer dans WhatQuiz. */
export function FuriousTubeContinue({ next }: { next?: string | null }) {
  const { user, continueWithFuriousTube } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [account, setAccount] = useState<FirebaseProfile | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!FIREBASE_ACCOUNTS) return;
    let alive = true;
    currentFuriousTubeAccount()
      .then((found) => alive && setAccount(found))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  if (!account || user) return null;

  const enter = async () => {
    setPending(true);
    try {
      const logged = await continueWithFuriousTube(account);
      navigate(next ?? homePathFor(logged), { replace: true });
    } catch (error) {
      toast.error(errorMessage(error));
      setPending(false);
    }
  };

  return (
    <div className="ft-continue">
      <p className="ft-continue-label">🔥 Compte Furious-Tube détecté</p>
      <p className="ft-continue-name">
        <strong>{account.displayName}</strong> <span className="muted small">{account.email}</span>
      </p>
      <Button variant="primary" size="lg" block loading={pending} onClick={enter}>
        Continuer en tant que {account.displayName}
      </Button>
    </div>
  );
}
