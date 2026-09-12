import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { getFeedback, saveFeedback } from '../../lib/help.js';

/* "Was this helpful?" — the only signal that tells us which articles are failing.
 *
 * A bare thumbs-down is close to useless on its own, so a negative answer opens a
 * short free-text field and routes the reader to support rather than leaving them
 * on a page that did not answer their question. */

export default function ArticleFeedback({ slug, title }) {
  const { t } = useTranslation();
  const [choice, setChoice] = useState(null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(false);

  // Reset between articles — this component stays mounted across route changes.
  useEffect(() => {
    const existing = getFeedback(slug);
    setChoice(existing ? existing.helpful : null);
    setSent(!!existing);
    setComment('');
  }, [slug]);

  const pick = (helpful) => {
    setChoice(helpful);
    if (helpful) {
      saveFeedback(slug, true);
      setSent(true);
    } else {
      setSent(false);
    }
  };

  const submitComment = (e) => {
    e.preventDefault();
    saveFeedback(slug, false, comment.trim());
    setSent(true);
  };

  return (
    <section aria-labelledby="article-feedback" className="mt-12 rounded-xl border border-white/10 bg-white/[0.03] p-5">
      {sent ? (
        <div className="flex items-start gap-3">
          <Icon name="check-circle" className="mt-0.5 w-5 h-5 shrink-0 text-teal-400" />
          <div>
            <p className="text-sm font-semibold text-white">{t('help.thanksTitle')}</p>
            <p className="mt-1 text-xs text-gray-500">
              {choice ? t('help.thanksPositive') : t('help.thanksNegative')}
              {' '}{t('help.stillStuck')}{' '}
              <Link to={`/support?cat=other&ref=${encodeURIComponent(slug)}`} className="text-teal-400 hover:underline">
                {t('help.raiseTicket')}
              </Link>.
            </p>
          </div>
        </div>
      ) : choice === false ? (
        <form onSubmit={submitComment}>
          <label htmlFor="feedback-comment" id="article-feedback" className="block text-sm font-semibold text-white">
            {t('help.whatWasMissing')}
          </label>
          <p className="mt-1 text-xs text-gray-500">{t('help.whatWasMissingHint')}</p>
          <textarea
            id="feedback-comment"
            rows={3}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('help.feedbackPlaceholder')}
            className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-teal-400/50 focus:outline-none"
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded-lg bg-teal-500 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-teal-400"
            >
              {t('help.sendFeedback')}
            </button>
            <button
              type="button"
              onClick={() => setChoice(null)}
              className="rounded-lg px-3 py-2 text-xs font-medium text-gray-500 hover:text-gray-300"
            >
              {t('help.cancel')}
            </button>
            <Link
              to={`/support?cat=other&ref=${encodeURIComponent(slug)}`}
              className="ml-auto text-xs font-medium text-teal-400 hover:underline"
            >
              {t('help.contactSupportInstead')}
            </Link>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <p id="article-feedback" className="text-sm font-semibold text-white">
            {t('help.helpfulQuestion', { title })}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => pick(true)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-teal-400/40 hover:text-teal-300"
            >
              <Icon name="thumbs-up" className="w-4 h-4" /> {t('help.yes')}
            </button>
            <button
              type="button"
              onClick={() => pick(false)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-gray-300 transition-colors hover:border-white/25 hover:text-white"
            >
              <Icon name="thumbs-down" className="w-4 h-4" /> {t('help.no')}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
