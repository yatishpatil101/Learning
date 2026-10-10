const MOBILE = /(?<![0-9])(?:0|91)?[6-9][0-9]{9}(?![0-9])/;
const TLD = String.raw`(?:com|in|net|org|co|info|biz|me|io)(?!\p{L})`;
const PROVIDER = String.raw`(?:gmail|yahoo|outlook|hotmail|rediffmail|ymail|icloud)(?!\p{L})`;
const DOT_WORD = String.raw`\s?\(?dot\)?\s?` + TLD;
const KNOWN_DOMAIN = String.raw`(?:${PROVIDER}|[\p{L}0-9-]+(?:\.${TLD}|${DOT_WORD}))`;
const EMAIL = new RegExp(
  String.raw`(?<![\p{L}0-9._%+-])[\p{L}0-9._%+-]+(?:@[\p{L}0-9.-]+(?:\.\p{L}{2,}|${DOT_WORD})|@${PROVIDER}|\s?(?:\s@|@\s|\(at\)|\[at\]| at(?:[\s-]the[\s-]rate)? )\s?${KNOWN_DOMAIN})`,
  'iu',
);
const LINK = /(?<![\p{L}0-9])(?:(?:wa|t|m)\s?\.\s?me\s?\/|(?:whatsapp|instagram|facebook|telegram|snapchat)\s?\.\s?(?:com|me)|fb\s?\.\s?(?:me|com))/iu;
const HANDLE = /(?<!\p{L})(?:insta(?:gram)?|ig|telegram|snap(?:chat)?|facebook|fb|twitter)\s?(?:id|handle)?\s?[:-]?\s?@[\p{L}0-9._]{2,}/iu;
const INVISIBLE = /\p{Cf}/gu;
const SEPARATORS = /[\p{Z}\p{Dash_Punctuation}\p{M}\s.()+_*:|']/gu;
const RANGE_JOIN = /(?<=[0-9]000)[\p{Z}\s]*[\p{Dash_Punctuation}|,/](?=[\p{Z}\s]*[0-9])/gu;
const GROUPED = /(?<![0-9,])[0-9]{1,3}(?:(?:,[0-9]{2})*,[0-9]{3}|(?:,[0-9]{3})+)(?![0-9])(?!,[0-9])/g;
const TIGHT_JOIN = /(?<=[0-9])[,/](?=[0-9])/g;
const ZERO_RUN = /(?<!\p{L})[0-9oO](?:[\p{Z}\p{Dash_Punctuation}\s.()+_*:|']?[0-9oO])+(?!\p{L})/gu;
const FILLER_WORD = /(?<=[0-9])(?<!000)[\p{Z}\s]{0,3}(?:dash|hyphen|dot|space|slash|comma|plus|then|next|okay|ok|ext|x)(?!\p{L})[\p{Z}\s]{0,3}(?=[0-9])/giu;
const BREAK = 'x';

const DIGIT_WORDS = [
  ['zero', 'shunya', 'शून्य'],
  ['one', 'ek', 'एक'],
  ['two', 'do', 'दो', 'दोन'],
  ['three', 'teen', 'तीन'],
  ['four', 'char', 'chaar', 'चार'],
  ['five', 'paanch', 'panch', 'पांच', 'पाँच', 'पाच'],
  ['six', 'chhe', 'chhah', 'छह', 'छः', 'छे', 'सहा'],
  ['seven', 'saat', 'सात'],
  ['eight', 'aath', 'आठ'],
  ['nine', 'nau', 'नौ', 'नऊ'],
];
const DIGIT_BY_WORD = new Map(DIGIT_WORDS.flatMap((words, digit) => words.map((w) => [w, String(digit)])));
const WORD = /[\p{L}\p{M}]+/gu;
const REPEATED = /(double|triple|dabal|डबल|ट्रिपल)[\p{Z}\s\p{Dash_Punctuation}]*([0-9])/giu;

const spelledDigits = (text) => text
  .replace(WORD, (w) => DIGIT_BY_WORD.get(w.toLowerCase()) ?? w)
  .replace(REPEATED, (_, times, digit) => digit.repeat(/^(triple|ट्रिपल)$/i.test(times) ? 3 : 2));
const ZEROES = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6,
  0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0,
  0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50,
  0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10,
];
const ONE_BASED = [0x2776, 0x2780, 0x278a, 0x24f5];

const digitValue = (cp) => {
  for (const zero of ZEROES) {
    if (cp >= zero && cp <= zero + 9) return cp - zero;
  }
  for (const one of ONE_BASED) {
    if (cp >= one && cp <= one + 8) return cp - one + 1;
  }
  return cp === 0x24ff ? 0 : -1;
};

const toAsciiDigits = (text) => Array.from(text).map((ch) => {
  const value = digitValue(ch.codePointAt(0));
  return value >= 0 ? String(value) : ch;
}).join('');

const hasMobile = (text) => {
  const zeroed = text.replace(ZERO_RUN, (run) => (/[0-9]/.test(run) ? run.replace(/[oO]/g, '0') : run));
  return MOBILE.test(zeroed
    .replace(FILLER_WORD, '')
    .replace(RANGE_JOIN, BREAK)
    .replace(GROUPED, (price) => price.replace(/,/g, '') + BREAK)
    .replace(TIGHT_JOIN, '')
    .replace(SEPARATORS, ''));
};

export const hasContactDetails = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const normalized = toAsciiDigits(text.normalize('NFKC').replace(INVISIBLE, ''));
  const collapsed = normalized.replace(/\s+/g, ' ');
  return EMAIL.test(collapsed) || LINK.test(collapsed) || HANDLE.test(collapsed)
    || hasMobile(spelledDigits(normalized));
};
