import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { useAdminFlags } from '../context/AdminFlagsContext.jsx';
import { useAppFlags } from '../context/AppFlagsContext.jsx';
import { canAccessModule } from '../lib/adminModules.js';

/* Client-side route guards. These decide what to RENDER, not what is permitted: the cached user
   they read is editable by anyone with devtools, so every protected read and write is enforced
   again server-side (@PreAuthorize). Their job is to avoid flashing a screen the session cannot
   use, and to send a visitor who lacks one to the sign-in door that fits the surface —
   /signin for the consumer app, /staff-login for the back office. */

/* Shown while the session is being revalidated. Every guard that can *deny* must render this
   instead of a decision: a restored session is only provisional until getMe() confirms it, and
   redirecting first would bounce a signed-in user to /signin on every hard refresh. */
function GuardPending() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="w-8 h-8 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" />
    </div>
  );
}

export function ProtectedRoute({ children }) {
  const { isIn, loading } = useAuth();
  const location = useLocation();
  if (loading) return <GuardPending />;
  if (!isIn) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export function RoleRoute({ roles, redirect = '/staff-login', children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <GuardPending />;
  if (!user) return <Navigate to={`${redirect}?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (!roles.includes(user.role)) return <Navigate to={redirect} replace />;
  return children;
}

/* Admin module flag route: redirects to /admin if the tab flag is disabled. */
export function FlagRoute({ flag, children }) {
  const { tabEnabled } = useAdminFlags();
  if (!tabEnabled(flag)) return <Navigate to="/admin" replace />;
  return children;
}

/* Per-module route guard. A caller may open a module iff the server resolved them the atom that
   opens it and returned it on `/auth/me`. No wait on the settings document any more — the answer
   travels with the user, so there is no second load that could false-deny during it. */
export function ModuleRoute({ moduleKey, children }) {
  const { user, loading: authLoading } = useAuth();
  if (authLoading) return <GuardPending />;
  if (!canAccessModule(user, moduleKey)) return <Navigate to="/admin" replace />;
  return children;
}

/* Consumer feature flag route: redirects to / if the flag is disabled. */
export function AppFlagRoute({ flag, children }) {
  const { flagEnabled } = useAppFlags();
  if (!flagEnabled(flag)) return <Navigate to="/" replace />;
  return children;
}
