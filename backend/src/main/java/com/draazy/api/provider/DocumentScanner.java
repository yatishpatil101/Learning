package com.draazy.api.provider;

/**
 * Seam for inspecting an uploaded file before it is stored (tech-debt D131).
 *
 * <p><strong>Why a seam and not a method.</strong> ADR-013 deferred malware scanning, and the whole
 * trace of that decision was a comment. The vault accepts 10 MB files and hands back signed URLs
 * that a buyer, a lawyer or a bank officer opens — so "what may be stored" is a policy question with
 * more than one answer depending on what the deployment has available, which is the same shape as
 * {@link FileStorage} and {@link KycProvider}: an interface here, a free default that always works,
 * and a real adapter that switches on when it is configured.
 *
 * <p><strong>Every registered implementation runs, and any one of them can refuse.</strong> The
 * caller injects {@code List<DocumentScanner>} rather than a single bean, because these are not
 * alternatives — the built-in structural checker and a clamd daemon answer different questions and
 * a deployment with both wants both. Adding an implementation therefore only ever narrows what is
 * accepted, never widens it.
 *
 * <p><strong>Where the third implementation is going.</strong> OCR-based document validation — does
 * this scan of an "Index II" actually read like an Index II — is intended to arrive on this seam as
 * another {@code DocumentScanner}, not as a branch inside an existing one. That is why {@link #scan}
 * is handed the file's category-free raw material (name, proved type, bytes) and answers with a
 * {@link Verdict} rather than a boolean: an OCR implementation needs to say <em>why</em> it refused,
 * and that string is the only thing the user will see. It is deliberately <em>not</em> built here.
 *
 * <p><strong>Boundary.</strong> This is shared kernel, so it cannot see the vault's own
 * {@code DocumentUploads} allowlist and must not try to. The caller runs that first and passes in
 * the type it <em>proved</em> from the bytes; an implementation here is told the answer rather than
 * re-deriving it.
 */
public interface DocumentScanner {

    /**
     * Decide whether these bytes may be stored.
     *
     * <p>Implementations must be side-effect free and must not mutate {@code content} — several run
     * over the same array, in registration order, and one changing it would silently change what the
     * next one sees.
     *
     * @param fileName    the client's original filename, unsanitised; metadata only, never a path
     * @param contentType the media type the bytes were <em>proved</em> to be by the caller's
     *                    signature check — not the type the client declared
     * @param content     the whole file, already in memory (the size ceiling is what makes that safe)
     * @return {@link Verdict#clean()}, or a refusal carrying a message fit to show the uploader
     * @throws java.io.UncheckedIOException if the implementation cannot reach a verdict at all — an
     *                                      undecidable upload must fail, never pass. See
     *                                      {@code ClamAvScanner} for the reasoning.
     */
    Verdict scan(String fileName, String contentType, byte[] content);

    /**
     * The answer, and the reason if it is a refusal.
     *
     * <p>Three outcomes rather than a boolean because two of them are already different HTTP
     * answers in this API — 413 for a file that is too big, 415 for one whose content is not
     * acceptable — and collapsing them here would force the caller to parse {@link #detail} to tell
     * them apart.
     *
     * @param outcome what to do with the file
     * @param detail  shown to the uploader on a refusal; {@code null} when clean. Safe to display:
     *                implementations must describe the <em>file</em>, never the scanner's internals
     *                (a clamd signature name, for instance, is a fingerprint of our configuration)
     */
    record Verdict(Outcome outcome, String detail) {

        /** What the caller should do with the file. */
        public enum Outcome {
            /** Store it. */
            CLEAN,
            /** Refuse it as too large (413). */
            TOO_LARGE,
            /** Refuse its content (415). */
            REJECTED
        }

        private static final Verdict CLEAN = new Verdict(Outcome.CLEAN, null);

        public static Verdict clean() {
            return CLEAN;
        }

        public static Verdict tooLarge(String detail) {
            return new Verdict(Outcome.TOO_LARGE, detail);
        }

        public static Verdict rejected(String detail) {
            return new Verdict(Outcome.REJECTED, detail);
        }

        public boolean isClean() {
            return outcome == Outcome.CLEAN;
        }
    }
}
