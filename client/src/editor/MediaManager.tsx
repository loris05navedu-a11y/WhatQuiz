import { useRef, useState, type FormEvent } from 'react';
import { formatBytes, MAX_MEDIA_PER_QUESTION, MEDIA_RULES, youtubeId } from '../../../shared/media';
import type { MediaItem, MediaKind } from '../../../shared/types';
import { errorMessage } from '../api/client';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { MediaAudio, MediaImg, MediaVideo } from '../components/Media';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';
import { STANDALONE } from '../lib/backend';
import { MediaError, uploadMedia } from '../lib/media';

const KIND_LABELS: Record<MediaKind, { add: string; icon: IconName; name: string }> = {
  image: { add: 'Image ou GIF', icon: 'image', name: 'Image' },
  audio: { add: 'Son', icon: 'music', name: 'Son' },
  video: { add: 'Vidéo', icon: 'video', name: 'Vidéo' },
};

interface MediaManagerProps {
  media: MediaItem[];
  onChange: (media: MediaItem[]) => void;
}

/** Médias supplémentaires d'une question : aperçu, ajout, remplacement, suppression et ordre. */
export function MediaManager({ media, onChange }: MediaManagerProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ kind: MediaKind; replace: number | null } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [linking, setLinking] = useState(false);
  const full = media.length >= MAX_MEDIA_PER_QUESTION;

  const choose = (kind: MediaKind, replace: number | null = null) => {
    setPending({ kind, replace });
    if (inputRef.current) {
      inputRef.current.accept = MEDIA_RULES[kind].accept;
      inputRef.current.click();
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file || !pending) return;
    setUploading(true);
    try {
      const item = await uploadMedia(file, pending.kind);
      const next = pending.replace === null ? [...media, item] : media.map((m, i) => (i === pending.replace ? item : m));
      onChange(next);
    } catch (error) {
      toast.error(error instanceof MediaError ? error.message : errorMessage(error));
    } finally {
      setUploading(false);
      setPending(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= media.length) return;
    const copy = [...media];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    onChange(copy);
  };

  const limits = (['image', 'audio', 'video'] as const)
    .map((kind) => `${KIND_LABELS[kind].name.toLowerCase()} ${formatBytes(STANDALONE ? MEDIA_RULES[kind].maxBytesLocal : MEDIA_RULES[kind].maxBytes)}`)
    .join(', ');

  return (
    <div className="field media-manager">
      <span className="field-label">Médias supplémentaires</span>
      <span className="field-hint">
        Jusqu’à {MAX_MEDIA_PER_QUESTION} images, sons ou vidéos (maximum : {limits}). Une vidéo YouTube peut être ajoutée par son lien.
      </span>
      <input ref={inputRef} type="file" hidden onChange={(e) => void onFile(e.target.files?.[0])} aria-label="Fichier du média" />
      {media.length > 0 && (
        <ul className="media-list">
          {media.map((item, index) => (
            <li key={`${item.url}-${index}`} className="media-card">
              <div className="media-card-preview">
                {item.kind === 'image' && <MediaImg url={item.url} />}
                {item.kind === 'audio' && <MediaAudio url={item.url} />}
                {item.kind === 'video' && <MediaVideo url={item.url} />}
              </div>
              <div className="media-card-actions">
                <span className="badge">
                  <Icon name={KIND_LABELS[item.kind].icon} size={14} /> {KIND_LABELS[item.kind].name}
                  {youtubeId(item.url) ? ' YouTube' : ''}
                </span>
                <span className="spacer" />
                <Button size="sm" variant="ghost" icon="chevronLeft" aria-label={`Avancer le média ${index + 1}`} disabled={index === 0} onClick={() => move(index, index - 1)} />
                <Button size="sm" variant="ghost" icon="chevronRight" aria-label={`Reculer le média ${index + 1}`} disabled={index === media.length - 1} onClick={() => move(index, index + 1)} />
                {!/^https:/.test(item.url) && (
                  <Button size="sm" variant="ghost" icon="refresh" aria-label={`Remplacer le média ${index + 1}`} loading={uploading && pending?.replace === index} onClick={() => choose(item.kind, index)} />
                )}
                <Button size="sm" variant="ghost" icon="trash" aria-label={`Supprimer le média ${index + 1}`} onClick={() => onChange(media.filter((_, i) => i !== index))} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="row media-add">
          {(['image', 'audio', 'video'] as const).map((kind) => (
            <Button key={kind} size="sm" icon={KIND_LABELS[kind].icon} loading={uploading && pending?.kind === kind && pending.replace === null} onClick={() => choose(kind)}>
              {KIND_LABELS[kind].add}
            </Button>
          ))}
          <Button size="sm" variant="ghost" icon="link" onClick={() => setLinking(true)}>
            Lien web ou YouTube
          </Button>
        </div>
      )}
      {linking && (
        <LinkDialog
          onClose={() => setLinking(false)}
          onAdd={(item) => {
            onChange([...media, item]);
            setLinking(false);
          }}
        />
      )}
    </div>
  );
}

function LinkDialog({ onAdd, onClose }: { onAdd: (item: MediaItem) => void; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<MediaKind>('video');
  const trimmed = url.trim();
  const isYoutube = youtubeId(trimmed) !== null;
  const valid = /^https:\/\/\S+$/.test(trimmed) && trimmed.length <= 500;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (valid) onAdd({ kind: isYoutube ? 'video' : kind, url: trimmed });
  };
  return (
    <Modal title="Ajouter un média par lien" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Adresse (https://…)</span>
          <input className="input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=…" autoFocus />
          <span className="field-hint">
            {isYoutube ? 'Vidéo YouTube : elle sera intégrée (sans cookies).' : 'Lien direct vers une image, un son (MP3…) ou une vidéo (MP4…). Les élèves la chargeront depuis Internet.'}
          </span>
        </label>
        {!isYoutube && (
          <div className="row">
            {(['image', 'audio', 'video'] as const).map((k) => (
              <Button key={k} size="sm" variant={kind === k ? 'primary' : 'ghost'} icon={KIND_LABELS[k].icon} aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABELS[k].name}
              </Button>
            ))}
          </div>
        )}
        {trimmed && !valid && <p className="alert">Seuls les liens sécurisés (https://) sont acceptés.</p>}
        <Button type="submit" variant="primary" icon="plus" disabled={!valid}>
          Ajouter
        </Button>
      </form>
    </Modal>
  );
}
