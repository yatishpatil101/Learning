/**
 * The one non-loopback `--base` guard, shared by `parity-all.mjs` and every `*-parity.mjs` harness.
 *
 * ## Why this is a module rather than a paste
 *
 * The guard was first written twice — once in `parity-all.mjs`, once each in `society-parity.mjs`
 * and `referral-parity.mjs` — because those two are the harnesses whose writes cannot be undone.
 * That left the other eighteen protected *only* when launched through the runner:
 * `node scripts/deal-parity.mjs --base https://…` went straight through, and several of the
 * eighteen write as freely as the two that were guarded (deals get closed, contracts signed,
 * documents uploaded, tickets filed). A guard that depends on which entry point you happened to
 * use is not a guard; it is a habit.
 *
 * Three copies of a security check also drift. The moment one of them learns about a new loopback
 * form — say a `[::ffff:127.0.0.1]` literal — and the others do not, the fleet disagrees about
 * what "local" means, and the copy that is wrong is the one nobody reads. So: one function, one
 * host test, one message shape, and per-caller wording for the only part that is genuinely
 * per-caller — *what this particular harness would do to the environment it was aimed at*.
 *
 * ## The test
 *
 * Parsed with `new URL` rather than matched as a substring, because `http://localhost.evil.com/api`
 * contains "localhost" and resolves nowhere near this machine. Loopback is `localhost`, `::1`, or
 * anything in `127/8` — the whole /8, because `127.0.0.2` is as local as `127.0.0.1` and a harness
 * that refused it would be teaching people to reach for the escape hatch.
 *
 * DNS is deliberately not consulted. A hostname that *resolves* to 127.0.0.1 today is still a name
 * somebody else controls tomorrow, and a guard that makes a network call to decide whether it is
 * safe to make network calls has already lost. The cost of that strictness is that a custom hosts
 * entry has to opt out explicitly, which is the right way round.
 *
 * @param base   the resolved base URL, exactly as the harness will use it.
 * @param allowNonLoopback  what `--i-know-what-im-doing` resolved to for this caller — normally
 *   `args.has('i-know-what-im-doing')`. Passed in rather than read from `process.argv` here so the
 *   module stays independent of each script's own argv parsing.
 * @param why  one or more lines naming the damage this caller could do, already indented to sit
 *   under the `--base` line. Callers pass their own because "approves a society claim, which
 *   reassigns real residents" is worth more at the moment of refusal than any generic sentence.
 */
export function assertLoopbackBase(base, allowNonLoopback, why) {
  if (allowNonLoopback) return;
  let host;
  try {
    // `hostname` keeps the brackets on an IPv6 literal, so `[::1]` arrives bracketed.
    host = new URL(base).hostname.replace(/^\[|\]$/g, '');
  } catch {
    console.error(`\n  --base is not a URL: ${base}\n`);
    process.exit(1);
  }
  if (host === 'localhost' || host === '::1' || /^127\.\d+\.\d+\.\d+$/.test(host)) return;
  console.error(
    `\n  Refusing to run: --base points at ${host}, which is not loopback.`
    + `\n    --base ${base}`
    + `\n  ${why}`
    + '\n  If that is genuinely what you want, re-run with --i-know-what-im-doing as the LAST'
    + '\n  argument (the arg parser reads pairs, so a valueless flag has to come last).\n',
  );
  process.exit(1);
}
