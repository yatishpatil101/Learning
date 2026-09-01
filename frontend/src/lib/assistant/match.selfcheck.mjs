/* Self-check for the assistant matcher. Guards the routing logic so a broken
   tokenizer/scorer fails loudly.

   Run with:  node src/lib/assistant/match.selfcheck.mjs

   Lives outside match.js so these assertions never ship in the browser bundle —
   the old `if (typeof process !== 'undefined') demo()` guard was a runtime check,
   which meant Rollup could not prove the branch dead and kept every assertion. */
import { tokenize, rankAnswers } from './match.js';

const assert = (cond, msg) => {
  if (!cond) throw new Error('assistant/match self-check failed: ' + msg);
};

assert(tokenize('How do I contact the owner?').join(',') === 'contact,owner', 'tokenize/stopwords');

const r1 = rankAnswers('how do I contact an owner');
assert(r1[0]?.entry.id === 'contact-gate', 'contact query → contact-gate, got ' + r1[0]?.entry.id);

const r2 = rankAnswers('list my property for rent');
assert(r2[0]?.entry.id === 'list-property', 'list query → list-property, got ' + r2[0]?.entry.id);

const r3 = rankAnswers('emi loan calculator');
assert(r3[0]?.entry.id === 'emi', 'emi query → emi, got ' + r3[0]?.entry.id);

assert(rankAnswers('xyzzy qwerty').length === 0, 'gibberish → no matches');
assert(rankAnswers('   ').length === 0, 'blank → no matches');

const faqR = rankAnswers('zero brokerage', { faqs: [{ id: 'F1', question: 'Is PuneNest zero brokerage?', answer: 'Yes.' }] });
assert(faqR.length > 0, 'faq entries are searchable');

// A curated entry must win over an imported FAQ that duplicates its question,
// so trust questions keep Nestor's crafted answer + deep-link (not a bare FAQ).
const dupFaq = [{ id: 'F2', question: 'How are owners and listings verified?', answer: 'We check them.' }];
const vr = rankAnswers('How are owners and listings verified?', { faqs: dupFaq });
assert(vr[0]?.entry.id === 'verification', 'curated verification beats duplicate FAQ, got ' + vr[0]?.entry.id);

console.log('assistant/match: all self-checks passed');
