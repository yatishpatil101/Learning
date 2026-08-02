import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { pmfEnabled, track, captureLead } from '../../lib/pmf.js';

// Gate-free fake-door capture for the PMF test. Unlike the owner-contact flow
// (which stays behind sign-in + Aadhaar), this asks only for an email or
// WhatsApp number so we get an honest top-of-funnel demand signal. Renders only
// when VITE_PMF_MODE=on.
export default function NotifyMe() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!pmfEnabled) return null;

  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!email.trim() && !whatsapp.trim()) return;
    setBusy(true);
    track('notify_submit', { has_email: !!email.trim(), has_whatsapp: !!whatsapp.trim() });
    await captureLead({ context: 'notify_me', email: email.trim(), whatsapp: whatsapp.trim() });
    setBusy(false);
    setDone(true);
  };

  return (
    <section className="section-pb">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 sm:p-10 text-center">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-brand-teal-1/15 text-sm font-medium text-brand-teal-3 mb-4">
            <Icon name="bell" className="w-4 h-4" /> {t('pmf.earlyAccess')}
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
            {t('pmf.beFirst')}
          </h2>
          <p className="text-gray-400 text-sm sm:text-base mb-6">
            {t('pmf.notifySub')}
          </p>

          {done ? (
            <div className="inline-flex items-center gap-2 text-emerald-300 font-medium">
              <Icon name="badge-check" className="w-5 h-5" /> {t('pmf.onTheList')}
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col sm:flex-row items-stretch gap-3 max-w-xl mx-auto">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="flex-1 px-4 py-3 rounded-xl text-white text-sm border border-white/10 bg-white/[0.03] focus:border-brand-teal-2 outline-none"
              />
              <input
                type="tel"
                value={whatsapp}
                onChange={(e) => setWhatsapp(e.target.value)}
                placeholder={t('pmf.whatsappNumber')}
                className="flex-1 px-4 py-3 rounded-xl text-white text-sm border border-white/10 bg-white/[0.03] focus:border-brand-teal-2 outline-none"
              />
              <button
                type="submit"
                disabled={busy}
                className="btn-teal inline-flex items-center justify-center gap-2 py-3 px-6 disabled:opacity-60"
              >
                <Icon name="send" className="w-4 h-4" /> {t('pmf.notifyMe')}
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
