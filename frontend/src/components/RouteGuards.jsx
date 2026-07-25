import { Navigate, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { useAdminFlags } from '../context/AdminFlagsContext.jsx';
import { useAppFlags } from '../context/AppFlagsContext.jsx';

/* Mock route guards (UX only — localStorage is editable, this is not real security). */

export function ProtectedRoute({ children }) {
  const { isIn } = useAuth();
  const location = useLocation();
  if (!isIn) return <Navigate to={`/signin?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return children;
}

export function RoleRoute({ roles, redirect = '/staff-login', children }) {
  const { user } = useAuth();
  const location = useLocation();
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

/* Per-user module access route (admin RBAC). Super-admins pass everything; scoped
   internal users may only open modules granted by their role bundle + overrides.
   Waits for settings/custom-roles to load so a manager isn't briefly false-denied. */
export function ModuleRoute({ moduleKey, children }) {
  const { user } = useAuth();
  const { canModule, loading } = useAdminFlags();
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-teal-400/30 border-t-teal-400 rounded-full animate-spin" />
      </div>
    );
  }
  if (!canModule(user, moduleKey)) return <Navigate to="/admin" replace />;
  return children;
}

/* Consumer feature flag route: redirects to / if the flag is disabled. */
export function AppFlagRoute({ flag, children }) {
  const { flagEnabled } = useAppFlags();
  if (!flagEnabled(flag)) return <Navigate to="/" replace />;
  return children;
}

/* Team-scoped ops route: staff must have the required team in their teams[] array.
   Admins bypass (they have full access). Mirrors HTML's OPS_SERVICE_TEAM guard. */
export function TeamRoute({ team, children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/staff-login" replace />;
  if (user.role === 'admin') return children;
  const userTeams = user.teams || (user.team ? [user.team] : []);
  if (!userTeams.includes(team)) return <Navigate to={`/ops?denied=${team}`} replace />;
  return children;
}
