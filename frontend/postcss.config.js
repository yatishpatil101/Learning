import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import minFontSize from './src/styles/min-font-size.js';

/* Array form rather than the object shorthand, because the last entry is a local
   plugin and the shorthand can only name packages.

   Order is load-bearing: the 12px legibility floor has to run *after* Tailwind
   has expanded `text-[11px]` into a real `font-size` declaration, or there is
   nothing for it to floor. See src/styles/min-font-size.js. */
export default {
  plugins: [
    tailwindcss(),
    autoprefixer(),
    minFontSize(),
  ],
};
