import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button, LinkButton } from '../components/Button';
import { CodeInput } from '../components/CodeInput';
import { Icon, type IconName } from '../components/Icon';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { homePathFor, useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { errorMessage } from '../api/client';

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  { icon: 'edit', title: 'Créez en quelques minutes', text: 'QCM, vrai/faux, réponses multiples ou texte libre, avec images et minuteur.' },
  { icon: 'zap', title: 'Jouez en direct', text: 'Un code à 6 chiffres, et toute la classe répond depuis tablettes et téléphones.' },
  { icon: 'chart', title: 'Analysez les résultats', text: 'Taux de réussite, questions difficiles, temps de réponse : tout est clair.' },
];

export function HomePage() {
  const { user, startDemo } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [demoLoading, setDemoLoading] = useState(false);

  const tryDemo = async () => {
    setDemoLoading(true);
    try {
      await startDemo();
      navigate('/dashboard');
    } catch (error) {
      toast.error(errorMessage(error));
      setDemoLoading(false);
    }
  };

  return (
    <div className="home">
      <header className="container home-nav">
        <Logo />
        <span className="spacer" />
        <ThemeToggle />
        {user ? (
          <LinkButton to={homePathFor(user)} variant="soft" icon="home">
            Mon espace
          </LinkButton>
        ) : (
          <LinkButton to="/login" variant="ghost" icon="login">
            Connexion
          </LinkButton>
        )}
      </header>

      <main className="container home-hero">
        <section className="home-intro animate-in">
          <span className="badge badge-brand">
            <Icon name="zap" size={14} /> Quiz interactifs en temps réel
          </span>
          <h1 className="home-title">
            La classe entière <em>répond</em>, en direct.
          </h1>
          <p className="home-lead">
            WhatQuiz permet aux enseignants de créer des quiz, de les tester, puis de les animer en direct avec leurs élèves — sur
            n’importe quelle tablette.
          </p>
          <div className="row">
            {user?.role === 'teacher' ? (
              <LinkButton to="/quizzes/new" variant="primary" size="lg" icon="plus">
                Créer un quiz
              </LinkButton>
            ) : (
              <LinkButton to="/register" variant="primary" size="lg" icon="user">
                Créer un compte professeur
              </LinkButton>
            )}
            {!user && (
              <Button size="lg" icon="play" onClick={tryDemo} loading={demoLoading}>
                Essayer la démo
              </Button>
            )}
          </div>
        </section>

        <section className="join-panel animate-in" aria-labelledby="join-title" style={{ animationDelay: '0.1s' }}>
          <h2 id="join-title">Rejoindre une partie</h2>
          <p className="muted">Saisissez le code affiché par votre professeur.</p>
          <CodeInput onSubmit={(code) => navigate(`/join?code=${code}`)} />
        </section>
      </main>

      <section className="container home-features" aria-label="Fonctionnalités">
        {FEATURES.map((feature) => (
          <article key={feature.title} className="card feature">
            <div className="stat-icon">
              <Icon name={feature.icon} />
            </div>
            <h3>{feature.title}</h3>
            <p className="muted">{feature.text}</p>
          </article>
        ))}
      </section>
      <footer className="container home-footer muted small">
        WhatQuiz — application libre pour la classe.
        {window.WhatQuizAndroid && (
          <>
            {' · '}
            <button type="button" className="link-button" onClick={() => window.WhatQuizAndroid?.changeServer()}>
              Changer de serveur
            </button>
          </>
        )}
      </footer>
    </div>
  );
}
