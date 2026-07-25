import Icon from '../Icon.jsx';
import { Link } from 'react-router';

/* Verification scope + due-diligence disclaimer.
   Legal purpose: keep the "Verified by PuneNest" claim honest and non-relied-upon.
   It sits RIGHT NEXT TO every verification/document claim (not just the /disclaimer page)
   so a user cannot reasonably treat our badge as a certification of clear title. Wording is
   deal-aware — a sale needs full title due-diligence language, a rental needs agreement-check
   language — and always points to the full Disclaimer. */
export default function VerificationDisclaimer({ deal }) {
  const isRent = deal === 'rent';
  return (
    <div className="rounded-xl border border-amber-500/25 p-4 flex items-start gap-3" style={{ background: 'rgba(245,158,11,.06)' }}>
      <Icon name="shield-alert" className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white mb-1">What “Verified by PuneNest” means — and what you must still check</p>
        <p className="text-xs text-slate-300 leading-relaxed">
          A “Verified” tag means PuneNest confirmed the owner’s identity and sighted the document the
          owner provided. It is <span className="font-semibold text-amber-200">not</span> a certification of the document’s authenticity, legal validity{isRent ? '' : ', or of clear and marketable title'}.
        </p>
        <p className="text-xs text-slate-300 leading-relaxed mt-1.5">
          {isRent
            ? 'Before you sign, read the leave-&-license agreement in full and independently confirm ownership and society permissions — ideally with your own lawyer.'
            : 'Always conduct your own independent legal due diligence — title search, encumbrance certificate, approved building plans and a physical inspection — and consult a lawyer before finalizing or paying any advance.'}
        </p>
        <Link to="/disclaimer" className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-300 hover:text-amber-200 mt-2">
          Read the full Disclaimer <Icon name="arrow-right" className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
