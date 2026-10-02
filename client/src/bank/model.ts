import { normalizeText } from '../../../shared/text';
import type { BankFolder, BankQuestion, Difficulty, QuestionType } from '../../../shared/types';

/** Dossier affiché : tous, sans dossier, ou un dossier précis (sous-dossiers compris). */
export type FolderFilter = 'all' | 'none' | string;

export type BankSort = 'recent' | 'used' | 'alpha';

export interface BankFilters {
  folder: FolderFilter;
  search: string;
  type: QuestionType | '';
  difficulty: Difficulty | '';
  tag: string;
  sort: BankSort;
}

export const DEFAULT_FILTERS: BankFilters = { folder: 'all', search: '', type: '', difficulty: '', tag: '', sort: 'recent' };

/** Le dossier et tous ses sous-dossiers. */
export function folderWithDescendants(folders: BankFolder[], id: string): Set<string> {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }
  return result;
}

/** Chemin lisible d'un dossier : « Maths › Fractions ». */
export function folderPath(folders: BankFolder[], id: string | null): string {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const names: string[] = [];
  for (let current = id ? byId.get(id) : undefined; current && names.length < 10; current = current.parentId ? byId.get(current.parentId) : undefined) {
    names.unshift(current.name);
  }
  return names.join(' › ');
}

/** Dossiers dans l'ordre de l'arborescence, avec leur profondeur (pour les listes déroulantes). */
export function flattenFolders(folders: BankFolder[]): { folder: BankFolder; depth: number }[] {
  const result: { folder: BankFolder; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of folders.filter((f) => f.parentId === parentId).sort((a, b) => a.name.localeCompare(b.name, 'fr'))) {
      result.push({ folder, depth });
      visit(folder.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

export const searchableText = (item: BankQuestion) =>
  normalizeText(
    [item.question.text, item.question.explanation ?? '', item.source, ...item.tags, ...item.question.answers.flatMap((a) => [a.text, a.match ?? ''])].join(' '),
  );

export function filterQuestions(questions: BankQuestion[], folders: BankFolder[], filters: BankFilters): BankQuestion[] {
  const term = normalizeText(filters.search);
  const inFolder =
    filters.folder === 'all' ? null : filters.folder === 'none' ? new Set<string>() : folderWithDescendants(folders, filters.folder);
  const result = questions.filter(
    (item) =>
      (inFolder === null || (filters.folder === 'none' ? item.folderId === null : item.folderId !== null && inFolder.has(item.folderId))) &&
      (!filters.type || item.question.type === filters.type) &&
      (!filters.difficulty || item.difficulty === filters.difficulty) &&
      (!filters.tag || item.tags.some((t) => t.toLowerCase() === filters.tag.toLowerCase())) &&
      (!term || searchableText(item).includes(term)),
  );
  return result.sort((a, b) =>
    filters.sort === 'alpha'
      ? a.question.text.localeCompare(b.question.text, 'fr')
      : filters.sort === 'used'
        ? b.usage - a.usage || b.createdAt.localeCompare(a.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
  );
}

export function allTags(questions: BankQuestion[]): string[] {
  const seen = new Map<string, string>();
  for (const item of questions) for (const tag of item.tags) if (!seen.has(tag.toLowerCase())) seen.set(tag.toLowerCase(), tag);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'fr'));
}

/** Nombre de questions par dossier (sous-dossiers compris). */
export function folderCounts(questions: BankQuestion[], folders: BankFolder[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const folder of folders) {
    const ids = folderWithDescendants(folders, folder.id);
    counts.set(
      folder.id,
      questions.filter((q) => q.folderId !== null && ids.has(q.folderId)).length,
    );
  }
  return counts;
}
