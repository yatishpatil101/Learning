package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.security.AuthPrincipal;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

// The review tick authorizes drafting/e-registration and use of Aadhaar/PAN.
// Audit stores the exact text hash because browser-only consent proves nothing later.
final class RentAgreementDeclaration {

    // Must match DECLARATION_VERSION in the wizard's constants.js; bump both with the text.
    static final String VERSION = "ra-decl-2026-09";

    static final String TEXT = "I confirm the above details are correct and authorize Draazy to draft the Leave & "
            + "License agreement and assist with stamp duty payment & e-registration as per Maharashtra rules. "
            + "I consent to the Aadhaar and PAN details and documents given here being used only for this "
            + "agreement and its e-registration with the Department of Registration & Stamps, Maharashtra, and "
            + "I confirm every person named has agreed to their details being shared for that purpose.";

    static final String TEXT_SHA256 = sha256(TEXT);

    private RentAgreementDeclaration() {
    }

    static void accept(AuditService audit, AuthPrincipal caller, ServiceRequest request, String version) {
        if (!ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return;
        }
        if (!VERSION.equals(version)) {
            throw new ConflictException(
                    "Accept the declaration on the review step before checkout.");
        }
        audit.record(caller, "service-request.declaration-accepted", "service_request",
                request.getId().toString(), "version", VERSION, "textSha256", TEXT_SHA256);
    }

    private static String sha256(String text) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
