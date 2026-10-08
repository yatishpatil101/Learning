import { test, expect } from '../../../fixtures/live.js';
import { trackErrors } from '../../../helpers/console.js';

/* Content compiles into a virtual module, so a broken frontmatter field or renamed category fails silently
   at runtime; assert on rendered output. `access: staff` ships in the bundle, hidden only by lib/help.js. */

const listen = (page) => {
  const errors = trackErrors(page);
  return errors;
};

/** Help pages render an h1; wait for it rather than for networkidle (lazy route). */
async function openHelp(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
}

/* <EmptyState> renders a <p> rather than a heading, so an unresolved article has no h1 and specs wait on
   this copy. A staff-gated runbook resolves to nothing and lands here too. */
const NOT_FOUND = /could not find that article/i;

async function openHelpNotFound(page, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(NOT_FOUND).first()).toBeVisible({ timeout: 30_000 });
}

test.describe('Help centre — public surface', () => {
  test('landing lists the public categories and no staff runbooks, and a category lists its articles', async ({ page }) => {
    const errors = listen(page);
    await openHelp(page, '/help');

    // A public visitor sees the consumer taxonomy.
    await expect(page.getByRole('link', { name: /Getting started/i }).first()).toBeVisible();

    // ...and never the staff section, which is the whole point of the filter.
    await expect(page.getByText(/Ops playbook/i)).toHaveCount(0);
    expect(errors).toEqual([]);

    await openHelp(page, '/help/c/getting-started');

    // Every article filed under this category should be reachable from it.
    const links = page.locator('a[href*="/help/a/"]');
    expect(await links.count()).toBeGreaterThan(0);
    await expect(page.getByRole('link', { name: /What is Draazy/i }).first()).toBeVisible();
  });

  test('an article renders compiled prose, not raw markdown, with a TOC that resolves', async ({ page }) => {
    const errors = listen(page);
    await openHelp(page, '/help/a/what-is-draazy');

    const body = page.locator('.doc-prose').first();
    await expect(body).toBeVisible();

    // Markdown that failed to compile would surface as literal syntax.
    const text = await body.innerText();
    expect(text).not.toMatch(/^#{1,6}\s/m);      // unrendered headings
    expect(text).not.toMatch(/\]\(\/help\//);     // unrendered links
    expect(errors).toEqual([]);

    /* Slugging heading text can leak HTML entities or reduce Devanagari to an empty string; both give a TOC
       that scrolls nowhere, and show up as an empty or duplicated id. */
    const ids = await page.locator('.doc-prose :is(h2,h3)[id]').evaluateAll(
      (els) => els.map((e) => e.id),
    );
    for (const id of ids) expect(id).not.toBe('');
    expect(new Set(ids).size).toBe(ids.length);

    const targets = await page.locator('.doc-toc a[href^="#"], a.doc-toc__link[href^="#"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href').slice(1)));
    for (const target of targets) {
      expect(ids, `TOC links to #${target} but no heading has that id`).toContain(target);
    }
  });

  test('search finds an article by a word in its title and degrades to an empty state', async ({ page }) => {
    await openHelp(page, '/help/search?q=brokerage');
    await expect(page.getByRole('link', { name: /brokerage/i }).first()).toBeVisible();

    const errors = listen(page);
    await openHelp(page, '/help/search?q=zzzzzznotathing');

    // The page must still render its heading — a thrown search would white-screen.
    await expect(page.locator('h1').first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('FAQ and changelog render and /docs redirects into the help centre', async ({ page }) => {
    const errors = listen(page);

    await openHelp(page, '/help/faq');
    await openHelp(page, '/help/changelog');

    await page.goto('/docs', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 });
    expect(new URL(page.url()).pathname).toBe('/help');

    expect(errors).toEqual([]);
  });

  test('an unknown article slug fails soft', async ({ page }) => {
    const errors = listen(page);
    await openHelpNotFound(page, '/help/a/no-such-article-exists');

    // It must explain itself rather than white-screen or render an empty shell.
    await expect(page.locator('.doc-prose')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('Help centre — staff content boundary', () => {
  /* A matched pair: asserting only that staff see the runbook passes even if everyone can, and only that the
     public cannot passes even if nobody can. */

  test('anonymous and signed-in seeker visitors cannot reach a staff runbook', async ({ page, login }) => {
    // A gated article resolves to nothing, so the reader gets the same
    // not-found state as a bad slug — the runbook's existence is not disclosed.
    await openHelpNotFound(page, '/help/a/verification-sla');

    await expect(page.locator('.doc-prose')).toHaveCount(0);
    // The internal SLA copy must not be anywhere on the page.
    expect(await page.locator('body').innerText()).not.toMatch(/turnaround target/i);

    // Role, not merely authentication, is what gates staff content.
    await login.asBuyer();
    await openHelpNotFound(page, '/help/a/ticket-escalation');

    await expect(page.locator('.doc-prose')).toHaveCount(0);
  });

  test('an admin reaches the same runbook and sees the staff section on the landing page', async ({ page, login }) => {
    await login.asAdmin();
    await openHelp(page, '/help/a/verification-sla');

    await expect(page.locator('.doc-prose').first()).toBeVisible();

    await openHelp(page, '/help');

    await expect(page.getByText(/Ops playbook/i).first()).toBeVisible();
  });
});