package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Structural rules for the migration chain.
 *
 * <p><strong>Why a test rather than a convention.</strong> On 2026-08-04 the local database became
 * unbootable and unrepairable at once, from two mistakes that a code review would not obviously
 * catch:
 *
 * <ul>
 *   <li>{@code V7} and {@code V24} both ran {@code CREATE TABLE society_leads}. Every database that
 *       had grown incrementally was fine, because V7 ran when V24 did not exist yet; every database
 *       built from scratch died on V24 with {@code relation already exists}. The chain had been
 *       un-replayable for months and nothing said so, because <strong>the test suite only ever
 *       migrates forward from whatever the test database already contains</strong> — it never
 *       builds one from empty.</li>
 *   <li>Fixing that meant editing {@code V7}, which changed its checksum, which is what actually
 *       broke the running database: Flyway refused to start against a history recording the old
 *       one.</li>
 * </ul>
 *
 * <p>Both checks below are cheap and textual. Neither replaces actually replaying the chain into an
 * empty database (see {@code docs/LOCAL_DEV.md} §1) — that is the real proof, and it needs a
 * database this test does not have. These catch the two specific shapes that caused the outage,
 * before the migration is ever run.
 */
@DisplayName("Migrations — the chain stays replayable")
class MigrationChainTest {

    private static final Path MIGRATIONS =
            Path.of("src", "main", "resources", "db", "migration").toAbsolutePath();

    /** {@code CREATE TABLE [IF NOT EXISTS] <name>} — the statement whose duplication broke us. */
    private static final Pattern CREATE_TABLE = Pattern.compile(
            "(?im)^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?([a-z_][a-z0-9_]*)");

    private static Stream<Path> sqlFiles() {
        try {
            return Files.list(MIGRATIONS).filter(p -> p.toString().endsWith(".sql"));
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + MIGRATIONS, e);
        }
    }

    private static String read(Path p) {
        try {
            return Files.readString(p, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new UncheckedIOException("cannot read " + p, e);
        }
    }

    /** Strip {@code --} line comments so a table named only in prose does not count as created. */
    private static String withoutComments(String sql) {
        return sql.replaceAll("(?m)--.*$", "");
    }

    @Test
    @DisplayName("no table is created twice in the chain")
    void noTableIsCreatedTwice() {
        Map<String, List<String>> creators = new TreeMap<>();
        sqlFiles().sorted().forEach(file -> {
            Matcher m = CREATE_TABLE.matcher(withoutComments(read(file)));
            while (m.find()) {
                creators.computeIfAbsent(m.group(1).toLowerCase(java.util.Locale.ROOT),
                        k -> new java.util.ArrayList<>()).add(file.getFileName().toString());
            }
        });

        Map<String, List<String>> duplicated = new TreeMap<>();
        creators.forEach((table, files) -> {
            if (files.size() > 1) {
                duplicated.put(table, files);
            }
        });

        assertThat(duplicated)
                .as("each of these tables is created by more than one migration. A database that "
                        + "grew incrementally survives it; one built from scratch fails on the "
                        + "second CREATE with 'relation already exists'. Keep the later, considered "
                        + "definition and delete the earlier sketch — and note that doing so edits "
                        + "an applied migration, so every existing database has to be rebuilt")
                .isEmpty();
    }

    /**
     * A weaker but useful companion: every versioned migration must have a distinct version number.
     * Two files claiming {@code V30} is not something Flyway resolves quietly — it refuses to start
     * — but it is worth catching at build time rather than at boot, because the natural way to
     * produce it is two people adding a migration on separate branches, and the merge looks clean.
     */
    @Test
    @DisplayName("no two migrations claim the same version")
    void versionsAreUnique() {
        Pattern versioned = Pattern.compile("^V(\\d+)__");
        Map<String, List<String>> byVersion = new TreeMap<>();
        sqlFiles().forEach(file -> {
            String name = file.getFileName().toString();
            Matcher m = versioned.matcher(name);
            if (m.find()) {
                byVersion.computeIfAbsent(m.group(1), k -> new java.util.ArrayList<>()).add(name);
            }
        });

        Map<String, List<String>> clashes = new TreeMap<>();
        byVersion.forEach((version, files) -> {
            if (files.size() > 1) {
                clashes.put(version, files);
            }
        });

        assertThat(clashes)
                .as("two migrations share a version number — renumber the later one")
                .isEmpty();
    }
}
