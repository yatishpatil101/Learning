import { expect } from '@playwright/test';

/* `[]` means the rule exists at top level; `null` means no such rule — the two are different
 *  failures and the assertions below distinguish them. */
const mediaWrapping = (page, selector) =>
  page.evaluate((sel) => {
    const found = [];
    let seen = 0;
    /* Per-rule try/catch, not one around the sheet: a single rule the CSSOM refuses to expose would
       otherwise abandon the remaining few thousand and report "no such rule". */
    const walk = (rules, conditions) => {
      for (const rule of rules) {
        seen += 1;
        try {
          const conds = rule.type === CSSRule.MEDIA_RULE ? [...conditions, rule.conditionText] : conditions;
          /* Match BEFORE recursing, and recurse unconditionally: since CSS Nesting, a plain style
             rule also carries an empty `cssRules`, so an `else if` branch swallows every rule. */
          if (rule.selectorText && rule.selectorText.split(',').some((s) => s.trim() === sel)) found.push(conds);
          if (rule.cssRules) walk(rule.cssRules, conds);
        } catch { /* one unreadable rule, e.g. an imported cross-origin sheet */ }
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules, []); } catch { /* cross-origin sheet — none of ours */ }
    }
    return { found, seen };
  }, selector);

/* A touchscreen synthesises `:hover` and holds it until the next tap lands elsewhere, so every
   decorative hover rule has to sit inside `(hover: hover)`. */
export async function expectHoverGated(page, selectors) {
  for (const selector of selectors) {
    const { found, seen } = await mediaWrapping(page, selector);
    expect(seen, 'the walk reached no CSS rules at all, so every assertion below would pass or fail for the wrong reason').toBeGreaterThan(100);
    expect(found.length, `${selector} has no rule at all — it was renamed or deleted, and this guard now proves nothing`).toBeGreaterThan(0);
    const gated = found.some((conds) => conds.some((c) => c.replace(/\s/g, '').includes('hover:hover')));
    expect(gated, `${selector} applies on a touchscreen, where the state it paints cannot be cleared`).toBe(true);
  }
}
