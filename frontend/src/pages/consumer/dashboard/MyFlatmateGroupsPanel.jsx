import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../../context/ToastContext.jsx';
import { leaveGroup, myFlatmateGroups, myFlatmateInterests, withdrawInterest } from '../../../services/flatmateService.js';
import { detailPath } from '../flatmates/helpers.js';
import { Card, RequestEmpty, RequestList, RequestRow, SectionHead } from './components.jsx';

const STATUS = {
  hosting: { key: 'flatmates.statusHosting', tint: 'teal', rank: -1 },
  accepted: { key: 'flatmates.statusIn', tint: 'emerald', rank: 0 },
  pending: { key: 'flatmates.statusWaiting', tint: 'amber', rank: 1 },
  declined: { key: 'flatmates.statusDeclined', tint: 'sky', rank: 2 },
};
const BTN = 'inline-flex min-h-[44px] items-center rounded-lg px-3 text-xs font-semibold transition ';

const hostedRow = (g) => ({ id: 'h-' + g.id, targetId: g.id, targetTitle: g.title, locality: g.locality, status: 'hosting' });

export default function MyFlatmateGroupsPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [rows, setRows] = useState(null);

  const load = useCallback(() => Promise.all([
    myFlatmateInterests(),
    myFlatmateGroups({ size: 20 }).then((page) => page.items).catch(() => []),
  ]).then(([asks, hosted]) => {
    setRows([...hosted.map(hostedRow), ...asks.filter((r) => r.kind === 'group' && STATUS[r.status])]
      .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank));
  }).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);

  const act = async (r) => {
    const leaving = r.status === 'accepted';
    if (leaving && !window.confirm(t('flatmates.leaveConfirm', { title: r.targetTitle }))) return;
    try {
      if (leaving) await leaveGroup(r.targetId);
      else await withdrawInterest('group', r.targetId);
      toast(leaving ? t('flatmates.leftToast', { title: r.targetTitle }) : t('flatmates.requestCancelled'));
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
    }
    load();
  };

  return (
    <Card className="p-5 sm:p-6" data-testid="my-flatmate-groups">
      <SectionHead icon="users-round" title={t('flatmates.myGroupsHeading')} />
      {rows === null ? (
        <div className="h-20 animate-pulse rounded-xl bg-white/[0.03]" aria-busy="true" />
      ) : rows.length === 0 ? (
        <RequestEmpty icon="users-round" text={t('flatmates.myGroupsEmpty')} cta={{ to: '/flatmates', label: t('flatmates.myGroupsBrowse'), icon: 'search' }} />
      ) : (
        <RequestList>
          {rows.map((r) => {
            const s = STATUS[r.status];
            return (
              <RequestRow key={r.id} icon="users-round" tint={s.tint} title={r.targetTitle || t('flatmates.detailMember')} meta={[r.locality, t(s.key)].filter(Boolean).join(' · ')}>
                <Link to={detailPath('group', r.targetId)} className={BTN + 'bg-white/5 text-gray-200 hover:bg-white/10'}>{t('dash.view')}</Link>
                {(r.status === 'accepted' || r.status === 'pending') && (
                  <button type="button" onClick={() => act(r)} className={BTN + 'text-rose-300 hover:bg-rose-500/10'}>
                    {r.status === 'accepted' ? t('flatmates.leaveGroup') : t('flatmates.cancelRequest')}
                  </button>
                )}
              </RequestRow>
            );
          })}
        </RequestList>
      )}
    </Card>
  );
}
