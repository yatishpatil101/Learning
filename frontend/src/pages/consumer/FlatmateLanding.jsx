import '../../styles/routes/filters.css';
import '../../styles/routes/flatmates.css';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useSignInGate } from '../../lib/useSignInGate.js';
import usePageHead from '../../lib/usePageHead.js';
import { MIN_INDEXABLE, flatmateCopy, flatmatePath, isWomenOnly, landingPath, parseFlatmateLanding } from '../../lib/landingPages.js';
import * as flatmateService from '../../services/flatmateService.js';
import Stub from '../Stub.jsx';
import GroupCard from './flatmates/GroupCard.jsx';
import RoomCard from './flatmates/RoomCard.jsx';
import { emptyFilters } from './flatmates/useFlatmateDiscovery.jsx';
import useFlatmatesSearch from './flatmates/useFlatmatesSearch.js';

const SIZE = 24;
// The feed has no strict women-only filter, so that page reads one larger page and picks the matches itself.
const WOMEN_SIZE = 50;
const SAVE_KIND = { r: 'room', g: 'group' };

function Landing({ target }) {
  const { women, place } = target;
  const copy = flatmateCopy(target);
  const rootRef = useScrollReveal([]);
  const { user } = useAuth();
  const { toast } = useToast();
  const sendToSignIn = useSignInGate();
  const [saved, setSaved] = useState({});
  const filters = { ...emptyFilters, ...(women ? { gender: 'female' } : { locality: place.name }) };
  const { items, total, status, loaded, retry } = useFlatmatesSearch({ filters, size: women ? WOMEN_SIZE : SIZE });

  const shown = (women ? items.filter(isWomenOnly) : items).slice(0, SIZE);
  const count = women ? items.filter(isWomenOnly).length : total;
  usePageHead({ title: copy.title, description: copy.description, path: flatmatePath(target), noindex: loaded && count < MIN_INDEXABLE.flatmates });

  const onSave = async (key) => {
    if (!user) { sendToSignIn('save'); return; }
    const on = !saved[key];
    setSaved((m) => ({ ...m, [key]: on }));
    try {
      const kind = SAVE_KIND[key[0]];
      const id = key.slice(2);
      await (on ? flatmateService.saveFlatmatePost(kind, id) : flatmateService.unsaveFlatmatePost(kind, id));
    } catch {
      setSaved((m) => ({ ...m, [key]: !on }));
      toast('Could not update your saved list. Please try again.', 'error');
    }
  };

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <nav aria-label="Breadcrumb" className="text-xs text-gray-500">
        <Link to="/" className="hover:text-teal-300">Home</Link> › <Link to="/flatmates" className="hover:text-teal-300">Flatmates</Link>
      </nav>
      <h1 className="mt-3 text-[1.6rem] font-extrabold leading-tight text-white sm:text-4xl">{copy.h1}</h1>
      <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-gray-400">{copy.intro.join(' ')}</p>

      <div className="mt-5">
        {status === 'error' && (
          <p className="text-sm text-gray-300" role="alert">
            We could not load posts right now. <button type="button" onClick={retry} className="font-semibold text-teal-400 underline">Try again</button>
          </p>
        )}
        {status !== 'error' && !loaded && <p className="text-sm text-gray-400" role="status">Loading posts…</p>}
        {loaded && !shown.length && <p className="text-sm text-gray-400">No posts here right now. The full flatmates board may have more.</p>}
        {shown.length > 0 && (
          <>
            <p className="mb-4 text-sm text-gray-400">{count === 1 ? '1 post' : `${count} posts`}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
              {shown.map((item, i) => (item.kind === 'group'
                ? <GroupCard key={`g:${item.id}`} anchorId={`g:${item.id}`} g={item} i={i} saved={!!saved[`g:${item.id}`]} onSave={onSave} />
                : <RoomCard key={`r:${item.id}`} anchorId={`r:${item.id}`} r={item} i={i} saved={!!saved[`r:${item.id}`]} onSave={onSave} />))}
            </div>
          </>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
        <Link to="/flatmates" className="dz-btn dz-btn-primary">See all flatmate posts</Link>
        {!women && <Link to={`/locality/${place.slug}`} className="text-teal-400 hover:underline">{place.name} area guide</Link>}
        {!women && <Link to={landingPath('rent', place.slug)} className="text-teal-400 hover:underline">Homes for rent in {place.name}</Link>}
      </div>
    </div>
  );
}

export default function FlatmateLanding() {
  const { place } = useParams();
  const target = parseFlatmateLanding(place);
  return target ? <Landing target={target} /> : <Stub title="Page not found" />;
}
