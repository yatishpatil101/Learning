/* Tiny keyword matcher for the Nestor assistant. No backend, no deps: ranks the
   curated KB (data/assistant.js) against a user query by token overlap. This is a
   deliberate BM25-lite — good enough to route "how do I..." questions to the right
   answer + deep link. Swap this for a real NLU/LLM call later without touching the
   widget: keep the { entry, score, confidence } return shape.

   ponytail: naive linear scan over ~20 entries per keystroke-submit — fine at this
   scale; index it only if the KB grows into the hundreds. */

import { KB } from '../../data/assistant.js';

const STOP = new Set([
  'the', 'a', 'an', 'how', 'do', 'does', 'did', 'i', 'to', 'is', 'are', 'of', 'my',
  'me', 'can', 'could', 'you', 'and', 'for', 'on', 'in', 'with', 'what', 'it', 'get',
  'be', 'this', 'that', 'we', 'us', 'at', 'or', 'if', 'so', 'as', 'about', 'from',
  'your', 'want', 'need', 'please', 'help', 'there', 'any',
]);

export function tokenize(str) {
  const m = String(str || '').toLowerCase().match(/[a-z0-9]+/g);
  if (!m) return [];
  return m.filter((t) => t.length > 1 && !STOP.has(t));
}

/* FAQs (loaded from the content service) become low-priority pseudo-entries so
   the assistant can answer them too, always with a support escalation attached.

   This function is the boundary between two vocabularies, and that is why the
   rename stops here. The published FAQ is `{ question, answer }` because that is
   what the server calls it; a knowledge-base entry is `{ q, a }` because it also
   carries keywords, actions and a route, and is a different thing that happens to
   contain a question. Adapting at the edge keeps the KB entries and the scorer
   untouched by where the answers came from. */
function faqEntries(faqs) {
  return (faqs || []).map((f) => ({
    id: 'faq-' + f.id,
    keywords: tokenize(f.question + ' ' + f.answer),
    q: f.question,
    a: f.answer,
    actions: [{ label: 'More help', to: '/support', icon: 'ticket-plus' }],
    isFaq: true,
  }));
}

function scoreEntry(qTokens, entry) {
  const kw = new Set(entry.keywords);
  const qWords = new Set(tokenize(entry.q));
  let score = 0;
  for (const t of qTokens) {
    if (kw.has(t)) score += 2;          // curated keyword hit — strong signal
    else if (qWords.has(t)) score += 1; // appears in the question text
  }
  // Slightly favour hand-written KB over auto FAQ entries on ties.
  if (!entry.isFaq && score > 0) score += 0.25;
  return score;
}

/**
 * Rank KB + FAQ entries against a query.
 * @returns {Array<{entry, score, confidence}>} best-first, score > 0 only.
 */
export function rankAnswers(query, { faqs = [], limit = 3 } = {}) {
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];
  const max = qTokens.length * 2;
  const rank = (pool) =>
    pool
      .map((entry) => {
        const score = scoreEntry(qTokens, entry);
        return { entry, score, confidence: max ? score / max : 0 };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);

  const curated = rank(KB);
  const faq = rank(faqEntries(faqs));

  // FAQs are a fallback layer, not a peer of the hand-written KB. An imported
  // FAQ can duplicate a canonical question (e.g. "How are owners verified?") and
  // out-score the curated entry on raw token overlap — but the curated answer
  // carries Nestor's voice and its deep-link actions, so it must win whenever
  // it's a confident match. Only when the curated match is weak do FAQs merge in
  // to help fill the gap.
  const ordered =
    curated.length && curated[0].confidence >= LOW_CONFIDENCE
      ? [...curated, ...faq]
      : [...curated, ...faq].sort((a, b) => b.score - a.score);

  return ordered.slice(0, limit);
}

/* Confidence below this → offer human-support escalation alongside best guesses. */
export const LOW_CONFIDENCE = 0.5;

export function kbById(id) {
  return KB.find((e) => e.id === id);
}

