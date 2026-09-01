package com.punenest.api.catalog.property;

/**
 * The 64-bit perceptual photo hash, and the arithmetic the duplicate probe does with it.
 *
 * <p>The hash itself is computed in the browser and cannot move here: it is an average hash over the
 * decoded pixels, and decoding an image is what {@code canvas} is for. The server never sees the
 * photo at this point in the flow — the wizard hashes what the owner picked, before any upload — so
 * re-deriving it here would mean fetching every uploaded image back out of storage to reproduce a
 * number the client already had. What does belong here is everything the client could never do:
 * storing the hash where it outlives the browser, and comparing it against other people's listings.
 *
 * <p>The format is fixed by {@code lib/data/imageHash.js} and this class is the other half of that
 * contract: 16 hex characters, 64 bits, one bit per cell of an 8x8 grayscale downscale, set where the
 * pixel is at or above the image mean. {@link #THRESHOLD} is the same 10 the client uses, and it is
 * the same number for the same reason — about 15% of the hash, loose enough to survive
 * re-compression and a mild crop, tight enough that two unrelated interiors do not collide.
 *
 * <p>{@link #bands(long)} exists for the index rather than for the comparison; see the
 * {@code property_photo_hashes} section of {@code V04__DDL_catalog_listings.sql} (added in the old
 * V116) for why band equality is a pre-filter and not a proof. Every candidate it returns is still
 * checked with {@link #distance(long, long)}.
 */
public final class PhotoHash {

    /** Two photos closer than this many bits of 64 are treated as the same shot. */
    public static final int THRESHOLD = 10;

    /** 16 hex characters, because the hash is exactly 64 bits. */
    private static final int HEX_LENGTH = 16;

    /** The most photos one listing may contribute. The wizard's own picker stops well below this. */
    public static final int MAX_PER_LISTING = 20;

    private PhotoHash() { }

    /**
     * Parse one 16-hex-char hash, or return null if it is not one.
     *
     * <p>Null rather than an exception, and the caller drops it: this arrives on the listing-create
     * body next to the fields an owner actually typed, and a photo whose hash arrived malformed is a
     * reason to lose a duplicate signal, not a reason to refuse the listing. A hash the owner cannot
     * see, cannot correct and did not enter must never be the thing that fails their post.
     *
     * <p>{@code parseUnsignedLong} rather than {@code parseLong}: half the hash space has the top bit
     * set, and those are the values a signed parse rejects. They round-trip through the column
     * unchanged because the comparison is bitwise.
     */
    public static Long parse(String hex) {
        if (hex == null || hex.length() != HEX_LENGTH) {
            return null;
        }
        try {
            return Long.parseUnsignedLong(hex, 16);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    /** Hamming distance: how many of the 64 bits differ. 0 is identical, 64 is the inverse image. */
    public static int distance(long a, long b) {
        return Long.bitCount(a ^ b);
    }

    /** True when two hashes are close enough to be the same photograph. */
    public static boolean sameShot(long a, long b) {
        return distance(a, b) <= THRESHOLD;
    }

    /**
     * The four 16-bit bands, in the same order as the generated columns.
     *
     * <p>The mask is what makes this correct for a hash with the top bit set: {@code >>} sign-extends,
     * and the mask throws the extension away.
     */
    public static int[] bands(long hash) {
        return new int[] {
            (int) ((hash >> 48) & 0xFFFF),
            (int) ((hash >> 32) & 0xFFFF),
            (int) ((hash >> 16) & 0xFFFF),
            (int) (hash & 0xFFFF),
        };
    }
}
