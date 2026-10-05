import { useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { avatarGrad, initials, seekerBudget, moveInLabel, seekerTitle } from '../helpers.js';
import { FLAT_PREF_LBL, ROOM_PREF_LBL } from '../constants.js';
import { Fresh } from '../atoms.jsx';
import { SeekerAskButton, seekerSubtitle } from '../SeekerCard.jsx';
import { DetailLayout, Identity, Sheet, Section, InfoRows, Tags, PriceCard, StickyAsk } from './parts.jsx';
import HeaderActions from './HeaderActions.jsx';

const pref = (labels, v) => (v && v !== 'any' ? labels[v] : null);

export default function SeekerDetail({ r, owned, interested, saved, onSave, onAsk, onReport, ownerPanel, back }) {
  const { t } = useTranslation();
  const cta = !owned && <SeekerAskButton r={r} interested={interested} onInterest={onAsk} />;
  const prefs = [
    [t('flatmates.detailRoomPref'), pref(ROOM_PREF_LBL, r.roomPref)],
    [t('flatmates.detailFlatPref'), pref(FLAT_PREF_LBL, r.flatPref)],
  ];

  const header = (
    <Identity
      avatar={<div className={'w-14 h-14 rounded-full bg-gradient-to-br ' + avatarGrad(r.gender) + ' flex items-center justify-center text-white text-lg font-bold shrink-0'}>{initials(r.name)}</div>}
      title={seekerTitle(r)}
      meta={[r.title && r.name, seekerSubtitle(r)].filter(Boolean).join(' · ')}
      badges={<>
        {r.verified && <span className="badge-seeker inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider"><Icon name="shield-check" className="w-3 h-3" /> {t('flatmates.verifiedSeeker')}</span>}
        <Fresh item={r} />
      </>}
    />
  );

  const aside = (
    <>
      {ownerPanel}
      <PriceCard
        label={t('flatmates.budgetMonth')}
        value={seekerBudget(r)}
        facts={[['calendar', t('flatmates.moveIn'), moveInLabel(r.moveIn)], ['map-pin', t('flatmates.detailAreas'), (r.localities || []).join(', ')]]}
        cta={cta}
      >
        {r.verifiedContactOnly && <p className="mt-3 text-xs text-amber-300 inline-flex items-center gap-1.5"><Icon name="shield" className="w-3.5 h-3.5" /> {t('flatmates.acceptsVerifiedOnly')}</p>}
      </PriceCard>
    </>
  );

  return (
    <DetailLayout
      back={back}
      actions={<HeaderActions saved={saved} onSave={onSave} shareText={'Flatmate: ' + r.name} reportLabel={t('flatmates.ariaReportPost')} onReport={!owned && (() => onReport({ id: r.id, title: 'Flatmate: ' + r.name, ownerName: r.name, ownerMobile: r.mobile, kind: 'share' }))} />}
      header={header}
      aside={aside}
      sticky={cta && <StickyAsk price={seekerBudget(r)} label={t('flatmates.budgetMonth')}>{cta}</StickyAsk>}
    >
      {(prefs.some(([, v]) => v) || r.tags?.length > 0 || r.note) && (
        <Sheet>
          {prefs.some(([, v]) => v) && <Section icon="home" title={t('flatmates.detailDetails')}><InfoRows items={prefs} /></Section>}
          {r.tags?.length > 0 && <Section icon="sparkles" title={t('flatmates.lifestyle')}><Tags items={r.tags} /></Section>}
          {r.note && <Section icon="message-square" title={t('flatmates.detailAbout')}><p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{r.note}</p></Section>}
        </Sheet>
      )}
    </DetailLayout>
  );
}
