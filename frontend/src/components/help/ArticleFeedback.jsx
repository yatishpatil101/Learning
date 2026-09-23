import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { getFeedback, saveFeedback } from '../../lib/help.js';
import { submitHelpFeedback } from '../../services/contentService.js';

/* localStorage is the widget's own memory (a returning reader sees "thanks"); the POST is the
   measurement. The caller keys this on the slug, so deriving state in an effect would flash stale. */
export default function ArticleFeedback({ slug, title, lang }) {
  const { t } = useTranslation();
  const remembered = () => getFeedback(slug);
  const [choice, setChoice] = useState(() => remembered()?.helpful ?? null);
  const [comment, setComment] = useState('');
  const [sent, setSent] = useState(() => !!remembered());

  // Fire-and-forget on purpose: the reader has answered and been thanked, and there is nothing
  // they could do about an upload failure. Loud in dev only.
  const report = (helpful, reason) => {
    submitHelpFeedback({ slug, lang, helpful, comment: reason }).catch((err) => {
      if (import.meta.env.DEV) console.warn('[help] feedback upload failed', err);
    });
  };

  // Double-click is guarded only by `setSent(true)` running in the same tick as the handler, so
  // React removes the button before the second click lands. Moving it after an await reopens it.
  const pick = (helpful) => {
    setChoice(helpful);
    if (helpful) {
      saveFeedback(slug, true);
      report(true);
      setSent(true);
    } else {
      // Reported before the reason is typed: a negative that only counts when explained biases the
      // measure. No local record here, so abandoning still leaves the box reachable next time.
      report(false);
      setSent(false);
    }
  };

  const submitComment = (e) => {
    e.preventDefault();
    const reason = comment.trim();
    saveFeedback(slug, false, reason);
    report(false, reason);
    setSent(true);
  };

  return (
    <section aria-labelledby="article-feedback" className="mt-12 rounded-xl border border-white/10 bg-white/[0.03] p-5">
      {sent ? (
        <div className="flex items-start gap-3">
          <Icon name="check-circle" className="mt-0.5 w-5 h-5 shrink-0 text-teal-400" />
          <div>
            <p id="article-feedback" className="text-sm font-semibold text-white">{t('help.thanksTitle')}</p>
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
          <p id="feedback-hint" className="mt-1 text-xs text-gray-500">{t('help.whatWasMissingHint')}</p>
          <textarea
            id="feedback-comment"
            rows={3}
            maxLength={500}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('help.feedbackPlaceholder')}
            aria-describedby="feedback-hint feedback-privacy"
            className="mt-3 w-full resize-y rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-gray-600 focus:border-teal-400/50 focus:outline-none"
          />
          {/* Said before the prose is typed: a box asking "what was missing?" on a support-adjacent
              surface collects phone numbers, and the notice reduces how much of that we store. */}
          <p id="feedback-privacy" className="mt-2 text-xs text-gray-400">{t('help.feedbackPrivacy')}</p>
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
