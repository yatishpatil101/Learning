package com.punenest.api.catalog.society;

/**
 * The two human actions that mint a society, held by {@code societies.mint_origin}.
 *
 * <p>Deliberately a separate class from {@link SocietySources} rather than two more constants on it.
 * The two answer different questions about the same row — {@code source} is where the record came
 * from and what a reader should weigh, {@code mint_origin} is which surface a person was standing on
 * when they added it — and every row that has a mint origin also has {@code source = 'community'}.
 * Putting five strings on one class is how somebody ends up comparing a mint origin against a
 * provenance and getting a permanent false.
 *
 * <p>The column's CHECK is the authority, as with sources.
 */
public final class SocietyMintOrigins {

    /**
     * A searcher looked for the building and the catalogue did not have it.
     *
     * <p>The value ops acts on: it is the only record that anybody wants a flat in this society. It
     * is never inferred or defaulted — a caller has to say so — because a fabricated one sends an
     * operator to go source inventory in a building nobody asked about.
     */
    public static final String DEMAND = "demand";

    /** Somebody posting a flat could not find their society. Supply arriving, not demand unserved. */
    public static final String LISTING = "listing";

    private SocietyMintOrigins() {
    }
}
