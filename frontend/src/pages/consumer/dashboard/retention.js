/* Dashboard retention helpers — all derived from REAL per-user state, never
   fabricated. Powers the Overview "stickiness" loop: profile completion and
   alert-match nudges. */

/* Real profile-completion meter. Each step maps to an actual user field or a
   real verification signal (Aadhaar), so the percentage is honest and the
   "next step" is a concrete action the user can take. Mobile is intentionally
   excluded — it is always present after login and would only inflate the base.
   Returns { percent, steps[], done, total, next } where `next` is the first
   unfinished step (or null when the profile is fully complete). */
export function profileCompletion(user, aadhaarVerified) {
  const has = (v) => !!(v && String(v).trim());
  const steps = [
    { key: 'name', label: 'Add your name', done: has(user?.name) },
    { key: 'email', label: 'Add your email address', done: has(user?.email) },
    { key: 'city', label: 'Set your city', done: has(user?.city) },
    { key: 'aadhaar', label: 'Verify your identity with Aadhaar', done: !!aadhaarVerified },
  ];
  const done = steps.filter((s) => s.done).length;
  const percent = Math.round((done / steps.length) * 100);
  const next = steps.find((s) => !s.done) || null;
  return { percent, steps, done, total: steps.length, next };
}
