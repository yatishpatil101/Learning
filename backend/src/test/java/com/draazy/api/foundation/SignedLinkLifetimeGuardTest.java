package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The ownership review panel's link-withdrawal interval must stay shorter than every server-side
 * signing TTL. Matched by constant name so a rename fails loudly.
 */
class SignedLinkLifetimeGuardTest {

    private static final Path MODULE = Path.of("").toAbsolutePath();

    /** {@code const LINK_LIFETIME_MS = 10 * 60 * 1000;} */
    private static final Pattern CLIENT_LIFETIME =
            Pattern.compile("LINK_LIFETIME_MS\\s*=\\s*(\\d+)\\s*\\*\\s*60\\s*\\*\\s*1000");

    /** {@code private static final Duration URL_TTL = Duration.ofMinutes(15);} */
    private static final Pattern R2_TTL =
            Pattern.compile("URL_TTL\\s*=\\s*Duration\\.ofMinutes\\((\\d+)\\)");

    /** {@code private static final Duration TTL = Duration.ofMinutes(30);} */
    private static final Pattern DEV_TTL =
            Pattern.compile("TTL\\s*=\\s*Duration\\.ofMinutes\\((\\d+)\\)");

    @Test
    @DisplayName("the review panel gives up on a file link before the object store does")
    void theClientAgesLinksOutBeforeEveryServerThatSignsThem() {
        int clientMinutes = minutes(CLIENT_LIFETIME, Path.of("frontend", "src", "pages", "admin",
                "properties", "review-modal", "OwnershipEvidencePanel.jsx"));
        int r2Minutes = minutes(R2_TTL, Path.of("backend", "src", "main", "java", "com", "draazy",
                "api", "provider", "storage", "R2FileStorage.java"));
        int devMinutes = minutes(DEV_TTL, Path.of("backend", "src", "main", "java", "com", "draazy",
                "api", "provider", "storage", "DevObjectStore.java"));

        assertThat(clientMinutes)
                .as("OwnershipEvidencePanel withdraws links after %d min, but R2 signs for only %d;"
                        + " the reviewer would be handed a dead link for %d min",
                        clientMinutes, r2Minutes, clientMinutes - r2Minutes)
                .isLessThan(r2Minutes);
        assertThat(clientMinutes).isLessThan(devMinutes);
    }

    private static int minutes(Pattern pattern, Path relative) {
        Path file = repoRoot().resolve(relative);
        assertThat(file).as("guarded file moved; update this guard, not its expectation").exists();
        String source;
        try {
            source = Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        Matcher matcher = pattern.matcher(source);
        assertThat(matcher.find())
                .as("%s no longer declares a constant matching /%s/", relative, pattern.pattern())
                .isTrue();
        int value = Integer.parseInt(matcher.group(1));
        return value;
    }

    /** The repository root, found by its {@code .git} directory rather than by counting hops. */
    private static Path repoRoot() {
        for (Path p = MODULE; p != null; p = p.getParent()) {
            if (Files.isDirectory(p.resolve(".git"))) {
                return p;
            }
        }
        return MODULE;
    }
}
