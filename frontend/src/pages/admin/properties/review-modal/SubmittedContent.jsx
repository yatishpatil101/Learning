import { Image as ImageIcon, MapPin, FileText } from 'lucide-react';

/* Verbatim, because the details grid can only say a field was filled in: deciding whether a listing is real
   means reading the prose, and a pending listing has no public page to read it on. */

const unitLine = (details) => {
  if (!details) return null;
  const parts = [details.flatNumber, details.tower, details.society, details.street, details.landmark]
    .filter((p) => typeof p === 'string' && p.trim());
  return parts.length ? parts.join(', ') : null;
};

const block = 'rounded-2xl border border-white/10 bg-white/[0.03] p-4';
const heading = 'mb-3 flex items-center gap-2 text-sm font-bold text-gray-200';
const dtClass = 'text-[11px] font-semibold uppercase tracking-wide text-gray-400';
/* The map pin's value is a coordinate pair and a link, never a run of owner prose, so it is the one
   line here that does not want `break-words`. */
const ddClass = 'break-words font-semibold text-gray-100';

/* The gallery is owner-supplied text that this panel turns into an `href` and an `img src`, and the
   reviewer opening it is staff. A `javascript:` or `data:` entry would run in the console's origin
   on click, so only the one scheme a photograph can legitimately arrive over is honoured; a
   relative path resolves against our own origin and is fine. Anything else is shown as the raw
   string, which is also the more useful thing for a reviewer to see.

   `https:` only, deliberately, even though an `http:` image is merely broken rather than dangerous:
   the page CSP already refuses to load one, so honouring it here produces an `<a>` a reviewer can
   click through to a plaintext address while the thumbnail beside it stays empty — the one
   presentation that invites a click and shows nothing to judge it by. */
const safePhotoUrl = (src) => {
  if (typeof src !== 'string' || !src.trim()) return null;
  try {
    return new URL(src, window.location.origin).protocol === 'https:' ? src : null;
  } catch {
    return null;
  }
};

export function SubmittedPhotos({ listing }) {
  const photos = Array.isArray(listing.gallery) ? listing.gallery.filter(Boolean) : [];
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
                  alt={`Submitted photo ${i + 1} of ${listing.title || 'this listing'}`}
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

export function SubmittedLocation({ listing }) {
  const unit = unitLine(listing.formDetails);
  const hasPin = Number.isFinite(listing.lat) && Number.isFinite(listing.lng);
  return (
    <div className={block}>
      <h4 className={heading}><MapPin className="h-4 w-4 text-brand-teal" /> Location</h4>
      <dl className="space-y-2 text-sm">
        {unit ? (
          <div>
            <dt className={dtClass}>Unit</dt>
            <dd className={ddClass}>{unit}</dd>
          </div>
        ) : null}
        <div>
          <dt className={dtClass}>Address</dt>
          <dd className={ddClass}>{listing.address || <span className="text-amber-300">Not submitted</span>}</dd>
        </div>
        <div>
          <dt className={dtClass}>Locality {'\u00B7'} city {'\u00B7'} PIN</dt>
          <dd className={ddClass}>
            {[listing.locality, listing.city, listing.pincode].filter(Boolean).join(' \u00B7 ') || '\u2014'}
          </dd>
        </div>
        <div>
          <dt className={dtClass}>Map pin</dt>
          <dd className="font-semibold text-gray-100">
            {hasPin ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${listing.lat},${listing.lng}`}
                target="_blank"
                rel="noreferrer"
                className="text-teal-300 underline underline-offset-2"
              >
                {listing.lat.toFixed(5)}, {listing.lng.toFixed(5)}
              </a>
            ) : (
              <span className="text-amber-300">No pin placed</span>
            )}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[11px] text-gray-500">
        Address and unit details are staff-only and are never shown on the public listing.
      </p>
    </div>
  );
}
