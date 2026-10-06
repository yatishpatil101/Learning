import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPermission } from '../../lib/adminModules.js';

/** A desk's customer tickets as one more tab, or null without `tickets:read`. `?view=tickets` is what the dashboard links to. `count` is the queue summary's `openTickets`; a failed summary hides the pill. */
export default function useDeskTickets(count) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  if (!hasPermission(user, 'tickets:read')) return null;
  return {
    on: params.get('view') === 'tickets',
    show: () => setParams({ view: 'tickets' }, { replace: true }),
    tab: { key: 'tickets', label: 'Customer tickets', count: count ?? null },
  };
}
