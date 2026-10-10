import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import { SimilarProperties } from './SimilarProperties.jsx';

const listingsPathFor = (listing) => {
  if (!listing) return '/listings';
  const params = new URLSearchParams();
  if (listing.deal) params.set('deal', listing.deal);
  if (listing.localitySlug || listing.locality) params.set('loc', listing.localitySlug || listing.locality);
  const query = params.toString();
  return query ? `/listings?${query}` : '/listings';
};

export default function ListingUnavailable({ reason, listing = null, closedWord, tr }) {
  const location = useLocation();
  const navigate = useNavigate();
  const cameFromListings = String(location.state?.from || '').startsWith('/listings');

  const browseTo = useMemo(() => listingsPathFor(listing), [listing]);
  const isClosed = reason === 'closed';
  const title = isClosed
    ? tr('property.dealClosedTitle', { word: closedWord })
    : tr('property.notFound');
  const body = isClosed
    ? tr('property.propertyBeenSub', { word: closedWord })
    : tr('property.notFoundRecoveryBody');

  return (
    <div className="mx-auto max-w-5xl px-4 py-28 sm:py-32">
      <div className="mx-auto max-w-2xl text-center">
        <Icon name={isClosed ? 'lock' : 'home'} className="w-11 h-11 text-slate-400 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
        <p className="text-gray-400 text-sm">{body}</p>
        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3">
          {cameFromListings ? (
            <button type="button" onClick={() => navigate(-1)} className="btn-teal min-h-[44px] inline-flex items-center justify-center gap-2 px-5 text-sm font-semibold">
              <Icon name="arrow-left" className="w-4 h-4" /> {tr('property.backToResults')}
            </button>
          ) : (
            <Link to={browseTo} className="btn-teal min-h-[44px] inline-flex items-center justify-center gap-2 px-5 text-sm font-semibold">
              <Icon name="arrow-left" className="w-4 h-4" /> {tr('property.backToResults')}
            </Link>
          )}
          {browseTo !== '/listings' ? (
            <Link to="/listings" className="min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 px-5 text-sm font-semibold text-slate-200 hover:bg-white/5">
              <Icon name="search" className="w-4 h-4" /> {tr('property.browseListings')}
            </Link>
          ) : null}
        </div>
      </div>
      {isClosed && listing ? (
        <div className="mt-12">
          <SimilarProperties p={listing} />
        </div>
      ) : null}
    </div>
  );
}
