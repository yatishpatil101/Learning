package com.draazy.api.billing.referral;

import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Arrays;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Turns a request into the two correlation digests the referral fraud desk reads (D55).
 *
 * <p><strong>Hashes, never the values.</strong> {@code same_device} and {@code same_ip} have been on
 * the contract since V7 and have always been {@code false}, because the platform captured neither
 * side of the comparison. Capturing them means holding something about where a person was and what
 * they were using, which is personal data the platform has no other purpose for — so it holds a
 * salted digest and nothing else. Equality is the only question ever asked of these values, and a
 * digest answers it exactly as well as the original.
 *
 * <p><strong>Why salted.</strong> An unsalted SHA-256 of an IPv4 address is not a one-way function
 * in any useful sense: the input space is 2³², so the entire rainbow table fits on a laptop and the
 * "hash" is a reversible encoding. The salt is a deployment secret, which makes reversal require the
 * secret rather than an afternoon. It is the same reasoning that puts a salt on a password and the
 * reason {@code Tokens.sha256Hex} — which hashes unguessable 256-bit tokens, where the input space
 * is the protection — is deliberately <em>not</em> reused here.
 *
 * <p><strong>IPv6 is collapsed to its /64.</strong> A single household is routinely assigned an
 * entire /64 and privacy extensions rotate the host half on a timer, so a digest of the full address
 * would fail to match the same person minutes later and {@code same_ip} would be permanently false
 * for every IPv6 client — a fabricated negative, which is the failure this class exists to remove.
 * {@code WriteRateLimitFilter#anonymousKey} collapses to the same boundary for the same reason; it
 * is package-private in {@code security} and hashes nothing, so the rule is restated here rather
 * than shared.
 *
 * <p><strong>Purpose limitation is a code fact, not only a promise.</strong> Nothing outside this
 * package reads a digest: {@link ReferralService} compares them at redemption, and
 * {@link ReferralSignalRetention} blanks them after ninety days. They are not on the wire, not in a
 * log line and not an analytics input.
 */
@Component
public class ReferralSignals {

    /** {@code SHA-256}, by its JCA name. */
    private static final String ALGORITHM = "SHA-256";

    /** Bytes of an IPv6 address that identify the /64. See the class Javadoc. */
    private static final int IPV6_PREFIX_BYTES = 8;

    /**
     * Separates the salt from the value so that two different fields cannot collide by accident —
     * a digest of {@code salt + value} is ambiguous about where one ends and the other begins.
     */
    private static final String SEPARATOR = "\u0000";

    private final String salt;

    public ReferralSignals(@Value("${draazy.security.referral-signal-salt}") String salt) {
        // why @Value and not @ConfigurationProperties: the binder resolves placeholders with
        // ignoreUnresolvablePlaceholders = true, so an unset variable would bind the literal
        // "${REFERRAL_SIGNAL_SALT}" and every deployment would silently share one well-known salt.
        // The same trap TrustedProxyConfig documents at length.
        this.salt = salt;
    }

    /**
     * The two digests for {@code request}, either of which may be {@code null}.
     *
     * <p>A null digest means the request did not carry the input — a missing {@code User-Agent}
     * header, or a container that reported no address. It is recorded as absent, never as a digest
     * of the empty string: that would make every such request match every other one and manufacture
     * exactly the correlation this is here to detect.
     */
    public Signals of(HttpServletRequest request) {
        if (request == null) {
            return Signals.NONE;
        }
        return new Signals(
                hash(collapse(request.getRemoteAddr())),
                hash(blankToNull(request.getHeader("User-Agent"))));
    }

    /**
     * Whether a stored digest and a freshly computed one describe the same thing.
     *
     * <p>Null never matches null. A referral code minted before V64 has no stored digest, and a
     * request that carried no {@code User-Agent} produces none — reading "both absent" as "the same
     * device" would flag honest referrals on the strength of two pieces of missing evidence.
     */
    public static boolean matches(String stored, String observed) {
        return stored != null && stored.equals(observed);
    }

    /** One request's correlation digests. Either field may be null; see {@link #of}. */
    public record Signals(String ipHash, String deviceHash) {

        /** Nothing observed — used where there is no request to read, such as a scheduled job. */
        public static final Signals NONE = new Signals(null, null);
    }

    private String hash(String value) {
        if (value == null) {
            return null;
        }
        try {
            MessageDigest digest = MessageDigest.getInstance(ALGORITHM);
            return HexFormat.of().formatHex(
                    digest.digest((salt + SEPARATOR + value).getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            // Every JRE ships SHA-256; this is unreachable and is rethrown rather than swallowed
            // because silently returning null here would report a clean fraud desk on a broken one.
            throw new IllegalStateException(ALGORITHM + " unavailable", impossible);
        }
    }

    /** IPv4 unchanged; IPv6 reduced to its /64. See the class Javadoc for why. */
    private static String collapse(String address) {
        String trimmed = blankToNull(address);
        if (trimmed == null || trimmed.indexOf(':') < 0) {
            return trimmed;
        }
        try {
            byte[] bytes = InetAddress.getByName(trimmed).getAddress();
            if (bytes.length != 16) {
                return trimmed;
            }
            return HexFormat.of().formatHex(Arrays.copyOf(bytes, IPV6_PREFIX_BYTES));
        } catch (UnknownHostException notAnAddress) {
            // getByName does not resolve here: a colon-bearing value that is not a literal IPv6
            // address is something a proxy invented, and hashing it as-is keeps it distinguishable
            // instead of merging every malformed value into one bucket.
            return trimmed;
        }
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
