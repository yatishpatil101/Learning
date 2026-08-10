import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';
import { isReachabilityFailure } from '../hooks/useConnectivity.js';

/**
 * A read that failed, said out loud, with the one affordance that can fix it (D166).
 *
 * This exists because "you have no saved searches" and "we could not load your saved searches" are
 * different sentences and only one of them is true. A `.catch(() => [])` renders the first when it
 * means the second, and the user acts on it: they re-post a listing they already have, or conclude
 * the platform lost their documents. So every async read that can come back empty gets this instead
 * of an empty state \u2014 originally only the document vault had it (D128), which is what D166 is.
 *
 * `message` is what to say when the *server answered and said no*. When the request never reached
 * the server the cause is the connection, not the feature, so say that instead: telling someone on
 * patchy 4G that "we couldn't load your dashboard" points them at the wrong problem. The
 * classification is `isReachabilityFailure`, the same rule the app-wide banner uses, so the strip
 * at the top of the screen and this card can never contradict each other.
 *
 * `dash.retry` is reused rather than duplicated: every locale file merges into one flat namespace
 * (see `i18n/index.js`), so the key's namespace of origin is not a coupling \u2014 one retry label for
 * the whole app is.
 *
 * @param {string}  message   copy for a server-answered failure
 * @param {unknown} error     the rejection value, used only to pick between the two sentences
 * @param {Function} onRetry  re-runs the read \u2014 typically `useAsyncList`'s `retry`
 * @param {string} [className] wrapper override, for surfaces whose shell is not a glass card
 */
export default function LoadError({ message, error, onRetry, className = 'glass-card rounded-2xl p-5' }) {
  const { t } = useTranslation();
  return (
    <div className={`${className} flex flex-col items-center text-center gap-3`}>
      <Icon name="alert-triangle" className="w-8 h-8 text-amber-400" />
      <p className="text-gray-300 text-sm">{isReachabilityFailure(error) ? t('connectivity.listUnreachable') : message}</p>
      <button onClick={onRetry} className="pn-control pn-control--action px-4 gap-1.5">
        <Icon name="refresh-cw" className="w-4 h-4" /> {t('dash.retry')}
      </button>
    </div>
  );
}
