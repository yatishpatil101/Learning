import { Link } from 'react-router';
import { KeyRound, ScrollText, ShieldCheck } from 'lucide-react';
import AuthShell from './AuthShell.jsx';
import MobileAuthIntro from './MobileAuthIntro.jsx';

export const STAFF_SUBMIT =
  'dz-auth-submit btn-teal w-full py-3.5 rounded-xl text-white font-semibold text-sm shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed';

const TRUST = [[KeyRound, 'Two-step sign-in'], [ShieldCheck, 'Role-scoped'], [ScrollText, 'Audit-logged']];
const STEPS = [['1', 'Password'], ['2', 'Authenticator code'], ['3', 'Your workspace']];

function StaffPanel() {
  return (
    <>
      <div className="inline-flex items-center gap-2 rounded-full border border-teal-400/25 bg-teal-400/[.08] px-3.5 py-1.5 mt-6 mb-6">
        <span className="auth-live-dot inline-block w-1.5 h-1.5 rounded-full bg-teal-300" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-200">Internal console</span>
      </div>
      <h1 className="text-4xl font-extrabold text-white leading-tight mb-4">
        Run Draazy from <span className="gradient-text">one secure workspace</span>
      </h1>
      <p className="text-gray-400 text-lg mb-6 leading-relaxed">
        Verifications, listings, requests and support — for the admin and service teams.
      </p>
      <div className="flex flex-wrap gap-2 mb-8">
        {TRUST.map(([Ic, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5 rounded-full border border-white/[.08] bg-white/[.04] px-3 py-1.5 text-[13px] font-medium text-gray-200">
            <Ic className="w-4 h-4 text-teal-300" /> {label}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {STEPS.map(([n, label]) => (
          <div key={n} className="stat-card rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold gradient-text">{n}</p>
            <p className="text-gray-500 text-xs mt-1">{label}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/** Back-office doors (/staff-login, /staff-invite) in the consumer sign-in's split-screen layout. */
export default function StaffShell({ icon: Icon, title, subtitle, children }) {
  return (
    <AuthShell
      left={<StaffPanel />}
      mobileIntro={<MobileAuthIntro eyebrow="Internal console" tagline="Admin & service-team access only." chips={TRUST} />}
    >
      <div className="auth-card glass-card rounded-2xl p-6 sm:p-8 lg:p-10 slide-up">
        <div className="text-center mb-6 sm:mb-8 slide-up slide-up-delay-1">
          <div className="w-12 h-12 sm:w-14 sm:h-14 bg-gradient-to-br from-teal-400/20 to-teal-600/20 rounded-2xl flex items-center justify-center mx-auto mb-3.5 sm:mb-4 border border-teal-400/20">
            <Icon className="w-6 h-6 sm:w-7 sm:h-7 text-teal-400" />
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">{title}</h2>
          {subtitle && <p className="text-gray-400 text-sm">{subtitle}</p>}
        </div>
        <div className="slide-up slide-up-delay-2">{children}</div>
        <p className="text-center text-sm text-gray-500 mt-7">
          Not on the team?
          <Link to="/signin" className="text-teal-400 hover:text-teal-300 font-semibold transition-colors ml-1">Customer sign-in</Link>
        </p>
      </div>
    </AuthShell>
  );
}

export function StaffField({ id, label, icon: Icon, className = '', ...input }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-gray-300 mb-2">{label}</label>
      <div className="relative">
        {Icon && <Icon className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />}
        <input
          id={id}
          {...input}
          className={(Icon ? 'pl-10 ' : 'px-4 ') + 'w-full pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500 focus:outline-none focus:border-teal-400 transition-all ' + className}
        />
      </div>
    </div>
  );
}
