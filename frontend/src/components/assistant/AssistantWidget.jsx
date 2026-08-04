import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import Icon from '../Icon.jsx';
import { useCity } from '../../context/CityContext.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { getFaqs } from '../../lib/mockApi.js';
import { getCookieConsent } from '../CookieConsent.jsx';
import { rankAnswers, LOW_CONFIDENCE } from '../../lib/assistant/match.js';
import {
  ASSISTANT,
  QUICK_ACTIONS,
  ESCALATION,
  ROUTE_SUGGESTIONS,
  KB,
} from '../../data/assistant.js';

/* Nestor — the always-on PuneNest help assistant. A floating concierge that
   explains how the app works, deep-links users to features, and escalates to
   human support. Rules-based (no backend): answers are ranked from the curated
   KB (data/assistant.js) via lib/assistant/match.js. Mounted once in
   ConsumerLayout; visible bottom-right on every consumer page. */

const MSG_KEY = 'pn_nestor_msgs';
const NUDGE_KEY = 'pn_nestor_nudge';
const NUDGE_TIMEOUT_MS = 6000; // auto-clear the first-visit hint after a few seconds
/* The hint is an introduction, so it has a budget: two sightings, then never
   again. It used to live in sessionStorage and only record an *explicit* close,
   which meant the 6s auto-hide was forgotten and the bubble greeted the user
   again on the very next page load — on every route, for the whole session. An
   introduction that repeats indefinitely is not an introduction, it is an
   interruption, so the timeout now counts too and the count outlives the tab. */
const NUDGE_MAX_SHOWS = 2;

function nudgeShows() {
  try {
    const n = Number(localStorage.getItem(NUDGE_KEY));
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch { return NUDGE_MAX_SHOWS; } // storage blocked → stay quiet
}

function recordNudgeShown() {
  try { localStorage.setItem(NUDGE_KEY, String(nudgeShows() + 1)); } catch { /* ignore */ }
}

/* Routes where the user is deciding or transacting. On a 640px-tall phone the
   bubble is ~110px of opaque card anchored above the FAB, which lands it over
   the price band on a listing and over the first field of the posting wizard —
   i.e. exactly the content the page exists to show. Nothing here is a route
   someone browses idly, so there is no "how does this work?" to answer.
   Suppressed below `lg` only: the desktop bubble sits in empty margin beside a
   wider layout and covers nothing. The width test is CSS (`max-lg:hidden`), not
   JS — see lib/chrome.js on keeping breakpoints out of JavaScript. */
const NUDGE_MUTED = ['/property/', '/list-property', '/checkout', '/schedule-visit', '/signin', '/signup'];

let msgSeq = 0;
// Stateless-enough unique id: monotonic counter + random suffix so keys never
// collide even across remounts / StrictMode double-invokes.
const uid = () => `m${Date.now().toString(36)}-${(msgSeq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function loadMsgs() {
  try {
    const raw = sessionStorage.getItem(MSG_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Guard against corrupt/foreign data so a bad blob can't crash the thread render.
    if (Array.isArray(parsed) && parsed.every((m) => m && typeof m === 'object' && m.id && m.role)) {
      return parsed;
    }
  } catch { /* ignore */ }
  return [];
}

/* Turn a KB entry into a bot message. KB actions with `ask` (no `to`) become
   follow-up query chips; everything else navigates. */
function botFromEntry(entry, extra) {
  return { id: uid(), role: 'bot', text: entry.a, actions: entry.actions || [], ...extra };
}

export default function AssistantWidget() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { city, isLive } = useCity();
  const { flagEnabled } = useAppFlags();

  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState(loadMsgs);
  const [input, setInput] = useState('');
  const [faqs, setFaqs] = useState([]);
  const [showNudge, setShowNudge] = useState(() => nudgeShows() < NUDGE_MAX_SHOWS);
  // True while the cookie-consent banner/sheet is on screen (first visit or
  // reopened from the footer). On phones the FAB and the full-width consent bar
  // fight for the same corner, so the FAB yields to the consent UI there.
  const [cookieBar, setCookieBar] = useState(() => !getCookieConsent());

  const threadRef = useRef(null);
  const inputRef = useRef(null);

  // Load FAQs once so the matcher can answer them too (best-effort).
  useEffect(() => {
    let alive = true;
    getFaqs().then((f) => alive && setFaqs(f || [])).catch(() => {});
    return () => { alive = false; };
  }, []);

  // Persist the thread across route changes / refresh within the session.
  useEffect(() => {
    try { sessionStorage.setItem(MSG_KEY, JSON.stringify(msgs)); } catch { /* ignore */ }
  }, [msgs]);

  // Seed the greeting the first time the panel opens with an empty thread.
  useEffect(() => {
    if (open && msgs.length === 0) {
      setMsgs([{ id: uid(), role: 'bot', text: ASSISTANT.greeting, quick: true }]);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll to the newest message; focus the composer on open.
  useEffect(() => {
    if (!open) return;
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, open]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  // Esc closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Track cookie-consent visibility (dispatched by CookieConsent) so the FAB can
  // step aside on small screens while the user is choosing cookies.
  useEffect(() => {
    const onBar = (e) => setCookieBar(!!e.detail?.visible);
    window.addEventListener('pn:cookie-banner', onBar);
    return () => window.removeEventListener('pn:cookie-banner', onBar);
  }, []);

  // The first-visit nudge is a gentle hint, not a task — auto-clear it after a
  // few seconds so the user never has to close it. Timing out spends one of the
  // two allowed sightings, exactly as an explicit close does: the user saw it
  // either way, and only counting the close is what made it repeat forever.
  //
  // The increment is behind a ref guard because StrictMode double-invokes effects
  // on purpose in development — without it a single page load spent the entire
  // two-sighting budget and the hint vanished after one view. Any future
  // per-visit counter has the same trap; InstallPrompt.jsx documents it too.
  const nudgeCounted = useRef(false);
  useEffect(() => {
    if (!showNudge) return undefined;
    if (!nudgeCounted.current) {
      nudgeCounted.current = true;
      recordNudgeShown();
    }
    const t = setTimeout(() => setShowNudge(false), NUDGE_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [showNudge]);

  const dismissNudge = useCallback(() => {
    setShowNudge(false);
    // Closing it by hand is a clearer "no" than letting it time out, so spend the
    // whole budget rather than one sighting.
    try { localStorage.setItem(NUDGE_KEY, String(NUDGE_MAX_SHOWS)); } catch { /* ignore */ }
  }, []);

  const openPanel = useCallback(() => { setOpen(true); dismissNudge(); }, [dismissNudge]);

  const push = useCallback((...m) => setMsgs((prev) => [...prev, ...m]), []);

  // Core: answer a free-text (or chip) query from the KB.
  const ask = useCallback((text) => {
    const q = String(text || '').trim();
    if (!q) return;
    push({ id: uid(), role: 'user', text: q });

    const ranked = rankAnswers(q, { faqs });
    if (ranked.length && ranked[0].confidence >= LOW_CONFIDENCE) {
      const related = ranked.slice(1, 3).map((r) => ({ label: r.entry.q, ask: r.entry.q }));
      push(botFromEntry(ranked[0].entry, related.length ? { related } : undefined));
    } else if (ranked.length) {
      push({
        id: uid(), role: 'bot',
        text: "I'm not fully sure I got that — did you mean one of these?",
        actions: ranked.map((r) => ({ label: r.entry.q, ask: r.entry.q, icon: 'help-circle' })),
        escalate: true,
      });
    } else {
      push({
        id: uid(), role: 'bot',
        text: "I couldn't find that in my playbook, but a human can help.",
        escalate: true,
      });
    }
  }, [faqs, push]);

  const runAction = useCallback((a) => {
    if (!a) return;
    if (a.ask) { ask(a.ask); return; }
    if (!a.to) return;
    if (a.external) {
      // Only hand off known-safe protocols; never navigate arbitrary strings.
      if (a.to.startsWith('tel:')) window.location.href = a.to;
      else if (/^https?:\/\//.test(a.to)) window.open(a.to, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(a.to);
    setOpen(false);
  }, [ask, navigate]);

  const onSubmit = useCallback((e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput('');
    ask(q);
  }, [ask, input]);

  const resetThread = useCallback(() => {
    setMsgs([{ id: uid(), role: 'bot', text: ASSISTANT.greeting, quick: true }]);
  }, []);

  // Context-aware suggestion chips for the current route (longest-prefix match).
  const suggestions = useMemo(() => {
    const key = Object.keys(ROUTE_SUGGESTIONS)
      .filter((p) => (p === '/' ? pathname === '/' : pathname.startsWith(p)))
      .sort((a, b) => b.length - a.length)[0];
    const ids = ROUTE_SUGGESTIONS[key] || ROUTE_SUGGESTIONS['/'];
    return ids.map((id) => KB.find((e) => e.id === id)).filter(Boolean);
  }, [pathname]);

  // Lift the FAB above whatever occupies the bottom-right corner on small screens.
  // --pn-bottom-inset (owned by ConsumerLayout) already accounts for the persistent
  // mobile bottom nav; the offsets below add the *extra* clearance for transient bars
  // that a page raises and the layout can't see:
  //  · The Property / Society / contact sticky action bar (`.pn-sticky-cta`) — full-width,
  //    rendered below `lg`, so the FAB must clear it up to the lg breakpoint.
  //  · The CityChrome waitlist bar — only when the current city isn't live (mobile).
  // ponytail: page-owned bars still announce themselves by route rather than raising
  // the inset var. Fold them into --pn-bottom-inset if a third one shows up.
  const detailBar = pathname.startsWith('/property/')
    || pathname === '/society'
    || pathname.startsWith('/society/')
    || pathname === '/contact';
  const cityBar = !isLive(city);
  let anchorClass = 'bottom-[calc(var(--pn-bottom-inset)+1.5rem)]';
  if (detailBar) anchorClass = 'bottom-[calc(var(--pn-bottom-inset)+5.75rem)] lg:bottom-[calc(var(--pn-bottom-inset)+1.5rem)]';
  else if (cityBar) anchorClass = 'bottom-[calc(var(--pn-bottom-inset)+9rem)] sm:bottom-[calc(var(--pn-bottom-inset)+1.5rem)]';
  // On phones the collapsed FAB and the full-width consent bar collide, so hide
  // the FAB there while the consent UI is up (desktop keeps it — no overlap).
  const hideClass = cookieBar && !open ? 'max-sm:hidden' : '';

  // Ops can hide the assistant via settings.flags.assistant (defaults on). Kept
  // after all hooks so the hook order stays stable.
  if (!flagEnabled('assistant')) return null;

  return (
    <div className={`fixed right-4 sm:right-6 z-[1300] ${anchorClass} ${hideClass}`}>
      {open ? (
        <Panel
          msgs={msgs}
          threadRef={threadRef}
          inputRef={inputRef}
          input={input}
          setInput={setInput}
          onSubmit={onSubmit}
          suggestions={suggestions}
          onSuggest={(e) => ask(e.q)}
          onAction={runAction}
          onClose={() => setOpen(false)}
          onMinimize={() => setOpen(false)}
          onReset={resetThread}
        />
      ) : (
        <Fab
          onOpen={openPanel}
          showNudge={showNudge}
          onDismissNudge={dismissNudge}
          nudgeMuted={NUDGE_MUTED.some((p) => pathname.startsWith(p))}
        />
      )}
    </div>
  );
}

/* ── Floating action button + first-visit nudge ─────────────────────────────── */
function Fab({ onOpen, showNudge, onDismissNudge, nudgeMuted }) {
  return (
    <div className="flex flex-col items-end gap-2">
      {showNudge ? (
        <div className={'relative max-w-[240px] animate-slideIn rounded-2xl rounded-br-md bg-[#1b1730]/95 px-3.5 py-2.5 text-[12.5px] leading-snug text-gray-200 shadow-2xl shadow-black/50 ring-1 ring-white/[0.06] backdrop-blur' + (nudgeMuted ? ' max-lg:hidden' : '')}>
          <button
            onClick={onDismissNudge}
            aria-label="Dismiss"
            /* A 44px circle here would be bigger than the bubble it closes, so the
               hit area is extended with a transparent pseudo-element instead — the
               glyph stays 20px, the target is 44px. See `.tap-extend` in index.css. */
            className="tap-extend absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#1b1730] text-gray-400 shadow-md ring-1 ring-white/[0.08] hover:text-white"
          >
            <Icon name="x" className="h-3 w-3" />
          </button>
          New here? Ask <b className="text-white">Nestor</b> how anything works or where to find it.
        </div>
      ) : null}
      <button
        onClick={onOpen}
        aria-label="Open Nestor, the PuneNest help assistant"
        className="group flex h-12 w-12 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#0d9488] to-[#14b8a6] font-semibold text-white shadow-2xl shadow-teal-500/30 transition hover:brightness-110 cursor-pointer sm:h-auto sm:w-auto sm:py-3 sm:pl-3.5 sm:pr-4"
      >
        <Icon name="sparkles" weight="fill" className="h-5 w-5" />
        <span className="hidden text-sm sm:inline">Ask Nestor</span>
      </button>
    </div>
  );
}

/* ── Chat panel ─────────────────────────────────────────────────────────────── */
function Panel({
  msgs, threadRef, inputRef, input, setInput, onSubmit,
  suggestions, onSuggest, onAction, onClose, onMinimize, onReset,
}) {
  return (
    <div
      role="dialog"
      aria-label="Nestor help assistant"
      className="animate-slideIn relative flex h-[min(560px,calc(100dvh-6rem))] w-[min(384px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl bg-[#141020]/95 shadow-2xl shadow-black/60 ring-1 ring-white/[0.06] backdrop-blur-xl"
    >
      {/* Signature: a soft teal aurora — clipped to the header so it never
         bleeds into the chat thread. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-0 h-16 overflow-hidden">
        <div className="absolute -top-14 left-1/2 h-28 w-64 -translate-x-1/2 rounded-full bg-teal-500/15 blur-3xl" />
      </div>

      {/* Header */}
      <header className="relative z-10 flex items-center gap-3 bg-gradient-to-b from-white/[0.06] to-transparent px-4 py-3.5">
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-[#0d9488] to-[#14b8a6] shadow-lg shadow-teal-500/30 ring-1 ring-white/20">
          <Icon name="sparkles" weight="fill" className="h-5 w-5 text-white" />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-[#141020]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold leading-tight text-white">{ASSISTANT.name}</p>
          <p className="flex items-center gap-1.5 text-[11px] leading-tight text-gray-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]" />
            {ASSISTANT.tagline} · online
          </p>
        </div>
        <button onClick={onReset} aria-label="Start over" title="Start over" className="rounded-lg p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer">
          <Icon name="refresh-cw" className="h-4 w-4" />
        </button>
        <button onClick={onMinimize} aria-label="Minimise" title="Minimise" className="rounded-lg p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer">
          <Icon name="chevron-down" className="h-5 w-5" />
        </button>
        <button onClick={onClose} aria-label="Close assistant" title="Close" className="rounded-lg p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white cursor-pointer">
          <Icon name="x" className="h-5 w-5" />
        </button>
      </header>

      {/* Thread */}
      <div ref={threadRef} className="relative z-10 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        {msgs.map((m) => (
          <Bubble key={m.id} m={m} onAction={onAction} />
        ))}
      </div>

      {/* Contextual suggestion chips */}
      {suggestions.length ? (
        <div className="relative z-10 px-3 pt-2.5">
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((e) => (
              <button
                key={e.id}
                onClick={() => onSuggest(e)}
                className="rounded-full bg-white/[0.05] px-3 py-1.5 text-[11.5px] font-medium text-gray-300 transition hover:bg-white/10 hover:text-white cursor-pointer"
              >
                {e.q}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Composer */}
      <div aria-hidden className="relative z-10 mx-4 mt-2 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      <form onSubmit={onSubmit} className="relative z-10 flex items-center gap-2 p-3">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask how anything works…"
          aria-label="Ask Nestor"
          className="min-w-0 flex-1 rounded-xl bg-white/[0.06] px-3.5 py-2.5 text-sm text-white outline-none transition placeholder:text-gray-500 focus:bg-white/[0.09] focus:ring-2 focus:ring-teal-400/30"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          aria-label="Send"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#0d9488] to-[#14b8a6] text-white shadow-lg shadow-teal-500/25 transition hover:brightness-110 disabled:opacity-40 disabled:shadow-none cursor-pointer disabled:cursor-default"
        >
          <Icon name="send" weight="fill" className="h-5 w-5" />
        </button>
      </form>
    </div>
  );
}

/* ── One message bubble (+ its action / related / escalation chips) ──────────── */
function Bubble({ m, onAction }) {
  const isUser = m.role === 'user';
  return (
    <div className={isUser ? 'flex justify-end' : 'flex flex-col items-start gap-2'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-br from-[#0d9488] to-[#14b8a6] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white shadow-lg shadow-teal-950/40'
            : 'max-w-[92%] rounded-2xl rounded-bl-md bg-white/[0.06] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-gray-100 shadow-[0_1px_2px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.06)]'
        }
      >
        {m.text}
      </div>

      {!isUser && m.actions?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {m.actions.map((a) => (
            <ActionChip key={a.label} a={a} onAction={onAction} />
          ))}
        </div>
      ) : null}

      {!isUser && m.related?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {m.related.map((a) => (
            <ActionChip key={a.label} a={a} onAction={onAction} subtle />
          ))}
        </div>
      ) : null}

      {!isUser && m.escalate ? (
        <div className="flex flex-wrap gap-1.5">
          {ESCALATION.actions.map((a) => (
            <ActionChip key={a.label} a={a} onAction={onAction} />
          ))}
        </div>
      ) : null}

      {/* Show the quick-start actions right under the very first greeting. */}
      {!isUser && m.quick ? (
        <div className="flex flex-wrap gap-1.5">
          {QUICK_ACTIONS.map((a) => (
            <ActionChip key={a.label} a={{ label: a.label, icon: a.icon, to: a.to, ask: a.kind === 'ask' ? a.text : undefined }} onAction={onAction} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ActionChip({ a, onAction, subtle }) {
  return (
    <button
      onClick={() => onAction(a)}
      className={
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition cursor-pointer ' +
        (subtle
          ? 'bg-white/[0.05] text-gray-300 hover:bg-white/10 hover:text-white'
          : 'bg-teal-400/[0.14] text-teal-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] hover:bg-teal-400/25')
      }
    >
      {a.icon ? <Icon name={a.icon} className="h-3.5 w-3.5" /> : null}
      {a.label}
      {a.external ? <Icon name="external-link" className="h-3 w-3 opacity-70" /> : null}
    </button>
  );
}
