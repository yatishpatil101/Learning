import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { jsPDF } from 'jspdf';
import '../../styles/routes/compare.css';
import Icon from '../../components/Icon.jsx';
import { listProperties } from '../../lib/mockApi.js';
import { fmtINR } from '../../lib/format.js';
import { useCompare } from '../../context/CompareContext.jsx';
import { cityLabelFor } from '../../lib/geoConfig.js';

const MAX = 4;
const AMENITIES = [
  ['gym', 'Gymnasium', 'dumbbell'],
  ['pool', 'Swimming Pool', 'waves'],
  ['lift', 'Lift / Elevator', 'move-vertical'],
  ['security', '24x7 Security', 'shield'],
  ['power', 'Power Backup', 'zap'],
  ['garden', 'Garden / Park', 'trees'],
];

const FURNISH_MAP = { unfurnished: 'furnUnfurnished', semi: 'furnSemi', furnished: 'furnFurnished' };
// Map the real `construction` field to a buyer-facing possession status. No fabrication —
// every value shown traces back to a real listing field.
const POSSESSION = { ready: 'possReady', new: 'possNew', under: 'possUnder' };

function metric(p, t) {
  const isRent = p.deal === 'rent';
  const am = {
    gym: (p.amenities || []).includes('gym'),
    pool: (p.amenities || []).includes('pool'),
    lift: (p.amenities || []).includes('lift'),
    security: (p.amenities || []).includes('security'),
    power: (p.amenities || []).includes('power'),
    garden: (p.amenities || []).includes('garden'),
  };

  return {
    id: p.id,
    available: true,
    title: p.bhkNum ? `${p.bhkNum} BHK ${p.type}` : p.type,
    loc: `${p.locality}, ${cityLabelFor(p)}`,
    img: p.image,
    deal: isRent ? t('compare.forRent') : t('compare.forSale'),
    priceNum: p.price,
    price: isRent ? '₹' + (p.price || 0).toLocaleString('en-IN') + '/mo' : fmtINR(p.price),
    type: p.type,
    bhk: p.bhkNum ? p.bhkNum + ' BHK' : p.type === 'Plot' ? 'Plot' : '—',
    area: p.area || 0,
    psf: p.area ? Math.round(p.price / p.area) : 0,
    furnish: FURNISH_MAP[p.furnishing] ? t('compare.' + FURNISH_MAP[p.furnishing]) : (p.furnishing || '—'),
    possession: POSSESSION[p.construction] ? t('compare.' + POSSESSION[p.construction]) : '—',
    rera: p.rera,
    am,
  };
}

const amenityCount = (m) => AMENITIES.filter(([k]) => m.am[k]).length;

const ROWS = [
  { label: 'Price', tk: 'rowPrice', icon: 'indian-rupee', best: 'min', get: (m) => m.price, cmp: (m) => m.priceNum },
  { label: 'Property Type', tk: 'rowType', icon: 'building-2', get: (m) => m.type },
  { label: 'Listing', tk: 'rowListing', icon: 'tag', get: (m) => m.deal },
  { label: 'Configuration', tk: 'rowConfig', icon: 'bed-double', get: (m) => m.bhk },
  { label: 'Area (sq.ft.)', tk: 'rowArea', icon: 'maximize', best: 'max', get: (m) => (m.area ? m.area.toLocaleString('en-IN') + ' sq.ft.' : '—'), cmp: (m) => m.area },
  { label: 'Price / sq.ft.', tk: 'rowPsf', icon: 'ruler', best: 'min', get: (m) => (m.psf ? '₹' + m.psf.toLocaleString('en-IN') : '—'), cmp: (m) => m.psf },
  { label: 'Furnishing', tk: 'rowFurnishing', icon: 'sofa', get: (m) => m.furnish },
  { label: 'Possession', tk: 'rowPossession', icon: 'calendar', get: (m) => m.possession },
  { label: 'RERA Verified', tk: 'rowRera', icon: 'shield-check', get: (m) => (m.rera ? 'rera-yes' : 'rera-no') },
];

export default function Compare() {
  const { t } = useTranslation();
  const { ids, toggle, clear } = useCompare();
  const [all, setAll] = useState(null);
  const [modal, setModal] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => { listProperties({}, 'newest').then(setAll); }, []);

  const loading = all === null;
  // Keep a column for every compared id — even ones no longer in the active dataset —
  // so a removed/expired listing shows an honest "No longer available" card instead of
  // silently vanishing.
  const items = useMemo(() => {
    if (!all) return [];
    return ids.map((id) => {
      const p = all.find((x) => x.id === id);
      return p ? metric(p, t) : { id, available: false };
    });
  }, [ids, all, t]);
  const liveItems = useMemo(() => items.filter((m) => m.available), [items]);

  const bestIds = (row) => {
    if (!row.best || !row.cmp || liveItems.length < 2) return [];
    const vals = liveItems.map(row.cmp).filter((v) => v > 0);
    if (vals.length < 2) return [];
    const target = row.best === 'min' ? Math.min(...vals) : Math.max(...vals);
    return liveItems.filter((m) => row.cmp(m) === target).map((m) => m.id);
  };
  const amWinners = useMemo(() => {
    if (liveItems.length < 2) return [];
    const max = Math.max(...liveItems.map(amenityCount));
    if (max === 0) return [];
    return liveItems.filter((m) => amenityCount(m) === max).map((m) => m.id);
  }, [liveItems]);

  const pickable = (all || []).filter((p) => !ids.includes(p.id) && (`${p.title} ${p.locality || ''}, Pune`.toLowerCase().includes(q.toLowerCase())));

  const contactHref = (m) => `/contact?ref=${encodeURIComponent(m.id)}&subject=${encodeURIComponent('Enquiry about ' + m.title)}`;

  // Render the live comparison to a real PDF (jspdf is already a dependency). Only
  // available listings and real fields are exported; falls back to the browser print
  // dialog if PDF generation fails for any reason.
  const exportPdf = () => {
    try {
      const cols = liveItems;
      if (!cols.length) return;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
      const pageW = doc.internal.pageSize.getWidth();
      const marginX = 40;
      const labelW = 150;
      const colW = Math.min(180, (pageW - marginX * 2 - labelW) / cols.length);
      let y = 48;

      doc.setFontSize(16);
      doc.setTextColor(20, 20, 20);
      doc.text(t('compare.pdfTitle'), marginX, y);
      y += 8;
      doc.setFontSize(9);
      doc.setTextColor(120, 120, 120);
      doc.text(new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }), marginX, y + 8);
      y += 28;

      const colX = (i) => marginX + labelW + i * colW;

      // Column headers
      doc.setFontSize(10);
      doc.setTextColor(20, 20, 20);
      cols.forEach((m, i) => {
        const lines = doc.splitTextToSize(m.title, colW - 8);
        doc.text(lines, colX(i), y);
      });
      y += 24;
      doc.setDrawColor(220, 220, 220);
      doc.line(marginX, y - 8, marginX + labelW + cols.length * colW, y - 8);

      const pdfRows = [
        [t('compare.location'), (m) => m.loc],
        ...ROWS.map((r) => [t('compare.' + r.tk, { defaultValue: r.label }), (m) => {
          const v = r.get(m);
          if (v === 'rera-yes') return t('compare.reraVerified');
          if (v === 'rera-no') return t('compare.reraNotListed');
          return String(v);
        }]),
        [t('compare.amenities'), (m) => `${amenityCount(m)} / ${AMENITIES.length}`],
        ...AMENITIES.map(([key, label]) => [t('compare.amen_' + key, { defaultValue: label }), (m) => (m.am[key] ? t('compare.yes') : t('compare.no'))]),
      ];

      doc.setFontSize(9);
      pdfRows.forEach(([label, getVal]) => {
        if (y > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = 48; }
        doc.setTextColor(110, 110, 110);
        doc.text(String(label), marginX, y);
        doc.setTextColor(30, 30, 30);
        cols.forEach((m, i) => {
          const val = doc.splitTextToSize(getVal(m), colW - 8);
          doc.text(val, colX(i), y);
        });
        y += 20;
      });

      doc.save('punenest-comparison.pdf');
    } catch {
      window.print();
    }
  };

  return (
    <div>
      <div className="pb-20 min-h-[100dvh]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
            <div>
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-teal-500/10 border border-teal-500/20 text-teal-400 text-sm font-medium mb-4">
                <Icon name="git-compare" className="w-4 h-4" /> {t('compare.badge')}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-white">{t('compare.title')}</h1>
              <p className="text-gray-400 text-sm mt-2">{t('compare.subtitle', { max: MAX })} <span className="text-teal-400">{t('compare.subtitleHighlight')}</span></p>
            </div>
            {ids.length > 0 && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={clear} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-300 text-sm font-medium hover:bg-white/5 transition-all flex items-center gap-2">
                  <Icon name="rotate-ccw" className="w-4 h-4" /> {t('compare.reset')}
                </button>
                {liveItems.length > 0 && (
                  <button type="button" onClick={exportPdf} className="btn-teal px-4 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2">
                    <Icon name="download" className="w-4 h-4" /> {t('compare.exportPdf')}
                  </button>
                )}
              </div>
            )}
          </div>

          {ids.length === 0 ? (
            <div className="glass-card rounded-2xl p-16 text-center">
              <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-5"><Icon name="git-compare" className="w-8 h-8 text-gray-500" /></div>
              <h3 className="text-xl font-bold text-white mb-2">{t('compare.emptyTitle')}</h3>
              <p className="text-gray-400 text-sm mb-6">{t('compare.emptyBody')}</p>
              <Link to="/listings" className="btn-teal inline-flex items-center gap-2 px-6 py-3 rounded-xl text-white text-sm font-semibold"><Icon name="search" className="w-4 h-4" /> {t('compare.browseListings')}</Link>
            </div>
          ) : loading ? (
            <div className="glass-card rounded-2xl p-16 text-center text-gray-500 text-sm">{t('compare.loading')}</div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden">
              {/* Mobile-only affordance: the table pages horizontally (sticky label
                 column + scroll-snap columns), so tell touch users they can swipe.
                 Hidden once 4 are added (nothing left to reveal) and on sm+. */}
              {items.length > 1 ? (
                <div className="flex sm:hidden items-center justify-center gap-1.5 py-2 text-[11px] font-medium text-gray-400 border-b border-white/5">
                  <Icon name="chevrons-left-right" className="w-3.5 h-3.5 text-teal-400" />
                  {t('compare.swipeHint')}
                </div>
              ) : null}
              <div className="overflow-x-auto cmp-scroll no-scrollbar">
                <table className="cmp-table w-full">
                  <thead>
                    <tr>
                      <th className="feature-col cmp-cell"><span className="text-xs uppercase tracking-wider text-gray-500 font-semibold">{t('compare.properties')}</span></th>
                      {items.map((m) => (
                        <th key={m.id} className="cmp-cell">
                          {m.available ? (
                            <div className="col-card rounded-2xl overflow-hidden">
                              <div className="relative h-32 overflow-hidden">
                                <img src={m.img} alt="" className="w-full h-full object-cover" />
                                <span className="absolute top-2 left-2 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-black/40 backdrop-blur text-teal-300">{m.deal}</span>
                                <button type="button" onClick={() => toggle(m.id)} aria-label={t('compare.removeAria', { title: m.title })} className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/40 backdrop-blur flex items-center justify-center text-white hover:bg-red-500/70 transition-colors"><Icon name="x" className="w-4 h-4" /></button>
                              </div>
                              <div className="p-2.5 sm:p-3 text-left">
                                <p className="text-white font-bold text-sm truncate">{m.title}</p>
                                <p className="text-gray-500 text-xs flex items-center gap-1 mt-0.5 truncate"><Icon name="map-pin" className="w-3 h-3 text-teal-400" /> {m.loc}</p>
                                <p className="text-base sm:text-lg font-bold gradient-text mt-1.5 truncate">{m.price}</p>
                                <div className="flex flex-col gap-1.5 sm:flex-row sm:gap-2 mt-2">
                                  <Link to={`/property/${m.id}`} className="flex-1 text-center text-[11px] py-1.5 rounded-lg btn-teal text-white font-semibold">{t('compare.view')}</Link>
                                  <Link to={contactHref(m)} className="flex-1 text-center text-[11px] py-1.5 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5">{t('compare.contact')}</Link>
                                </div>
                              </div>
                            </div>
                          ) : (
                            <div className="col-card rounded-2xl overflow-hidden">
                              <div className="relative h-32 flex items-center justify-center bg-white/5">
                                <Icon name="x-circle" className="w-8 h-8 text-gray-600" />
                                <button type="button" onClick={() => toggle(m.id)} aria-label={t('compare.removeUnavailableAria')} className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/40 backdrop-blur flex items-center justify-center text-white hover:bg-red-500/70 transition-colors"><Icon name="x" className="w-4 h-4" /></button>
                              </div>
                              <div className="p-3 text-left">
                                <p className="text-white font-bold text-sm">{t('compare.noLongerAvailable')}</p>
                                <p className="text-gray-500 text-xs mt-0.5">{t('compare.removedOrExpired')}</p>
                                <button type="button" onClick={() => toggle(m.id)} className="mt-2 w-full text-center text-[11px] py-1.5 rounded-lg border border-white/10 text-gray-300 hover:bg-white/5">{t('compare.remove')}</button>
                              </div>
                            </div>
                          )}
                        </th>
                      ))}
                      {items.length < MAX ? (
                        <th className="cmp-cell">
                          <button type="button" onClick={() => setModal(true)} className="add-slot w-full h-full min-h-[230px] rounded-2xl flex flex-col items-center justify-center gap-3 text-gray-400 hover:text-teal-400">
                            <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center"><Icon name="plus" className="w-6 h-6" /></div>
                            <span className="text-sm font-medium">{t('compare.addProperty')}</span>
                          </button>
                        </th>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody>
                    {ROWS.map((row) => {
                      const winners = bestIds(row);
                      return (
                        <tr key={row.label} className="cmp-row">
                          <td className="feature-col cmp-cell"><span className="row-label"><Icon name={row.icon} className="w-4 h-4 text-teal-400" />{t('compare.' + row.tk, { defaultValue: row.label })}</span></td>
                          {items.map((m) => {
                            const win = winners.includes(m.id);
                            const raw = m.available ? row.get(m) : '—';
                            return (
                              <td key={m.id} className="cmp-cell">
                                <span className={'text-sm text-gray-200 ' + (win ? 'best' : '')}>
                                  {!m.available ? <span className="text-gray-600">—</span>
                                    : raw === 'rera-yes' ? (<><Icon name="check-circle-2" className="w-4 h-4 chk inline" /> <span className="text-emerald-400">{t('compare.reraVerified')}</span></>)
                                    : raw === 'rera-no' ? (<><Icon name="x-circle" className="w-4 h-4 crs inline" /> <span className="text-gray-500">{t('compare.reraNotListed')}</span></>)
                                    : raw}
                                  {win ? <span className="best-tag">{t('compare.best')}</span> : null}
                                </span>
                              </td>
                            );
                          })}
                          {items.length < MAX ? <td className="cmp-cell" /> : null}
                        </tr>
                      );
                    })}
                    {/* Amenities Summary */}
                    <tr>
                      <td className="feature-col cmp-cell"><span className="row-label text-teal-400"><Icon name="sparkles" className="w-4 h-4" />{t('compare.amenities')}</span></td>
                      {items.map((m) => {
                        const win = amWinners.includes(m.id);
                        return (
                          <td key={m.id} className="cmp-cell"><span className={'text-sm ' + (win ? 'best' : 'text-gray-400')}>{m.available ? <>{amenityCount(m)} / {AMENITIES.length}{win ? <span className="best-tag">{t('compare.best')}</span> : null}</> : <span className="text-gray-600">—</span>}</span></td>
                        );
                      })}
                      {items.length < MAX ? <td className="cmp-cell" /> : null}
                    </tr>
                    {/* Individual Amenity Rows */}
                    {AMENITIES.map(([key, label, icon]) => (
                      <tr key={key} className="cmp-row">
                        <td className="feature-col cmp-cell">
                          <span className="row-label pl-2">
                            <Icon name={icon} className="w-4 h-4 text-gray-500" />
                            {t('compare.amen_' + key, { defaultValue: label })}
                          </span>
                        </td>
                        {items.map((m) => (
                          <td key={m.id} className="cmp-cell">
                            {!m.available ? (
                              <span className="text-gray-600">—</span>
                            ) : m.am[key] ? (
                              <Icon name="check" className="w-4 h-4 chk" />
                            ) : (
                              <Icon name="minus" className="w-4 h-4 crs" />
                            )}
                          </td>
                        ))}
                        {items.length < MAX ? <td className="cmp-cell" /> : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="flex items-start gap-3 mt-6 text-gray-500 text-xs">
            <Icon name="info" className="w-4 h-4 text-teal-400 flex-shrink-0 mt-0.5" />
            <p>{t('compare.tipStart')} <span className="text-emerald-400 font-medium">{t('compare.best')}</span> {t('compare.tipEnd')}</p>
          </div>
        </div>
      </div>

      {modal ? (
        <div className="fixed inset-0 z-[60] modal-overlay flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div className="pn-modal-panel rounded-2xl border border-white/10 w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-white/10">
              <h3 className="text-lg font-bold text-white">{t('compare.modalTitle')}</h3>
              <button type="button" onClick={() => setModal(false)} aria-label={t('compare.close')} className="w-9 h-9 rounded-xl flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/5"><Icon name="x" className="w-5 h-5" /></button>
            </div>
            <div className="p-4 border-b border-white/10">
              <div className="relative">
                <Icon name="search" className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input value={q} onChange={(e) => setQ(e.target.value)} type="text" placeholder={t('compare.searchPlaceholder')} className="w-full pl-10 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-400" />
              </div>
            </div>
            <div className="overflow-y-auto p-4 space-y-2">
              {pickable.length === 0 ? (
                <p className="text-center text-gray-500 text-sm py-6">{t('compare.noMore')}</p>
              ) : pickable.slice(0, 20).map((p) => (
                <button type="button" key={p.id} onClick={() => { toggle(p.id); setModal(false); }} className="modal-pick w-full flex items-center gap-3 rounded-xl p-2.5 text-left">
                  <img src={p.image} alt="" className="w-16 h-12 rounded-lg object-cover flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-semibold truncate">{p.bhkNum ? p.bhkNum + ' BHK ' : ''}{p.type}</p>
                    <p className="text-gray-500 text-xs truncate">{p.locality}, {cityLabelFor(p)}</p>
                  </div>
                  <span className="text-teal-300 text-sm font-bold">{p.deal === 'rent' ? '₹' + (p.price || 0).toLocaleString('en-IN') + '/mo' : fmtINR(p.price)}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
