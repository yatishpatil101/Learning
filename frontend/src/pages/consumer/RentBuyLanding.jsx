import '../../styles/routes/filters.css';
import '../../styles/routes/listings.css';
import { Link, useParams } from 'react-router';
import Icon from '../../components/Icon.jsx';
import usePageHead from '../../lib/usePageHead.js';
import { toFacetQuery } from '../../lib/listings/facetQuery.js';
import { expandBhkToken } from '../../lib/listings/bhkOptions.js';
import { INITIAL } from '../../lib/listings/filterState.js';
import {
  LANDING_BHKS, PUNE, isIndexable, landingCopy, landingPath, listingsUrl, parseLanding,
} from '../../lib/landingPages.js';
import Stub from '../Stub.jsx';
import Card from './listings/Card.jsx';
import useListingsSearch from './listings/useListingsSearch.js';

const SIZE = 24;
const chip = 'rounded-full border border-white/10 px-3 py-1.5 text-sm text-gray-300 hover:border-teal-400/40 hover:text-teal-300';
const chipOn = 'rounded-full border border-teal-400/50 bg-teal-400/10 px-3 py-1.5 text-sm font-semibold text-teal-300';

function Landing({ target }) {
  const { deal, place, bhk } = target;
  const copy = landingCopy(target);
  const path = landingPath(deal, place.slug, bhk);
  const otherDeal = deal === 'rent' ? 'buy' : 'rent';
  const query = toFacetQuery({
    ...INITIAL(deal),
    localities: new Set(place === PUNE ? [] : [place.slug]),
    bhk: new Set(bhk ? expandBhkToken(String(bhk), deal) : []),
  });
  const { data, status, retry } = useListingsSearch({ query, page: 1, size: SIZE });
  const ready = status === 'ready';
  usePageHead({ title: copy.title, description: copy.description, path, noindex: ready && !isIndexable(target, data.total) });

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500">
        <Link to="/" className="hover:text-teal-300">Home</Link> › <Link to={landingPath(deal)} className="hover:text-teal-300">{deal === 'rent' ? 'Rent' : 'Buy'}</Link>
        {place !== PUNE && <> › <Link to={landingPath(deal, place.slug)} className="hover:text-teal-300">{place.name}</Link></>}
      </nav>
      <h1 className="mt-3 text-[1.6rem] font-extrabold leading-tight text-white sm:text-4xl">{copy.h1}</h1>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-gray-400">{copy.intro.join(' ')}</p>

      {place !== PUNE && (
        <div className="mt-4 flex flex-wrap gap-2" aria-label="Home size">
          <Link to={landingPath(deal, place.slug)} className={bhk ? chip : chipOn}>All sizes</Link>
          {LANDING_BHKS.map((n) => <Link key={n} to={landingPath(deal, place.slug, n)} className={n === bhk ? chipOn : chip}>{n} BHK</Link>)}
        </div>
      )}

      <div className="mt-5">
        {status === 'loading' && !data.items.length && <p className="text-sm text-gray-400" role="status">Loading homes…</p>}
        {status === 'error' && (
          <p className="text-sm text-gray-300" role="alert">
            We could not load homes right now. <button type="button" onClick={retry} className="font-semibold text-teal-400 underline">Try again</button>
          </p>
        )}
        {ready && !data.items.length && (
          <p className="text-sm text-gray-400">No homes are listed here right now. Try <Link to={listingsUrl({ deal, place: PUNE })} className="text-teal-400 hover:underline">all of Pune</Link> or another area below.</p>
        )}
        {data.items.length > 0 && (
          <>
            <p className="mb-4 text-sm text-gray-400">{data.total === 1 ? '1 home listed' : `${data.total} homes listed`}</p>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {data.items.map((p, i) => <Card key={p.id} p={p} index={i} />)}
            </div>
          </>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
        <Link to={listingsUrl(target)} className="dz-btn dz-btn-primary">{data.total > data.items.length ? `See all ${data.total} homes` : 'More filters'}</Link>
        {place !== PUNE && <Link to={`/locality/${place.slug}`} className="text-teal-400 hover:underline">{place.name} area guide</Link>}
        <Link to={landingPath(otherDeal, place.slug, bhk)} className="text-teal-400 hover:underline">
          <Icon name="arrow-right" aria-hidden="true" className="mr-1 inline h-4 w-4" />Homes for {otherDeal === 'rent' ? 'rent' : 'sale'} in {copy.where}
        </Link>
      </div>
    </div>
  );
}

export default function RentBuyLanding({ deal }) {
  const { place, bhk } = useParams();
  const target = parseLanding(deal, bhk === undefined ? [place] : [place, bhk]);
  return target ? <Landing target={target} /> : <Stub title="Page not found" />;
}
