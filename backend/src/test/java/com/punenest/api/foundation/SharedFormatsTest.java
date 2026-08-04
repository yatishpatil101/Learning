package com.punenest.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Fails the build when a shared input format is spelled inline instead of taken from
 * {@code common.validation.Formats} (tech debt D25).
 *
 * <p><strong>Why the constant alone is not the fix.</strong> Hoisting the nine duplicated mobile
 * patterns into one place cleans up the nine that exist; it does nothing about the tenth. Every one
 * of those nine was written by someone adding a field who reasonably copied the neighbouring DTO,
 * and the next person to add a mobile field will do exactly the same unless something says
 * otherwise. The register recorded three different 422 messages for one rule precisely because
 * nothing ever objected.
 *
 * <p><strong>What it checks and what it does not.</strong> Only the literal regex, and only under
 * {@code main}. It says nothing about whether a field <em>should</em> carry the pattern — that is a
 * contract question the spec answers and {@code validate_spec.py} guards. It is a textual rule
 * about a duplicated string, so it is a textual test, deliberately with no parser and no dependency:
 * the same reasoning that kept ArchUnit out of {@link ArchitectureBoundaryTest}.
 *
 * <p>{@code Formats.java} itself is the one legitimate site and is excluded by name.
 */
@DisplayName("Shared formats — no inline re-spelling (tech-debt D25)")
class SharedFormatsTest {

    private static final Path MAIN = Path.of("src", "main", "java").toAbsolutePath();

    /** The literal the register found at nine sites, exactly as it is written in Java source. */
    private static final String INLINE_MOBILE = "\"^[6-9][0-9]{9}$\"";

    /** Where the pattern is allowed to appear as a literal. */
    private static final String CANONICAL_HOME = "Formats.java";

    @Test
    @DisplayName("the Indian mobile pattern appears as a literal in exactly one file")
    void mobilePatternIsNotRespelled() {
        List<String> offenders = javaFiles()
                .filter(p -> !p.getFileName().toString().equals(CANONICAL_HOME))
                .filter(p -> read(p).contains(INLINE_MOBILE))
                .map(p -> MAIN.relativize(p).toString().replace('\\', '/'))
                .sorted()
                .toList();

        assertThat(offenders)
                .as("""
                        These files spell the Indian mobile pattern inline. Use \
                        @Pattern(regexp = Formats.MOBILE, message = Formats.MOBILE_MESSAGE) \
                        instead — the message matters as much as the regex, because a caller \
                        integrating against the platform should not see one rule described three \
                        ways depending on which endpoint rejected them.""")
                .isEmpty();
    }

    /** And the canonical home really does hold it, so the check above cannot pass by vacuity. */
    @Test
    @DisplayName("the canonical home holds the pattern it claims to own")
    void formatsActuallyDeclaresIt() {
        Path formats = MAIN.resolve(
                Path.of("com", "punenest", "api", "common", "validation", CANONICAL_HOME));

        assertThat(formats).exists();
        assertThat(read(formats)).contains(INLINE_MOBILE);
    }

    private static Stream<Path> javaFiles() {
        try (Stream<Path> walk = Files.walk(MAIN)) {
            return walk.filter(p -> p.getFileName().toString().endsWith(".java")).toList().stream();
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot walk " + MAIN, e);
        }
    }

    private static String read(Path file) {
        try {
            return Files.readString(file, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot read " + file, e);
        }
    }
}
