package com.draazy.api.foundation;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.FileVisitResult;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.SimpleFileVisitor;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Fails the build when an empty source file appears anywhere in the repository: an empty spec is a
 * test that passes by having nothing to run. Scans the whole tree, since the generator is not Java.
 */
@DisplayName("Source tree — no empty source files (tech-debt D39, D75)")
class SourceTreeHygieneTest {

    /**
     * The module directory: Surefire runs with it as the working directory. The repo root is
     * resolved from it rather than assumed — see {@link #repoRoot()}.
     */
    private static final Path MODULE = Path.of("").toAbsolutePath();

    /**
     * Extensions where a zero-byte file is always a mistake. An allowlist, because a blocklist must
     * anticipate every marker file that is <em>meant</em> to be empty ({@code .gitkeep}, etc.).
     */
    private static final Set<String> SOURCE_EXTENSIONS = Set.of(
            ".java", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs",
            ".sql", ".py", ".css", ".scss", ".html", ".json", ".yaml", ".yml", ".md");

    /**
     * Never walked into: build output, dependencies, VCS and IDE scratch. {@code persist} is the
     * frontend's gitignored runtime store, which nobody wrote by hand and nobody can fix.
     */
    private static final Set<String> PRUNED = Set.of(
            "node_modules", "target", "target-cli", "bin", "dist", "build", "coverage",
            ".git", ".idea", ".vscode", ".gradle", ".venv", "__pycache__",
            "test-results", "playwright-report", ".copilot", ".claude", "persist");

    /**
     * Files that must contain mojibake to do their job, so the encoding guard skips them.
     * An exempt file is one this guard has stopped protecting, so the list stays short.
     */
    private static final Set<String> MOJIBAKE_EXEMPT = Set.of(
            "e2e/scripts/fix-mojibake.mjs");

    @Test
    @DisplayName("no empty or declaration-free source file exists anywhere in the repository")
    void noEmptySourceFiles() {
        Path root = repoRoot();
        List<String> empties = sourceFilesUnder(root).stream()
                .filter(SourceTreeHygieneTest::isEmpty)
                .map(p -> root.relativize(p).toString().replace('\\', '/'))
                .sorted()
                .toList();

        assertThat(empties)
                .as("""
                        Empty source files found. If they are untracked, they are not yours: \
                        something regenerated them (see this class's Javadoc — it has happened \
                        twice for .java alone). Delete them, then check whether the real file \
                        still exists one directory deeper before assuming anything is missing. \
                        If they are tracked, the file is a placeholder that was never filled in — \
                        an empty test spec in particular passes by having nothing to run, so \
                        delete it or write it rather than leaving it to imply coverage.""")
                .isEmpty();
    }

    /**
     * Fails on mojibake or a UTF-8 BOM: both are fingerprints of the same bad write (PowerShell
     * {@code Set-Content}). Round-trip detection, since a pattern list only catches known damage.
     */
    @Test
    @DisplayName("no mojibake or UTF-8 BOM in any source file (tech-debt D19)")
    void noMojibakeOrBom() {
        Path root = repoRoot();
        List<String> damaged = new ArrayList<>();
        for (Path file : sourceFilesUnder(root)) {
            String rel = root.relativize(file).toString().replace('\\', '/');
            if (MOJIBAKE_EXEMPT.contains(rel)) {
                continue;
            }
            String text;
            try {
                text = Files.readString(file, StandardCharsets.UTF_8);
            } catch (java.io.UncheckedIOException | IOException e) {
                continue;
            }
            if (!text.isEmpty() && text.charAt(0) == '\uFEFF') {
                damaged.add(rel + "  (UTF-8 BOM)");
            } else if (hasMojibake(text)) {
                damaged.add(rel + "  (mojibake)");
            }
        }

        assertThat(damaged)
                .as("""
                        Mojibake or a UTF-8 BOM found. Both mean the file was written by something \
                        that did not preserve UTF-8 — on this machine that is almost always \
                        PowerShell `Set-Content`, `>` redirection or `-replace`, which the repo \
                        notes ban on source files for exactly this reason. Do not hand-edit the \
                        damaged characters: re-run `node e2e/scripts/fix-mojibake.mjs` (DRY=1 \
                        first), which repairs by round-trip and cannot miss a sequence nobody \
                        thought to look for. Then fix the tool that wrote the file.""")
                .isEmpty();
    }

    /**
     * Runs stop at every ASCII character, and that bound is load-bearing: a UTF-8 sequence never
     * contains a byte below {@code 0x80}, so an absorbing run would let one bad character mask all.
     */
    private static boolean hasMojibake(String text) {
        int i = 0;
        while (i < text.length()) {
            if (text.charAt(i) < 0x80) {
                i += 1;
                continue;
            }
            int start = i;
            var bytes = new java.io.ByteArrayOutputStream();
            while (i < text.length()) {
                char c = text.charAt(i);
                if (c < 0x80) {
                    break;
                }
                int b = cp1252Byte(c);
                if (b < 0) {
                    break;
                }
                bytes.write(b);
                i += 1;
            }
            int runLength = i - start;
            if (runLength == 0) {
                i += 1; // Not CP1252-representable at all, so it cannot be mojibake.
                continue;
            }
            // `new String(bytes, UTF_8)` substitutes U+FFFD rather than throwing, which is the
            // signal wanted: a run that does not decode cleanly is not mojibake and is left alone.
            String decoded = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            if (decoded.indexOf('\uFFFD') < 0 && decoded.length() < runLength) {
                return true;
            }
        }
        return false;
    }

    /**
     * CP1252 differs from Latin-1 only in {@code 0x80}-{@code 0x9F}, and those 27 typographic
     * characters are precisely the ones that make mojibake recognisable.
     */
    private static int cp1252Byte(char c) {
        if (c < 0x80 || (c >= 0xA0 && c <= 0xFF)) {
            return c;
        }
        int idx = CP1252_HIGH.indexOf(c);
        return idx < 0 ? -1 : 0x80 + idx;
    }

    /** {@code 0x80}–{@code 0x9F} in CP1252 order; {@code '\0'} marks the five undefined slots. */
    private static final String CP1252_HIGH =
            "\u20AC\0\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\0\u017D\0"
            + "\0\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\0\u017E\u0178";

    /**
     * "Declares nothing" only for {@code .java}: no portable way to tell a comment-only script from
     * a deliberate one. {@code package-info.java} is exempt from that half, but not from zero-byte.
     */
    private static boolean isEmpty(Path file) {
        try {
            if (Files.size(file) == 0) {
                return true;
            }
            String name = file.getFileName().toString();
            if (!name.endsWith(".java")) {
                return Files.readString(file, StandardCharsets.UTF_8).isBlank();
            }
            if (name.equals("package-info.java")) {
                return false;
            }
            String stripped = Files.readString(file, StandardCharsets.UTF_8)
                    .replaceAll("(?s)/\\*.*?\\*/", "")
                    .replaceAll("//[^\\n]*", "")
                    .replaceAll("(?m)^\\s*package\\s+[^;]+;", "")
                    .replaceAll("(?m)^\\s*import\\s+[^;]+;", "")
                    .trim();
            return stripped.isEmpty();
        } catch (java.io.UncheckedIOException | IOException e) {
            // A file that cannot be read as UTF-8 is not a source file this guard has an opinion
            // about, so passing silently is correct here.
            return false;
        }
    }

    /**
     * The repository root, identified by the {@code .git} directory rather than by counting
     * {@code ..} hops, so the guard survives the module being nested more deeply.
     */
    private static Path repoRoot() {
        for (Path p = MODULE; p != null; p = p.getParent()) {
            if (Files.isDirectory(p.resolve(".git"))) {
                return p;
            }
        }
        return MODULE;
    }

    private static List<Path> sourceFilesUnder(Path root) {
        List<Path> found = new ArrayList<>();
        try {
            Files.walkFileTree(root, new SimpleFileVisitor<>() {
                @Override
                public FileVisitResult preVisitDirectory(Path dir, BasicFileAttributes attrs) {
                    return PRUNED.contains(dir.getFileName().toString())
                            ? FileVisitResult.SKIP_SUBTREE
                            : FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) {
                    String name = file.getFileName().toString().toLowerCase(Locale.ROOT);
                    int dot = name.lastIndexOf('.');
                    if (dot > 0 && SOURCE_EXTENSIONS.contains(name.substring(dot))) {
                        found.add(file);
                    }
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult visitFileFailed(Path file, IOException e) {
                    // An unreadable entry (a lock file, a permission quirk) must not fail the build.
                    return FileVisitResult.CONTINUE;
                }
            });
        } catch (IOException e) {
            throw new IllegalStateException("cannot walk " + root, e);
        }
        return found;
    }
}
