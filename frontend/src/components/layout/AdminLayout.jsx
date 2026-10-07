import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ExternalLink, LogOut, Menu,
  X, UserPlus,
  BookOpen, Moon, Sun,
} from 'lucide-react';
import LogoMark from '../brand/LogoMark.jsx';
import ConnectivityBanner from '../ConnectivityBanner.jsx';
import ErrorBoundary from '../ErrorBoundary.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { roleLabel } from '../../lib/auth.js';
import { setAppPrefs } from '../../lib/localPrefs.js';
import { useIsLightTheme } from '../../lib/themeColour.js';
import { ADMIN_MODULES, canAccessModule, hasPermission, portalBase, portalPath } from '../../lib/adminModules.js';
import { AdminFlagsProvider, useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import AdminTopbarTools from './AdminTopbarTools.jsx';

export default function AdminLayout() {
  const { user } = useAuth();
  return (
    <AdminFlagsProvider read={hasPermission(user, 'settings:read')}>
      <AdminLayoutInner />
    </AdminFlagsProvider>
  );
}

function AdminLayoutInner() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { tabEnabled } = useAdminFlags();
  /* `adminOnly` is not a third filter: the server's catalogue already makes those atoms administrator-only. */
  const nav = ADMIN_MODULES
    .filter((m) => (!m.flagKey || tabEnabled(m.flagKey)) && canAccessModule(user, m.key))
    .map((m) => [portalPath(user, m.path), m.label, m.icon, m.end]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const light = useIsLightTheme();

  const doLogout = () => {
    logout();
    navigate('/staff-login');
  };

  return (
    <div className="ph-no-capture min-h-[100dvh] bg-ink lg:flex">
      {/* Staff get the same connectivity banner: a queue that fails to load looks exactly like an empty one. */}
      <ConnectivityBanner />
      <aside
        className={
          'fixed inset-y-0 left-0 z-50 w-64 transform border-r border-white/10 bg-ink-2 transition-transform lg:static lg:translate-x-0 ' +
          (open ? 'translate-x-0' : '-translate-x-full')
        }
      >
        <div className="flex items-center justify-between px-5 py-4">
          {/* min-h on touch only: the drawer has nothing beside the
              wordmark; the desktop rail keeps its 56px header. */}
          <Link to={portalBase(user)} className="flex min-h-[44px] items-center gap-2 sm:min-h-0">
            <LogoMark className="h-8 w-8 shrink-0 text-brand-teal" />
            <span className="font-extrabold">
              Draazy
              <span className="ml-1 text-xs font-medium text-gray-400">{roleLabel(user?.role)}</span>
            </span>
          </Link>
          {/* tap-extend, not tap-target: growing the box would push
              the wordmark; aria-label as phones never show `title`. */}
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
                /* py-3 below sm: 16 nav rows at 40px are a long thumb-drag,
                   and a miss lands on the neighbouring section. */
                'flex items-center gap-3 rounded-xl px-3 py-3 sm:py-2.5 text-sm transition-all ' +
                (isActive ? 'bg-brand-teal/15 text-brand-teal' : 'text-gray-300 hover:bg-white/5 hover:text-white')
              }
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <div className="flex min-h-[100dvh] flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-ink/80 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-2.5">
            <button onClick={() => setOpen(true)} aria-label="Open menu" className="tap-extend relative rounded-lg p-2 hover:bg-white/5 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>

            <AdminTopbarTools />

            {hasPermission(user, 'postOnBehalf:write') ? (
              <div className="hidden items-center gap-1.5 ml-auto lg:flex">
                <button onClick={() => navigate(portalPath(user, '/admin/post-on-behalf'))} className="flex items-center gap-1.5 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-medium text-teal-300 hover:bg-teal-500/20 transition">
                  <UserPlus className="h-3.5 w-3.5" /> Post on Behalf
                </button>
                <button onClick={() => navigate('/')} className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-white/10 transition" title="View live site">
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : <div className="flex-1" />}

            <button
              type="button"
              onClick={() => setAppPrefs({ theme: light ? 'dark' : 'light' })}
              aria-label={light ? 'Switch to dark mode' : 'Switch to light mode'}
              aria-pressed={light}
              title={light ? 'Dark mode' : 'Light mode'}
              className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-white/10 bg-white/5 p-1.5 text-gray-300 transition hover:bg-white/10 hover:text-white sm:min-h-0 sm:min-w-0"
            >
              {light ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            </button>

            {/* New tab so checking an SLA mid-queue doesn't lose the
                queue; AdminTopbarTools is flex-1, so no margin here. */}
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
                  </div>
                </div>
                <button onClick={doLogout} aria-label="Log out" className="tap-extend relative rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white transition" title="Log out">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </header>
        {/* Bottom padding carries the home-indicator inset (--dz-safe-b) so the last queue row isn't under the
            gesture bar; env() is 0px outside an installed notched app. */}
        <main className="flex-1 p-4 pb-[calc(1rem+var(--dz-safe-b))] sm:p-6 sm:pb-[calc(1.5rem+var(--dz-safe-b))]">
          {/* Same placement as the consumer shell: a throwing module must not take the sidebar down with it. */}
          <ErrorBoundary scope="admin-route" resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
