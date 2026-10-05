import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import Icon from '../../../../components/Icon.jsx';
import { inr, perHead, shareFloor, moneyRange, bhkText, groupListingsUrl, seatsLeft, policyAvatar, moveInLabel } from '../helpers.js';
import { GroupBadges, GroupJoinButton } from '../GroupCard.jsx';
import { DetailLayout, Identity, Sheet, Section, InfoRows, Tags, PriceCard, StickyAsk } from './parts.jsx';
import HeaderActions from './HeaderActions.jsx';
import GroupChatLink from './GroupChatLink.jsx';

const BILL_KEY = { included: 'billIncluded', shared: 'billShared', separate: 'billSeparate' };
const FURN_KEY = { furnished: 'furnFurnished', semi: 'furnSemi', unfurnished: 'furnUnfurnished' };
const CTA = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold whitespace-nowrap ';

function MembershipCta({ g, status, onJoin, onLeave, onCancel }) {
  const { t } = useTranslation();
  if (status === 'accepted') return (
    <div className="flex-1 flex gap-2" data-testid="group-membership">
      <span className={CTA + 'flex-1 chip text-emerald-300'}><Icon name="check-check" className="w-4 h-4" /> {t('flatmates.youreIn')}</span>
      <button type="button" onClick={onLeave} className={CTA + 'btn-ghost text-rose-300'}>{t('flatmates.leaveGroup')}</button>
    </div>
  );
  if (status === 'pending') return (
    <div className="flex-1 flex gap-2" data-testid="group-membership">
      <span className={CTA + 'flex-1 chip text-teal-200'}><Icon name="clock" className="w-4 h-4" /> {t('flatmates.requested')}</span>
      <button type="button" onClick={onCancel} className={CTA + 'btn-ghost text-gray-200'}>{t('flatmates.cancelRequest')}</button>
    </div>
  );
  if (status === 'declined') return <span className={CTA + 'flex-1 chip text-gray-400'}>{t('flatmates.notAccepted')}</span>;
  return <GroupJoinButton g={g} joined={false} onJoin={onJoin} />;
}

function WantedFlat({ p, canSearch }) {
  const { t } = useTranslation();
  return (
    <Section icon="search" title={t('flatmates.lookingForHeading')}>
      <InfoRows items={[
        [t('flatmates.groupLocalities'), p.localities.join(', ')],
        [t('flatmates.groupBhk'), bhkText(p.bhk)],
        [t('flatmates.groupFurnishing'), FURN_KEY[p.furnishing] && t('flatmates.' + FURN_KEY[p.furnishing])],
        [t('flatmates.groupMoveInBy'), moveInLabel(p.moveInBy)],
        [t('flatmates.gatedOnly'), p.gatedOnly && t('flatmates.yes')],
        [t('flatmates.needsBachelors'), p.bachelors && t('flatmates.yes')],
      ]} />
      {canSearch && (
        <Link to={groupListingsUrl(p)} className="mt-4 btn-teal inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl text-sm font-semibold text-white" data-testid="group-find-flats">
          <Icon name="search" className="w-4 h-4" /> {t('flatmates.findFlatsForUs')}
        </Link>
      )}
    </Section>
  );
}

function Member({ m, policy, label, onRemove }) {
  const { t } = useTranslation();
  const name = m.name || label;
  return (
    <li className="w-16 flex flex-col items-center gap-1.5 text-center" data-testid="group-member">
      <div className="relative">
        <div className={'w-12 h-12 rounded-full bg-gradient-to-br ' + policyAvatar(policy) + ' flex items-center justify-center text-white text-sm font-bold'}>{m.initials || <Icon name="user" className="w-5 h-5 opacity-80" />}</div>
        {m.verified && <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-[#0f0d1a] flex items-center justify-center"><Icon name="check" className="w-2.5 h-2.5 text-white" /></span>}
        {onRemove && (
          <button type="button" onClick={() => onRemove(m)} aria-label={t('flatmates.removeMember', { name })} data-testid="group-member-remove"
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-[#1c1930] ring-1 ring-white/20 flex items-center justify-center text-gray-300 hover:text-rose-300 before:absolute before:-inset-3 before:content-['']">
            <Icon name="x" className="w-3 h-3" />
          </button>
        )}
      </div>
      <span className="text-xs text-gray-200 w-full truncate">{name}</span>
    </li>
  );
}

export default function GroupDetail({ g, owned, myStatus, saved, onSave, onJoin, onLeave, onCancel, onRemoveMember, onReport, ownerPanel, back }) {
  const { t } = useTranslation();
  const left = seatsLeft(g);
  const offPlatform = Math.max(0, g.seatsTotal - left - g.members.length);
  const bill = (v) => BILL_KEY[v] && t('flatmates.' + BILL_KEY[v]);
  const p = g.preferences;
  const share = <>{p ? moneyRange(shareFloor(g), perHead(g), t) : inr(perHead(g))}<span className="text-gray-500 text-sm font-normal">{t('flatmates.perMonth')}</span></>;
  const cta = !owned && <MembershipCta g={g} status={myStatus} onJoin={onJoin} onLeave={onLeave} onCancel={onCancel} />;

  const header = (
    <Identity
      avatar={<div className={'w-12 h-12 rounded-2xl bg-gradient-to-br ' + policyAvatar(g.policy) + ' flex items-center justify-center text-white shrink-0'}><Icon name="users-round" className="w-6 h-6" /></div>}
      title={g.title}
      badges={<GroupBadges g={g} reviewStatus={g.reviewStatus} owned={owned} />}
    />
  );

  const aside = (
    <>
      {ownerPanel}
      <PriceCard
        label={t(p ? 'flatmates.budgetEach' : 'flatmates.yourShare') + ' · ' + t('flatmates.nSharingWord', { count: g.seatsTotal })}
        value={share}
        facts={p
          ? [['home', t('flatmates.wholeFlat'), moneyRange(p.rentMin, p.rentMax, t)], ['wallet', t('flatmates.deposit'), moneyRange(p.depositMin, p.depositMax, t)]]
          : [['home', t('flatmates.wholeFlat'), inr(g.rent)], ['wallet', t('flatmates.deposit'), g.deposit > 0 && inr(g.deposit)]]}
        cta={cta}
      />
    </>
  );

  return (
    <DetailLayout
      back={back}
      actions={<HeaderActions saved={saved} onSave={onSave} shareText={g.title} reportLabel={t('flatmates.ariaReportGroup')} onReport={!owned && (() => onReport({ id: g.id, title: g.title, ownerName: g.members?.[0]?.name || 'Group', kind: 'share' }))} />}
      header={header}
      aside={aside}
      sticky={cta && <StickyAsk price={share} label={t(p ? 'flatmates.budgetEach' : 'flatmates.yourShare')}>{cta}</StickyAsk>}
    >
      <Sheet>
        <Section icon="users" title={t('flatmates.detailMembers')} aside={<span className="text-xs text-gray-400">{t('flatmates.detailMembersCount', { filled: g.seatsTotal - left, total: g.seatsTotal })}</span>}>
          <ul className="flex flex-wrap gap-x-2 gap-y-3">
            {g.members.map((m, k) => <Member key={m.id || k} m={m} policy={g.policy} label={t('flatmates.detailMember')} onRemove={owned && !m.host && m.id ? onRemoveMember : null} />)}
            {Array.from({ length: offPlatform }).map((_, k) => (
              <li key={'f' + k} className="w-16 flex flex-col items-center gap-1.5 text-center" data-testid="group-seat-filled">
                <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center text-gray-400"><Icon name="user" className="w-5 h-5" /></div>
                <span className="text-xs text-gray-400">{t('flatmates.filled')}</span>
              </li>
            ))}
            {Array.from({ length: left }).map((_, k) => (
              <li key={'s' + k} className="w-16 flex flex-col items-center" aria-hidden="true" data-testid="group-seat-open">
                <div className="w-12 h-12 rounded-full border border-dashed border-white/25 flex items-center justify-center text-gray-500"><Icon name="plus" className="w-5 h-5" /></div>
              </li>
            ))}
          </ul>
          {(owned || myStatus === 'accepted') && <div className="mt-4"><GroupChatLink groupId={g.id} /></div>}
        </Section>
        {p && <WantedFlat p={p} canSearch={owned || myStatus === 'accepted'} />}
        {[g.noticePeriodDays, g.lockInMonths, g.maintenanceBilling, g.electricityBilling].some((v) => v != null) && (
          <Section icon="file-text" title={t('flatmates.termsHeading')}>
            <InfoRows items={[
              [t('flatmates.noticePeriod'), g.noticePeriodDays],
              [t('flatmates.lockIn'), g.lockInMonths],
              [t('flatmates.maintenanceBill'), bill(g.maintenanceBilling)],
              [t('flatmates.electricityBill'), bill(g.electricityBilling)],
            ]} />
          </Section>
        )}
        {g.tags?.length > 0 && <Section icon="sparkles" title={t('flatmates.lifestyle')}><Tags items={g.tags} /></Section>}
        {g.note && <Section icon="message-square" title={t('flatmates.detailAbout')}><p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">{g.note}</p></Section>}
      </Sheet>
    </DetailLayout>
  );
}
