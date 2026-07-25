/**
 * "Powered by Google" attribution mark.
 *
 * Google's Places (New) API Terms of Service require a visible "Powered by
 * Google" attribution whenever autocomplete predictions are shown OUTSIDE a
 * Google map (which is exactly how every locality/society/landmark picker in the
 * app surfaces them). This renders the Google wordmark as a compact logo instead
 * of a loud text headline, and is reused everywhere predictions appear (the hero
 * search and every LocalitySelect-backed Select / MultiSelect).
 *
 * Design-consistency note: the per-letter hex values below are Google's fixed
 * brand colours. They are deliberately kept outside the app theme — the mark must
 * render in Google's own palette to be a valid attribution.
 */

const GOOGLE = [
  ['G', '#4285F4'],
  ['o', '#EA4335'],
  ['o', '#FBBC05'],
  ['g', '#4285F4'],
  ['l', '#34A853'],
  ['e', '#EA4335'],
];

export default function PoweredByGoogle({ className = '' }) {
  return (
    <div className={'pbg' + (className ? ' ' + className : '')} role="img" aria-label="Powered by Google">
      <span className="pbg-by">powered by</span>
      <span className="pbg-word" aria-hidden="true">
        {GOOGLE.map(([ch, color], i) => (
          <span key={i} style={{ color }}>{ch}</span>
        ))}
      </span>
    </div>
  );
}
