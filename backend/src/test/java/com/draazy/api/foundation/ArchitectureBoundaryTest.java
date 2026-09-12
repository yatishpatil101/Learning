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

/**
 * Enforces the package boundary rules of {@code docs/system/package-structure.md} §2.
 *
 * <p><strong>Why this exists.</strong> The original rule — "a feature context never imports another
 * feature context" — was aspirational and was already false when it was written. {@code identity}
 * owns "who" and {@code catalog} owns "which listing"; no transaction context can say anything
 * without both. Enforcing that rule would have needed an allowlist naming nearly every pair, which
 * permits everything and therefore guards nothing.
 *
 * <p>The property actually worth failing a build over is that the context graph stays
 * <strong>acyclic</strong>. The moment {@code identity} reaches back into {@code deals}, the two
 * have fused and neither can ever be extracted. So the rule enforced here is a <em>layering</em>:
 * every context is assigned a rank, and an import may only point at a strictly lower rank. Adding a
 * context means adding a rank — a deliberate, reviewable act — rather than quietly appending to an
 * allowlist.
 *
 * <p><strong>Why not ArchUnit.</strong> ArchUnit is the conventional tool and expresses this in
 * three lines, but it is not resolvable in this build environment and the rule is one paragraph of
 * string comparison. Per {@code ponytail}, a dependency must earn its keep. Scanning source text
 * also catches a case the usual bytecode import rule misses: a <em>fully-qualified inline</em>
 * reference such as {@code com.draazy.api.deals.offer.Offer o = ...}, which produces no import
 * statement at all.
 */
@DisplayName("Architecture — package boundaries (package-structure.md §2)")
class ArchitectureBoundaryTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "draazy", "api");

    /** The shared kernel. May never depend on a feature context. */
    private static final Set<String> SHARED_KERNEL = Set.of("common", "security", "provider");

    /**
     * Context layering. An import may only point at a <strong>strictly lower</strong> rank.
     * Adding a bounded context to the codebase means adding a line here.
     */
    private static final Map<String, Integer> LAYER = new LinkedHashMap<>();

    static {
        LAYER.put("content", 0);
        LAYER.put("identity", 0);
        LAYER.put("catalog", 1);
        // documents sits beside leads: both are join contexts over catalog + identity, and neither
        // touches the other. The document vault and the buyer's access request are the paperwork
        // analogue of a lead — an outsider asking an owner for something, and the owner deciding.
        LAYER.put("documents", 2);
        LAYER.put("leads", 2);
        // engagement depends on catalog (PropertyMapper, SocietyRepository) but not on leads,
        // finance or deals, so it sits at the same rank as leads — the two never interact.
        LAYER.put("engagement", 2);
        // billing sits at rank 2 with the other join contexts: it reads catalog (a boost is bought
        // for a property) and identity (a subscriber, a referrer), and nothing at its own rank or
        // above. It must stay strictly below finance, because the payment webhook finance already
        // owns is what activates a paid subscription or boost — so the arrow is finance -> billing.
        LAYER.put("billing", 2);
        // finance sits below deals, not beside it: DealService.close creates the tenancy that
        // starts a rent ledger (slice 5, D1), so the arrow points deals -> finance. Ranking finance
        // above deals would make that legitimate call a violation and invite someone to "fix" it by
        // having finance call back into deals — which is the cycle this whole test exists to
        // prevent. leads (2) and finance (4) never interact; only the strict ordering matters.
        //
        // It also sits *above* services rather than beside it, and that is the same rule as billing:
        // finance owns the one payment webhook, and a webhook that settles a purchase must be able
        // to reach whatever was bought. Services learned to sell a paid draft (V39), so the arrow
        // finance -> services is now real and must be legal. The alternative — having services
        // subscribe upward to a finance event — buys nothing here and inverts the direction the
        // money actually flows in.
        LAYER.put("finance", 4);
        // services sits below finance and above documents: it reads down into documents (the draft
        // and the registered copy are vault rows), catalog and identity, and touches neither finance
        // nor deals — the assisted-service workflow and the rent ledger never interact. Only the
        // strict ordering against documents (2) below and finance (4) above matters.
        LAYER.put("services", 3);
        LAYER.put("deals", 5);
        // moderation sits at the top because it is the one context that legitimately reaches into
        // everything: taking content down means touching catalog (properties), identity (users) and
        // engagement (reviews), and the abuse queue can point at any of them. Ranking it highest
        // means those reads are all downward and legal, while nothing below can call back up into
        // it — a listing can never decide it has been moderated.
        LAYER.put("moderation", 6);
        // admin sits above everything and imports none of it. The back-office reports on the whole
        // platform, so ranking it top is the only placement that makes its reads legal — but it
        // reaches the tables through native SQL rather than through the other contexts' repositories
        // (see AdminMetricsRepository), so in practice it has no outgoing edges at all. The rank is
        // here to keep it that way: if someone later injects PropertyRepository into an admin
        // service, the rank makes it legal — which is the point, because the alternative was leaving
        // admin off the map entirely and having this test silently ignore it.
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

        /**
         * True if this file names the given context anywhere in code — as an import or as a
         * fully-qualified inline reference. Javadoc and comments mentioning another context by name
         * are prose, not coupling, so they are stripped before matching.
         */
        boolean references(String context) {
            return stripComments(body).contains("com.draazy.api." + context + ".");
        }

        private static String stripComments(String src) {
            return src.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\n]*", "");
        }
    }
}
