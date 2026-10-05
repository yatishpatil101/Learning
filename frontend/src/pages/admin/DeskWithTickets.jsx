import { useSearchParams } from 'react-router';
import { useAuth } from '../../context/AuthContext.jsx';
import { hasPermission } from '../../lib/adminModules.js';
import { classNames } from '../../lib/format.js';
import AdminServices from './AdminServices.jsx';

const VIEWS = [['requests', 'Requests'], ['tickets', 'Tickets']];

// Customer tickets are filed per team, separately from the desk's service requests.
export default function DeskWithTickets({ desk, children }) {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  if (!hasPermission(user, 'tickets:read')) return children;
  const view = params.get('view') === 'tickets' ? 'tickets' : 'requests';

  return (
    <div>
      <div className="mb-4 inline-flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
        {VIEWS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setParams(id === 'tickets' ? { view: 'tickets' } : {}, { replace: true })}
            aria-pressed={view === id}
            className={classNames('rounded-md px-3 py-1 text-xs font-medium transition', view === id ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white')}
          >
            {label}
          </button>
        ))}
      </div>
      {view === 'tickets' ? <AdminServices desk={desk} /> : children}
    </div>
  );
}
