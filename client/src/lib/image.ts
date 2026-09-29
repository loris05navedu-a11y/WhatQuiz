import { STANDALONE } from './backend';

// Sans serveur, l'image voyage dans le quiz et vers chaque élève : on la garde plus légère.
const MAX_SIDE = STANDALONE ? 800 : 1280;
const QUALITY = STANDALONE ? 0.75 : 0.85;

/** Redimensionne une image côté navigateur avant l'envoi (plus léger pour le réseau et la tablette). */
export async function resizeImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Ce fichier n’est pas une image');
  if (file.type === 'image/gif') return blobToDataUrl(file);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return canvas.toDataURL(type, QUALITY);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
