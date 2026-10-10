/** Only FAQs can be reordered today; other content types keep server order. */
import { createProvider } from './config.js';

const provider = createProvider('content');

/* FAQs are public: no token and no session short-circuit; archived entries stay server-side. */
export const listFaqs = async () => (await provider()).listFaqs();

export const submitHelpFeedback = async (verdict) => (await provider()).submitHelpFeedback(verdict);

export const listHelpFeedbackArticles = async (opts) => (await provider()).listHelpFeedbackArticles(opts);

export const listHelpFeedbackComments = async (opts) => (await provider()).listHelpFeedbackComments(opts);
