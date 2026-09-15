package com.draazy.api.provider;

/**
 * Seam for inspecting an uploaded file before it is stored. Every registered implementation runs and
 * any one may refuse, so adding one only narrows. docs/system/cross-cutting.md#87-uploads.
 */
public interface DocumentScanner {

    /**
     * Decide whether these bytes may be stored. {@code contentType} is the type the caller
     * <em>proved</em> from the signature, not the one the client declared.
     */
    Verdict scan(String fileName, String contentType, byte[] content);

    /**
     * The answer, and the reason if it is a refusal. {@code detail} is shown to the uploader, so it
     * must describe the file and never the scanner's internals.
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
