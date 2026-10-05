import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import '../../styles/routes/flatmates.css';
import RoomDetail from './flatmates/detail/RoomDetail.jsx';
import GroupDetail from './flatmates/detail/GroupDetail.jsx';
import SeekerDetail from './flatmates/detail/SeekerDetail.jsx';
import OwnerPanel from './flatmates/detail/OwnerPanel.jsx';
import ReportModal from '../../components/ReportModal.jsx';
import VerifyIdentityRedirect from '../../components/auth/VerifyIdentityRedirect.jsx';
import { SHARE_REPORT_REASONS } from '../../lib/reportReasons.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useVerification } from '../../context/VerificationContext.jsx';
import { useSignInGate } from '../../lib/useSignInGate.js';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { recordAskLocally, rememberAsk } from '../../lib/data/flatmates.js';
import * as flatmateService from '../../services/flatmateService.js';
import { inr, perHead, roomTitle, FLATMATE_IMG, FLATMATE_GROUP_IMG } from './flatmates/helpers.js';
import { SHARE_OPENER, SEEKER_OPENER, groupOpener } from './flatmates/openers.js';

const KINDS = ['group', 'room', 'post'];
const interestKey = (kind, id) => (kind === 'post' ? id : `${kind}-${id}`);

function askFor(kind, item, share) {
  if (kind === 'group') {
    const message = groupOpener(item);
    return {
      send: () => flatmateService.joinGroup(item.id, { share: 'solo', message }),
      thread: { propertyId: 'group-' + item.id, property: { title: item.title, price: inr(perHead(item)) + '/mo', loc: (item.locality || 'Pune') + ', Pune', img: FLATMATE_GROUP_IMG }, party: { name: item.title, avatar: (item.title || 'GR').slice(0, 2).toUpperCase() }, firstMessage: message },
      sent: [item.policy === 'any' ? 'flatmates.joinedToast' : 'flatmates.requestJoinToast', { title: item.title }],
      dup: ['flatmates.joinRequestAlreadyRecorded', { title: item.title }],
    };
  }
  if (kind === 'room') {
    const message = SHARE_OPENER[share] || SHARE_OPENER.solo;
    const title = item.society || roomTitle(item);
    return {
      send: () => flatmateService.roomInterest(item.id, { share, message }),
      thread: { propertyId: 'room-' + item.id, property: { title: item.society ? 'Room in ' + item.society : title, price: item.budget ? '₹' + item.budget + '/mo' : '', loc: item.localities?.[0] || 'Pune', img: item.photos?.[0] || FLATMATE_IMG }, party: { name: title, avatar: title.slice(0, 2).toUpperCase() }, firstMessage: message },
      sent: ['flatmates.messageSentOwner', { society: title }],
      dup: ['flatmates.enquiryAlreadyRecorded', { society: title }],
    };
  }
  return {
    send: () => flatmateService.postInterest(item.id, { share: 'solo', message: SEEKER_OPENER }),
    thread: { propertyId: item.id, property: { title: 'Flatmate: ' + item.name, price: item.budget ? '₹' + item.budget + '/mo' : '', loc: item.localities?.[0] || 'Pune', img: FLATMATE_IMG }, party: { name: item.name, avatar: (item.name || 'U').slice(0, 2).toUpperCase() }, firstMessage: SEEKER_OPENER },
    sent: ['flatmates.interestSentToast', { name: item.name }],
    dup: ['flatmates.interestAlreadyRecorded', { name: item.name }],
  };
}

export default function FlatmateDetail() {
  const { kind, id } = useParams();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { verified: identityVerified } = useVerification();
  const sendToSignIn = useSignInGate();
  const rootRef = useScrollReveal([]);
  const [state, setState] = useState({ status: 'loading' });
  const [myAsk, setMyAsk] = useState(null);
  const interested = !!myAsk;
  const [saved, setSaved] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const item = state.item;
  const owned = !!state.owned;
  const signedInAs = user?.mobile;

  const load = useCallback(async () => {
    if (!KINDS.includes(kind)) { setState({ status: 'missing' }); return; }
    try {
      const res = await flatmateService.getFlatmateDetail(kind, id);
      setState({ status: 'ready', owned: res.owned, item: res.item });
    } catch (err) {
      setState({ status: err?.status === 404 || err?.status === 400 ? 'missing' : 'error', error: err });
    }
  }, [kind, id]);
  useEffect(() => { if (!authLoading) load(); }, [authLoading, signedInAs, load]);

  const loadMine = useCallback(() => flatmateService.myFlatmateInterests()
    .then((rows) => rows.find((r) => (r.kind === 'room' || r.kind === 'group' ? `${r.kind}-${r.targetId}` : r.targetId) === interestKey(kind, id)))
    .then((row) => row || null), [kind, id]);

  useEffect(() => {
    if (!signedInAs || !KINDS.includes(kind)) { setMyAsk(null); setSaved(false); return undefined; }
    let alive = true;
    loadMine().then((s) => { if (alive) setMyAsk(s); }).catch(() => {});
    flatmateService.listFlatmateSaveKeys()
      .then((rows) => { if (alive) setSaved(rows.some((r) => r.kind === kind && r.id === id)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [signedInAs, kind, id, loadMine]);

  const patchItem = (next) => setState((s) => ({ ...s, item: { ...s.item, ...next, photos: s.item.photos } }));

  const onAsk = async (target, share = 'solo') => {
    if (!user) { sendToSignIn(kind === 'group' ? 'community' : 'contact'); return; }
    if (kind === 'post' && target.verifiedContactOnly && !identityVerified) {
      toast(t('flatmates.acceptsVerifiedOnlyToast', { name: target.name }), 'error');
      setVerifyOpen(true);
      return;
    }
    const ask = askFor(kind, target, share);
    setMyAsk({ status: 'pending' });
    let sent;
    try {
      sent = await ask.send();
    } catch (err) {
      if (err?.code === flatmateService.CONFLICT_ALREADY_INTERESTED) {
        rememberAsk(user.mobile, interestKey(kind, id));
        recordAskLocally({ request: ask.thread });
        loadMine().then(setMyAsk).catch(() => {});
        toast(t(...ask.dup));
        return;
      }
      setMyAsk(null);
      if (err?.code === flatmateService.CONFLICT_GROUP_FULL) { await load(); toast(t('flatmates.groupAlreadyFull', { title: target.title }), 'error'); return; }
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    if (sent?.status) setMyAsk({ status: sent.status });
    rememberAsk(user.mobile, interestKey(kind, id));
    recordAskLocally({ request: ask.thread });
    toast(t(...ask.sent));
    if (kind === 'group' && target.policy === 'any') await load();
  };

  const onLeave = async () => {
    if (!window.confirm(t('flatmates.leaveConfirm', { title: item.title }))) return;
    try {
      await flatmateService.leaveGroup(id);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    setMyAsk(null);
    toast(t('flatmates.leftToast', { title: item.title }));
    await load();
  };

  const onCancel = async () => {
    try {
      await flatmateService.withdrawInterest(kind, id);
    } catch (err) {
      loadMine().then(setMyAsk).catch(() => {});
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    setMyAsk(null);
    toast(t('flatmates.requestCancelled'));
  };

  const onRemoveMember = async (m) => {
    const name = m.name || t('flatmates.detailMember');
    if (!window.confirm(t('flatmates.removeMemberConfirm', { name }))) return;
    try {
      await flatmateService.removeGroupMember(id, m.id);
    } catch (err) {
      toast(err?.message || t('common.somethingWentWrong'), 'error');
      return;
    }
    toast(t('flatmates.memberRemoved', { name }));
    await load();
  };

  const onSave = async () => {
    if (!user) { sendToSignIn('save'); return; }
    const next = !saved;
    setSaved(next);
    try {
      if (next) await flatmateService.saveFlatmatePost(kind, id);
      else await flatmateService.unsaveFlatmatePost(kind, id);
    } catch {
      setSaved(!next);
      toast(t('flatmates.saveFailed'), 'error');
    }
  };

  const back = (
    <Link to={kind === 'post' ? '/flatmates?view=team-up' : '/flatmates'} className="inline-flex items-center gap-1.5 min-h-[44px] -ml-2 px-2 rounded-xl text-sm text-gray-400 hover:text-white"><Icon name="arrow-left" className="w-4 h-4" /> {t('flatmates.detailBack')}</Link>
  );
  const viewProps = { owned, saved, onSave, back, onReport: setReportTarget, ownerPanel: owned && <OwnerPanel kind={kind} item={item} patch={patchItem} /> };

  return (
    <div ref={rootRef} className="sf-page">
      <div className="pt-2 pb-28 sm:pt-4 lg:pt-6 lg:pb-24 min-h-[100dvh]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          {state.status !== 'ready' && <div className="mb-3">{back}</div>}

          {state.status === 'loading' && <div className="sf-card rounded-2xl h-72 animate-pulse" aria-busy="true" />}

          {state.status === 'missing' && (
            <div className="sf-card rounded-2xl p-8 text-center" data-testid="flatmate-detail-missing">
              <Icon name="search" className="w-8 h-8 text-gray-500 mx-auto mb-3" />
              <p className="text-white font-semibold">{t('flatmates.detailNotFound')}</p>
              <Link to="/flatmates" className="btn-teal inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-xl text-white text-sm font-semibold">{t('flatmates.detailBrowse')}</Link>
            </div>
          )}

          {state.status === 'error' && (
            <div className="sf-card rounded-2xl p-8 text-center">
              <p className="text-white font-semibold">{t('common.somethingWentWrong')}</p>
              <button type="button" onClick={load} className="btn-ghost inline-flex items-center gap-2 mt-4 px-4 py-2.5 rounded-xl text-gray-200 text-sm font-semibold"><Icon name="rotate-ccw" className="w-4 h-4" /> {t('flatmates.detailRetry')}</button>
            </div>
          )}

          {state.status === 'ready' && (
            <>
              {kind === 'room' && <RoomDetail {...viewProps} r={item} ask={myAsk} onAsk={onAsk} />}
              {kind === 'group' && <GroupDetail {...viewProps} g={item} myStatus={myAsk?.status || null} onJoin={onAsk} onLeave={onLeave} onCancel={onCancel} onRemoveMember={onRemoveMember} />}
              {kind === 'post' && <SeekerDetail {...viewProps} r={item} interested={interested} onAsk={onAsk} />}
            </>
          )}
        </div>
      </div>

      {reportTarget && (
        <ReportModal
          target={reportTarget}
          kind={reportTarget.kind || 'share'}
          reasons={SHARE_REPORT_REASONS}
          title={t('flatmates.reportTitle')}
          success={t('flatmates.reportSuccess')}
          onClose={() => setReportTarget(null)}
          toast={toast}
        />
      )}

      {verifyOpen && <VerifyIdentityRedirect source="flatmates" onClose={() => setVerifyOpen(false)} />}
    </div>
  );
}
