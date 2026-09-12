/**
 * The contact gate for one listing, as React state.
 *
 * The gate used to be read synchronously during render (`contactStatus(...)` straight out of
 * localStorage). Against a real API that is not available: the answer arrives over the network, so
 * every consumer needs the same three things — an effect that fetches it, a safe value to render
 * before it lands, and a way to replace it after the user acts on it. Duplicating that across
 * ContactBox, ContactOwnerModal and useProperty is how the three drift out of agreement about what
 * "approved" looks like, so it lives here once.
 *
 * `loading` matters for more than a spinner. `NO_CONTACT_GATE` reads as "no request made", which is
 * also the state that renders a *Request number* button — so a consumer that ignores `loading`
 * flashes that button at an already-approved user before correcting itself.
 */
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
      // A gate that fails to load must not blank the page: fall back to the closed state, which
      // shows the masked number and the request button. That is the safe direction — it can only
      // under-reveal, never hand out a number we failed to confirm the caller may see.
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
