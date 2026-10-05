package com.draazy.api.foundation;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

// Package-level checks allow shared identity/catalog vocabulary without hiding real feature leaks.
@DisplayName("Architecture — package boundaries (package-structure.md §2)")
class ArchitectureBoundaryTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "draazy", "api");

    // The shared kernel. May never depend on a feature context.
    private static final Set<String> SHARED_KERNEL = Set.of("common", "security", "provider");

    // Context layering. An import may only point at a <strong>strictly lower</strong> rank.
    // Adding a bounded context to the codebase means adding a line here.
    private static final Map<String, Integer> LAYER = new LinkedHashMap<>();

    static {
        LAYER.put("content", 0);
        LAYER.put("identity", 0);
        LAYER.put("catalog", 1);

        LAYER.put("documents", 2);
        LAYER.put("leads", 2);

        // engagement depends on catalog (PropertyMapper, SocietyRepository) but not on leads,
        // finance or deals, so it sits at the same rank as leads — the two never interact.
        LAYER.put("engagement", 2);

        // It must stay strictly below finance, because the payment webhook finance already owns is what activates a
        // paid subscription or boost — so the arrow is finance -> billing.
        LAYER.put("billing", 2);

        // Ranking finance above deals would make that legitimate call a violation and invite someone to "fix" it by
        // leads (2) and finance (4) never interact; only the strict ordering matters.
        LAYER.put("finance", 4);

        LAYER.put("services", 3);
        LAYER.put("deals", 5);

        LAYER.put("moderation", 6);

        // The back-office reports on the whole platform, so ranking it top is the only placement that makes its reads
        // legal.
        LAYER.put("admin", 7);
    }

    @Test
    @DisplayName("the shared kernel never depends on a feature context")
    void sharedKernelDoesNotDependOnFeatures() {
        List<String> violations = new ArrayList<>();
        for (String kernel : SHARED_KERNEL) {
            for (SourceFile f : sourcesIn(kernel)) {
                for (String target : LAYER.keySet()) {
                    if (f.references(target)) {
                        violations.add("%s references feature context '%s'".formatted(f.path, target));
                    }
                }
            }
        }
        assertThat(violations)
                .as("""
                        A shared-kernel package (common/security/provider) reached into a feature \
                        context. The kernel is imported by everything, so this makes the feature \
                        un-removable and creates a cycle through the kernel. Invert it: define a \
                        port in common.* and let the feature implement it (see common.trust.ContactGate).""")
                .isEmpty();
    }

    @Test
    @DisplayName("feature contexts only depend downward — the context graph stays acyclic")
    void featureDependenciesPointDownward() {
        List<String> violations = new ArrayList<>();
        for (Map.Entry<String, Integer> from : LAYER.entrySet()) {
            for (SourceFile f : sourcesIn(from.getKey())) {
                for (Map.Entry<String, Integer> to : LAYER.entrySet()) {
                    if (to.getKey().equals(from.getKey())) {
                        continue;
                    }
                    if (f.references(to.getKey()) && to.getValue() >= from.getValue()) {
                        violations.add("%s (layer %d) references '%s' (layer %d)"
                                .formatted(f.path, from.getValue(), to.getKey(), to.getValue()));
                    }
                }
            }
        }
        assertThat(violations)
                .as("""
                        A bounded context referenced one at the same or a higher layer, which \
                        introduces a cycle. Downward reads are fine (deals resolving a Property or \
                        a User). For an upward need, publish an event or define a port in common.* \
                        — do not import back up.""")
                .isEmpty();
    }

    @Test
    @DisplayName("every context package on disk is ranked in the layering table")
    void everyContextIsRanked() {
        try (Stream<Path> dirs = Files.list(MAIN)) {
            List<String> unranked = dirs
                    .filter(Files::isDirectory)
                    .map(p -> p.getFileName().toString())
                    .filter(name -> !SHARED_KERNEL.contains(name) && !LAYER.containsKey(name))
                    .toList();
            assertThat(unranked)
                    .as("""
                            A new bounded context appeared without a layer. Unranked packages are \
                            invisible to the rules above, so the guardrail would silently stop \
                            covering the newest — and least settled — part of the codebase. Add it \
                            to LAYER and to package-structure.md §2.""")
                    .isEmpty();
        } catch (IOException e) {
            throw new IllegalStateException("cannot list " + MAIN.toAbsolutePath(), e);
        }
    }

    private static List<SourceFile> sourcesIn(String context) {
        Path root = MAIN.resolve(context);
        if (!Files.isDirectory(root)) {
            return List.of();
        }
        try (Stream<Path> paths = Files.walk(root)) {
            return paths
                    .filter(p -> p.getFileName().toString().endsWith(".java"))
                    .map(SourceFile::read)
                    .toList();
        } catch (IOException e) {
            throw new IllegalStateException("cannot walk " + root.toAbsolutePath(), e);
        }
    }

    private record SourceFile(String path, String body) {

        static SourceFile read(Path p) {
            try {
                return new SourceFile(p.toString(), Files.readString(p, StandardCharsets.UTF_8));
            } catch (IOException e) {
                throw new IllegalStateException("cannot read " + p, e);
            }
        }

        // True if this file names the given context anywhere in code — as an import or as a fully-qualified inline
        // reference.
        boolean references(String context) {
            return stripComments(body).contains("com.draazy.api." + context + ".");
        }

        private static String stripComments(String src) {
            return src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
        }
    }
}
