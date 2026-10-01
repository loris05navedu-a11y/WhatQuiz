import { ASSET_STORE, database } from './db';

/**
 * Fichiers des questions en mode sans serveur (images, sons, vidéos), rangés dans IndexedDB.
 * Un fichier est identifié par l'empreinte SHA-256 de son contenu : `asset:<id>`. Le même fichier ajouté deux fois
 * n'est stocké qu'une fois. Les élèves les reçoivent de l'appareil du professeur, une seule fois par partie.
 */

export interface StoredAsset {
  type: string;
  blob: Blob;
}

const memory = new Map<string, StoredAsset>();

const toHex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function putAsset(blob: Blob, type: string): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const id = toHex(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 32);
  const asset = { type, blob: new Blob([bytes], { type }) };
  memory.set(id, asset);
  const db = await database();
  if (db) {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ASSET_STORE, 'readwrite');
      tx.objectStore(ASSET_STORE).put({ ...asset, size: bytes.byteLength, createdAt: new Date().toISOString() }, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Enregistrement du fichier impossible'));
      tx.onabort = () => reject(tx.error ?? new Error('Espace de stockage insuffisant sur cet appareil'));
    });
  }
  return id;
}

export async function getAsset(id: string): Promise<StoredAsset | null> {
  const cached = memory.get(id);
  if (cached) return cached;
  const db = await database();
  if (!db) return null;
  const found = await new Promise<StoredAsset | null>((resolve) => {
    const request = db.transaction(ASSET_STORE, 'readonly').objectStore(ASSET_STORE).get(id);
    request.onsuccess = () => {
      const value = request.result as StoredAsset | undefined;
      resolve(value?.blob ? { type: value.type, blob: value.blob } : null);
    };
    request.onerror = () => resolve(null);
  });
  if (found) memory.set(id, found);
  return found;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export const assetId = (url: string) => (url.startsWith('asset:') ? url.slice(6) : null);
