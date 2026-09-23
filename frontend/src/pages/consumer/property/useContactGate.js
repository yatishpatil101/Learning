/* `loading` matters for more than a spinner: `NO_CONTACT_GATE` reads as "no request made", which is
   also what renders the *Request number* button — ignoring `loading` flashes it at an approved user. */
import { useCallback, useEffect, useState } from 'react';
import { NO_CONTACT_GATE } from '../../../lib/contact.js';
import { contactStatus } from '../../../services/contactService.js';

export function useContactGate(propertyId) {
  const [gate, setGate] = useState(NO_CONTACT_GATE);
  const [loading, setLoading] = useState(Boolean(propertyId));

  const refresh = useCallback(async () => {
    if (!propertyId) {
      setGate(NO_CONTACT_GATE);
      setLoading(false);
      return NO_CONTACT_GATE;
    }
    const next = await contactStatus(propertyId);
    setGate(next);
    setLoading(false);
    return next;
  }, [propertyId]);

  useEffect(() => {
    let alive = true;
    setLoading(Boolean(propertyId));

    if (!propertyId) {
      setGate(NO_CONTACT_GATE);
      setLoading(false);
      return undefined;
    }

    contactStatus(propertyId)
      .then((next) => {
        if (alive) setGate(next);
      })
      // Falling back to the closed state can only under-reveal, never hand out a number we failed
      // to confirm the caller may see.
      .catch(() => {
        if (alive) setGate(NO_CONTACT_GATE);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [propertyId]);

  return { gate, loading, setGate, refresh };
}
