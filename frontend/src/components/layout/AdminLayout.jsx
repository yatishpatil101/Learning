import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink, LayoutDashboard, LogOut, Menu, MessageSquare,
  X, UserPlus, BedDouble, Gift,
  BookOpen, LifeBuoy, PenLine,
} from 'lucide-react';
import LogoMark from '../brand/LogoMark.jsx';
import ConnectivityBanner from '../ConnectivityBanner.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { roleLabel } from '../../lib/auth.js';
import { ADMIN_MODULES, canAccessModule } from '../../lib/adminModules.js';
import { AdminFlagsProvider, useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import AdminTopbarTools from './AdminTopbarTools.jsx';

const OPS_NAV = [
  ['/ops', 'Dashboard', LayoutDashboard, true],
  ['/ops/requests', 'Requests', MessageSquare],
  // The two live-seam screens. Kept next to the demo queues rather than in a section of their own:
  // an operator navigates by the work, not by which store answers.
  ['/ops/support', 'Support queue', LifeBuoy],
  // One row where there were six. Rent Agreement / Legal / Interior / Packers / Valuation were
  // five one-line wrappers over a single component reading `localStorage`; the desk they are now
  // is the same screen with `?type=` set, so a sidebar row per type would be five links to one
  // page — and five of them would light up as the active route at once.
  ['/ops/drafting-desk', 'Drafting desk', PenLine],
  ['/ops/referrals', 'Referrals', Gift],
  ['/ops/flatmate-review', 'Flatmate', BedDouble],
];

export default function AdminLayout({ variant = 'admin' }) {
  // Both variants render AdminLayoutInner, which calls useAdminFlags(); the
  // provider must wrap both so the ops variant doesn't throw (blank screen).
  // It only *reads* for the admin variant, though — see AdminFlagsContext.
  return (
    <AdminFlagsProvider read={variant === 'admin'}>
      <AdminLayoutInner variant={variant} />
    </AdminFlagsProvider>
  );
}

function AdminLayoutInner({ variant = 'admin' }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { tabEnabled } = useAdminFlags();
  /* The sidebar is the module registry filtered by two independent things: the global tab flag,
     which is what the platform has switched on for everyone, and the caller's own permission
     atoms, which are what this person may open.

     The `adminOnly` field is no longer a third filter. It used to be, because the console resolved
     access itself and needed a rule that a scoped user could never be granted a control surface;
     now the atoms behind those modules (`settings:read`, `finance:read`, `audit:read`,
     `users:write`) are administrator-only in the server's own catalogue, so an operations account
     cannot hold one and the atom check already excludes them. The field stays as documentation of
     which rows those are — and as the thing the Team & Access grid dims. */
  const nav = variant === 'ops'
    ? OPS_NAV
    : ADMIN_MODULES
        .filter((m) => (!m.flagKey || tabEnabled(m.flagKey)) && canAccessModule(user, m.key))
        .map((m) => [m.path, m.label, m.icon, m.end]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const doLogout = () => {
    logout();
    navigate('/staff-login');
  };

  return (
    <div className="min-h-[100dvh] bg-ink lg:flex">
      {/* Staff get the same connectivity answer consumers do (D164). An ops screen is where a
          dropped connection is *most* expensive to misread: a queue that fails to load looks
          exactly like a queue that is finally empty, and one of those ends a shift early. */}
      <ConnectivityBanner />
      <aside
        className={
          'fixed inset-y-0 left-0 z-50 w-64 transform border-r border-white/10 bg-ink-2 transition-transform lg:static lg:translate-x-0 ' +
          (open ? 'translate-x-0' : '-translate-x-full')
        }
      >
        <div className="flex items-center justify-between px-5 py-4">
          {/* min-h on touch only: the drawer is 280px wide with nothing beside the
              wordmark, so a taller row costs nothing there, while the desktop rail
              keeps its 56px header. */}
          <Link to={variant === 'ops' ? '/ops' : '/admin'} className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <LogoMark className="h-8 w-8 shrink-0 text-brand-teal" />
            <span className="font-extrabold">
              Draazy
              <span className="ml-1 text-xs font-medium text-gray-400">{variant === 'ops' ? 'Ops' : 'Admin'}</span>
            </span>
          </Link>
          {/* tap-extend, not tap-target: the drawn square sits in a tight header row,
             so growing the box would push the wordmark. aria-label because this is
             icon-only and a phone never surfaces `title`. */}
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="tap-extend relative rounded-lg p-1 hover:bg-white/5 lg:hidden">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-1 px-3 py-2">
          {nav.map(([to, label, Icon, end]) => (
            <NavLink
              key={to}
              to={to}
              end={!!end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                /* py-3 below sm, py-2.5 from there: 16 nav rows at 40px each are a
                   long thumb-drag through a drawer, and a miss lands on the
                   neighbouring section rather than nothing. The 4px it adds per row
                   is inside a scrolling drawer, so nothing else moves. */
                'flex items-center gap-3 rounded-xl px-3 py-3 sm:py-2.5 text-sm transition-all ' +
                (isActive ? 'bg-brand-teal/15 text-brand-teal' : 'text-gray-300 hover:bg-white/5 hover:text-white')
              }
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {open ? <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} /> : null}

      <div className="flex min-h-[100dvh] flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-ink/80 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button onClick={() => setOpen(true)} aria-label="Open menu" className="tap-extend relative rounded-lg p-2 hover:bg-white/5 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>

            {variant === 'admin' ? <AdminTopbarTools /> : null}

            {/* Quick actions — desktop only */}
            {variant === 'admin' ? (
              <div className="hidden items-center gap-1.5 ml-auto lg:flex">
                <button onClick={() => navigate('/admin/post-on-behalf')} className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-500/20 transition">
                  <UserPlus className="h-3.5 w-3.5" /> Post on Behalf
                </button>
                <button onClick={() => navigate('/')} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 transition" title="View live site">
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : <div className="flex-1" />}

            {/* Runbooks. Opens in a new tab on purpose: the help centre lives outside
                the back-office shell, and someone checking an SLA mid-queue should not
                lose the queue they are working. Both variants get it — ops needs the
                runbooks more than admin does. Alignment is already handled upstream:
                AdminTopbarTools is flex-1 on the admin variant, and the ops variant
                renders a flex-1 spacer, so no margin is needed here. */}
            <a
              href="/help/c/ops-playbook"
              target="_blank"
              rel="noopener noreferrer"
              title={t('help.runbooks')}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-white/10 hover:text-white sm:min-h-0 sm:min-w-0"
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{t('help.runbooks')}</span>
            </a>

            {/* User profile + logout */}
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-teal/15 text-xs font-bold text-brand-teal">
                  {(user?.name || 'A').charAt(0).toUpperCase()}
                </div>
                <div className="hidden text-right sm:block">
                  <div className="text-sm font-semibold">{user?.name || 'Admin'}</div>
                  <div className="text-[11px] text-gray-400">
                    {roleLabel(user?.role)}
                    {user?.team ? ' · ' + user.team : ''}
                  </div>
                </div>
                <button onClick={doLogout} aria-label="Log out" className="tap-extend relative rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white transition" title="Log out">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </header>
        {/* The bottom padding carries the home-indicator inset. The consumer app
            routes every bottom offset through --dz-safe-b (see the chrome-token block
            in index.css); this shell was written without a bottom bar and so never
            picked the pattern up, which leaves the last row of a queue sitting under
            the gesture bar on a notched phone — exactly the row a field-ops user is
            reaching for. `env()` resolves to 0px on desktop and in a browser tab, so
            this is inert everywhere except an installed app on a notched device. */}
        <main className="flex-1 p-4 pb-[calc(1rem+var(--dz-safe-b))] sm:p-6 sm:pb-[calc(1.5rem+var(--dz-safe-b))]">
          {/* Same placement rationale as the consumer shell: a module that throws must not take
              the sidebar down with it, or a moderator loses the navigation they would use to get
              out of the broken queue. */}
          <ErrorBoundary scope="admin-route" resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
