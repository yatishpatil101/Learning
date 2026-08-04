import { useId, useState } from 'react';
import { Link } from 'react-router';
import Icon from '../Icon.jsx';
import { useAppFlags } from '../../context/AppFlagsContext.jsx';
import { useHelpPath } from '../../lib/useHelp.js';

const SOCIAL = {
  facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
  x: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  instagram: 'M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163C8.741 0 8.332.014 7.052.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.332 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z',
  youtube: 'M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z',
};

const Soc = ({ k, label, href, hover }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}
    className={`tap-target sm:min-h-0 sm:min-w-0 w-9 h-9 rounded-xl bg-white/5 flex items-center justify-center transition-all text-gray-400 ${hover}`}>
    <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4" aria-hidden="true">
      <path d={SOCIAL[k]} />
    </svg>
  </a>
);

/* A footer column that collapses on phones (tap the heading) but stays open from
   sm: upward. The three link columns are ~600px of dead weight at the bottom of
   every page on mobile — an accordion keeps them reachable without making every
   page that much longer to scroll past.

   Collapsed, the three of these are a *list*, so they are spaced like one: the
   grid gap is removed on mobile (see the grid below) and each column carries its
   own top rule instead. Rows then land on a single repeating 48px rhythm rather
   than floating 40px apart with nothing between them — which is what made the
   collapsed footer read as three stranded labels in a lot of empty space.

   Mirrors the existing `CollapsibleCard` pattern in dashboard/ProfileTab.jsx:
   the panel is `sm:block` and the chevron is `sm:hidden`, so the desktop grid
   renders exactly as it does today with no JS breakpoint detection. */
const FooterCol = ({ title, children }) => {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="border-t border-white/5 sm:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        className="w-full flex items-center justify-between gap-3 text-left min-h-[48px] sm:min-h-0 sm:cursor-default"
      >
        <h4 className="text-xs font-semibold text-gray-400 tracking-widest uppercase mb-0 sm:mb-5">{title}</h4>
        <Icon data-footer-chevron="" name="chevron-down" className={'w-4 h-4 text-gray-500 flex-shrink-0 transition-transform sm:hidden ' + (open ? 'rotate-180' : '')} />
      </button>
      <div id={panelId} className={(open ? 'block' : 'hidden') + ' sm:block pb-4 sm:pb-0 sm:pt-0'}>{children}</div>
    </div>
  );
};

export default function Footer() {
  const { flagEnabled } = useAppFlags();
  /* Help routes are the one place in the app where the URL carries the language
     (/hi/help/...). Linking to the unprefixed path from a prefixed page does not
     merely look untidy: HelpLangRoute reads the prefix and calls changeLanguage()
     on it, and that write persists to `pnLang` device-wide — so a Hindi reader
     clicking "FAQ" here used to be reset to English across the whole app. */
  const hp = useHelpPath();
  return (
    <footer className="pt-10 sm:pt-14 pb-6 sm:pb-8 relative" style={{ background: '#12101f' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ── Main content: 4-column grid ──
            gap-0 on phones: the collapsed columns are a divided list, so their own
            top rules carry the separation, and the bottom bar's rule closes it.
            From sm: the real grid gap and the block spacing return. */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0 sm:gap-10 lg:gap-8 mb-0 sm:mb-12">

          {/* Column 1 — brand + social */}
          <div className="sm:col-span-2 lg:col-span-1 pb-6 sm:pb-0">
            <Link to="/" className="tap-target sm:min-h-0 sm:min-w-0 inline-flex items-center gap-2.5 mb-4">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-teal-400 flex items-center justify-center shadow-md shadow-teal-500/20">
                <Icon name="home" className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold">PuneNest</span>
            </Link>
            <p className="text-sm text-gray-500 leading-relaxed mb-4 sm:mb-5">
              Pune's broker-free property marketplace. Verified owners, zero brokerage, direct contact.
            </p>
            <div className="flex items-center gap-2">
              <Soc k="facebook" label="PuneNest on Facebook" href="https://www.facebook.com/punenest" hover="hover:bg-teal-500/10 hover:text-teal-400" />
              <Soc k="x" label="PuneNest on X" href="https://x.com/punenest" hover="hover:bg-teal-500/10 hover:text-teal-400" />
              <Soc k="instagram" label="PuneNest on Instagram" href="https://www.instagram.com/punenest" hover="hover:bg-pink-500/10 hover:text-pink-400" />
              <Soc k="youtube" label="PuneNest on YouTube" href="https://www.youtube.com/@punenest" hover="hover:bg-[#f97316]/10 hover:text-[#fb923c]" />
              <Soc k="linkedin" label="PuneNest on LinkedIn" href="https://www.linkedin.com/company/punenest" hover="hover:bg-teal-500/10 hover:text-teal-400" />
            </div>
          </div>

          {/* Column 2 — Explore links */}
          <FooterCol title="Explore">
            <ul className="space-y-3">
              {[
                ['Buy property', '/listings?deal=buy'],
                ['Rent property', '/listings?deal=rent'],
                ['Flatmates', '/flatmates'],
                ['Browse societies', '/societies'],
                ['Buy plots', '/listings?type=plot'],
                ['List your property', '/list-property'],
                ['Refer & earn', '/refer'],
                ['Services', '/services'],
                flagEnabled('emiCalculator') && ['EMI calculator', '/emi-calculator'],
                ['Locality insights', '/locality/baner'],
              ].filter(Boolean).map(([label, to]) => (
                <li key={label}>
                  <Link to={to} className="text-sm text-gray-500 hover:text-white transition-colors">{label}</Link>
                </li>
              ))}
            </ul>
          </FooterCol>

          {/* Column 3 — Company links */}
          <FooterCol title="Company">
            <ul className="space-y-3">
              {[
                ['Help centre', hp('/help')],
                ['FAQ', hp('/help/faq')],
                ['What\u2019s new', hp('/help/changelog')],
                ['Privacy policy', '/privacy'],
                ['Terms of service', '/terms'],
                ['Refund policy', '/refund-policy'],
                ['Disclaimer', '/disclaimer'],
                ['Staff & admin', '/staff-login'],
              ].map(([label, href]) => (
                <li key={label}>
                  <Link to={href} className="text-sm text-gray-500 hover:text-white transition-colors">{label}</Link>
                </li>
              ))}
              <li>
                <a href="/sitemap.xml" className="text-sm text-gray-500 hover:text-white transition-colors">Sitemap</a>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event('pn:open-cookie-preferences'))}
                  className="text-sm text-gray-500 hover:text-white transition-colors"
                >
                  Cookie preferences
                </button>
              </li>
            </ul>
          </FooterCol>

          {/* Column 4 — Contact */}
          <FooterCol title="Contact">
            <address className="not-italic space-y-3">
              <a href="tel:+919876543210" className="flex items-center gap-2.5 group">
                <Icon name="phone" className="w-4 h-4 text-teal-500 shrink-0" />
                <span className="text-sm text-gray-500 group-hover:text-white transition-colors">+91 98765 43210</span>
              </a>
              <a href="mailto:hello@punenest.com" className="flex items-center gap-2.5 group">
                <Icon name="mail" className="w-4 h-4 text-teal-500 shrink-0" />
                <span className="text-sm text-gray-500 group-hover:text-white transition-colors">hello@punenest.com</span>
              </a>
              <div className="flex items-start gap-2.5">
                <Icon name="map-pin" className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                <span className="text-sm text-gray-500">201, Business Bay, Baner Road, Pune 411045</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Icon name="clock" className="w-4 h-4 text-teal-500 shrink-0" />
                <span className="text-sm text-gray-500">Mon – Sat, 9 AM – 8 PM</span>
              </div>
              <div className="flex items-start gap-2.5 pt-1">
                <Icon name="file-text" className="w-4 h-4 text-teal-500 shrink-0 mt-0.5" />
                <span className="text-xs text-gray-600 leading-relaxed">
                  PuneNest Technologies Pvt. Ltd.<br />
                  CIN U72900PN2024PTC000000 · GSTIN 27ABCDE1234F1Z5
                </span>
              </div>
            </address>
          </FooterCol>

        </div>

        {/* ── Bottom bar ── */}
        <div className="border-t border-white/5 pt-5 sm:pt-7 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-gray-600 order-2 sm:order-1">© 2026 PuneNest. All rights reserved. Made with care in Pune.</p>
          {/* Standalone links in a row, not prose — so they carry the 44px floor on
              phones. `sm:` puts the original compact footer density back. */}
          <nav className="flex items-center gap-5 order-1 sm:order-2" aria-label="Legal links">
            {[['Privacy', '/privacy'], ['Terms', '/terms']].map(([label, to]) => (
              <Link key={label} to={to} className="tap-target sm:min-h-0 sm:min-w-0 inline-flex items-center text-xs text-gray-600 hover:text-gray-400 transition-colors">{label}</Link>
            ))}
            <a href="/sitemap.xml" className="tap-target sm:min-h-0 sm:min-w-0 inline-flex items-center text-xs text-gray-600 hover:text-gray-400 transition-colors">Sitemap</a>
          </nav>
        </div>

      </div>
    </footer>
  );
}
