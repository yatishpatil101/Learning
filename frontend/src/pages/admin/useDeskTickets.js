import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPermission } from '../../lib/adminModules.js';
import { listTicketQueue } from '../../services/ticketService.js';

/** A desk's customer tickets as one more tab, or null without `tickets:read`. `?view=tickets` is what the dashboard links to. */
export default function useDeskTickets(desk) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const allowed = hasPermission(user, 'tickets:read');
  const [count, setCount] = useState(null);

  useEffect(() => {
    if (!allowed) return undefined;
    let live = true;
    // A failed count hides the pill rather than reading "0"; the tab itself still loads the board.
    listTicketQueue({ team: desk, status: 'open', size: 1 }).then((r) => { if (live) setCount(r.total); }, () => {});
    return () => { live = false; };
  }, [allowed, desk]);

  if (!allowed) return null;
  return {
    on: params.get('view') === 'tickets',
    show: () => setParams({ view: 'tickets' }, { replace: true }),
    tab: { key: 'tickets', label: 'Customer tickets', count },
  };
}
