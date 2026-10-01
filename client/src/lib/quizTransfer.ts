import { parseQuizFile, QUIZ_FILE_EXTENSION, QuizFileError, toQuizFile } from '../../../shared/quizFile';
import type { MediaItem, Quiz, QuizInput } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { quizApi } from '../api/endpoints';
import { safeFileName, saveTextFile } from './download';
import { blobToDataUrl } from './image';
import { mediaBlob, uploadMedia } from './media';

const MAX_FILE_BYTES = 80 * 1024 * 1024;

/** Réécrit tous les médias d'un quiz (couverture, images, sons, vidéos), une seule fois par URL. null = retiré. */
async function mapMedia(quiz: QuizInput, convert: (url: string) => Promise<string | null>): Promise<QuizInput> {
  const cache = new Map<string, string | null>();
  const map = async (url: string | null) => {
    if (!url) return null;
    if (!cache.has(url)) cache.set(url, await convert(url));
    return cache.get(url)!;
  };
  const questions = [];
  for (const question of quiz.questions) {
    const media: MediaItem[] = [];
    for (const item of question.media ?? []) {
      const url = await map(item.url);
      if (url) media.push({ kind: item.kind, url });
    }
    questions.push({ ...question, imageUrl: await map(question.imageUrl), media });
  }
  return { ...quiz, imageUrl: await map(quiz.imageUrl), questions };
}

/** Export : les fichiers (serveur ou navigateur) sont intégrés au fichier pour rester portables. */
export async function exportQuiz(id: number): Promise<void> {
  const { quiz } = await quizApi.get(id);
  const portable = await mapMedia(quiz, async (url) => {
    if (/^(https:|data:)/.test(url)) return url;
    const blob = await mediaBlob(url);
    return blob ? blobToDataUrl(blob) : null;
  });
  saveTextFile(JSON.stringify(toQuizFile(portable)), `${safeFileName(quiz.title)}${QUIZ_FILE_EXTENSION}`, 'application/json');
}

export class ImportError extends Error {}

/** Crée un nouveau quiz à partir d'un fichier exporté ; les médias intégrés sont renvoyés au serveur (ou rangés dans le navigateur). */
export async function importQuizFile(file: File): Promise<{ quiz: Quiz; lostImages: number }> {
  if (file.size > MAX_FILE_BYTES) throw new ImportError('Fichier trop volumineux');
  let lostImages = 0;
  try {
    const parsed = parseQuizFile(await file.text());
    const input = await mapMedia(parsed, async (url) => {
      if (!url.startsWith('data:')) return url;
      try {
        const blob = await (await fetch(url)).blob();
        return (await uploadMedia(blob)).url;
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
