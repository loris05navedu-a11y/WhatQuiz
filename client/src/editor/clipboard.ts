import { parseQuestionList } from '../../../shared/quizFile';
import type { QuestionInput } from '../../../shared/types';
import { readStorage, writeStorage } from '../lib/storage';

const KEY = 'wq:question-clipboard';
const FORMAT = 'whatquiz-questions';

/** Copie des questions : presse-papiers du système (autre onglet, autre quiz) et copie locale de secours. */
export async function copyQuestions(questions: QuestionInput[]): Promise<void> {
  const text = JSON.stringify({ format: FORMAT, questions });
  writeStorage('local', KEY, text);
  await navigator.clipboard?.writeText(text).catch(() => undefined);
}

function parse(text: string | null): QuestionInput[] {
  if (!text) return [];
  try {
    const data = JSON.parse(text) as { format?: unknown; questions?: unknown };
    return data.format === FORMAT ? parseQuestionList(data.questions) : [];
  } catch {
    return [];
  }
}

export async function pasteQuestions(): Promise<QuestionInput[]> {
  const fromSystem = await navigator.clipboard?.readText().then(parse, () => []);
  return fromSystem?.length ? fromSystem : parse(readStorage('local', KEY));
}

export const hasCopiedQuestions = () => parse(readStorage('local', KEY)).length > 0;
