/* FAQs are public, but feedback still goes through `post` for the shared API envelope. */
import { get, post } from '../../http.js';

/** `String(... || '')` rather than a trusting spread because these strings are rendered directly into the help page
 * and fed to the assistant's tokenizer. */
const toFaq = (row) => ({
  id: String(row?.id || ''),
  question: String(row?.question || ''),
  answer: String(row?.answer || ''),
  category: String(row?.category || ''),
});

/** Every published FAQ. Public — no token, no session short-circuit. */
export async function listFaqs() {
  const rows = await get('/faqs');
  return (Array.isArray(rows) ? rows : []).map(toFaq);
}

export async function submitHelpFeedback({ slug, helpful, comment }) {
  await post('/help/feedback', {
    slug,
    lang: 'en',
    helpful,
    ...(comment ? { comment } : {}),
  });
}
