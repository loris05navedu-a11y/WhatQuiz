import { Suspense } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { Button, LinkButton, PageLoader } from './Button';
import { Icon, type IconName } from './Icon';
import { Logo } from './Logo';
import { Menu } from './Menu';
import { ThemeToggle } from './ThemeToggle';
import { CloudStatusButton } from './CloudStatus';
import { FURIOUS_TUBE_URL } from '../lib/backend';

/** Lien de navigation : le libellé disparaît sur les écrans moyens (l'icône et l'infobulle restent). */
const navItem = (to: string, icon: IconName, label: string) => (
  <NavLink to={to} title={label} aria-label={label}>
    <Icon name={icon} size={18} /> <span className="topnav-label">{label}</span>
  </NavLink>
);

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
                {navItem('/dashboard', 'home', 'Tableau de bord')}
                {navItem('/bank', 'folder', 'Banque')}
                {navItem('/library', 'book', 'Bibliothèque')}
                {navItem('/history', 'history', 'Historique')}
              </>
            ) : (
              navItem('/me', 'home', 'Accueil')
            )}
          </nav>
          <span className="spacer" />
          <LinkButton to="/join" variant="soft" size="sm" icon="play" className={`hide-tablet${isTeacher ? ' topbar-join' : ''}`}>
            Rejoindre
          </LinkButton>
          <CloudStatusButton />
          <ThemeToggle />
          <Menu
            trigger={(props) => (
              <Button variant="ghost" icon="user" aria-label="Menu du compte" {...props}>
                <span className={`hide-tablet${isTeacher ? ' topbar-account-name' : ''}`} style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                    <Link role="menuitem" className="menu-item show-mobile" to="/bank" onClick={close}>
                      <Icon name="folder" /> Banque de questions
                    </Link>
                    <Link role="menuitem" className="menu-item show-mobile" to="/library" onClick={close}>
                      <Icon name="book" /> Bibliothèque
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
                <a role="menuitem" className="menu-item" href={FURIOUS_TUBE_URL} onClick={close}>
                  <Icon name="play" /> Furious-Tube
                </a>
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
