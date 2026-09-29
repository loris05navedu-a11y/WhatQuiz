import { parseQuizFile, QUIZ_FILE_EXTENSION, QuizFileError, toQuizFile } from '../../../shared/quizFile';
import type { Quiz, QuizInput } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { quizApi, uploadApi } from '../api/endpoints';
import { safeFileName, saveTextFile } from './download';
import { blobToDataUrl } from './image';

const MAX_FILE_BYTES = 40 * 1024 * 1024;

/** Réécrit toutes les images d'un quiz (couverture + questions), une seule fois par URL. */
async function mapImages(quiz: QuizInput, convert: (url: string) => Promise<string | null>): Promise<QuizInput> {
  const cache = new Map<string, string | null>();
  const map = async (url: string | null) => {
    if (!url) return null;
    if (!cache.has(url)) cache.set(url, await convert(url));
    return cache.get(url)!;
  };
  const questions = [];
  for (const question of quiz.questions) questions.push({ ...question, imageUrl: await map(question.imageUrl) });
  return { ...quiz, imageUrl: await map(quiz.imageUrl), questions };
}

export async function exportQuiz(id: number): Promise<void> {
  const { quiz } = await quizApi.get(id);
  const portable = await mapImages(quiz, async (url) => {
    if (!url.startsWith('/uploads/')) return url;
    try {
      const response = await fetch(url);
      return response.ok ? await blobToDataUrl(await response.blob()) : null;
    } catch {
      return null;
    }
  });
  saveTextFile(JSON.stringify(toQuizFile(portable)), `${safeFileName(quiz.title)}${QUIZ_FILE_EXTENSION}`, 'application/json');
}

export class ImportError extends Error {}

/** Crée un nouveau quiz à partir d'un fichier exporté ; les images intégrées sont renvoyées au serveur. */
export async function importQuizFile(file: File): Promise<{ quiz: Quiz; lostImages: number }> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError('Fichier trop volumineux');
  let lostImages = 0;
  try {
    const parsed = parseQuizFile(await file.text());
    const input = await mapImages(parsed, async (url) => {
      if (!url.startsWith('data:')) return url;
      try {
        return (await uploadApi.image(url)).url;
      } catch {
        lostImages += 1;
        return null;
      }
    });
    const { quiz } = await quizApi.create(input);
    return { quiz, lostImages };
  } catch (error) {
    throw new ImportError(error instanceof QuizFileError ? error.message : errorMessage(error));
  }
}
