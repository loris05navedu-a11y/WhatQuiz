import { QUESTION_TYPE_LABELS } from '../../../shared/constants';
import type { MediaItem, PublicQuestion } from '../../../shared/types';
import { Icon } from '../components/Icon';
import { MediaAudio, MediaImg, MediaVideo } from '../components/Media';

export function QuestionMeta({ question }: { question: Pick<PublicQuestion, 'index' | 'total' | 'type' | 'points' | 'pointsEnabled'> & { bonus?: boolean } }) {
  return (
    <div className="question-meta">
      <span className="badge badge-brand">
        Question {question.index + 1}/{question.total}
      </span>
      <span className="badge">{QUESTION_TYPE_LABELS[question.type]}</span>
      {question.bonus && (
        <span className="badge badge-bonus">
          <Icon name="gift" size={14} /> Bonus ×2
        </span>
      )}
      {question.pointsEnabled && question.points > 0 && <span className="badge">{question.points} pts</span>}
    </div>
  );
}

interface QuestionStatementProps {
  text: string;
  imageUrl: string | null;
  media?: MediaItem[];
  large?: boolean;
}

/** Énoncé, images, audio et vidéo d'une question (taille adaptée à l'écran, élève ou projection). */
export function QuestionStatement({ text, imageUrl, media = [], large }: QuestionStatementProps) {
  const images = [imageUrl, ...media.filter((m) => m.kind === 'image').map((m) => m.url)].filter((url): url is string => Boolean(url));
  return (
    <div className={`question-statement${large ? ' large' : ''}`}>
      <h2 className="question-text">{text}</h2>
      {images.length === 1 && <MediaImg className="question-image" url={images[0]} />}
      {images.length > 1 && (
        <div className={`question-gallery gallery-${Math.min(images.length, 4)}`}>
          {images.map((url, i) => (
            <MediaImg key={i} url={url} alt={`Image ${i + 1}`} />
          ))}
        </div>
      )}
      {media
        .filter((m) => m.kind === 'video')
        .map((m, i) => (
          <MediaVideo key={`v${i}`} className="question-video" url={m.url} />
        ))}
      {media
        .filter((m) => m.kind === 'audio')
        .map((m, i) => (
          <MediaAudio key={`a${i}`} className="question-audio" url={m.url} />
        ))}
    </div>
  );
}
