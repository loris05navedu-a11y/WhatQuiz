import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { AppShell } from './components/AppShell';
import { PageLoader } from './components/Button';
import { RequireAuth } from './components/RequireAuth';
import { AuthProvider } from './context/AuthContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';

// Chaque page est chargée à la demande : l'élève ne télécharge jamais le code de l'éditeur.
const page = (loader: () => Promise<Record<string, ComponentType>>, name: string): LazyExoticComponent<ComponentType> =>
  lazy(() => loader().then((module) => ({ default: module[name] })));

const Home = page(() => import('./pages/Home'), 'HomePage');
const Login = page(() => import('./pages/Auth'), 'LoginPage');
const Register = page(() => import('./pages/Auth'), 'RegisterPage');
const Join = page(() => import('./pages/Join'), 'JoinPage');
const Play = page(() => import('./pages/Play'), 'PlayPage');
const Host = page(() => import('./pages/Host'), 'HostPage');
const Dashboard = page(() => import('./pages/Dashboard'), 'DashboardPage');
const QuizEditor = page(() => import('./pages/QuizEditor'), 'QuizEditorPage');
const QuizPreview = page(() => import('./pages/QuizPreview'), 'QuizPreviewPage');
const Launch = page(() => import('./pages/Launch'), 'LaunchPage');
const Results = page(() => import('./pages/Results'), 'ResultsPage');
const History = page(() => import('./pages/History'), 'HistoryPage');
const Settings = page(() => import('./pages/Settings'), 'SettingsPage');
const StudentHome = page(() => import('./pages/StudentHome'), 'StudentHomePage');
const NotFound = page(() => import('./pages/NotFound'), 'NotFoundPage');

function Root() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Outlet />
    </Suspense>
  );
}

const router = createBrowserRouter([
  {
    element: <Root />,
    children: [
      { path: '/', element: <Home /> },
      { path: '/login', element: <Login /> },
      { path: '/register', element: <Register /> },
      { path: '/join', element: <Join /> },
      { path: '/play/:code', element: <Play /> },
      {
        element: <RequireAuth role="teacher" />,
        children: [{ path: '/host/:code', element: <Host /> }],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppShell />,
            children: [
              { path: '/settings', element: <Settings /> },
              { path: '/me', element: <StudentHome /> },
              {
                element: <RequireAuth role="teacher" />,
                children: [
                  { path: '/dashboard', element: <Dashboard /> },
                  { path: '/history', element: <History /> },
                  { path: '/quizzes/new', element: <QuizEditor /> },
                  { path: '/quizzes/:id/edit', element: <QuizEditor /> },
                  { path: '/quizzes/:id/preview', element: <QuizPreview /> },
                  { path: '/quizzes/:id/launch', element: <Launch /> },
                  { path: '/games/:id/results', element: <Results /> },
                ],
              },
            ],
          },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
