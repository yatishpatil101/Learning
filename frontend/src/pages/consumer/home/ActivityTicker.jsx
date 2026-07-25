import { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/Icon.jsx';

/* Trust-proof "live activity" ticker. Rotates short, believable proof-of-life
   lines to reinforce the verified / zero-brokerage positioning. Purely cosmetic
   (seeded copy, not real events) and reduced-motion safe — when the user prefers
   reduced motion it shows a single static line and never cycles. */
const ITEMS = [
  { icon: 'shield-check', text: 'New Aadhaar-verified listing in Hinjawadi', color: 'text-emerald-300' },
  { icon: 'heart', text: 'Someone just saved a 2 BHK in Baner', color: 'text-rose-300' },
  { icon: 'hand-coins', text: 'Zero-brokerage deal closed in Wakad', color: 'text-teal-300' },
  { icon: 'calendar-check', text: 'Visit scheduled for a 3 BHK in Kothrud', color: 'text-teal-300' },
  { icon: 'badge-check', text: 'Owner verified in Viman Nagar', color: 'text-amber-300' },
  { icon: 'home', text: 'New flat listed in Koregaon Park', color: 'text-emerald-300' },
];

export default function ActivityTicker() {
  const [i, setI] = useState(0);
  const [show, setShow] = useState(true);
  const timers = useRef([]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return undefined; // static line, no cycling

    const id = setInterval(() => {
      setShow(false); // fade out
      const t = setTimeout(() => {
        setI((n) => (n + 1) % ITEMS.length);
        setShow(true); // fade in next
      }, 320);
      timers.current.push(t);
    }, 3600);

    return () => {
      clearInterval(id);
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  const item = ITEMS[i];
  return (
    <div className="hero-ticker flex justify-center mt-4 sm:mt-6" aria-live="off">
      <div className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/10 backdrop-blur-sm max-w-full">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="ticker-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400/70" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className={'flex items-center gap-1.5 text-xs sm:text-[13px] font-medium text-gray-300 truncate transition-opacity duration-300 ' + (show ? 'opacity-100' : 'opacity-0')}>
          <Icon name={item.icon} className={'w-3.5 h-3.5 shrink-0 ' + item.color} />
          <span className="truncate">{item.text}</span>
        </span>
      </div>
    </div>
  );
}
