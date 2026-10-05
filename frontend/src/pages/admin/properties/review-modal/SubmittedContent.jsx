import { ExternalLink, Image as ImageIcon, MapPin, FileText } from 'lucide-react';
import { titleCase } from '../../societies/helpers.jsx';

/* Verbatim, because the details grid can only say a field was filled in: deciding whether a listing is real
   means reading the prose, and a pending listing has no public page to read it on. */

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const joined = (...parts) => parts.map(text).filter(Boolean).join(', ');

const block = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
const heading = 'mb-3 flex items-center gap-2 text-sm font-bold text-gray-200';
const dtClass = 'text-[11px] text-gray-500';
const ddClass = 'mt-0.5 break-words text-sm font-semibold text-gray-100';
const missing = <span className="font-medium text-amber-300">Not given</span>;

/** Owner-supplied gallery text becomes `href` and `img src`, so only https or same-origin is allowed. */
const safePhotoUrl = (src) => {
  if (typeof src !== 'string' || !src.trim()) return null;
  try {
    const url = new URL(src, window.location.origin);
    return url.protocol === 'https:' || url.origin === window.location.origin ? src : null;
  } catch {
    return null;
  }
};

export function SubmittedPhotos({ listing }) {
  const photos = Array.isArray(listing.gallery) && listing.gallery.filter(Boolean).length
    ? listing.gallery.filter(Boolean)
    : [listing.image].filter(Boolean);
  return (
    <div className={block}>
      <h4 className={heading}>
        <ImageIcon className="h-4 w-4 text-brand-teal" /> Photos
        <span className="text-xs font-normal text-gray-400">{photos.length}</span>
      </h4>
      {photos.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {photos.map((raw, i) => {
            const src = safePhotoUrl(raw);
            /* Keyed by position: nothing dedupes the gallery on the way in, and the list is never reordered
               or re-sliced while open, so the index is the honest key. */
            if (!src) {
              return (
                <p key={i} className="break-all rounded-xl border border-amber-400/30 bg-amber-400/5 p-2 text-xs text-amber-300">
                  Not a usable photo address: {String(raw)}
                </p>
              );
            }
            return (
              <a key={i} href={src} target="_blank" rel="noreferrer" className="group block overflow-hidden rounded-xl border border-white/10">
                <img
                  src={src}
                  alt={`Submitted ${i + 1} of ${listing.title || 'this listing'}`}
                  loading="lazy"
                  className="h-28 w-full object-cover transition group-hover:scale-105"
                />
              </a>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-amber-300">No photos submitted.</p>
      )}
    </div>
  );
}

export function SubmittedDescription({ listing }) {
  const text = typeof listing.desc === 'string' ? listing.desc.trim() : '';
  return (
    <div className={block}>
      <h4 className={heading}><FileText className="h-4 w-4 text-brand-teal" /> Description</h4>
      {text ? (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-gray-200">{text}</p>
      ) : (
        <p className="text-sm text-amber-300">No description submitted.</p>
      )}
    </div>
  );
}

function Row({ label, value, wide }) {
  return (
    <div className={wide ? 'col-span-full' : undefined}>
      <dt className={dtClass}>{label}</dt>
      <dd className={ddClass}>{value || missing}</dd>
    </div>
  );
}

export function SubmittedLocation({ listing }) {
  const d = listing.formDetails || {};
  const society = text(d.society) || (listing.societySlug ? titleCase(listing.societySlug) : '');
  const unit = joined(d.flatNumber, d.tower);
  const near = joined(d.street, d.landmark);
  /* The map pin is coordinates plus a Google Maps link, never owner prose. */
  const hasPin = Number.isFinite(listing.lat) && Number.isFinite(listing.lng);
  return (
    <div className={block}>
      <h4 className={heading}><MapPin className="h-4 w-4 text-brand-teal" /> Location</h4>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        <Row wide label="Address" value={text(listing.address)} />
        {society ? <Row label="Society / building" value={society} /> : null}
        {unit ? <Row label="Flat / tower" value={unit} /> : null}
        {near ? <Row label="Street / landmark" value={near} /> : null}
        <Row label="Locality" value={listing.locality} />
        <Row label="City" value={listing.city} />
        <Row label="PIN code" value={text(listing.pincode)} />
        <div className="col-span-full">
          <dt className={dtClass}>Map pin</dt>
          <dd className="mt-0.5 text-sm">
            {hasPin ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${listing.lat},${listing.lng}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 font-semibold text-teal-300 hover:text-teal-200"
              >
                Open in Google Maps <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="font-normal tabular-nums text-gray-500">{listing.lat.toFixed(5)}, {listing.lng.toFixed(5)}</span>
              </a>
            ) : (
              <span className="font-medium text-amber-300">No pin placed</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-gray-500">Address and unit are staff-only, never shown publicly.</p>
    </div>
  );
}
