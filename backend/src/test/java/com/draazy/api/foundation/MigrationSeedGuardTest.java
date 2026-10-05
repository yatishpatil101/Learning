package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

// Reference data belongs in a repeatable migration, and only a test can hold that line.
@DisplayName("Migrations — reference data never ships in a versioned file")
class MigrationSeedGuardTest {

    private static final Path MIGRATIONS = Path.of("src/main/resources/db/migration");

    private static final Path REFERENCE_SEED = MIGRATIONS.resolve("R__DML_seed_reference_data.sql");

    private static final Map<String, String> BACKFILLS = Map.of(
            "V71", "Re-seeds open review cases with the four-fact checklist the approval gate now requires;"
                    + " a reset DB has no open cases to re-seed.",
            "V90", "Converts stored per-account atom documents to function documents; a reset DB has no"
                    + " stored documents, and accounts without one fall back to the role default.");

    // Tables whose rows a versioned migration once seeded, and which the repeatable seed now owns alone.
    // Keyed by table rather than by version because there is no longer a version to point at.
    private static final Map<String, String> RE_HOMED_INTO_REFERENCE_SEED = Map.of(
            "message_template",
            "V78 created this table and seeded its ten WhatsApp templates in the same file, so the live "
                    + "reset destroyed them on every machine and GET /admin/message-templates answered [] "
                    + "for months. The rows now live in R__DML_seed_reference_data.sql with "
                    + "ON CONFLICT (id) DO UPDATE.");

    private static final Pattern INSERT = Pattern.compile("insert\\s+into\\s+([\\w.\"]+)", Pattern.CASE_INSENSITIVE);

    private static final Pattern VERSION = Pattern.compile("^(V\\d+)__");

    // A table listed as re-homed must still be seeded.
    // The comment on `#RE_HOMED_INTO_REFERENCE_SEED` claims the rows moved to the repeatable seed.
    @Test
    @DisplayName("a versioned migration that seeds reference data is a silent data-loss bug")
    void versionedMigrationsDoNotSeedReferenceData() {
        Map<String, List<String>> offenders = new TreeMap<>();

        for (Path migration : versionedMigrations()) {
            if (BACKFILLS.containsKey(version(migration))) {
                continue;
            }
            List<String> tables = insertedTables(read(migration));
            if (!tables.isEmpty()) {
                offenders.put(migration.getFileName().toString(), tables);
            }
        }

        assertThat(offenders)
                .as(
                        """
                        These versioned migrations insert rows. The live reset truncates every table and \
                        replays only the R__ seeds, and flyway_schema_history survives it -- so a V__ \
                        migration's rows are deleted by the first live run and never restored, on any \
                        machine, silently.

                        If these rows are reference data (the application expects them to exist on every \
                        environment): they belong in R__DML_seed_reference_data.sql with ON CONFLICT (id) DO \
                        UPDATE, and the table belongs in RE_HOMED_INTO_REFERENCE_SEED. Do not edit the \
                        versioned migration if it has been applied anywhere -- that changes its checksum \
                        and fails Flyway validation on the next start; write the seed and leave the \
                        migration alone.

                        If they are a one-time backfill: add the version to BACKFILLS with a sentence \
                        saying why losing them to the reset costs nothing.""")
                .isEmpty();
    }

    // A stale entry is worse than no entry: it reads as a considered exception while excusing nothing, and the next
    // person to reuse that version prefix inherits a blanket pass they never asked for.
    @Test
    @DisplayName("a table listed as re-homed still has its rows in the repeatable seed")
    void reHomedTablesAreStillSeeded() {
        List<String> seeded = insertedTables(read(REFERENCE_SEED));

        for (Map.Entry<String, String> entry : RE_HOMED_INTO_REFERENCE_SEED.entrySet()) {
            assertThat(seeded)
                    .as(
                            "%s is listed as re-homed, but nothing in R__DML_seed_reference_data.sql inserts "
                                    + "into it. The live reset truncates every table and replays only the R__ "
                                    + "seeds, so it is empty on every machine that has run the live suite once.%n%s",
                            entry.getKey(), entry.getValue())
                    .contains(entry.getKey());
        }
    }

    @Test
    @DisplayName("every listed version still exists and still inserts")
    void theListsDoNotRot() {
        Set<String> present = versionedMigrations().stream()
                .filter(m -> !insertedTables(read(m)).isEmpty())
                .map(MigrationSeedGuardTest::version)
                .collect(java.util.stream.Collectors.toSet());

        assertThat(present)
                .as("a listed migration was deleted or no longer inserts -- drop it from BACKFILLS")
                .containsAll(BACKFILLS.keySet());

        assertThat(present.stream().filter(v -> !BACKFILLS.containsKey(v)).toList())
                .as("the consolidated chain is DDL-only -- a versioned migration that inserts rows "
                        + "either belongs in an R__DML_ seed or needs a BACKFILLS entry explaining itself")
                .isEmpty();
    }

    private static List<Path> versionedMigrations() {
        try (Stream<Path> files = Files.list(MIGRATIONS)) {
            return files.filter(p -> p.getFileName().toString().matches("^V\\d+__.*\\.sql$"))
                    .sorted()
                    .toList();
        } catch (IOException e) {
            throw new UncheckedIOException(
                    "Could not read " + MIGRATIONS.toAbsolutePath() + " -- has the migration folder moved?", e);
        }
    }

    private static String version(Path migration) {
        Matcher m = VERSION.matcher(migration.getFileName().toString());
        return m.find() ? m.group(1) : migration.getFileName().toString();
    }

    private static List<String> insertedTables(String sql) {
        Matcher m = INSERT.matcher(stripComments(sql));
        return m.results().map(r -> r.group(1)).distinct().toList();
    }

    // Remove `--` line comments and `/* *``/` blocks before looking for inserts. Otherwise a migration that explains
    // in prose why it does not insert would be reported as inserting.
    private static String stripComments(String sql) {
        return sql.replaceAll("(?s)/\\*.*?\\*/", " ").replaceAll("--[^\\n]*", " ");
    }

    private static String read(Path migration) {
        try {
            return Files.readString(migration);
        } catch (IOException e) {
            throw new UncheckedIOException("Could not read " + migration, e);
        }
    }
}
