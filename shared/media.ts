import type { MediaItem, MediaKind } from './types';

/**
 * Médias des questions : formats acceptés, limites de taille et vérification du contenu réel du fichier
 * (on ne se fie jamais au type annoncé par le navigateur). Partagé par le serveur et le mode sans serveur.
 */

export const MAX_MEDIA_PER_QUESTION = 4;

const MB = 1024 * 1024;

export interface MediaRule {
  label: string;
  /** Taille maximale sur un serveur WhatQuiz. */
  maxBytes: number;
  /** Taille maximale en mode sans serveur (le fichier est transmis à chaque élève en pair-à-pair). */
  maxBytesLocal: number;
  accept: string;
}

export const MEDIA_RULES: Record<MediaKind, MediaRule> = {
  image: { label: 'Image (PNG, JPEG, GIF, WebP)', maxBytes: 5 * MB, maxBytesLocal: 3 * MB, accept: 'image/png,image/jpeg,image/gif,image/webp' },
  audio: { label: 'Son (MP3, OGG, WAV, M4A)', maxBytes: 10 * MB, maxBytesLocal: 5 * MB, accept: 'audio/*' },
  video: { label: 'Vidéo (MP4, WebM)', maxBytes: 30 * MB, maxBytesLocal: 12 * MB, accept: 'video/mp4,video/webm' },
};

export const formatBytes = (bytes: number) => (bytes >= MB ? `${(bytes / MB).toFixed(bytes >= 10 * MB ? 0 : 1)} Mo` : `${Math.ceil(bytes / 1024)} Ko`);

export interface DetectedMedia {
  kind: MediaKind;
  mime: string;
  extension: string;
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) => signature.every((value, i) => bytes[offset + i] === value);

/** Reconnaît le format d'un fichier à partir de ses premiers octets (au moins 16). */
export function detectMedia(bytes: Uint8Array): DetectedMedia | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { kind: 'image', mime: 'image/png', extension: 'png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mime: 'image/jpeg', extension: 'jpg' };
  if (ascii(bytes, 0, 4) === 'GIF8') return { kind: 'image', mime: 'image/gif', extension: 'gif' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return { kind: 'image', mime: 'image/webp', extension: 'webp' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return { kind: 'audio', mime: 'audio/wav', extension: 'wav' };
  if (ascii(bytes, 0, 4) === 'OggS') return { kind: 'audio', mime: 'audio/ogg', extension: 'ogg' };
  if (ascii(bytes, 0, 4) === 'fLaC') return { kind: 'audio', mime: 'audio/flac', extension: 'flac' };
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0 && (bytes[1] & 0x06) !== 0)) {
    return { kind: 'audio', mime: 'audio/mpeg', extension: 'mp3' };
  }
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return { kind: 'audio', mime: 'audio/aac', extension: 'aac' };
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4);
    if (brand.startsWith('M4A') || brand.startsWith('M4B')) return { kind: 'audio', mime: 'audio/mp4', extension: 'm4a' };
    return { kind: 'video', mime: 'video/mp4', extension: 'mp4' };
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { kind: 'video', mime: 'video/webm', extension: 'webm' };
  return null;
}

/** Problème d'un fichier (null si accepté). `local` : limites du mode sans serveur. */
export function mediaProblem(detected: DetectedMedia | null, size: number, local: boolean): string | null {
  if (!detected) return 'Format non reconnu (images PNG/JPEG/GIF/WebP, sons MP3/OGG/WAV/M4A, vidéos MP4/WebM)';
  const max = local ? MEDIA_RULES[detected.kind].maxBytesLocal : MEDIA_RULES[detected.kind].maxBytes;
  if (size > max) return `Fichier trop lourd : ${formatBytes(size)} (maximum ${formatBytes(max)} pour ${MEDIA_RULES[detected.kind].label.split(' ')[0].toLowerCase()})`;
  return null;
}

/** Identifiant d'une vidéo YouTube (lien classique, court, Shorts ou intégré), sinon null. */
export function youtubeId(url: string): string | null {
  const match =
    /^https:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)([A-Za-z0-9_-]{11})/.exec(url) ??
    /^https:\/\/youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url) ??
    /^https:\/\/www\.youtube-nocookie\.com\/embed\/([A-Za-z0-9_-]{11})/.exec(url);
  return match?.[1] ?? null;
}

/** Référence d'un fichier stocké dans le navigateur (mode sans serveur). */
export const LOCAL_ASSET = /^asset:[a-f0-9]{16,64}$/;
const UPLOADED = /^\/uploads\/[\w.-]+$/;
const WEB = /^https:\/\/\S+$/;

/** URL de média acceptable. `allowLocal` : mode sans serveur (fichiers du navigateur et images intégrées). */
export function isValidMediaUrl(item: MediaItem, allowLocal: boolean): boolean {
  const { kind, url } = item;
  if (UPLOADED.test(url)) return !allowLocal;
  if (WEB.test(url)) return url.length <= 500;
  if (!allowLocal) return false;
  if (LOCAL_ASSET.test(url)) return true;
  return kind === 'image' && /^data:image\/[\w+.-]+;base64,[A-Za-z0-9+/=]+$/.test(url);
}

/** Toutes les URL de médias d'un quiz (couverture, images principales, médias des questions). */
export function quizMediaUrls(quiz: { imageUrl: string | null; questions: { imageUrl: string | null; media?: MediaItem[] }[] }): string[] {
  const urls = new Set<string>();
  if (quiz.imageUrl) urls.add(quiz.imageUrl);
  for (const question of quiz.questions) {
    if (question.imageUrl) urls.add(question.imageUrl);
    for (const item of question.media ?? []) urls.add(item.url);
  }
  return [...urls];
}
