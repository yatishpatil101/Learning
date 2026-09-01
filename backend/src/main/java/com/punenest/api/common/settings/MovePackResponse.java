package com.punenest.api.common.settings;

import java.util.Map;

/**
 * The contract's {@code MovePackConfig} — whether the Move-in Pack is on sale, and for how much.
 *
 * <p>Public, for the reason {@code /fees} already settled: a price quoted to somebody who has not
 * signed in is not a privileged fact, and this one is quoted on a page that renders for visitors
 * who may never have an account. The admin-only settings document cannot serve it, because that
 * document also carries the permission map.
 *
 * <p><strong>Why {@code items} is an open map rather than a record of named prices.</strong> The
 * pack's contents are a merchandising decision — movers, cleaning, an agreement, paint, a
 * verification, a broadband connection today, something else next quarter. A record would make
 * adding a line item a deploy, and worse, binding the stored block to a record would silently drop
 * every key the record did not name, which is the failure mode {@code AdminSettingsController}
 * already documents for this same document.
 *
 * <p><strong>Prices are whole rupees</strong>, like every other money value on the platform. There
 * are no paise anywhere in this codebase and this is not the field that introduces them.
 *
 * <p><strong>Non-numeric entries are dropped rather than forwarded</strong>, the same way
 * {@code GET /flags} drops non-booleans: the contract types these as integers, and a hand-edited
 * {@code "8000"} string passed through would be a response that disagrees with its own schema.
 *
 * @param enabled whether the pack is on sale. When {@code false} the page runs in "coming soon"
 *     mode — prices hidden, waitlist capture instead of booking
 * @param items   price per pack line item in whole rupees, keyed by item slug. Empty is a real
 *     answer, not an error
 */
public record MovePackResponse(
        boolean enabled,
        Map<String, Integer> items) {
}
