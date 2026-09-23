package com.draazy.api.engagement.flatmate;

/** {@code FlatmateSupplyService.declaresAgreement} wants the flag, the document, the regNo and both
 *  dates together; a fixture sending the bare flag still gets 201 but files at identity tier. */
final class FlatmateAgreementFixture {

    /** JSON fields, comma-separated, no braces — append inside an object literal. */
    static final String EVIDENCE = """
            "agreementDoc":{"name":"leave-and-licence.pdf","size":184320,\
            "mime":"application/pdf","dataUrl":"data:application/pdf;base64,JVBERi0xLjQK"},\
            "agreementRegNo":"PNE-3/1234/2025",\
            "agreementRegisteredOn":"2026-01-01","agreementValidTill":"2027-01-01\"""";

    private FlatmateAgreementFixture() {
    }
}
