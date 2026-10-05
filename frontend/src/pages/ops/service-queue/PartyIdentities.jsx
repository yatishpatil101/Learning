import { useState } from 'react';
import { Eye, EyeOff, ShieldAlert } from 'lucide-react';
import { readServiceRequestIdentities } from '../../../services/serviceRequestService.js';
import { classNames } from '../../../lib/format.js';

const PARTY_LABEL = { owner: 'Owner', tenant: 'Tenant', witness: 'Witness' };

/** Identity numbers live only in this component's state. Callers key it by request id and holder,
 *  so switching matters or a change of holder discards any reveal. The server lets only the holder
 *  read them and audits allowed and refused reads alike. */
export default function PartyIdentities({ requestId, className = 'rounded-2xl border border-white/10 p-4' }) {
  const [identities, setIdentities] = useState(null);
  const [status, setStatus] = useState('idle');
  const [refusal, setRefusal] = useState('');

  const reveal = async () => {
    if (status === 'loading') return;
    setStatus('loading');
    setRefusal('');
    try {
      setIdentities(await readServiceRequestIdentities(requestId));
      setStatus('ready');
    } catch (err) {
      setIdentities(null);
      setStatus('refused');
      setRefusal(err?.message || 'These numbers are visible only to the person working the matter.');
    }
  };

  const hide = () => {
    setIdentities(null);
    setStatus('idle');
    setRefusal('');
  };

  return (
    <section className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Parties&rsquo; identity numbers</h4>
        {status === 'ready' ? (
          <button type="button" onClick={hide} className="dz-btn dz-btn-ghost">
            <EyeOff className="h-4 w-4" /> Hide
          </button>
        ) : (
          <button type="button" onClick={reveal} disabled={status === 'loading'} className="dz-btn dz-btn-primary disabled:opacity-40">
            <Eye className="h-4 w-4" /> {status === 'loading' ? 'Checking…' : 'Reveal'}
          </button>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400">
        Holder only. Every attempt is recorded against your name; numbers are discarded once the request closes.
      </p>

      {status === 'refused' ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{refusal}</span>
        </div>
      ) : null}

      {status === 'ready' ? (
        identities.length === 0 ? (
          // Blank means either not supplied or already purged, so the copy must not claim more.
          <p className="mt-3 text-sm text-gray-500">
            Nothing was recorded against this request. Ask the customer to add the parties&rsquo; details before drafting.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {identities.map((p) => (
              <li key={`${p.partyRole}-${p.partyIndex}`} className="rounded-xl border border-white/5 bg-white/5 p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold">{p.partyName || `${PARTY_LABEL[p.partyRole] || 'Party'} ${p.partyIndex + 1}`}</span>
                  <span className="text-xs uppercase tracking-wide text-gray-500">{PARTY_LABEL[p.partyRole] || p.partyRole}</span>
                </div>
                {p.purged ? (
                  <div className="mt-1 text-xs text-gray-500">Recorded, and since discarded — this request has closed.</div>
                ) : (
                  <dl className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2">
                    <div className="flex justify-between gap-2 py-0.5">
                      <dt className="text-gray-400">PAN</dt>
                      <dd className={classNames('font-mono', p.pan ? '' : 'text-gray-500')}>{p.pan || 'not supplied'}</dd>
                    </div>
                    <div className="flex justify-between gap-2 py-0.5">
                      <dt className="text-gray-400">Aadhaar</dt>
                      <dd className={classNames('font-mono', p.aadhaar ? '' : 'text-gray-500')}>{p.aadhaar || 'not supplied'}</dd>
                    </div>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )
      ) : null}
    </section>
  );
}
