import { useEffect, useId, useRef, useState } from 'react';

/**
 * Cloudflare Turnstile widget (tech-debt D130).
 *
 * Renders the challenge and hands the resulting token to `onToken`. It is deliberately
 * self-contained and wired into nothing: the token is passed upward, never stored, and the
 * component knows nothing about any particular form.
 *
 * The backend reads the token from the `CF-Turnstile-Response` header on the three public,
 * unauthenticated writes (`POST /auth/login`, `POST /cities/waitlist`, `POST /society-leads`).
 * Sending it as a header rather than a body field is what keeps every request DTO and the OpenAPI
 * contract unchanged.
 *
 * With no site key configured the component renders nothing and calls `onToken(null)` once, so a
 * form that gates its submit button on a token must treat "no widget" as "not required" — matching
 * the backend, which passes every request through when the challenge is switched off. Failing the
 * other way would make an unconfigured dev machine unable to submit anything.
 *
 * @param {object} props
 * @param {string} [props.siteKey] Turnstile site key. Public by design — it is safe in the bundle;
 *   the secret it pairs with lives only on the server. Defaults to `VITE_TURNSTILE_SITE_KEY`.
 * @param {(token: string | null) => void} props.onToken Called with a fresh token, or `null` when
 *   the token expires, the challenge fails, or no site key is configured.
 * @param {'light' | 'dark' | 'auto'} [props.theme='auto']
 * @param {'normal' | 'compact' | 'flexible'} [props.size='normal']
 * @param {string} [props.className]
 */
export default function TurnstileWidget({
  siteKey = import.meta.env?.VITE_TURNSTILE_SITE_KEY,
  onToken,
  theme = 'auto',
  size = 'normal',
  className = '',
}) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const instanceId = useId();

  // Held in a ref so that a parent passing an inline arrow function does not re-render the widget
  // on every keystroke. Turnstile issues single-use tokens, so a re-render is not free: it discards
  // a solved challenge and asks the user to solve another.
  const onTokenRef = useRef(onToken);
  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);

  useEffect(() => {
    if (!siteKey) {
      onTokenRef.current?.(null);
      return undefined;
    }

    // Re-armed in the effect body rather than only cleared in cleanup: under StrictMode the
    // mount → cleanup → re-mount cycle would otherwise leave this false forever, and every
    // callback after the first script load would be silently swallowed.
    let active = true;

    const render = () => {
      if (!active || !containerRef.current || !window.turnstile) return;
      // Clear first: StrictMode's double-effect would otherwise stack two widgets in one container.
      containerRef.current.innerHTML = '';
      try {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          size,
          callback: (token) => active && onTokenRef.current?.(token),
          // A token is single-use and short-lived. Clearing it on expiry is what stops a form
          // submitting a token the server will reject, which would surface to the user as an
          // unexplained failure on a form they filled in correctly.
          'expired-callback': () => active && onTokenRef.current?.(null),
          'timeout-callback': () => active && onTokenRef.current?.(null),
          'error-callback': () => {
            if (!active) return;
            setFailed(true);
            onTokenRef.current?.(null);
          },
        });
      } catch {
        setFailed(true);
        onTokenRef.current?.(null);
      }
    };

    if (window.turnstile) {
      render();
    } else {
      // One script tag for the whole app, keyed by id: two copies of the Turnstile API on a page
      // fight over the same global and the second render silently does nothing.
      const SCRIPT_ID = 'cf-turnstile-script';
      let script = document.getElementById(SCRIPT_ID);
      if (!script) {
        script = document.createElement('script');
        script.id = SCRIPT_ID;
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        script.async = true;
        script.defer = true;
        document.head.appendChild(script);
      }
      // Attached even when the tag already exists but has not finished loading — a second widget
      // mounting during that window would otherwise never render.
      script.addEventListener('load', render);
      script.addEventListener('error', () => {
        if (!active) return;
        setFailed(true);
        onTokenRef.current?.(null);
      });
    }

    return () => {
      active = false;
      if (widgetIdRef.current && window.turnstile?.remove) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // Already gone — the container was unmounted before Turnstile finished cleaning up.
        }
      }
      widgetIdRef.current = null;
    };
  }, [siteKey, theme, size]);

  if (!siteKey) return null;

  return (
    <div className={className}>
      <div ref={containerRef} data-testid="turnstile-widget" id={`turnstile-${instanceId}`} />
      {failed && (
        <p role="alert" className="text-sm text-red-600">
          The verification check could not load. Please refresh the page and try again.
        </p>
      )}
    </div>
  );
}
