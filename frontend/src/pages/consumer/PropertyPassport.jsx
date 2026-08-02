import { useEffect, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import Loading from '../../components/ui/Loading.jsx';
import Modal from '../../components/ui/Modal.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { getManagedProp, publishManagedProp, deleteManagedProp } from '../../lib/data/managedProperty.js';
import { getDocsForProp } from '../../lib/data/documents.js';
import { passportChecklist, passportPercent } from './owner-hub/helpers.js';
import DocVault from './owner-hub/DocVault.jsx';
import RentPanel from './owner-hub/RentPanel.jsx';

export default function PropertyPassport() {
  const { t } = useTranslation();
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const mobile = user?.mobile || '';

  const [prop, setProp] = useState(undefined);
  const [docCount, setDocCount] = useState(0);
  const [confirmDel, setConfirmDel] = useState(false);

  const refresh = useCallback(() => {
    setProp(getManagedProp(id) || null);
    setDocCount(getDocsForProp(mobile, id).length);
  }, [id, mobile]);

  useEffect(() => { refresh(); }, [refresh]);

  if (prop === undefined) return <Loading />;
  if (!prop) return (
    <div className="mx-auto max-w-3xl px-4 py-32 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4"><Icon name="folder-x" className="w-6 h-6 text-gray-500" /></div>
      <h1 className="text-xl font-bold text-white">{t('ownerHub.notFound')}</h1>
      <p className="text-gray-400 text-sm mt-1.5">{t('ownerHub.notFoundSub')}</p>
      <Link to="/dashboard#properties" className="btn-teal inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold mt-5"><Icon name="arrow-left" className="w-4 h-4" /> {t('ownerHub.backToProps')}</Link>
    </div>
  );

  const pct = passportPercent(prop, docCount);
  const checklist = passportChecklist(prop, docCount);
  const val = prop.valuation;

  const publish = () => {
    const res = publishManagedProp(prop.id);
    if (res?.already) { toast(t('ownerHub.alreadyListed'), 'info'); return; }
    toast(t('ownerHub.submittedReview'), 'success');
    refresh();
  };

  const remove = () => {
    deleteManagedProp(prop.id);
    setConfirmDel(false);
    toast(t('ownerHub.removedToast'), 'info');
    navigate('/dashboard#properties');
  };

  return (
    <div className="pb-20 min-h-[100dvh]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6">
        <Link to="/dashboard#properties" className="inline-flex items-center gap-1.5 text-gray-400 text-sm hover:text-white mb-4"><Icon name="arrow-left" className="w-4 h-4" /> {t('ownerHub.myProperties')}</Link>

        {/* Header */}
        <div className="glass-card rounded-2xl p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                {prop.publishedListingId
                  ? <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-brand-teal-1/15 border border-brand-teal-2/25 text-brand-teal-3 text-xs font-medium"><Icon name="globe" className="w-3.5 h-3.5" /> {t('ownerHub.listedToBuyers')}</span>
                  : <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-gray-300 text-xs font-medium"><Icon name="lock" className="w-3.5 h-3.5" /> {t('ownerHub.private')}</span>}
              </div>
              <h1 className="text-2xl font-bold text-white truncate">{prop.title}</h1>
              <p className="text-gray-400 text-sm mt-1 flex items-center gap-1.5"><Icon name="map-pin" className="w-4 h-4 text-brand-teal-2" /> {prop.loc || prop.locality}</p>
              <p className="text-xl font-bold gradient-text mt-2">{prop.priceStr}</p>
            </div>
            <div className="flex gap-2.5 flex-shrink-0">
              {prop.publishedListingId ? (
                <Link to={`/property/${prop.publishedListingId}`} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/5 flex items-center gap-2"><Icon name="external-link" className="w-4 h-4 text-brand-teal-2" /> {t('ownerHub.viewListing')}</Link>
              ) : (
                <button onClick={publish} className="btn-teal px-4 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="megaphone" className="w-4 h-4" /> {t('ownerHub.publishAsListing')}</button>
              )}
              <button onClick={() => setConfirmDel(true)} aria-label={t('ownerHub.removeProperty')} className="px-3 py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 flex items-center gap-2 transition-all"><Icon name="trash-2" className="w-4 h-4" /></button>
            </div>
          </div>

          {/* Completeness meter */}
          <div className="mt-5 pt-5 border-t border-white/10">
            <div className="flex items-center justify-between text-sm mb-2"><span className="text-gray-300 font-medium">{t('ownerHub.completeness')}</span><span className="text-brand-teal-3 font-bold">{pct}%</span></div>
            <div className="insight-bar mb-3"><span style={{ width: `${pct}%` }} /></div>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {checklist.map((c) => (
                !c.done && c.key === 'valued' ? (
                  <Link key={c.key} to="/services/property-valuation" className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-brand-teal-3 transition-colors">
                    <Icon name="circle" className="w-3.5 h-3.5" /> {t(c.labelKey)} <Icon name="arrow-right" className="w-3 h-3" />
                  </Link>
                ) : (
                  <span key={c.key} className={'inline-flex items-center gap-1.5 text-xs ' + (c.done ? 'text-emerald-300' : 'text-gray-500')}>
                    <Icon name={c.done ? 'check-circle' : 'circle'} className="w-3.5 h-3.5" /> {t(c.labelKey)}
                  </span>
                )
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-6 mt-6">
          <div className="space-y-6">
            <DocVault mobile={mobile} propId={prop.id} onChange={refresh} />
          </div>

          <div className="space-y-6">
            <RentPanel prop={prop} onChange={refresh} />

            {val && (
              <div className="glass-card rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4"><Icon name="gauge" className="w-5 h-5 text-brand-teal-2" /><h2 className="text-lg font-bold text-white">{t('ownerHub.valuation')}</h2></div>
                <div className="space-y-2.5">
                  <div className="rd-cell flex items-center justify-between"><span className="text-gray-400 text-sm">{t('ownerHub.estRent')}</span><span className="text-white font-semibold">{t('ownerHub.rentPerMo', { amount: fmtNum(val.rent.mid) })}</span></div>
                  <div className="rd-cell flex items-center justify-between"><span className="text-gray-400 text-sm">{t('ownerHub.estSale')}</span><span className="text-white font-semibold">{fmtINR(val.sale.mid)}</span></div>
                  <div className="rd-cell flex items-center justify-between"><span className="text-gray-400 text-sm">{t('ownerHub.localityRate')}</span><span className="text-white font-semibold">₹{fmtNum(val.perSqft)}{t('locality.perSqft')}</span></div>
                </div>
                <Link to="/services/property-valuation" className="mt-4 w-full block text-center py-2.5 rounded-xl border border-brand-teal-2/40 text-brand-teal-3 text-sm font-semibold hover:bg-brand-teal-1/10 transition-all">{t('ownerHub.getAccurate')}</Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <Modal
        open={confirmDel}
        onClose={() => setConfirmDel(false)}
        title={t('ownerHub.removeTitle')}
        size="sm"
        footer={(
          <>
            <button onClick={() => setConfirmDel(false)} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/5">{t('ownerHub.keepIt')}</button>
            <button onClick={remove} className="px-4 py-2.5 rounded-xl bg-rose-500/90 hover:bg-rose-500 text-white text-sm font-semibold flex items-center gap-2"><Icon name="trash-2" className="w-4 h-4" /> {t('ownerHub.remove')}</button>
          </>
        )}
      >
        <p className="text-gray-300 text-sm">
          <Trans i18nKey="ownerHub.removeBody" values={{ title: prop.title }} components={{ 1: <span className="text-white font-semibold" /> }} />
        </p>
        {prop.publishedListingId ? (
          <p className="text-amber-300/90 text-xs mt-3 flex items-start gap-1.5"><Icon name="alert-triangle" className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {t('ownerHub.removeWarn')}</p>
        ) : null}
      </Modal>
    </div>
  );
}
