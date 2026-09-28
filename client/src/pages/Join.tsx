import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { errorMessage } from '../api/client';
import { gameApi } from '../api/endpoints';
import { CodeInput } from '../components/CodeInput';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';

/** Étape 1 pour l'élève : vérifier le code avant de demander le pseudo. */
export function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initial = (params.get('code') ?? '').replace(/\D/g, '').slice(0, 6);

  const check = async (code: string) => {
    setLoading(true);
    setError(null);
    try {
      await gameApi.checkCode(code);
      navigate(`/play/${code}`);
    } catch (err) {
      setError(errorMessage(err));
      setLoading(false);
    }
  };

  const autoChecked = useRef(false);
  useEffect(() => {
    if (initial.length === 6 && !autoChecked.current) {
      autoChecked.current = true;
      void check(initial);
    }
    // Vérification automatique unique quand le code arrive par le lien / QR code.
  }, []);

  return (
    <div className="auth-page">
      <div className="auth-top">
        <Logo />
        <ThemeToggle />
      </div>
      <div className="auth-card card animate-in">
        <h1 className="auth-title">Rejoindre une partie</h1>
        <p className="muted">Entrez le code à 6 chiffres affiché au tableau.</p>
        <CodeInput onSubmit={check} loading={loading} error={error} initial={initial} autoFocus />
      </div>
    </div>
  );
}
