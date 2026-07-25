import { useEffect, useState } from 'react';

/* Hero noun that rotates through the full spread of inventory (residential +
   commercial + land) so a "Find Your ___ in {city}" headline speaks to every seeker,
   not just home-buyers. Shared by the home hero and the auth marketing panel so the
   two stay in lock-step.

   The visible cycling spans are decorative and hidden from assistive tech; a single
   sr-only label carries the full accessible name ("Home, Office, Shop or Plot") so
   screen-reader users hear the marketplace's breadth without a 2.4s live-region
   interruption. Honors prefers-reduced-motion by holding on the first word. */
const HERO_NOUNS = ['Home', 'Office', 'Shop', 'Plot'];

const DEFAULT_WORD_CLASS =
  'bg-gradient-to-r from-[#2dd4bf] to-[#14b8a6] bg-clip-text text-transparent';

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
