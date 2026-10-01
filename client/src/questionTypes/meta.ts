import type { QuestionType } from '../../../shared/constants';
import type { PublicQuestion, SubmittedAnswer } from '../../../shared/types';
import type { IconName } from '../components/Icon';
import { CHOICE_LETTERS } from '../game/ChoiceTile';

/** Icône de chaque type (l'affichage propre à chaque type est dans ce dossier). */
export const TYPE_ICONS: Record<QuestionType, IconName> = {
  single: 'circleDot',
  multiple: 'checkSquare',
  truefalse: 'toggle',
  text: 'text',
  numeric: 'hash',
  slider: 'sliders',
  order: 'listOrdered',
  match: 'link',
  ranking: 'barChart',
  poll: 'pieChart',
  wordcloud: 'cloud',
};

/** Familles d'affichage : plusieurs types partagent la même saisie. */
export const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set(['single', 'multiple', 'truefalse', 'poll']);
export const ORDER_TYPES: ReadonlySet<QuestionType> = new Set(['order', 'ranking']);
export const NUMBER_TYPES: ReadonlySet<QuestionType> = new Set(['numeric', 'slider']);

export function formatValue(value: number, unit?: string): string {
  const text = Number.isInteger(value) ? String(value) : value.toLocaleString('fr-FR', { maximumFractionDigits: 4 });
  return unit ? `${text} ${unit}` : text;
}

/** Réponse de l'élève en clair (écran « réponse enregistrée »). */
export function describeAnswer(answer: SubmittedAnswer, question: PublicQuestion): string {
  switch (answer.kind) {
    case 'text':
      return `« ${answer.text} »`;
    case 'number':
      return formatValue(answer.value, question.unit);
    case 'order':
      return answer.order.map((index, place) => `${place + 1}. ${question.choices[index]}`).join(' · ');
    case 'match':
      return answer.pairs.map((option, i) => `${question.choices[i]} → ${question.options?.[option] ?? '?'}`).join(' · ');
    case 'choice':
      return answer.choices.map((index) => `${CHOICE_LETTERS[index]}. ${question.choices[index]}`).join(' · ');
  }
}
