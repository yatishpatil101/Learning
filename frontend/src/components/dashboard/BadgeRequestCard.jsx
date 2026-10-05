import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';
import { badgeDocsFor } from '../../pages/consumer/list-property/constants.js';
import { canonicalTypeKey, matchTypeKey } from '../../data/propertyTypes.js';
import { requestOwnershipVerification } from '../../services/propertyReviewService.js';

const badgeTypeOf = (type) => {
  const raw = String(type || '').toLowerCase();
  const key = canonicalTypeKey(raw) || ['plot', 'farmland'].find((k) => matchTypeKey(k, raw));
  return key === 'farmland' ? 'farmland' : key === 'plot' ? 'openplot' : 'flat';
};

const STATE_CHIP = {
  verified: ['dash.badge.verified', 'bg-emerald-500/15 text-emerald-300'],
  requested: ['dash.badge.underReview', 'bg-amber-500/15 text-amber-300'],
  declined: ['dash.badge.declined', 'bg-rose-500/15 text-rose-300'],
  none: ['dash.badge.notRequested', 'bg-white/[0.08] text-gray-400'],
};

export default function BadgeRequestCard({ listing, docs, onUpload, toast }) {
  const { t } = useTranslation();
  const [requested, setRequested] = useState(null);
  const [busy, setBusy] = useState(false);
  const proofs = badgeDocsFor(listing.deal, badgeTypeOf(listing.type)).filter((doc) => doc.verifies);
  const uploaded = new Set((docs || []).map((d) => d.category));
  const ready = proofs.some((doc) => uploaded.has(doc.key));
  const requestedNow = requested === listing.uuid;
  const state = listing.ownershipVerified ? 'verified'
    : requestedNow || listing.ownershipRequestedAt ? 'requested'
    : listing.ownershipDeclinedReason ? 'declined' : 'none';
  const [chipKey, chipCls] = STATE_CHIP[state];

  const request = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await requestOwnershipVerification(listing.uuid);
      setRequested(listing.uuid);
      toast(t('dash.badge.requestedToast'), 'success');
    } catch (err) {
      toast(err?.message || t('dash.badge.requestFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="badge-request-card" data-state={state} className="glass-card rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 bg-teal-500/15 text-teal-400"><Icon name="shield-check" className="w-5 h-5" /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-white text-sm font-semibold truncate">{t('dash.badge.title')}</p>
            <span data-testid="badge-state" className={'text-[10px] px-2 py-0.5 rounded-full font-semibold ' + chipCls}>{t(chipKey)}</span>
          </div>
          <p className="text-gray-400 text-xs mt-0.5">
            {state === 'verified' ? t('dash.badge.lineVerified')
              : state === 'requested' ? t('dash.badge.lineRequested')
              : state === 'declined' ? t('dash.badge.lineDeclined', { reason: listing.ownershipDeclinedReason })
              : t('dash.badge.lineNone')}
          </p>
        </div>
      </div>
      {state === 'none' || state === 'declined' ? (
        <>
          <ul className="mt-3 space-y-2">
            {proofs.map((doc) => (
              <li key={doc.key} data-doc={doc.key} className="flex items-center gap-2 text-xs">
                <Icon name={uploaded.has(doc.key) ? 'check-circle' : 'circle'} className={'w-4 h-4 flex-shrink-0 ' + (uploaded.has(doc.key) ? 'text-emerald-400' : 'text-gray-600')} />
                <span className={'flex-1 min-w-0 truncate ' + (uploaded.has(doc.key) ? 'text-white' : 'text-gray-400')}>{doc.key}</span>
                {!uploaded.has(doc.key) && (
                  <button type="button" onClick={() => onUpload(doc.key)} className="min-h-[36px] px-3 rounded-lg bg-white/5 hover:bg-white/10 text-teal-300 font-semibold inline-flex items-center gap-1">
                    <Icon name="upload" className="w-3.5 h-3.5" /> {t('dash.badge.upload')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" onClick={request} disabled={!ready || busy} data-testid="request-badge"
            className="mt-4 w-full sm:w-auto min-h-[44px] px-4 rounded-lg bg-brand-teal text-ink text-sm font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed">
            <Icon name="shield-check" className="w-4 h-4" /> {busy ? t('dash.badge.requesting') : t('dash.badge.request')}
          </button>
        </>
      ) : null}
    </div>
  );
}
