import { Link } from 'react-router';
import { Home } from 'lucide-react';

export const STAFF_FIELD =
  'w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-base text-white placeholder-gray-500 focus:border-teal-400 focus:outline-none';

/** The internal console's door: brand, one card, the audit line. */
export default function StaffShell({ title, subtitle, children }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center p-5">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-teal-500">
            <Home className="h-6 w-6 text-white" />
          </div>
          <div>
            <div className="text-xl font-extrabold">Draazy</div>
            <div className="-mt-0.5 text-[11px] text-gray-400">Internal Console</div>
          </div>
        </div>
        <div className="dz-card rounded-2xl p-6 sm:p-7">
          <h1 className="mb-1 text-lg font-bold">{title}</h1>
          {subtitle && <p className="mb-5 text-sm text-gray-400">{subtitle}</p>}
          {children}
        </div>
        <p className="mt-5 text-center text-[11px] text-gray-600">
          Internal access only · every action is logged.{' '}
          <Link to="/" className="text-teal-400 hover:underline">Back to site</Link>
        </p>
      </div>
    </div>
  );
}
