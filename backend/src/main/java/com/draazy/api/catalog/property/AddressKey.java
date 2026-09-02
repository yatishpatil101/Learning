package com.draazy.api.catalog.property;

import java.util.Arrays;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Collectors;

/**
 * Normalises a street address into a comparison key (V79).
 *
 * <p><strong>What problem this solves.</strong> "Flat 402, B Wing, Rohan Nilay, Baner" and
 * "B-402 Rohan Nilay, Baner, Pune 411045" are the same doorway, and a marketplace that cannot see
 * that cannot notice one flat listed twice by two different owners. Comparing the raw strings
 * matches nothing: Indian addresses carry no standard word order, no standard punctuation, and a
 * long tail of interchangeable filler words. Both of those collapse here to
 * {@code "402 b nilay rohan"}.
 *
 * <p>Three rules get them there, and each exists because of a specific way the same address gets
 * written twice.
 *
 * <ul>
 *   <li><strong>Filler words are dropped.</strong> The words that differ between two spellings are
 *       almost entirely structural nouns — "flat", "wing", "building", "society". They carry
 *       nothing that distinguishes one unit from another, because every address in the building has
 *       them, and they are exactly what one writer includes and the next omits.</li>
 *   <li><strong>Tokens are sorted.</strong> "Flat 402, B Wing" and "B-402" name the same unit in
 *       opposite order, and that reordering is the norm rather than an edge case — there is no
 *       convention in Indian addressing about whether the wing precedes the number, or the building
 *       precedes the road. Sorting makes order stop mattering. It costs some precision: an address
 *       differing only by permutation now matches, which for street addresses is a distinction
 *       almost nothing real depends on.</li>
 *   <li><strong>The listing's own city, locality and any pincode are removed.</strong> One writer
 *       ends at the locality and the next spells out "Baner, Pune 411045"; that tail is present on
 *       one side of the comparison and absent on the other. The city and locality are taken from the
 *       row being indexed rather than from a hard-coded list of place names — that list goes stale
 *       the first time this platform serves a second city.</li>
 * </ul>
 *
 * <p><strong>Deliberately not fuzzy.</strong> No edit distance, no phonetic matching, no
 * transliteration. The output feeds a rule that opens a moderation case against a legitimate owner,
 * so a false positive costs somebody real time — and once matching becomes approximate there is no
 * defensible line between "close enough" and "a different flat in the same building". Exact
 * equality of a conservatively normalised string is a rule that can be explained to the owner it
 * fires on.
 */
public final class AddressKey {

    private AddressKey() {
    }

    /**
     * Structural words that appear in one spelling of an address and not the next.
     *
     * <p>Every entry is a word that is true of every unit in the building, so removing it cannot
     * merge two addresses that were genuinely distinguishable. That is the test for adding to this
     * list, and it is why street types ("road", "lane", "marg") are absent: they name <em>which</em>
     * street, so dropping those really would merge distinct addresses.
     */
    private static final Set<String> FILLER = Set.of(
            "flat", "apt", "apartment", "unit", "room", "no", "number", "wing", "block", "tower",
            "bldg", "building", "society", "soc", "chs", "chsl", "the", "near", "opp", "opposite",
            "behind");

    /**
     * Build the comparison key for one listing.
     *
     * @param address  the address as the owner typed it
     * @param city     the listing's city column, removed from the key where it appears in the address
     * @param locality the listing's locality column, removed for the same reason
     * @return the key, or {@code null} when the address is absent or does not normalise to at least
     *     two tokens — which the duplicate probe reads as "no signal", the right answer for an
     *     address that said only "the society building"
     */
    public static String of(String address, String city, String locality) {
        if (address == null) {
            return null;
        }
        Set<String> drop = new HashSet<>(FILLER);
        drop.addAll(tokens(city));
        drop.addAll(tokens(locality));
        Set<String> kept = tokens(address).stream()
                .filter(token -> !drop.contains(token))
                // Six digits standing alone is a pincode. Dropped rather than kept because it is
                // present in one spelling and absent in the other, and the row carries it in its own
                // column anyway — this key is never where that fact is stored.
                .filter(token -> !token.matches("\\d{6}"))
                .collect(Collectors.toSet());
        // One token is not an address. "Flat 402" normalises to "402", which collides with every
        // flat 402 in the locality — a different building, a different owner, a real listing. The
        // probe's output is a moderator's time, so the cost of a loose key is paid by an honest
        // owner waiting behind a queue of manufactured suspicions. Two tokens is the point at which
        // the key names a doorway rather than a floor plan.
        if (kept.size() < 2) {
            return null;
        }
        // A TreeSet does the sort in one step. `tokens` has already de-duplicated, which matters as
        // much as the sort: "Rohan Nilay, Nilay Society" and "Rohan Nilay" should not differ over a
        // repetition, because a repeated token is never what distinguishes two doorways.
        return String.join(" ", new TreeSet<>(kept));
    }

    /**
     * Split on anything that is not a letter or a digit, so "B-402", "B 402" and "B/402" all split
     * the same way. Unicode-aware, because a Devanagari address is still an address; the filler list
     * will not match it, which degrades to case-and-punctuation normalisation rather than to a wrong
     * answer.
     *
     * <p>{@code Locale.ROOT} and not the default locale. Under a Turkish or Azeri default,
     * {@code "I"} lowercases to {@code "\u0131"} rather than {@code "i"} — so the filler list would
     * stop matching, and, far worse, keys written before and after a locale change would never
     * compare equal again. The value is persisted, so that damage is permanent and silent.
     */
    private static Set<String> tokens(String text) {
        if (text == null || text.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(text.toLowerCase(Locale.ROOT).split("[^\\p{L}\\p{N}]+"))
                .filter(token -> !token.isEmpty())
                .collect(Collectors.toSet());
    }
}
