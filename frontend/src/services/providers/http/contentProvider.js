/* FAQs are public, but feedback still goes through `post` for the shared API envelope. */
import { get, post, unwrapPage } from '../../http.js';

/** `String(... || '')` rather than a trusting spread because these strings are rendered directly into the help page
 * and fed to the assistant's tokenizer. */
const toFaq = (row) => ({
  id: String(row?.id || ''),
  question: String(row?.question || ''),
  answer: String(row?.answer || ''),
  category: String(row?.category || ''),
  translations: row?.translations && typeof row.translations === 'object' ? row.translations : {},
});

/** Every published FAQ. Public — no token, no session short-circuit. */
export async function listFaqs() {
  const rows = await get('/faqs');
  return (Array.isArray(rows) ? rows : []).map(toFaq);
}

const VOTER_KEY = 'dz_help_voter_v1';

function voterId() {
  try {
    let id = localStorage.getItem(VOTER_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(VOTER_KEY, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export async function submitHelpFeedback({ slug, helpful, comment }) {
  await post('/help/feedback', {
    slug,
    lang: 'en',
    helpful,
    voter: voterId(),
    ...(comment ? { comment } : {}),
  });
}

export async function listHelpFeedbackArticles({ page = 0, size = 20 } = {}) {
  return unwrapPage(await get('/admin/help-feedback', { page, size }), { page, size });
}

export async function listHelpFeedbackComments({ slug, page = 0, size = 20 } = {}) {
  const query = { page, size };
  if (slug) query.slug = slug;
  return unwrapPage(await get('/admin/help-feedback/comments', query), { page, size });
}
