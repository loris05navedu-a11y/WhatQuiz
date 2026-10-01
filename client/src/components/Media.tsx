import type { ImgHTMLAttributes } from 'react';
import { youtubeId } from '../../../shared/media';
import { useMediaUrl } from '../lib/media';
import { Icon } from './Icon';

/** Image d'un quiz ou d'une question (fichier envoyé, stocké dans le navigateur ou reçu du professeur). */
export function MediaImg({ url, alt = '', ...rest }: { url: string } & Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'>) {
  const src = useMediaUrl(url);
  if (!src) return <span className={`media-placeholder ${rest.className ?? ''}`} aria-hidden="true" />;
  return <img src={src} alt={alt} {...rest} />;
}

export function MediaVideo({ url, className }: { url: string; className?: string }) {
  const id = youtubeId(url);
  const src = useMediaUrl(id ? null : url);
  if (id) {
    return (
      <iframe
        className={`${className ?? ''} media-youtube`}
        src={`https://www.youtube-nocookie.com/embed/${id}?rel=0`}
        title="Vidéo YouTube"
        allow="encrypted-media; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    );
  }
  if (!src) return <MediaLoading kind="video" />;
  return <video className={className} src={src} controls playsInline preload="metadata" />;
}

export function MediaAudio({ url, className }: { url: string; className?: string }) {
  const src = useMediaUrl(url);
  if (!src) return <MediaLoading kind="audio" />;
  return <audio className={className} src={src} controls preload="metadata" />;
}

function MediaLoading({ kind }: { kind: 'audio' | 'video' }) {
  return (
    <span className="media-loading" role="status">
      <Icon name={kind === 'audio' ? 'music' : 'video'} size={18} /> Chargement du {kind === 'audio' ? 'son' : 'média'}…
    </span>
  );
}
