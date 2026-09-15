import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';

/**
 * Hands the account to `/verify-identity` and renders nothing. Deliberately no `onVerified` or
 * `subtitle`: submit answers 202, so surfaces learn the outcome from `VerificationContext` later.
 */
export default function VerifyIdentityRedirect({
  onClose,
  source = 'unknown',
}) {
  const navigate = useNavigate();
  const location = useLocation();
  // One user action must leave exactly ONE history entry: StrictMode runs the mount effect twice,
  // and a duplicate push strands the user on the capture screen when they hit Back.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    navigate('/verify-identity', {
      state: {
        source,
        returnTo: location.pathname + location.search,
      },
    });
    onClose?.();
  }, [location.pathname, location.search, navigate, onClose, source]);

  return null;
}
