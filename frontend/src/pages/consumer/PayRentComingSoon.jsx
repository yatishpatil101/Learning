import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useToast } from '../../context/ToastContext.jsx';

/* The whole of /pay-rent. Online rent payment and deposit financing are not built: there is no
   backend, no fee, no payout account and no flag that reveals a real flow — the rail was withdrawn
   rather than hidden. Instead of bouncing tenants to home, this gives the feature an honest,
   on-brand "coming soon" home that explains what's coming and points to what already works (browse
   rentals, rent agreement, the rental hub).

   Deliberately static: it calls nothing. A tenant who wants their rent reflected on the dashboard
   today enters it themselves in the Finances tab, which is a record of what they pay elsewhere and
   never claims the platform collected it. */

const STEPS = [
  { icon: 'wallet', key: 'prCsStep1' },
  { icon: 'badge-indian-rupee', key: 'prCsStep2' },
  { icon: 'receipt-indian-rupee', key: 'prCsStep3' },
];

const FEATURES = [
  { icon: 'wallet', tKey: 'prCsF1' },
  { icon: 'receipt-indian-rupee', tKey: 'prCsF2' },
  { icon: 'hand-coins', tKey: 'prCsF3' },
  { icon: 'repeat', tKey: 'prCsF4' },
];

export default function PayRentComingSoon() {
  const { t: tr } = useTranslation();
  const { toast } = useToast();

  return (
    <div className="pt-8 sm:pt-10 pb-20 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Hero */}
      <section className="glass rounded-2xl p-6 sm:p-8 mb-6 overflow-hidden relative">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-16 -top-16 w-52 h-52 rounded-full blur-3xl"
          style={{ background: 'rgba(20,184,166,.16)' }}
        />
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-400/15 border border-amber-400/25 text-amber-300 text-xs font-semibold">
          <Icon name="calendar-clock" className="w-3.5 h-3.5" /> {tr('misc.prCsBadge')}
        </span>
        <h1 className="text-2xl sm:text-3xl font-extrabold mt-3 text-white">{tr('misc.prCsTitle')}</h1>
        <p className="text-gray-400 text-sm mt-2 max-w-2xl">{tr('misc.prCsSubtitle')}</p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {/* No request, by design — so this cannot be a "notify me" button. Nothing would be
              recorded and nobody would ever be told. It says what is coming instead. */}
          <button
            type="button"
            onClick={() => toast(tr('misc.prCsNotified'), 'success')}
            className="btn-teal px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
          >
            <Icon name="calendar-clock" className="w-4 h-4" /> {tr('misc.prCsNotify')}
          </button>
          <Link
            to="/services/rent-agreement"
            className="px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2 bg-white/5 hover:bg-white/10 text-gray-200 border border-white/10"
          >
            <Icon name="file-signature" className="w-4 h-4 text-brand-teal-3" /> {tr('misc.prCsAgreement')}
          </Link>
        </div>
      </section>

      {/* Signature: how it'll work — a quiet three-step rent journey */}
      <section className="glass rounded-2xl p-6 mb-6">
        <h2 className="font-bold text-white mb-5">{tr('misc.prCsHowTitle')}</h2>
        <ol className="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-2">
          {STEPS.map((s, i) => (
            <li key={s.key} className="flex-1 flex sm:flex-col items-start sm:items-center text-left sm:text-center gap-3 sm:gap-3">
              <div className="flex sm:flex-col items-center gap-3 sm:gap-0 shrink-0">
                <span className="w-11 h-11 rounded-xl bg-brand-teal/10 border border-brand-teal-2/25 flex items-center justify-center">
                  <Icon name={s.icon} className="w-5 h-5 text-brand-teal-3" />
                </span>
              </div>
              <div className="sm:mt-3">
                <p className="text-[11px] font-bold tracking-wide text-brand-teal-3">{tr('misc.prCsStepLabel', { n: i + 1 })}</p>
                <p className="text-sm text-gray-300 mt-0.5 max-w-[16rem]">{tr('misc.' + s.key)}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* What's coming */}
      <section className="mb-6">
        <h2 className="font-bold text-white mb-3">{tr('misc.prCsWhatsComing')}</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {FEATURES.map((f) => (
            <div key={f.tKey} className="glass rounded-2xl p-5 flex gap-3.5">
              <span className="w-10 h-10 rounded-xl bg-brand-teal/10 flex items-center justify-center shrink-0">
                <Icon name={f.icon} className="w-5 h-5 text-brand-teal-3" />
              </span>
              <div>
                <p className="text-white text-sm font-semibold">{tr('misc.' + f.tKey + 'Title')}</p>
                <p className="text-gray-400 text-[13px] mt-0.5">{tr('misc.' + f.tKey + 'Desc')}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Meanwhile — what already works */}
      <section className="glass rounded-2xl p-6">
        <h2 className="font-bold text-white mb-1">{tr('misc.prCsMeanwhile')}</h2>
        <p className="text-gray-400 text-sm mb-4">{tr('misc.prCsMeanwhileBody')}</p>
        <div className="flex flex-wrap gap-3">
          <Link to="/listings?deal=rent" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal-3 hover:text-brand-teal-2">
            <Icon name="search" className="w-4 h-4" /> {tr('misc.prCsBrowse')}
          </Link>
          <span className="text-white/10">·</span>
          <Link to="/dashboard#my-rental" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal-3 hover:text-brand-teal-2">
            <Icon name="key-round" className="w-4 h-4" /> {tr('misc.prCsMyRental')}
          </Link>
        </div>
      </section>
    </div>
  );
}
