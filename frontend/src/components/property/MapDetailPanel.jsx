import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import Icon from '../Icon.jsx';
import PropertyImage from '../ui/PropertyImage.jsx';
import { fmtINR, fmtNum } from '../../lib/format.js';
import { FURN_LBL } from '../../pages/consumer/listings/constants.js';
import { POSSESSION, AMEN_ICON, amenLabel } from './tileMeta.js';
import { useSaved } from '../../context/SavedContext.jsx';
import { cityLabelFor } from '../../lib/geoConfig.js';
import { messagesLinkForProp } from '../../lib/chat.js';
import { queuePendingChat } from '../../services/conversationService.js';
import { ContactOwnerModal } from '../../pages/consumer/property/ContactOwnerModal.jsx';
import { ScheduleVisitModal } from '../../pages/consumer/property/ScheduleVisitModal.jsx';
import '../../styles/routes/property-map-detail.css';

const titleOf = (p) => {
  if (p.shareType === 'pg') return 'PG / Hostel';
  if (p.shareType === 'flatmates') return 'Flatmate / Shared';
  const t = (p.type || '').toLowerCase();
  if (['plot', 'open plot', 'farm land'].includes(t)) return p.type && t !== 'plot' ? p.type : 'Residential Plot';
  return p.bhkNum ? `${p.bhkNum} BHK ${p.type}` : p.type;
};

const factsOf = (p) => {
  const isPg = p.shareType === 'pg' || p.shareType === 'flatmates';
  const isPlot = ['plot', 'open plot', 'farm land'].includes((p.type || '').toLowerCase());
  const baths = Number(p.bath) || 0;
  const area = p.area ? p.area.toLocaleString('en-IN') + ' sq.ft' : '';
  const furn = FURN_LBL[p.furnishing];
  const possession = POSSESSION[p.construction];
  const out = [];
  if (isPg) {
    if (area) out.push({ icon: 'maximize-2', value: area, label: 'Built-up' });
    if (furn) out.push({ icon: 'sofa', value: furn, label: 'Furnishing' });
  } else if (isPlot) {
    if (area) out.push({ icon: 'maximize-2', value: area, label: 'Plot area' });
    if (p.type) out.push({ icon: 'building-2', value: p.type, label: 'Land type' });
  } else {
    if (p.bhkNum) out.push({ icon: 'bed-double', value: p.bhkNum + ' Bed', label: 'Bedrooms' });
    if (baths) out.push({ icon: 'bath', value: baths + ' Bath', label: 'Bathrooms' });
    if (area) out.push({ icon: 'maximize-2', value: area, label: 'Built-up' });
    if (furn) out.push({ icon: 'sofa', value: furn, label: 'Furnishing' });
    if (p.type) out.push({ icon: 'building-2', value: p.type, label: 'Type' });
  }
  if (possession) out.push({ icon: 'calendar', value: possession, label: 'Possession' });
  return out;
};

export default function MapDetailPanel({ property: p, list, locName, activeIndex, onClose, onSelect, fromSearch, onOpenFull, scheduleEnabled, chatEnabled, isIn, toast }) {
  const navigate = useNavigate();
  const [shot, setShot] = useState(0);
  const savedList = useSaved();
  const saved = savedList.has(p?.id);
  const [contactOpen, setContactOpen] = useState(false);
  const [visitOpen, setVisitOpen] = useState(false);

  const gallery = p ? (p.gallery && p.gallery.length ? p.gallery : [p.image]) : [];

  useEffect(() => { setShot(0); }, [p?.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (contactOpen || visitOpen) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && gallery.length > 1) setShot((i) => (i - 1 + gallery.length) % gallery.length);
      else if (e.key === 'ArrowRight' && gallery.length > 1) setShot((i) => (i + 1) % gallery.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gallery.length, onClose, contactOpen, visitOpen]);

  if (!p) return null;

  const isRent = p.deal === 'rent';
  const loc = (locName && locName[p.localitySlug]) || p.locality;
  const priceStr = isRent ? `₹${(p.price || 0).toLocaleString('en-IN')}` : fmtINR(p.price);
  const emi = Math.round((p.price * 0.0072) / 100) * 100;
  const facts = factsOf(p);
  const amenities = Array.isArray(p.amenities) ? p.amenities : [];
  const total = list.length;

  const tags = [];
  tags.push([p.construction === 'new' ? 'New launch' : p.construction === 'under' ? 'Under constr.' : 'Ready to move', 'is-teal']);
  if (p.ownerVerified) tags.push(['Verified Owner', 'is-indigo']);
  if (p.ownershipVerified) tags.push(['Ownership Verified', 'is-emerald']);
  if (p.rera) tags.push(['RERA', 'is-coral']);

  const step = (delta) => {
    const next = activeIndex + delta;
    if (next >= 0 && next < total) onSelect(list[next].id);
  };
  // "Contact Owner" mirrors the property-detail page: L1 contact (badge-not-gate) —
  // any signed-in user may reach the owner. Queue a pending in-app chat request
  // (owner accepts in Messages) and open the thread. Falls back to the enquiry
  // popup when in-app messaging is disabled.
  const startChatRequest = () => { queuePendingChat(p); navigate(messagesLinkForProp(p)); };
  const contact = () => {
    if (!isIn) { toast('Please sign in to contact owner', 'info'); return; }
    if (!chatEnabled) { setContactOpen(true); return; }
    startChatRequest();
  };
  const schedule = () => { if (!isIn) { toast('Please sign in to schedule a visit', 'info'); return; } setVisitOpen(true); };
  const toggleSave = () => {
    if (!isIn) { toast('Please sign in to save properties', 'info'); return; }
    savedList.toggle(p.id, p.uuid);
  };

  return (
    <>
      <aside className="pn-mdp" role="dialog" aria-modal="true" aria-label={titleOf(p) + ' details'}>
        <span className="pn-mdp-grip" aria-hidden="true" />
        <div className="pn-mdp-top">
          <div className="pn-mdp-step">
            <button type="button" onClick={() => step(-1)} disabled={activeIndex <= 0} aria-label="Previous property"><Icon name="chevron-left" /></button>
            <span>{activeIndex + 1} <i>of</i> {total}</span>
            <button type="button" onClick={() => step(1)} disabled={activeIndex >= total - 1} aria-label="Next property"><Icon name="chevron-right" /></button>
          </div>
          <button type="button" className="pn-mdp-close" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
        </div>

        <div className="pn-mdp-scroll">
          <div className="pn-mdp-media">
            <PropertyImage src={gallery[shot]} alt={p.title} />
            <span className={'pn-mdp-deal ' + (isRent ? 'is-rent' : 'is-sale')}>{isRent ? 'For Rent' : 'For Sale'}</span>
            <button type="button" className={'pn-mdp-heart' + (saved ? ' is-on' : '')} onClick={toggleSave} aria-label={saved ? 'Saved' : 'Save property'}><Icon name="heart" weight={saved ? 'fill' : 'regular'} /></button>
            {gallery.length > 1 ? (
              <>
                <button type="button" className="pn-mdp-nav is-prev" onClick={() => setShot((i) => (i - 1 + gallery.length) % gallery.length)} aria-label="Previous photo"><Icon name="chevron-left" /></button>
                <button type="button" className="pn-mdp-nav is-next" onClick={() => setShot((i) => (i + 1) % gallery.length)} aria-label="Next photo"><Icon name="chevron-right" /></button>
                <span className="pn-mdp-count">{shot + 1} / {gallery.length}</span>
              </>
            ) : null}
          </div>

          <div className="pn-mdp-info">
            <div className="pn-mdp-tags">
              {tags.map(([t, cls]) => <span key={t} className={'pn-mdp-tag ' + cls}>{t}</span>)}
            </div>
            <div className="pn-mdp-price">{priceStr}{isRent ? <i>/mo</i> : null}</div>
            {!isRent ? <div className="pn-mdp-emi">EMI from ₹{fmtNum(emi)}/mo · Zero brokerage</div> : <div className="pn-mdp-emi">Zero brokerage — deal direct with owner</div>}
            <h3 className="pn-mdp-title">{titleOf(p)}</h3>
            <div className="pn-mdp-loc"><Icon name="map-pin" /> {loc}, {cityLabelFor(p)}</div>

            {facts.length ? (
              <div className="pn-mdp-facts">
                {facts.map((fct, i) => (
                  <div className="pn-mdp-fact" key={i}>
                    <Icon name={fct.icon} />
                    <div><b>{fct.value}</b><span>{fct.label}</span></div>
                  </div>
                ))}
              </div>
            ) : null}

            {amenities.length ? (
              <div className="pn-mdp-sect">
                <div className="pn-mdp-sect-hd">Amenities</div>
                <div className="pn-mdp-chips">
                  {amenities.map((k) => (
                    <span className="pn-mdp-chip" key={k}><Icon name={AMEN_ICON[k] || 'check'} /> {amenLabel(k)}</span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="pn-mdp-sect">
              <div className="pn-mdp-sect-hd">Overview</div>
              <p className="pn-mdp-desc">
                This {p.bhkNum ? p.bhkNum + ' BHK ' : ''}{(p.type || 'home').toLowerCase()} in {loc} offers{amenities.length ? ' ' + amenities.slice(0, 3).map(amenLabel).join(', ').toLowerCase() : ' modern living'} with great connectivity to Pune's IT hubs, schools and hospitals — broker-free, direct from the verified owner.
              </p>
            </div>
          </div>
        </div>

        <div className="pn-mdp-actions">
          <div className="pn-mdp-cta-row">
            <button type="button" className="pn-mdp-btn is-primary" onClick={contact}><Icon name="phone" /> Contact Owner</button>
            {scheduleEnabled ? <button type="button" className="pn-mdp-btn is-ghost" onClick={schedule}><Icon name="calendar-check" /> Schedule</button> : null}
          </div>
          <Link
            to={`/property/${p.id}`}
            state={{ from: fromSearch, restore: true }}
            onClick={onOpenFull}
            onMouseEnter={() => import('../../pages/consumer/Property.jsx')}
            className="pn-mdp-full"
          >
            Open full page <Icon name="arrow-right" />
          </Link>
        </div>
      </aside>

      {contactOpen ? <ContactOwnerModal p={p} isIn={isIn} onClose={() => setContactOpen(false)} toast={toast} /> : null}
      {visitOpen && scheduleEnabled ? <ScheduleVisitModal p={p} isIn={isIn} onClose={() => setVisitOpen(false)} toast={toast} /> : null}
    </>
  );
}
