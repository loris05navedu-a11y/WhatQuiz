import { LinkButton } from '../components/Button';
import { EmptyState } from '../components/EmptyState';

export function NotFoundPage() {
  return (
    <div className="container page">
      <EmptyState icon="search" title="Page introuvable" actions={<LinkButton to="/" variant="primary" icon="home">Retour à l’accueil</LinkButton>}>
        Cette page n’existe pas ou a été déplacée.
      </EmptyState>
    </div>
  );
}
