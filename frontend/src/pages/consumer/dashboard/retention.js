/* Dashboard retention helpers — all derived from REAL per-user state, never
   fabricated. Powers the Overview "stickiness" loop: profile completion and
   alert-match nudges. */

/* Profile-completion meter. Every step maps to a real field or verification signal, so the
   percentage is honest and `next` is a concrete action. Mobile is excluded on purpose — it is
   always present after login and would only inflate the base. */
export function profileCompletion(user, identityVerified) {
  const has = (v) => !!(v && String(v).trim());
  const steps = [
    { key: 'name', label: 'Add your name', done: has(user?.name) },
    { key: 'email', label: 'Add your email address', done: has(user?.email) },
    { key: 'city', label: 'Set your city', done: has(user?.city) },
    { key: 'identity', label: 'Verify your identity', done: !!identityVerified },
  ];
  const done = steps.filter((s) => s.done).length;
  const percent = Math.round((done / steps.length) * 100);
  const next = steps.find((s) => !s.done) || null;
  return { percent, steps, done, total: steps.length, next };
}
