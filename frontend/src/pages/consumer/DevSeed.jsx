import { useState } from 'react';
import { FlaskConical, Sparkles, Check, Handshake, CircleDot, Lock, Database, Trash2, List, LayoutDashboard, CheckCircle2, ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';
import { seedNow, clearDemo, OWNER, getInventory } from '../../lib/data/devSeed.js';
import { digits } from '../../lib/contact.js';

function fmtPhone(mobile) {
  const d = digits(mobile);
  if (d.length === 10) return `${d.slice(0, 5)} ${d.slice(5)}`;
  return d;
}

export default function DevSeed() {
  const [result, setResult] = useState(null);
  const [inventory, setInventory] = useState([]);

  const handleSeed = () => {
    const count = seedNow();
    const inv = getInventory();
    setInventory(inv);
    setResult({ type: 'success', count });
  };

  const handleClear = () => {
    clearDemo();
    setInventory([]);
    setResult({ type: 'clear' });
  };

  const demoMob = digits(OWNER.mobile);
  const underOfferPropLink = `/property/${demoMob}/DEMO-UO-RENT?deal=rent`;

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <div className="mb-2 flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-400/15">
          <FlaskConical className="h-6 w-6 text-amber-300" />
        </div>
        <div>
          <h1 className="text-2xl font-extrabold">Test Data — Under Offer</h1>
          <p className="text-sm text-gray-400">
            Dev tool (prototype). Seeds a demo owner + sample listings into this browser so you can try the{' '}
            <b className="text-amber-300">Under Offer</b> flow end to end.
          </p>
        </div>
      </div>

      {import.meta.env.PROD && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <ShieldAlert className="mt-0.5 h-5 w-5 flex-shrink-0 text-rose-400" />
          <span>
            <b>Developer tool exposed in a production build.</b> It seeds/clears demo data in this browser. Guard
            <code className="mx-1 rounded bg-black/30 px-1">/dev-seed</code>behind a non-production flag or admin role before launch.
          </span>
        </div>
      )}

      <div className="pn-card mt-6 rounded-2xl p-5">
        <h2 className="mb-1 flex items-center gap-2 font-bold">
          <Sparkles className="h-4 w-4 text-teal-300" /> What this seeds
        </h2>
        <ul className="mt-3 space-y-1.5 text-sm text-gray-300">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-emerald-400" />
            Logs you in as a demo <b>owner</b> (Demo Owner · 90000 12345).
          </li>
          <li className="flex items-start gap-2">
            <Handshake className="mt-0.5 h-4 w-4 text-amber-400" />A <b>rent</b> listing in <b>Under Offer</b> with 2 trusted parties.
          </li>
          <li className="flex items-start gap-2">
            <Handshake className="mt-0.5 h-4 w-4 text-amber-400" />A <b>sale</b> listing in <b>Under Offer</b> with 1 party.
          </li>
          <li className="flex items-start gap-2">
            <CircleDot className="mt-0.5 h-4 w-4 text-teal-400" />
            An <b>active</b> rent listing (for contrast).
          </li>
          <li className="flex items-start gap-2">
            <Lock className="mt-0.5 h-4 w-4 text-rose-400" />A <b>sold</b> listing (hidden from public, shown in dashboard).
          </li>
        </ul>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <button
          onClick={handleSeed}
          className="btn btn-primary"
        >
          <Database className="h-4 w-4" /> Seed test data
        </button>
        <button
          onClick={handleClear}
          className="btn btn-secondary"
        >
          <Trash2 className="h-4 w-4" /> Clear demo data
        </button>
      </div>

      {result && (
        <div className="pn-card mt-5 rounded-2xl p-4 text-sm">
          {result.type === 'success' ? (
            <div className="flex items-start gap-2 text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-400" />
              <div>
                Seeded <b>{result.count}</b> listings as <b>{OWNER.name}</b> ({fmtPhone(OWNER.mobile)}).
                <br />
                Two are <b className="text-amber-300">Under Offer</b>. Open the Listings page or My Listings to verify.
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-gray-200">
              <Trash2 className="h-5 w-5 text-gray-400" /> Demo listings &amp; deals cleared for {fmtPhone(OWNER.mobile)}.
            </div>
          )}
        </div>
      )}

      {inventory.length > 0 && (
        <div className="pn-card mt-5 rounded-2xl p-4">
          <h3 className="mb-3 font-semibold text-gray-300">Current Inventory</h3>
          <div className="space-y-2 text-sm">
            {inventory.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 border-b border-white/5 pb-2 last:border-0">
                <div className="flex-1">
                  <div className="font-medium text-gray-200">{item.title}</div>
                  <div className="text-xs text-gray-400">{item.loc}</div>
                  <div className="mt-0.5 text-xs text-gray-500">
                    {item.bhk} BHK · {item.deal} · {item.price}
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                      item.status === 'Under Offer'
                        ? 'bg-amber-400/15 text-amber-300'
                        : item.status === 'Sold/Closed'
                        ? 'bg-rose-400/15 text-rose-300'
                        : 'bg-teal-400/15 text-teal-300'
                    }`}
                  >
                    {item.status}
                  </div>
                  {item.parties > 0 && <div className="mt-1 text-xs text-gray-500">{item.parties} parties</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <Link
          to="/listings?deal=rent"
          className="flex items-center justify-center gap-2 rounded-xl border border-teal-400/30 px-4 py-3 text-center font-semibold text-teal-200 transition hover:bg-teal-400/10"
        >
          <List className="h-4 w-4" /> Listings page
        </Link>
        <Link
          to="/dashboard#listings"
          className="flex items-center justify-center gap-2 rounded-xl border border-indigo-400/30 px-4 py-3 text-center font-semibold text-indigo-200 transition hover:bg-indigo-400/10"
        >
          <LayoutDashboard className="h-4 w-4" /> My Listings
        </Link>
        <Link
          to={underOfferPropLink}
          className="flex items-center justify-center gap-2 rounded-xl border border-amber-400/30 px-4 py-3 text-center font-semibold text-amber-200 transition hover:bg-amber-400/10"
        >
          <Handshake className="h-4 w-4" /> Under Offer property
        </Link>
      </div>
      <p className="mt-4 text-xs text-gray-500">
        Tip: on the <b>Listings</b> page your seeded homes show under the matching <b>Buy/Rent</b> tab with a "Your listing" tag; the
        Under Offer ones also carry an amber badge. Open one to finalize or release it.
      </p>
    </div>
  );
}
