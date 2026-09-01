// Tier 1 route styles for the split-screen auth pages (.auth-page). Hoisted out
// of index.css, where it sat under the "Listings page" heading. The .otp-* box
// styles stay global in index.css (OtpBoxes.jsx is shared with list-property).
import '../../styles/routes/auth.css';

/* Split-screen auth layout: decorative left panel (desktop) + form card (ports
   signin/signup.html main layout). `left` is the desktop panel content; `children`
   is the form card. `mobileIntro` is a compact brand/trust block shown ONLY below
   `lg` (above the card) so mobile users still get Draazy branding and trust cues
   that the desktop left panel carries.

   `align` controls desktop vertical placement of the form card:
   - 'center' (default): vertically centered within the area *below* the fixed
     navbar. Best for short cards (e.g. Sign In).
   - 'top': pinned just below the navbar. Use for tall cards (e.g. Sign Up) that
     would otherwise get clipped by the fixed navbar when centered. */
export default function AuthShell({ left, children, mobileIntro, align = 'center' }) {
  // Reserve the fixed navbar so the card never tucks under it. 'top' adds 16px of
  // breathing room on top of the bar; both read the height from --dz-nav-h, so lg
  // resolves to the 72px/88px this used to hardcode and desktop is unchanged.
  const colAlign = align === 'top'
    ? 'lg:justify-start lg:pt-[calc(var(--dz-nav-h)+16px)] lg:pb-12'
    : 'lg:justify-center lg:pt-[var(--dz-nav-h)] lg:pb-12';
  return (
    <div className="auth-page min-h-[100dvh] flex pt-[var(--dz-nav-h)] lg:pt-0">
      {/* Mobile-only ambient backdrop: teal aurora + fine tech grid so the auth
          screen feels like the front page of a modern proptech, not a form on black. */}
      <div className="auth-mobile-bg lg:hidden" aria-hidden="true" />
      <div className="auth-left hidden lg:flex lg:w-1/2 items-center justify-center p-12 relative">
        <div className="floating-shape w-64 h-64 bg-teal-400" style={{ top: '10%', left: '10%' }} />
        <div className="floating-shape w-48 h-48 bg-teal-600" style={{ top: '60%', right: '15%' }} />
        <div className="floating-shape w-32 h-32 bg-purple-400" style={{ bottom: '20%', left: '25%' }} />
        <div className="floating-shape w-40 h-40 bg-teal-300" style={{ top: '35%', right: '30%' }} />
        <div className="relative z-10 max-w-md slide-right">{left}</div>
      </div>
      {/* Mobile always top-aligns just under the navbar; desktop uses `align`. */}
      <div className={'relative z-10 w-full lg:w-1/2 flex flex-col items-center justify-start px-5 pt-6 pb-8 sm:px-8 lg:px-12 lg:min-h-[100dvh] ' + colAlign}>
        <div className="w-full max-w-md">
          {mobileIntro ? <div className="lg:hidden">{mobileIntro}</div> : null}
          {children}
        </div>
      </div>
    </div>
  );
}
