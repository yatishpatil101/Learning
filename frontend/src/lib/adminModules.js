/* Admin tabs use server-resolved atoms from `user.permissions`; the console composes no union. */
import {
  BarChart3, Building2, Calculator, FileSignature, FileText, Gauge, Gift, Landmark, LayoutDashboard, LifeBuoy,
  MessageSquare, Paintbrush, Scale, Settings, Truck, Users, Flag, IndianRupee, UserPlus,
  MapPin, UsersRound,
} from 'lucide-react';

// `value` is the server's desk slug (`desk:<value>` function); Home Loans has tickets, not service requests.
export const SERVICE_DESKS = [
  { value: 'rental', label: 'Rent Agreement', path: '/admin/rent-agreement', icon: FileSignature },
  { value: 'legal', label: 'Property & Legal', path: '/admin/legal', icon: Scale },
  { value: 'loans', label: 'Home Loans', path: '/admin/home-loans', icon: Landmark, atom: 'tickets:read', writeAtom: 'tickets:write' },
  { value: 'interior', label: 'Interior & Renovation', path: '/admin/interior', icon: Paintbrush },
  { value: 'packers', label: 'Packers & Movers', path: '/admin/packers', icon: Truck },
  { value: 'valuation', label: 'Property Valuation', path: '/admin/valuation', icon: Calculator },
];
export const DESK_BY_VALUE = Object.fromEntries(SERVICE_DESKS.map((d) => [d.value, d]));

// Home Loans is the ticket board itself; every other desk shows tickets under `?view=tickets`.
export const ticketPath = (ticket, open = false) => {
  const desk = DESK_BY_VALUE[ticket?.desk] || DESK_BY_VALUE.loans;
  const params = new URLSearchParams(desk.value === 'loans' ? {} : { view: 'tickets' });
  if (open && ticket?.id) params.set('open', ticket.id);
  const qs = params.toString();
  return qs ? `${desk.path}?${qs}` : desk.path;
};

const DESK_MODULES = SERVICE_DESKS.map(({ atom = 'services:read', writeAtom = 'services:write', ...d }) => ({
  key: `desk:${d.value}`, label: d.label, path: d.path, icon: d.icon, desk: d.value, atom, writeAtom,
}));

export const ADMIN_MODULES = [
  { key: 'dashboard', label: 'Dashboard', path: '/admin', icon: LayoutDashboard, end: true, base: true },
  { key: 'kycReview', label: 'KYC Review', path: '/admin/kyc-review', icon: UserPlus, atom: 'identity:write' },
  { key: 'analytics', label: 'Analytics', path: '/admin/analytics', icon: BarChart3, flagKey: 'analytics', atom: 'analytics:read' },
  { key: 'postOnBehalf', label: 'Post on Behalf', path: '/admin/post-on-behalf', icon: UserPlus, atom: 'postOnBehalf:write' },
  { key: 'staffActivity', label: 'Team Activity', path: '/admin/staff-activity', icon: Gauge, atom: 'audit:read' },
  { key: 'properties', label: 'Properties', path: '/admin/properties', icon: Building2, atom: 'properties:read', writeAtom: 'properties:moderate' },
  { key: 'users', label: 'Users', path: '/admin/users', icon: Users, atom: 'users:read' },
  ...DESK_MODULES,
  { key: 'support', label: 'Support queue', path: '/admin/support', icon: LifeBuoy, atom: 'tickets:read', writeAtom: 'tickets:write' },
  { key: 'enquiries', label: 'Enquiries', path: '/admin/enquiries', icon: MessageSquare, atom: 'enquiries:read' },
  { key: 'referrals', label: 'Referrals', path: '/admin/referrals', icon: Gift, atom: 'reports:write' },
  { key: 'finance', label: 'Finance', path: '/admin/finance', icon: IndianRupee, flagKey: 'finance', adminOnly: true, atom: 'finance:read' },
  { key: 'content', label: 'Content', path: '/admin/content', icon: FileText, atom: 'content:read', writeAtom: 'content:write' },
  { key: 'reports', label: 'Reports', path: '/admin/reports', icon: Flag, flagKey: 'reports', atom: 'reports:read', writeAtom: 'reports:write' },
  { key: 'flatmates', label: 'Flatmates', path: '/admin/flatmates', icon: Users, flagKey: 'flatmates', atom: 'flatmates:read', writeAtom: 'flatmates:write' },
  { key: 'societies', label: 'Societies', path: '/admin/societies', icon: Building2, atom: 'societies:read', writeAtom: 'societies:write' },
  { key: 'localities', label: 'Localities', path: '/admin/localities', icon: MapPin, atom: 'properties:moderate', writeAtom: 'properties:moderate' },
  { key: 'team', label: 'Team & Access', path: '/admin/team', icon: UsersRound, atom: 'users:write' },
  { key: 'settings', label: 'Settings', path: '/admin/settings', icon: Settings, adminOnly: true, atom: 'settings:read', writeAtom: 'settings:write' },
];

export const MODULE_BY_KEY = Object.fromEntries(ADMIN_MODULES.map((m) => [m.key, m]));
export const MODULE_BY_PATH = Object.fromEntries(ADMIN_MODULES.map((m) => [m.path, m]));

// Keys that every admin-portal user always keeps (landing page).
export const BASE_MODULE_KEYS = ADMIN_MODULES.filter((m) => m.base).map((m) => m.key);

/* `user.permissions` is the server-resolved effective set; absent arrays grant nothing. */
export const hasPermission = (user, atom) =>
  !!atom && Array.isArray(user?.permissions) && user.permissions.includes(atom);

export function canAccessModule(user, key) {
  const mod = MODULE_BY_KEY[key];
  if (!mod) return false;
  if (mod.base) return true;
  // Only staff are scoped to desks; the server lets admin and manager work every desk.
  if (mod.desk && user?.role === 'staff' && !(Array.isArray(user?.desks) && user.desks.includes(mod.desk))) return false;
  return hasPermission(user, mod.atom);
}

/** Can this caller act inside a module, as opposed to only reading it? */
export const canWriteModule = (user, key) =>
  hasPermission(user, MODULE_BY_KEY[key]?.writeAtom);

// Paths outside the module list (the public site) are always open.
export function canOpenPath(user, href) {
  const mod = MODULE_BY_PATH[portalPath({ role: 'admin' }, String(href).split(/[?#]/)[0])];
  return !mod || canAccessModule(user, mod.key);
}

export const DESK_FUNCTION_PREFIX = 'desk:';
export const deskFromFunction = (fn) => String(fn || '').startsWith(DESK_FUNCTION_PREFIX)
  ? String(fn).slice(DESK_FUNCTION_PREFIX.length)
  : null;

export const moduleLabel = (key) => MODULE_BY_KEY[key]?.label || key;

// Staff work under /staff, manager and admin under /admin; module paths are written once as /admin.
export const portalBase = (user) => (user?.role === 'staff' ? '/staff' : '/admin');
export const portalPath = (user, path) => String(path).replace(/^\/(admin|staff)(?=[/?#]|$)/, portalBase(user));

/* Labels fall back to the raw atom when a grantable module has no readable shell entry. */
const ATOM_MODULE_LABELS = {
  dashboard: 'Dashboard',
  postOnBehalf: 'Post on Behalf',
  audit: 'Team Activity',
  tickets: 'Support Tickets',
  users: 'Users',
  identity: 'Identity Verification',
  registrations: 'Rent Agreement Registration Check',
};

export function permissionLabel({ module, action }) {
  const noun = ATOM_MODULE_LABELS[module]
    || MODULE_BY_KEY[module]?.label
    || module.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
  return `${noun} · ${action === 'write' ? 'Edit' : 'View'}`;
}
