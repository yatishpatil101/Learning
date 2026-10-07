/* Colour values live in src/styles/theme.css; this file only names them. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
const ACCENTS = ['teal', 'emerald', 'green', 'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'pink', 'rose', 'red', 'orange', 'amber', 'yellow'];
const ramp = (hue) => Object.fromEntries(SHADES.map((s) => [s, v(`dz-c-${hue}-${s}`)]));

const colors = {
  white: v('dz-c-white'),
  'pure-white': v('dz-c-pure-white'),
  black: v('dz-c-black'),
  ink: v('dz-c-ink'),
  'ink-2': v('dz-c-ink-2'),
  'ink-card': v('dz-c-ink-card'),
  page: v('dz-c-page'),
  ...Object.fromEntries(['gray', 'slate', ...ACCENTS].map((hue) => [hue, ramp(hue)])),
  brand: {
    teal: v('dz-c-teal-500'),
    indigo: v('dz-c-indigo-600'),
    'teal-1': v('dz-c-teal-600'),
    'teal-2': v('dz-c-teal-500'),
    'teal-3': v('dz-c-teal-400'),
    'indigo-4': v('dz-c-indigo-600'),
    'coral-2': v('dz-c-orange-400'),
    'coral-3': v('dz-c-orange-300'),
  },
  cta: { btn: v('cta-btn'), 'btn-text': v('cta-btn-text') },
};

/* Mid-tone text darkens in light mode for contrast; the same shade as a fill does not. */
const textColors = {
  ...Object.fromEntries(ACCENTS.map((hue) => [hue, { 500: v(`dz-t-${hue}-500`) }])),
  brand: { teal: v('dz-t-teal-500'), 'teal-2': v('dz-t-teal-500') },
};

/* `border-white/10` is a hairline in either theme: theme.css raises --dz-line-boost in light mode. */
const line = { white: 'rgb(var(--dz-c-white) / calc(<alpha-value> * var(--dz-line-boost)))' };

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  /* Without hover-only media a touch browser keeps the hover state after tap, so a tapped card stays lifted. */
  future: { hoverOnlyWhenSupported: true },
  theme: {
    extend: {
      colors,
      textColor: textColors,
      borderColor: line,
      divideColor: line,
      ringColor: line,
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        heroGradient: {
          '0%': { backgroundPosition: '0% 50%' },
          '25%': { backgroundPosition: '50% 100%' },
          '50%': { backgroundPosition: '100% 50%' },
          '75%': { backgroundPosition: '50% 0%' },
          '100%': { backgroundPosition: '0% 50%' },
        },
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(20px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
      },
      animation: {
        heroGradient: 'heroGradient 18s ease infinite',
        fadeUp: 'fadeUp 0.5s ease forwards',
        slideIn: 'slideIn 0.3s ease-out',
      },
    },
  },
};
