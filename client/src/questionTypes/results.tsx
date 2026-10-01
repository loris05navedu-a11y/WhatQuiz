import type { CSSProperties } from 'react';
import type { Correction, HostView, PublicQuestion, QuestionStats, SubmittedAnswer, TextAnswerStat } from '../../../shared/types';
import { Icon } from '../components/Icon';
import { ChoiceTile } from '../game/ChoiceTile';
import { formatPercent } from '../lib/format';
import { CHOICE_TYPES, formatValue, ORDER_TYPES } from './meta';

/** Énoncé seul : ce que le professeur projette pendant que les élèves répondent. */
export function HostQuestionBody({ question }: { question: PublicQuestion }) {
  if (CHOICE_TYPES.has(question.type)) {
    return (
      <div className={`choices choices-${question.choices.length}${question.type === 'truefalse' ? ' choices-tf' : ''}`}>
        {question.choices.map((choice, index) => (
          <ChoiceTile key={index} index={index} text={choice} />
        ))}
      </div>
    );
  }
  if (ORDER_TYPES.has(question.type)) {
    return (
      <ul className="item-chips" aria-label="Éléments à ordonner">
        {question.choices.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    );
  }
  if (question.type === 'match') {
    return (
      <div className="match-columns">
        <ul>
          {question.choices.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
        <ul>
          {question.options?.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }
  const hints: Partial<Record<PublicQuestion['type'], string>> = {
    text: 'Les élèves saisissent leur réponse.',
    wordcloud: 'Les élèves proposent un mot : le nuage apparaîtra à la fin.',
    numeric: `Les élèves saisissent un nombre${question.unit ? ` (en ${question.unit})` : ''}.`,
    slider: question.range ? `Les élèves placent un curseur entre ${formatValue(question.range.min, question.unit)} et ${formatValue(question.range.max, question.unit)}.` : '',
  };
  return (
    <p className="host-hint">
      <Icon name={question.type === 'wordcloud' ? 'cloud' : question.type === 'text' ? 'text' : 'hash'} size={18} /> {hints[question.type]}
    </p>
  );
}

export function Explanation({ text, inverse = true }: { text?: string; inverse?: boolean }) {
  if (!text) return null;
  return (
    <aside className={`explanation${inverse ? ' explanation-inverse' : ''}`}>
      <Icon name="bulb" size={20} />
      <p>{text}</p>
    </aside>
  );
}

export function WordCloud({ items }: { items: TextAnswerStat[] }) {
  if (items.length === 0) return <p className="muted-inverse">Aucune réponse.</p>;
  const max = Math.max(...items.map((i) => i.count));
  return (
    <ul className="word-cloud" aria-label="Nuage de mots">
      {items.map((item, i) => (
        <li key={item.text} style={{ '--weight': item.count / max, '--hue': (i * 47) % 360 } as CSSProperties} title={`${item.count} réponse${item.count > 1 ? 's' : ''}`}>
          {item.text}
          <span className="sr-only"> : {item.count}</span>
        </li>
      ))}
    </ul>
  );
}

function Bar({ label, value, total, tone }: { label: string; value: number; total: number; tone?: 'correct' | 'muted' }) {
  const ratio = total ? value / total : 0;
  return (
    <li className={`stat-bar${tone ? ` is-${tone}` : ''}`}>
      <span className="stat-bar-label">{label}</span>
      <span className="stat-bar-track" aria-hidden="true">
        <span style={{ width: `${ratio * 100}%` }} />
      </span>
      <b>{value}</b>
    </li>
  );
}

/** Correction et répartition des réponses, sur l'écran du professeur. */
export function HostReveal({ view }: { view: HostView }) {
  const question = view.question!;
  const stats = view.stats;
  const answered = view.answeredCount;

  if (CHOICE_TYPES.has(question.type)) {
    const counts = stats?.kind === 'choices' ? stats.counts : (view.distribution ?? []);
    const poll = question.type === 'poll';
    return (
      <div className={`choices choices-${question.choices.length} choices-compact`}>
        {question.choices.map((choice, index) => (
          <ChoiceTile
            key={index}
            index={index}
            text={choice}
            state={poll ? 'idle' : question.correctChoices.includes(index) ? 'correct' : 'dimmed'}
            count={counts[index] ?? 0}
            total={answered}
          />
        ))}
      </div>
    );
  }
  return <StatsDetail question={question} stats={stats} correction={question} answered={answered} />;
}

interface CorrectionLike {
  acceptedAnswers: string[];
  correctOrder?: number[];
  correctPairs?: number[];
  correctValue?: { answer: number; tolerance: number };
}

function StatsDetail({ question, stats, correction, answered }: { question: PublicQuestion; stats: QuestionStats | null; correction: CorrectionLike; answered: number }) {
  switch (question.type) {
    case 'text':
      return (
        <div className="text-answers">
          <p>
            Réponse attendue : <b>{correction.acceptedAnswers.join(' / ')}</b>
          </p>
          {stats?.kind === 'texts' && stats.items.length > 0 ? (
            <ul>
              {stats.items.map((answer) => (
                <li key={answer.text} className={answer.correct ? 'correct' : undefined}>
                  <span>{answer.text}</span>
                  <b>{answer.count}</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-inverse">Aucune réponse.</p>
          )}
        </div>
      );
    case 'wordcloud':
      return <WordCloud items={stats?.kind === 'texts' ? stats.items : []} />;
    case 'numeric':
    case 'slider': {
      const expected = correction.correctValue;
      return (
        <div className="stack">
          {expected && (
            <p className="expected-value">
              Réponse attendue : <b>{formatValue(expected.answer, question.unit)}</b>
              {expected.tolerance > 0 && <span> (± {formatValue(expected.tolerance, question.unit)})</span>}
            </p>
          )}
          {stats?.kind === 'numbers' && stats.items.length > 0 ? (
            <>
              <ul className="stat-bars">
                {stats.items.map((item) => (
                  <Bar key={item.value} label={formatValue(item.value, question.unit)} value={item.count} total={answered} tone={item.correct ? 'correct' : 'muted'} />
                ))}
              </ul>
              {stats.average !== null && <p className="muted-inverse">Moyenne de la classe : {formatValue(Math.round(stats.average * 100) / 100, question.unit)}</p>}
            </>
          ) : (
            <p className="muted-inverse">Aucune réponse.</p>
          )}
        </div>
      );
    }
    case 'order': {
      const order = correction.correctOrder ?? [];
      const rates = stats?.kind === 'order' ? stats.correctRates : [];
      return (
        <ol className="order-result">
          {order.map((item, place) => (
            <li key={item}>
              <span className="order-rank">{place + 1}</span>
              <span className="order-text">{question.choices[item]}</span>
              <span className="badge">{formatPercent(rates[item] ?? 0)} bien placé</span>
            </li>
          ))}
        </ol>
      );
    }
    case 'ranking': {
      const positions = stats?.kind === 'order' ? stats.averagePositions : [];
      const ranked = question.choices.map((text, i) => ({ text, average: positions[i] })).sort((a, b) => (a.average ?? 99) - (b.average ?? 99));
      return (
        <ol className="order-result">
          {ranked.map((entry, place) => (
            <li key={entry.text}>
              <span className="order-rank">{place + 1}</span>
              <span className="order-text">{entry.text}</span>
              {entry.average !== null && entry.average !== undefined && <span className="badge">rang moyen {entry.average.toFixed(1)}</span>}
            </li>
          ))}
        </ol>
      );
    }
    case 'match': {
      const pairs = correction.correctPairs ?? [];
      const rates = stats?.kind === 'match' ? stats.correctRates : [];
      return (
        <ul className="match-result">
          {question.choices.map((left, i) => (
            <li key={i}>
              <span>{left}</span>
              <Icon name="link" size={16} />
              <b>{question.options?.[pairs[i]]}</b>
              <span className="badge">{formatPercent(rates[i] ?? 0)}</span>
            </li>
          ))}
        </ul>
      );
    }
    default:
      return null;
  }
}

interface PlayerCorrectionProps {
  question: PublicQuestion;
  correction: Correction | null;
  mine: SubmittedAnswer | null;
}

/** Correction côté élève, avec sa propre réponse (forme affichée). */
export function PlayerCorrection({ question, correction, mine }: PlayerCorrectionProps) {
  if (CHOICE_TYPES.has(question.type)) {
    const selected = mine?.kind === 'choice' ? mine.choices : [];
    const poll = question.type === 'poll';
    return (
      <div className={`choices choices-${question.choices.length} choices-compact`}>
        {question.choices.map((choice, index) => {
          const correct = correction?.correctChoices.includes(index) ?? false;
          const isMine = selected.includes(index);
          const state = poll ? (isMine ? 'selected' : 'dimmed') : correct ? 'correct' : isMine ? 'wrong' : 'dimmed';
          return <ChoiceTile key={index} index={index} text={choice} state={state} />;
        })}
      </div>
    );
  }

  switch (question.type) {
    case 'text':
      return (
        <div className="accepted-answers">
          {mine?.kind === 'text' && <p>Votre réponse : « {mine.text} »</p>}
          <p>
            Réponse attendue : <b>{correction?.acceptedAnswers.join(' / ')}</b>
          </p>
        </div>
      );
    case 'numeric':
    case 'slider':
      return (
        <div className="accepted-answers">
          {mine?.kind === 'number' && <p>Votre réponse : {formatValue(mine.value, question.unit)}</p>}
          {correction?.correctValue && (
            <p>
              Réponse attendue : <b>{formatValue(correction.correctValue.answer, question.unit)}</b>
              {correction.correctValue.tolerance > 0 && ` (± ${formatValue(correction.correctValue.tolerance, question.unit)})`}
            </p>
          )}
        </div>
      );
    case 'order': {
      const expected = correction?.correctOrder ?? [];
      const given = mine?.kind === 'order' ? mine.order : [];
      return (
        <ol className="order-result">
          {expected.map((item, place) => (
            <li key={item} className={given[place] === item ? 'is-right' : given.length ? 'is-wrong' : undefined}>
              <span className="order-rank">{place + 1}</span>
              <span className="order-text">{question.choices[item]}</span>
              {given.length > 0 && <Icon name={given[place] === item ? 'check' : 'x'} size={18} strokeWidth={3} />}
            </li>
          ))}
        </ol>
      );
    }
    case 'match': {
      const expected = correction?.correctPairs ?? [];
      const given = mine?.kind === 'match' ? mine.pairs : [];
      return (
        <ul className="match-result">
          {question.choices.map((left, i) => {
            const right = given.length > 0 && given[i] === expected[i];
            return (
              <li key={i} className={given.length ? (right ? 'is-right' : 'is-wrong') : undefined}>
                <span>{left}</span>
                <Icon name="link" size={16} />
                <b>{question.options?.[expected[i]]}</b>
                {given.length > 0 && !right && <span className="muted-inverse small">(vous : {question.options?.[given[i]]})</span>}
              </li>
            );
          })}
        </ul>
      );
    }
    default:
      return null;
  }
}
