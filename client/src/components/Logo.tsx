import { Link } from 'react-router';

interface LogoMarkProps {
  size?: number;
}

/** Symbole WhatQuiz : une bulle de dialogue qui pose la question. */
export function LogoMark({ size = 36 }: LogoMarkProps) {
  return (
    <svg className="logo-mark" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="wq-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7b5cff" />
          <stop offset="1" stopColor="#4527d9" />
        </linearGradient>
      </defs>
      <path d="M10 4h28a8 8 0 0 1 8 8v20a8 8 0 0 1-8 8H22l-9 7v-7h-3a8 8 0 0 1-8-8V12a8 8 0 0 1 8-8z" fill="url(#wq-grad)" />
      <path
        d="M18.5 17.5a5.5 5.5 0 1 1 7.7 5.04c-1.35.6-2.2 1.6-2.2 3.06V27"
        fill="none"
        stroke="#fff"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <circle cx="24" cy="33" r="2.6" fill="#ff6b57" />
    </svg>
  );
}

interface LogoProps {
  to?: string;
  inverse?: boolean;
  size?: number;
}

export function Logo({ to = '/', inverse = false, size = 36 }: LogoProps) {
  return (
    <Link to={to} className={`logo${inverse ? ' logo-inverse' : ''}`} aria-label="WhatQuiz — accueil">
      <LogoMark size={size} />
      <span className="logo-word" style={{ fontSize: size * 0.62 }}>
        What<b>Quiz</b>
      </span>
    </Link>
  );
}
