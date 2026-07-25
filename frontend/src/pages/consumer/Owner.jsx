import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router';
import Icon from '../../components/Icon.jsx';
import Loading from '../../components/ui/Loading.jsx';
import { getOwner } from '../../lib/mockApi.js';
import { fmtINR, timeAgo, avatarFor } from '../../lib/format.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { contactStatus, requestContact, maskPhone, fmtPhone, digits, ownerHidesNumber } from '../../lib/contact.js';
import { getEntityReviews, addEntityReview } from '../../lib/store.js';
import { queueOwnerChat, messagesLinkForProp } from '../../lib/chat.js';
import ReportModal, { OWNER_REPORT_REASONS } from '../../components/ReportModal.jsx';

const SEED_REVIEWS = [
  { id: 'seed1', n: 'Priya Kulkarni', a: 'PK', d: '2 weeks ago', r: 5, t: 'Dealt directly with the owner — completely transparent, no brokerage at all. Answered every question and the flat was exactly as listed.' },
  { id: 'seed2', n: 'Rohit More', a: 'RM', d: '1 month ago', r: 5, t: 'Quick to respond on WhatsApp and very flexible with visit timings. Smooth, honest owner.' },
  { id: 'seed3', n: 'Sneha Deshpande', a: 'SD', d: '2 months ago', r: 4, t: 'Genuine owner with verified documents. Saved a lot by avoiding broker commission.' },
];

const mapStored = (r) => ({ id: r.id, n: r.user || 'User', a: avatarFor(r.user || 'U'), d: timeAgo(r.at), r: +r.rating || 0, t: r.text || '' });

function Stars({ r, cls = 'w-3.5 h-3.5' }) {
  return (
    <>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" className={`${cls} ${i <= r ? 'text-amber-400 fill-amber-400' : 'text-gray-600'}`} />
      ))}
    </>
  );
}

function ReviewCard({ v }) {
  return (
    <div className="border-b border-white/5 pb-4 last:border-0">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white font-bold text-xs">{v.a}</div>
        <div className="flex-1"><p className="text-white text-sm font-medium">{v.n}</p><div className="flex gap-0.5"><Stars r={v.r} /></div></div>
        <span className="text-gray-500 text-xs">{v.d}</span>
      </div>
      <p className="text-gray-400 text-sm leading-relaxed">{v.t}</p>
    </div>
  );
}

export default function Owner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [owner, setOwner] = useState(undefined);
  const [reviews, setReviews] = useState(SEED_REVIEWS);
  const [picked, setPicked] = useState(0);
  const [hover, setHover] = useState(0);
  const [revText, setRevText] = useState('');
  const [reported, setReported] = useState(false);
  const [status, setStatus] = useState('none');
  const { isIn } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    let alive = true;
    setOwner(undefined);
    getOwner(id).then((r) => alive && setOwner(r));
    return () => { alive = false; };
  }, [id]);

  useEffect(() => {
    setReviews([...getEntityReviews('owner', id).map(mapStored), ...SEED_REVIEWS]);
  }, [id]);

  useEffect(() => {
    if (owner && owner.mobile) setStatus(contactStatus(owner.mobile, ''));
  }, [owner]);

  const initials = useMemo(() => (owner ? (owner.name || 'A').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : ''), [owner]);

  if (owner === undefined) return <Loading />;
  if (!owner) return (
    <div className="mx-auto max-w-3xl px-4 py-32 text-center">
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto mb-4"><Icon name="user-search" className="w-6 h-6 text-gray-500" /></div>
      <h1 className="text-xl font-bold text-white">Owner not found</h1>
      <p className="text-gray-400 text-sm mt-1.5">This profile may have been removed or the link is incorrect.</p>
      <Link to="/listings" className="btn-teal inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-semibold mt-5"><Icon name="search" className="w-4 h-4" /> Browse listings</Link>
    </div>
  );

  const memberSince = (owner.joinedAt || '2024').slice(0, 4);
  const masked = maskPhone(owner.mobile);
  const ownerHides = status === 'approved' && ownerHidesNumber(owner.mobile);
  const revealed = status === 'owner' || (status === 'approved' && !ownerHides);

  const latestListing = owner.listings?.length ? [...owner.listings].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] : null;
  const waText = `Hi ${(owner.name || '').split(' ')[0] || 'there'}, I saw your profile on PuneNest and I'm interested in your listings. Are they still available?`;
  const revCount = reviews.length;
  const revAvg = revCount ? Math.round((reviews.reduce((s, v) => s + v.r, 0) / revCount) * 10) / 10 : 0;
  const dist = [5, 4, 3, 2, 1].map((s) => reviews.filter((v) => v.r === s).length);
  const maxDist = Math.max(1, ...dist);

  const postReview = () => {
    if (!isIn) { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
    if (!picked) { toast('Please add a star rating', 'error'); return; }
    if (!revText.trim()) { toast('Please write a short comment', 'error'); return; }
    const saved = addEntityReview('owner', id, { rating: picked, text: revText.trim() });
    if (saved === 'login') { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname)}`); return; }
    setReviews((r) => [{ id: saved.id, n: saved.user, a: avatarFor(saved.user), d: 'Today', r: picked, t: revText.trim() }, ...r]);
    setRevText('');
    setPicked(0);
    toast('Thanks! Your review has been posted.', 'success');
  };

  const requestNumber = () => {
    if (!isIn) {
      navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }
    const res = requestContact(owner.mobile, '');
    if (res === 'aadhaar_required') { toast('Please verify your identity with Aadhaar OTP before contacting owners. Go to List Property to complete verification.', 'error'); return; }
    setStatus(contactStatus(owner.mobile, ''));
    if (res === 'pending') toast("Request sent — you'll get the number once the owner approves.", 'success');
    else if (res === 'approved') toast('Owner has shared their number with you.', 'success');
    else if (res === 'declined') toast('The owner declined your request.', 'info');
  };

  const messageOwner = () => {
    if (!isIn) { navigate(`/signin?reason=contact&next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return; }
    if (latestListing) {
      queueOwnerChat(latestListing, { firstMessage: waText });
      navigate(messagesLinkForProp(latestListing));
    } else {
      navigate('/contact');
    }
  };

  const scheduleHref = () => {
    const qp = new URLSearchParams();
    if (owner.mobile) qp.set('o', digits(owner.mobile));
    if (latestListing) { qp.set('listing', latestListing.id); if (latestListing.title) qp.set('title', latestListing.title); }
    const qs = qp.toString();
    return '/schedule-visit' + (qs ? `?${qs}` : '');
  };

  return (
    <div>
      <main className="pb-24 lg:pb-20 min-h-[100dvh]">
        <div className="cover h-44 sm:h-52 relative">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 20% 30%,rgba(255,255,255,.3) 0,transparent 40%),radial-gradient(circle at 80% 60%,rgba(20,184,166,.4) 0,transparent 40%)' }} />
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Profile header */}
          <div className="glass-card rounded-2xl p-6 -mt-16 relative">
            <button onClick={() => setReported(true)} type="button" aria-label="Report this owner" className="sm:hidden absolute top-4 right-4 w-9 h-9 rounded-xl border border-white/10 text-gray-400 flex items-center justify-center hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 transition-all"><Icon name="flag" className="w-4 h-4" /></button>
            <div className="flex flex-col sm:flex-row sm:items-end gap-5">
              <div className="w-28 h-28 rounded-2xl bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center text-white text-4xl font-bold border-4 border-[#0f0d1a] -mt-16 sm:-mt-20 flex-shrink-0">{initials}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold text-white">{owner.name}</h1>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-teal-500/15 border border-teal-500/25 text-teal-300 text-xs font-medium"><Icon name="badge-check" className="w-3.5 h-3.5" /> Verified Owner</span>
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="hand-coins" className="w-3.5 h-3.5" /> Zero Brokerage</span>
                </div>
                <p className="text-gray-400 text-sm mt-1">Property Owner · Direct dealing, no middlemen</p>
                <div className="flex items-center gap-4 mt-2 text-sm">
                  <span className="flex items-center gap-1 text-amber-400"><Icon name="star" className="w-4 h-4 fill-amber-400" /> {revCount ? revAvg.toFixed(1) : '—'} <span className="text-gray-500">({revCount} review{revCount === 1 ? '' : 's'})</span></span>
                  <span className="flex items-center gap-1 text-gray-400"><Icon name="map-pin" className="w-4 h-4 text-teal-400" /> {owner.city || 'Pune'}</span>
                </div>
              </div>
              <div className="hidden sm:flex gap-2.5 flex-wrap">
                {revealed ? (
                  <>
                    <a href={`tel:+91${digits(owner.mobile)}`} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/5 flex items-center gap-2"><Icon name="phone" className="w-4 h-4 text-teal-400" /> Call</a>
                    <a href={`https://wa.me/91${digits(owner.mobile)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" className="px-4 py-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/10 flex items-center gap-2"><Icon name="message-circle" className="w-4 h-4" /> WhatsApp</a>
                  </>
                ) : (
                  <>
                    <button onClick={requestNumber} className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-200 text-sm font-medium hover:bg-white/5 flex items-center gap-2"><Icon name="phone" className="w-4 h-4 text-teal-400" /> Call</button>
                    <button onClick={requestNumber} className="px-4 py-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 text-sm font-medium hover:bg-emerald-500/10 flex items-center gap-2"><Icon name="message-circle" className="w-4 h-4" /> WhatsApp</button>
                  </>
                )}
                <button onClick={messageOwner} type="button" className="btn-teal px-4 py-2.5 rounded-xl text-white text-sm font-semibold flex items-center gap-2"><Icon name="send" className="w-4 h-4" /> Message</button>
                <button onClick={() => setReported(true)} type="button" className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm font-medium hover:bg-rose-500/10 hover:text-rose-300 hover:border-rose-500/30 flex items-center gap-2 transition-all"><Icon name="flag" className="w-4 h-4" /> Report</button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-white/10">
              <div><p className="text-2xl font-bold gradient-text">{owner.listings?.length || 0}</p><p className="text-gray-500 text-xs">Properties Listed</p></div>
              <div><p className="text-2xl font-bold gradient-text">{memberSince}</p><p className="text-gray-500 text-xs">Member Since</p></div>
              <div><p className="text-2xl font-bold gradient-text">100%</p><p className="text-gray-500 text-xs">Verified Listings</p></div>
              <div><p className="text-2xl font-bold gradient-text">~2 hrs</p><p className="text-gray-500 text-xs">Avg. Response Time</p></div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 mt-6">
            <div className="space-y-6">
              {/* About */}
              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white mb-3">About the Owner</h2>
                <p className="text-gray-400 text-sm leading-relaxed">{owner.name} is a verified property owner listing directly on PuneNest. No brokers, no commission — you deal with the owner directly from enquiry to handover.</p>
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="user-check" className="w-3.5 h-3.5" /> Verified Owner</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-xs font-medium"><Icon name="scroll-text" className="w-3.5 h-3.5" /> Ownership Verified</span>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/15 text-gray-300 text-xs font-medium"><Icon name="phone-off" className="w-3.5 h-3.5" /> Number Protected</span>
                </div>
              </div>

              {/* Listings */}
              <div className="glass-card rounded-2xl p-6">
                <div className="flex items-center justify-between mb-5">
                  <h2 className="text-lg font-bold text-white">Properties by this Owner</h2>
                  <Link to="/listings" className="text-teal-400 text-sm hover:text-teal-300">View all</Link>
                </div>
                {owner.listings?.length ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {owner.listings.map((p) => (
                      <Link key={p.id} to={`/property/${p.id}`} className="prop-row rounded-xl overflow-hidden block group">
                        <div className="h-32 overflow-hidden"><img src={p.image} className="w-full h-full object-cover" alt="" /></div>
                        <div className="p-3">
                          <p className="text-white font-bold text-sm">{p.deal === 'rent' ? '₹' + (p.price || 0).toLocaleString('en-IN') + '/mo' : fmtINR(p.price)}</p>
                          <p className="text-gray-400 text-xs group-hover:text-teal-400 transition-colors">{p.bhkNum ? p.bhkNum + ' BHK ' : ''}{p.type}</p>
                          <p className="text-gray-500 text-[11px] flex items-center gap-1 mt-0.5"><Icon name="map-pin" className="w-3 h-3 text-teal-400" />{p.locality}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">This owner has no active listings.</p>
                )}
              </div>

              {/* Reviews */}
              <div className="glass-card rounded-2xl p-6">
                <h2 className="text-lg font-bold text-white mb-1">Reviews &amp; Ratings</h2>
                <p className="text-gray-500 text-xs mb-5">From buyers &amp; tenants who dealt with this owner directly.</p>
                <div className="flex flex-col sm:flex-row gap-6 mb-6">
                  <div className="text-center sm:border-r border-white/10 sm:pr-6">
                    <p className="text-5xl font-extrabold gradient-text">{revCount ? revAvg.toFixed(1) : '—'}</p>
                    <div className="flex justify-center gap-0.5 my-2"><Stars r={Math.round(revAvg)} cls="w-4 h-4" /></div>
                    <p className="text-gray-500 text-xs">{revCount ? `${revCount} review${revCount === 1 ? '' : 's'}` : 'No reviews yet'}</p>
                  </div>
                  <div className="flex-1 space-y-1.5">
                    {[5, 4, 3, 2, 1].map((s, i) => (
                      <div key={s} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-400 w-3">{s}</span><Icon name="star" className="w-3 h-3 text-amber-400 fill-amber-400" />
                        <div className="flex-1 h-1.5 rounded-full bg-white/10"><div className="h-1.5 rounded-full bg-amber-400" style={{ width: `${(dist[i] / maxDist) * 100}%` }} /></div>
                        <span className="text-gray-500 w-6 text-right">{dist[i]}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="bg-white/[0.04] border border-white/10 rounded-xl p-4 mb-5">
                  <p className="text-sm font-medium text-white mb-2">Rate your experience with this owner</p>
                  <div className="star-pick flex gap-1 mb-3" onMouseLeave={() => setHover(0)}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <button key={i} type="button" onMouseEnter={() => setHover(i)} onClick={() => setPicked(i)} aria-label={`${i} star`}>
                        <Icon name="star" className={'w-6 h-6 ' + (i <= (hover || picked) ? 'text-amber-400 fill-amber-400' : 'text-gray-600')} />
                      </button>
                    ))}
                  </div>
                  <textarea rows={2} value={revText} onChange={(e) => setRevText(e.target.value)} placeholder="Share your experience..." className="field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 resize-none mb-3" />
                  <button onClick={postReview} className="btn-teal px-5 py-2.5 rounded-xl text-white text-sm font-semibold">Post Review</button>
                </div>
                <div className="space-y-4">
                  {reviews.map((v) => <ReviewCard key={v.id} v={v} />)}
                </div>
              </div>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              <div className="glass-card rounded-2xl p-6 sticky top-24">
                <div className="flex items-center gap-2 px-3 py-2 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <Icon name="hand-coins" className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs text-emerald-300 font-medium">No brokerage. Deal directly.</span>
                </div>
                <h3 className="text-white font-bold mb-4">Contact owner directly</h3>
                <div className="space-y-2.5">
                  {revealed ? (
                    <>
                      <a href={`tel:+91${digits(owner.mobile)}`} className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-200 text-sm hover:bg-white/5 transition-all"><Icon name="phone" className="w-4 h-4 text-teal-400" /> {fmtPhone(owner.mobile)}</a>
                      <a href={`https://wa.me/91${digits(owner.mobile)}`} target="_blank" rel="noopener noreferrer" className="hidden lg:flex items-center gap-3 py-3 px-4 mt-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 text-sm hover:bg-emerald-500/10 transition-all"><Icon name="message-circle" className="w-4 h-4" /> Chat on WhatsApp</a>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-300 text-sm"><Icon name="phone-off" className="w-4 h-4 text-gray-500" /> <span className="tracking-wider">{masked}</span></div>
                      {ownerHides ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-300 font-medium px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20"><Icon name="message-circle" className="w-3.5 h-3.5" /> Approved — owner prefers in-app chat</span>
                      ) : status === 'pending' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-amber-300 font-medium px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20"><Icon name="clock" className="w-3.5 h-3.5" /> Request sent — awaiting owner</span>
                      ) : status === 'declined' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-gray-400 font-medium px-3 py-1.5 rounded-lg bg-white/5 border border-white/10"><Icon name="x-circle" className="w-3.5 h-3.5" /> Owner declined the request</span>
                      ) : (
                        <>
                          <p className="text-gray-500 text-xs mt-2 mb-2.5">Number hidden for the owner's privacy.</p>
                          <div className="hidden lg:block"><button onClick={requestNumber} className="btn-teal inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-sm font-semibold"><Icon name="lock-keyhole" className="w-4 h-4" /> Request number</button></div>
                        </>
                      )}
                    </>
                  )}
                  <a href="mailto:hello@punenest.com" className="flex items-center gap-3 py-3 px-4 rounded-xl border border-white/10 text-gray-200 text-sm hover:bg-white/5 transition-all"><Icon name="mail" className="w-4 h-4 text-teal-400" /> Email PuneNest support</a>
                  <div className={(revealed ? '' : 'hidden lg:block ') + 'mt-1'}><Link to={scheduleHref()} className="btn-teal flex items-center justify-center gap-2 py-3 rounded-xl text-white text-sm font-semibold"><Icon name="calendar-check" className="w-4 h-4" /> Schedule a Visit</Link></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <div className="pn-sticky-cta lg:hidden">
        {revealed ? (
          <>
            <a href={`tel:+91${digits(owner.mobile)}`} className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="phone" className="w-4 h-4" /> Call</a>
            <a href={`https://wa.me/91${digits(owner.mobile)}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold py-3 px-4"><Icon name="message-circle" className="w-4 h-4" /> WhatsApp</a>
          </>
        ) : (
          <>
            {status === 'none' ? (
              <button onClick={requestNumber} className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="lock-keyhole" className="w-4 h-4" /> Request number</button>
            ) : (
              <button onClick={messageOwner} type="button" className="btn-teal flex-1 min-h-[44px] flex items-center justify-center gap-1.5 text-sm font-semibold py-3 px-4"><Icon name="send" className="w-4 h-4" /> Message</button>
            )}
            <Link to={scheduleHref()} className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border border-white/15 text-slate-200 text-sm font-semibold py-3 px-4"><Icon name="calendar-check" className="w-4 h-4" /> Visit</Link>
          </>
        )}
      </div>

      {reported && (
        <ReportModal
          target={{ id: '', title: owner.name, ownerName: owner.name, ownerMobile: owner.mobile }}
          kind="user"
          reasons={OWNER_REPORT_REASONS}
          title="Report this owner"
          subtitle="Our team reviews every report and keeps it confidential."
          success="Thanks for flagging this. Our team will review this owner."
          onClose={() => setReported(false)}
          toast={toast}
        />
      )}
    </div>
  );
}