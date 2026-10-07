import { useEffect, useState } from 'react';

/* Cycling spans are aria-hidden; one sr-only label carries the full name so screen readers get no live-region
   churn. Holds on the first word under prefers-reduced-motion. */
const HERO_NOUNS = ['Home', 'Office', 'Shop', 'Plot'];

const DEFAULT_WORD_CLASS =
  'bg-gradient-to-r from-teal-400 to-teal-500 bg-clip-text text-transparent';

// "Home, Office, Shop or Plot" — the visible spread read as a single phrase.
const srPhrase = (words) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}` : words[0];

export default function RotatingNoun({ words = HERO_NOUNS, wordClassName = DEFAULT_WORD_CLASS }) {
  const [i, setI] = useState(0);
  const len = words.length;
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const id = setInterval(() => setI((n) => (n + 1) % len), 2400);
    return () => clearInterval(id);
  }, [len]);
  return (
    <span className="relative inline-grid place-items-center">
      <span className="sr-only">{srPhrase(words)}</span>
      {words.map((w, idx) => (
        <span
          key={w}
          aria-hidden="true"
          className={
            'col-start-1 row-start-1 transition-all duration-500 ease-out ' +
            wordClassName + ' ' +
            (idx === i ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-1.5')
          }
        >
          {w}
        </span>
      ))}
    </span>
  );
}
