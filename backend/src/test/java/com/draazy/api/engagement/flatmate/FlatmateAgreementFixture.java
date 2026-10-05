package com.draazy.api.engagement.flatmate;

final class FlatmateAgreementFixture {

    /** JSON fields, comma-separated, no braces — append inside an object literal. */
    static final String EVIDENCE = """
            "agreementDoc":{"id":"agr-doc-1","name":"leave-and-licence.pdf","size":184320,\
            "mime":"application/pdf","dataUrl":"data:application/pdf;base64,JVBERi0xLjQK"},\
            "ownerConsent":true""";

    static String evidence(String documentId) {
        return """
                "agreementDoc":{"id":"%s","name":"leave-and-licence.pdf","size":184320,\
                "mime":"application/pdf","dataUrl":"data:application/pdf;base64,JVBERi0xLjQK"},\
                "ownerConsent":true""".formatted(documentId);
    }

    private FlatmateAgreementFixture() {
    }
}
