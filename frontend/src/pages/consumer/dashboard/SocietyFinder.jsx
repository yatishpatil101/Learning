import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { useFollows } from '../../../context/FollowContext.jsx';
import SocietySelect from '../list-property/SocietySelect.jsx';

/** Pick a building from Google Maps (resolved or minted server-side) and follow it to be alerted when a home is listed there. */
export default function SocietyFinder({ onFollow }) {
  const { t } = useTranslation();
  const [round, setRound] = useState(0);
  const follows = useFollows();

  const follow = async (picked) => {
    if (!picked?.slug) return;
    if (!follows.has(picked.slug)) await follows.toggle(picked.slug);
    setRound((n) => n + 1);
    if (onFollow) onFollow(picked.slug);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Bell className="h-4 w-4 text-teal-400" /> {t('dash.societyFinder.title')}
      </div>
      <p className="mt-1 mb-3 text-xs text-gray-500">{t('dash.societyFinder.hint')}</p>
      <SocietySelect
        key={round}
        allowNotOnMaps={false}
        mintOrigin="demand"
        authReason="dashboard"
        onChange={follow}
        placeholder={t('dash.societyFinder.placeholder')}
      />
    </div>
  );
}
