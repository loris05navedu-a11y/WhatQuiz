import { Suspense } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Button, LinkButton, PageLoader } from './Button';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { Menu } from './Menu';
import { ThemeToggle } from './ThemeToggle';

export function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isTeacher = user?.role === 'teacher';

  const onLogout = async () => {
    await logout();
    navigate('/');
  };

  return (
    <>
      {user?.isDemo && (
        <div className="demo-banner">
          <div className="container row" style={{ justifyContent: 'center', textAlign: 'center' }}>
            <span>
              Mode démo : vos quiz seront effacés sous 24 h. <Link to="/register">Créer un compte gratuit</Link>
            </span>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="container topbar-inner">
          <Logo to={isTeacher ? '/dashboard' : '/me'} />
          <nav className="topnav hide-mobile" aria-label="Navigation principale">
            {isTeacher ? (
              <>
                <NavLink to="/dashboard">
                  <Icon name="home" size={18} /> Tableau de bord
                </NavLink>
                <NavLink to="/history">
                  <Icon name="history" size={18} /> Historique
                </NavLink>
              </>
            ) : (
              <NavLink to="/me">
                <Icon name="home" size={18} /> Accueil
              </NavLink>
            )}
          </nav>
          <span className="spacer" />
          <LinkButton to="/join" variant="soft" size="sm" icon="play" className="hide-tablet">
            Rejoindre
          </LinkButton>
          <ThemeToggle />
          <Menu
            trigger={(props) => (
              <Button variant="ghost" icon="user" aria-label="Menu du compte" {...props}>
                <span className="hide-tablet" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {user?.displayName}
                </span>
              </Button>
            )}
          >
            {(close) => (
              <>
                <div className="menu-label">{user?.email}</div>
                {isTeacher && (
                  <>
                    <Link role="menuitem" className="menu-item show-mobile" to="/dashboard" onClick={close}>
                      <Icon name="home" /> Tableau de bord
                    </Link>
                    <Link role="menuitem" className="menu-item show-mobile" to="/history" onClick={close}>
                      <Icon name="history" /> Historique
                    </Link>
                  </>
                )}
                <Link role="menuitem" className="menu-item" to="/join" onClick={close}>
                  <Icon name="play" /> Rejoindre une partie
                </Link>
                {user?.isAdmin && (
                  <Link role="menuitem" className="menu-item" to="/admin" onClick={close}>
                    <Icon name="users" /> Administration
                  </Link>
                )}
                <Link role="menuitem" className="menu-item" to="/settings" onClick={close}>
                  <Icon name="sliders" /> Paramètres du compte
                </Link>
                <button role="menuitem" className="menu-item danger" onClick={onLogout}>
                  <Icon name="logout" /> Se déconnecter
                </button>
              </>
            )}
          </Menu>
        </div>
      </header>
      <main id="main" className="container page">
        <Suspense fallback={<PageLoader />}>
          <Outlet />
        </Suspense>
      </main>
    </>
  );
}
