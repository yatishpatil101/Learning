import Icon from '../../../components/Icon.jsx';
import { useTranslation } from 'react-i18next';

const CHANNELS = [
  { key: 'ccCall', icon: 'phone', value: '+91 98765 43210', href: 'tel:+919876543210' },
  { key: 'ccWhatsApp', icon: 'message-circle', value: 'wa.me/919876543210', href: 'https://wa.me/919876543210', ext: true },
  { key: 'ccEmail', icon: 'mail', value: 'hello@draazy.com', href: 'mailto:hello@draazy.com' },
];

export default function ContactCard() {
  const { t } = useTranslation();
  return (
    <div className="glass-card rounded-2xl p-6 reveal">
      <h2 className="text-lg font-bold text-white mb-1 flex items-center gap-2">
        <Icon name="headset" className="w-5 h-5 text-teal-400" /> {t('misc.ccTitle')}
      </h2>
      <p className="text-gray-500 text-xs mb-4">{t('misc.ccSubtitle')}</p>

      <div className="space-y-2">
        {CHANNELS.map((c) => (
          <a
            key={c.key}
            href={c.href}
            {...(c.ext ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:border-teal-400/40 hover:bg-white/7 transition-all group"
          >
            <span className="w-10 h-10 rounded-xl bg-teal-500/10 flex items-center justify-center flex-shrink-0">
              <Icon name={c.icon} className="w-5 h-5 text-teal-400" />
            </span>
            <span className="min-w-0">
              <span className="block text-white text-sm font-semibold">{t('misc.' + c.key)}</span>
              <span className="block text-gray-500 text-xs truncate">{c.value}</span>
            </span>
            <Icon name="arrow-right" className="w-4 h-4 text-gray-600 ml-auto group-hover:text-teal-400 transition-colors" />
          </a>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-white/10">
        <Icon name="clock" className="w-3.5 h-3.5 text-gray-500" />
        <span className="text-xs text-gray-500">{t('misc.ccHours')}</span>
      </div>
    </div>
  );
}
