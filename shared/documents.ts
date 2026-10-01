/**
 * Stockage de documents commun au serveur (SQLite, table `documents`) et au mode sans serveur (IndexedDB).
 * Les fonctionnalités récentes (versions, banque de questions, classes, devoirs, notifications…) l'utilisent à
 * travers les services de shared/services : une seule implémentation pour les deux modes.
 */
export interface StoredDoc {
  id: string;
  /** Propriétaire (professeur ou élève), null pour un document global. */
  ownerId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocStore {
  get<T extends StoredDoc>(kind: string, id: string): T | undefined;
  /** Documents d'un type, éventuellement limités à un propriétaire. */
  list<T extends StoredDoc>(kind: string, ownerId?: number): T[];
  put<T extends StoredDoc>(kind: string, doc: T): void;
  delete(kind: string, id: string): void;
}

/** Erreur métier avec un code HTTP et un message lisible (convertie par le serveur comme par l'API locale). */
export class ServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
