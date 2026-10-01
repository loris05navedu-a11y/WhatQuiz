import { useEffect, useState } from 'react';
import { detectMedia, mediaProblem, type DetectedMedia } from '../../../shared/media';
import type { MediaKind } from '../../../shared/types';
import { apiUpload } from '../api/client';
import { assetUrl, STANDALONE } from './backend';
import { resizeImageBlob } from './image';

export class MediaError extends Error {}

const IMAGE_MIMES: Record<string, DetectedMedia> = {
  'image/png': { kind: 'image', mime: 'image/png', extension: 'png' },
  'image/jpeg': { kind: 'image', mime: 'image/jpeg', extension: 'jpg' },
};

async function sniff(blob: Blob): Promise<DetectedMedia | null> {
  return detectMedia(new Uint8Array(await blob.slice(0, 32).arrayBuffer()));
}

/**
 * Ajoute un fichier aux médias : vérifie son format réel et sa taille, réduit les images (sauf GIF), puis
 * l'envoie au serveur, ou le range dans le navigateur en mode sans serveur. `expected` limite à un type de média.
 */
export async function uploadMedia(file: Blob, expected?: MediaKind): Promise<{ url: string; kind: MediaKind }> {
  let detected = await sniff(file);
  if (expected && detected && detected.kind !== expected) {
    throw new MediaError(expected === 'image' ? 'Ce fichier n’est pas une image' : expected === 'audio' ? 'Ce fichier n’est pas un son' : 'Ce fichier n’est pas une vidéo');
  }
  let blob: Blob = file;
  if (detected?.kind === 'image' && detected.mime !== 'image/gif' && detected.mime !== 'image/webp') {
    blob = await resizeImageBlob(new Blob([file], { type: detected.mime }));
    detected = IMAGE_MIMES[blob.type] ?? detected;
  }
  const problem = mediaProblem(detected, blob.size, STANDALONE);
  if (problem || !detected) throw new MediaError(problem ?? 'Fichier invalide');
  if (STANDALONE) {
    const { putAsset } = await import('../standalone/assets');
    return { url: `asset:${await putAsset(blob, detected.mime)}`, kind: detected.kind };
  }
  const { url } = await apiUpload<{ url: string }>('/uploads/file', blob, detected.mime);
  return { url, kind: detected.kind };
}

/* ───────────── Affichage des fichiers locaux ou reçus du professeur ───────────── */

type RemoteFetcher = (id: string) => Promise<Blob | null>;
let remoteFetcher: RemoteFetcher | null = null;

/** En partie (mode sans serveur), les fichiers absents de l'appareil sont demandés au professeur. */
export function setRemoteAssetFetcher(fetcher: RemoteFetcher | null): void {
  remoteFetcher = fetcher;
  for (const [url, entry] of resolved) if (entry === null) resolved.delete(url);
}

const resolved = new Map<string, Promise<string | null> | null>();

async function resolveAsset(id: string): Promise<string | null> {
  const { getAsset } = await import('../standalone/assets');
  const local = await getAsset(id);
  if (local) return URL.createObjectURL(local.blob);
  const blob = remoteFetcher ? await remoteFetcher(id).catch(() => null) : null;
  return blob ? URL.createObjectURL(blob) : null;
}

export function resolveMediaUrl(url: string): Promise<string | null> | string {
  if (!url.startsWith('asset:')) return assetUrl(url);
  let entry = resolved.get(url);
  if (!entry) {
    entry = resolveAsset(url.slice(6)).then((result) => {
      if (result === null) resolved.set(url, null);
      return result;
    });
    resolved.set(url, entry);
  }
  return entry;
}

/** URL affichable d'un média (null pendant le chargement ou s'il est introuvable). */
export function useMediaUrl(url: string | null | undefined): string | null {
  const immediate = url ? resolveMediaUrl(url) : null;
  const [value, setValue] = useState<string | null>(typeof immediate === 'string' ? immediate : null);
  useEffect(() => {
    if (!url) return setValue(null);
    const result = resolveMediaUrl(url);
    if (typeof result === 'string') return setValue(result);
    let alive = true;
    setValue(null);
    void result.then((resolvedUrl) => alive && setValue(resolvedUrl));
    return () => {
      alive = false;
    };
  }, [url]);
  return value;
}

/** Contenu binaire d'un média (export de quiz). */
export async function mediaBlob(url: string): Promise<Blob | null> {
  try {
    if (url.startsWith('data:')) return await (await fetch(url)).blob();
    if (url.startsWith('asset:')) {
      const { getAsset } = await import('../standalone/assets');
      return (await getAsset(url.slice(6)))?.blob ?? null;
    }
    if (url.startsWith('/uploads/')) {
      const response = await fetch(assetUrl(url));
      return response.ok ? await response.blob() : null;
    }
  } catch {
    // Média inaccessible : ignoré par l'appelant.
  }
  return null;
}
