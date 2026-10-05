import Icon from '../../../../components/Icon.jsx';
import PropertyImage from '../../../../components/ui/PropertyImage.jsx';
import { fmtINR } from '../../../../lib/format.js';
import { FURNISH_LABEL, LISTING_STATUS_CLS } from './helpers.js';
import CardActions from './CardActions.jsx';

// Private (managed-only) property: not yet posted to buyers. Show its passport progress and the two things that
// matter — open the tools, or publish it to the marketplace.
export default function PrivateListingCard({ l, onPublish, onDelete }) {
  return (
    <div className="rounded-xl bg-white/[0.03] overflow-hidden">
      <div className="flex items-start gap-3 p-3 sm:gap-4 sm:p-4">
        <PropertyImage src={l.image} alt={l.title} className="w-24 h-24 rounded-xl object-cover flex-shrink-0 sm:w-20 sm:h-20 sm:rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <div className="min-w-0 sm:flex-1">
            <p className="text-white text-sm font-semibold sm:truncate">{l.title}</p>
            {(l.bhk || l.furnishing) && (
              <p className="text-gray-500 text-[11px] mt-0.5">
                {[l.bhk && `${l.bhk} BHK`, l.furnishing && (FURNISH_LABEL[String(l.furnishing).toLowerCase()] || l.furnishing)].filter(Boolean).join(' · ')}
              </p>
            )}
            <p className="text-xs mt-0.5">
              {l.locality && <span className="text-gray-500">{l.locality} · </span>}
              <span className="text-white font-semibold">{fmtINR(l.price)}{l.deal === 'rent' ? '/mo' : ''}</span>
            </p>
            <div className="mt-2 max-w-[220px]">
              <div className="flex items-center justify-between text-[11px] text-gray-400 mb-1"><span>Passport</span><span>{l.passportPct}%</span></div>
              <div className="insight-bar"><span style={{ width: `${l.passportPct}%` }} /></div>
            </div>
          </div>
          <span className={'text-[13px] px-2.5 py-1 rounded-full font-semibold inline-flex items-center gap-1 flex-shrink-0 self-start ' + LISTING_STATUS_CLS.private}>
            <Icon name="lock" className="w-3 h-3" />Private
          </span>
        </div>
      </div>
      <CardActions
        primary={{ label: 'Publish to buyers', icon: 'globe', tone: 'emerald', onClick: () => onPublish(l) }}
        items={[
          { icon: 'gauge', label: 'Property tools', to: `/owner-hub/property/${l.managedId}` },
          { icon: 'trash-2', label: 'Delete', tone: 'danger', onClick: () => onDelete(l) },
        ]}
      />
    </div>
  );
}
