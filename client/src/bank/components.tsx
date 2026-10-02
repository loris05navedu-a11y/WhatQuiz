import { DIFFICULTY_LABELS, QUESTION_TYPE_LABELS, QUESTION_TYPES } from '../../../shared/constants';
import type { BankFolder, BankQuestion, Difficulty, QuestionType } from '../../../shared/types';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { TYPE_ICONS } from '../questionTypes/meta';
import { flattenFolders, folderPath, type BankFilters, type BankSort, type FolderFilter } from './model';

/* ───── Arborescence des dossiers ───── */

interface FolderTreeProps {
  folders: BankFolder[];
  counts: Map<string, number>;
  total: number;
  unfiled: number;
  value: FolderFilter;
  onChange: (value: FolderFilter) => void;
}

export function FolderTree({ folders, counts, total, unfiled, value, onChange }: FolderTreeProps) {
  const item = (key: FolderFilter, label: string, count: number, depth = 0, icon: 'folder' | 'list' | 'clipboard' = 'folder') => (
    <li key={key}>
      <button
        type="button"
        className={`folder-item${value === key ? ' active' : ''}`}
        style={{ paddingLeft: 12 + depth * 16 }}
        aria-current={value === key ? 'true' : undefined}
        onClick={() => onChange(key)}
      >
        <Icon name={icon} size={16} />
        <span className="folder-name">{label}</span>
        <span className="folder-count">{count}</span>
      </button>
    </li>
  );
  return (
    <ul className="folder-tree" aria-label="Dossiers">
      {item('all', 'Toutes les questions', total, 0, 'list')}
      {item('none', 'Sans dossier', unfiled, 0, 'clipboard')}
      {flattenFolders(folders).map(({ folder, depth }) => item(folder.id, folder.name, counts.get(folder.id) ?? 0, depth))}
    </ul>
  );
}

/** Liste déroulante des dossiers (déplacement, rangement d'une nouvelle question). */
export function FolderSelect({
  folders,
  value,
  onChange,
  label,
  rootLabel = 'Aucun dossier',
  exclude,
}: {
  folders: BankFolder[];
  value: string | null;
  onChange: (value: string | null) => void;
  label: string;
  rootLabel?: string;
  exclude?: Set<string>;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{rootLabel}</option>
        {flattenFolders(folders)
          .filter(({ folder }) => !exclude?.has(folder.id))
          .map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {'  '.repeat(depth)}
              {depth ? '└ ' : ''}
              {folder.name}
            </option>
          ))}
      </select>
    </label>
  );
}

/* ───── Filtres ───── */

interface FiltersBarProps {
  filters: BankFilters;
  onChange: (patch: Partial<BankFilters>) => void;
  tags: string[];
  folders?: BankFolder[];
}

export function FiltersBar({ filters, onChange, tags, folders }: FiltersBarProps) {
  return (
    <div className="bank-filters">
      <div className="input-with-icon bank-search">
        <Icon name="search" />
        <input
          className="input"
          type="search"
          placeholder="Énoncé, réponse, tag…"
          aria-label="Rechercher dans la banque"
          value={filters.search}
          onChange={(e) => onChange({ search: e.target.value })}
        />
      </div>
      {folders && (
        <select className="select" aria-label="Dossier" value={filters.folder} onChange={(e) => onChange({ folder: e.target.value })}>
          <option value="all">Tous les dossiers</option>
          <option value="none">Sans dossier</option>
          {flattenFolders(folders).map(({ folder, depth }) => (
            <option key={folder.id} value={folder.id}>
              {'  '.repeat(depth)}
              {folder.name}
            </option>
          ))}
        </select>
      )}
      <select className="select" aria-label="Type de question" value={filters.type} onChange={(e) => onChange({ type: e.target.value as QuestionType | '' })}>
        <option value="">Tous les types</option>
        {QUESTION_TYPES.map((type) => (
          <option key={type} value={type}>
            {QUESTION_TYPE_LABELS[type]}
          </option>
        ))}
      </select>
      <select className="select" aria-label="Difficulté" value={filters.difficulty} onChange={(e) => onChange({ difficulty: e.target.value as Difficulty | '' })}>
        <option value="">Toutes difficultés</option>
        {(['easy', 'medium', 'hard'] as const).map((d) => (
          <option key={d} value={d}>
            {DIFFICULTY_LABELS[d]}
          </option>
        ))}
      </select>
      {tags.length > 0 && (
        <select className="select" aria-label="Tag" value={filters.tag} onChange={(e) => onChange({ tag: e.target.value })}>
          <option value="">Tous les tags</option>
          {tags.map((tag) => (
            <option key={tag} value={tag}>
              #{tag}
            </option>
          ))}
        </select>
      )}
      <select className="select" aria-label="Trier" value={filters.sort} onChange={(e) => onChange({ sort: e.target.value as BankSort })}>
        <option value="recent">Ajoutées récemment</option>
        <option value="used">Les plus utilisées</option>
        <option value="alpha">Énoncé (A → Z)</option>
      </select>
    </div>
  );
}

/* ───── Liste des questions ───── */

interface QuestionListProps {
  items: BankQuestion[];
  folders: BankFolder[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onPreview: (item: BankQuestion) => void;
  onEdit?: (item: BankQuestion) => void;
  onDelete?: (item: BankQuestion) => void;
  showFolder?: boolean;
}

export function QuestionList({ items, folders, selected, onToggle, onToggleAll, onPreview, onEdit, onDelete, showFolder = true }: QuestionListProps) {
  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  return (
    <div className="bank-list">
      <label className="bank-select-all">
        <input type="checkbox" checked={allSelected} onChange={onToggleAll} disabled={items.length === 0} />
        <span>
          {allSelected ? 'Tout désélectionner' : 'Tout sélectionner'} ({items.length} question{items.length > 1 ? 's' : ''})
        </span>
      </label>
      <ul>
        {items.map((item) => {
          const { question } = item;
          const isSelected = selected.has(item.id);
          return (
            <li key={item.id} className={`bank-item${isSelected ? ' is-selected' : ''}`}>
              <input type="checkbox" checked={isSelected} onChange={() => onToggle(item.id)} aria-label={`Sélectionner « ${question.text} »`} />
              <div className="bank-item-body">
                <button type="button" className="bank-item-text" onClick={() => onToggle(item.id)}>
                  {question.text}
                </button>
                <div className="bank-item-meta">
                  <span className="badge">
                    <Icon name={TYPE_ICONS[question.type]} size={13} /> {QUESTION_TYPE_LABELS[question.type]}
                  </span>
                  {item.difficulty && <span className={`badge difficulty-${item.difficulty}`}>{DIFFICULTY_LABELS[item.difficulty]}</span>}
                  {showFolder && item.folderId && (
                    <span className="badge">
                      <Icon name="folder" size={13} /> {folderPath(folders, item.folderId)}
                    </span>
                  )}
                  {item.tags.map((tag) => (
                    <span key={tag} className="bank-tag">
                      #{tag}
                    </span>
                  ))}
                  {item.usage > 0 && <span className="muted small">utilisée {item.usage} fois</span>}
                  {item.source && <span className="muted small">de « {item.source} »</span>}
                </div>
              </div>
              <div className="bank-item-actions">
                <Button size="sm" variant="ghost" icon="eye" aria-label="Aperçu" title="Aperçu" onClick={() => onPreview(item)} />
                {onEdit && <Button size="sm" variant="ghost" icon="edit" aria-label="Modifier" title="Modifier" onClick={() => onEdit(item)} />}
                {onDelete && <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer" title="Supprimer" onClick={() => onDelete(item)} />}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
