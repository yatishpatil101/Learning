/* Every colour the app paints lives in src/styles/theme.css, so light mode can swap it. A literal
   anywhere else is a colour the theme cannot reach. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/* Paths relative to src/, with the reason the literal cannot come from the theme. */
const ALLOWED = {
  'styles/theme.css': 'the palette itself',
  'components/ui/PoweredByGoogle.jsx': "Google's attribution mark must keep Google's brand colours",
  'lib/localPrefs.js': 'meta theme-color must match the pre-paint script in index.html',
  'lib/uploads/image.worker.js': 'JPEG matte for transparent uploads, not UI',
  'pages/consumer/list-property/confetti.js': 'canvas-confetti only parses hex',
};

const LITERAL = /(?<![a-zA-Z0-9&-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])|(?<![a-zA-Z-])(?:rgba?|hsla?)\(\s*\d|%23[0-9a-fA-F]{3,8}\b/g;
const DECLARATION = /(?:^|[;{])\s*[\w-]+\s*:([^;{}]*)(?=[;}])/g;
const NAMED = /(?<![\w-])(?:white|black|red|green|blue|gray|grey|silver|orange|yellow|purple|pink|navy|teal|maroon|olive|lime|aqua|fuchsia)(?![\w-])/g;
const blankComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(css|jsx?)$/.test(name) ? [path] : [];
  });

const hits = [];
for (const file of walk(SRC)) {
  const rel = relative(SRC, file).replaceAll('\\', '/');
  if (ALLOWED[rel]) continue;
  const text = readFileSync(file, 'utf8');
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(LITERAL)) hits.push(`src/${rel}:${i + 1}  ${m[0]}`);
  });
  if (!rel.endsWith('.css')) continue;
  const css = blankComments(text);
  for (const decl of css.matchAll(DECLARATION)) {
    for (const m of decl[1].matchAll(NAMED)) {
      hits.push(`src/${rel}:${lineAt(css, decl.index + decl[0].length - decl[1].length + m.index)}  ${m[0]}`);
    }
  }
}

if (hits.length) {
  console.error(
    `check-colours: ${hits.length} colour literal(s) outside src/styles/theme.css.\n\n` +
      'Use a theme variable instead: rgb(var(--dz-c-teal-500) / .2) in CSS and style props, a palette ' +
      'class (text-teal-400) in className, or cssColour() from src/lib/themeColour.js for canvas, ' +
      'charts and maps. A new colour belongs in theme.css, with its light-mode value.\n',
  );
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log('check-colours: no colour literals outside theme.css');
