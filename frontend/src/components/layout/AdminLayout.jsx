import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Building2, ExternalLink, LayoutDashboard, LogOut, Menu, MessageSquare,
  FileText, ShieldCheck, Wrench, X, IndianRupee, UserPlus, BedDouble, Gift,
  BookOpen,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { roleLabel } from '../../lib/auth.js';
import { ADMIN_MODULES } from '../../lib/adminModules.js';
import { isSuperAdmin } from '../../lib/permissions.js';
import { AdminFlagsProvider, useAdminFlags } from '../../context/AdminFlagsContext.jsx';
import AdminTopbarTools from './AdminTopbarTools.jsx';

const OPS_NAV = [
  ['/ops', 'Dashboard', LayoutDashboard, true],
  ['/ops/requests', 'Requests', MessageSquare],
  ['/ops/rent-agreement', 'Rent Agreement', FileText],
  ['/ops/legal', 'Property & Legal', ShieldCheck],
  ['/ops/interior', 'Interior', Wrench],
  ['/ops/packers', 'Packers', Building2],
  ['/ops/valuation', 'Valuation', IndianRupee],
  ['/ops/referrals', 'Referrals', Gift],
  ['/ops/flatmate-review', 'Flatmate', BedDouble],
];

export default function AdminLayout({ variant = 'admin' }) {
  // Both variants render AdminLayoutInner, which calls useAdminFlags(); the
  // provider must wrap both so the ops variant doesn't throw (blank screen).
  return (
    <AdminFlagsProvider>
      <AdminLayoutInner variant={variant} />
    </AdminFlagsProvider>
  );
}

function AdminLayoutInner({ variant = 'admin' }) {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { tabEnabled, canModule } = useAdminFlags();
  const superAdmin = isSuperAdmin(user);
  // Admin sidebar is derived from the module registry, then filtered by the global
  // tab flag, the user's per-module access, and admin-only visibility.
  const nav = variant === 'ops'
    ? OPS_NAV
    : ADMIN_MODULES
        .filter((m) => (!m.flagKey || tabEnabled(m.flagKey)) && (!m.adminOnly || superAdmin) && canModule(user, m.key))
        .map((m) => [m.path, m.label, m.icon, m.end]);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const doLogout = () => {
    logout();
    navigate('/staff-login');
  };

  return (
    <div className="min-h-[100dvh] bg-ink lg:flex">
      <aside
        className={
          'fixed inset-y-0 left-0 z-50 w-64 transform border-r border-white/10 bg-ink-2 transition-transform lg:static lg:translate-x-0 ' +
          (open ? 'translate-x-0' : '-translate-x-full')
        }
      >
        <div className="flex items-center justify-between px-5 py-4">
          <Link to={variant === 'ops' ? '/ops' : '/admin'} className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-teal text-ink">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="font-extrabold">
              Pune<span className="text-brand-teal">Nest</span>
              <span className="ml-1 text-xs font-medium text-gray-400">{variant === 'ops' ? 'Ops' : 'Admin'}</span>
            </span>
          </Link>
          <button onClick={() => setOpen(false)} className="rounded-lg p-1 hover:bg-white/5 lg:hidden">
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
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all ' +
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
            <button onClick={() => setOpen(true)} className="rounded-lg p-2 hover:bg-white/5 lg:hidden">
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
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs font-medium text-gray-300 transition hover:bg-white/10 hover:text-white"
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
                <button onClick={doLogout} className="rounded-lg p-1.5 text-gray-400 hover:bg-white/5 hover:text-white transition" title="Log out">
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
