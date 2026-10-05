package com.draazy.api.services.request;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.validation.AadhaarValidator;
import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Service request details: no identity numbers, and only the keys a rent agreement has")
class ServiceRequestDetailsGuardTest {

    private static final String AADHAAR = withCheckDigit("23456789012");

    @Test
    @DisplayName("words that merely contain 'pan' are not identity keys")
    void noOverFire() {
        assertThatCode(() -> legal(Map.of("company", "Acme Pvt Ltd", "panel", "west wall",
                "expandedNotes", "call after 6", "Spanish", "yes"))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a populated key naming the number is refused however it is spelt")
    void identityKeys() {
        for (String key : List.of("pan", "oPan", "panNo", "pan_number", "tenant-pan", "PANCard",
                "pannumber", "aadhaarNumber", "w1Aadhaar", "aadhar", "aadhaarno", "AADHAARNO", "tenantaadhar")) {
            assertThatThrownBy(() -> legal(Map.of("owner", Map.of(key, "x"))))
                    .as(key).isInstanceOf(BadRequestException.class);
        }
        assertThatCode(() -> legal(Map.of("owner", Map.of("oPan", "", "oAadhaar", ""))))
                .doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a checksum-valid Aadhaar or a PAN is refused under any key, spaced or not")
    void identityValues() {
        String a = AADHAAR.substring(0, 4);
        String b = AADHAAR.substring(4, 8);
        String c = AADHAAR.substring(8);
        String spaced = a + " " + b + " " + c;
        for (Object value : List.of(AADHAAR, spaced, "my number is " + spaced, Long.parseLong(AADHAAR),
                -Long.parseLong(AADHAAR), a + "\u00A0" + b + "\u00A0" + c, a + "  " + b + "  " + c,
                a + "." + b + "." + c, a + "/" + b + "/" + c, a + " \u2013 " + b + " \u2013 " + c,
                devanagari(AADHAAR), "UID" + AADHAAR, "UID-" + AADHAAR, "-" + AADHAAR,
                "ABCPE1234F", "pan abcpe1234f please")) {
            assertThatThrownBy(() -> legal(Map.of("tenants", List.of(Map.of("docNo", value)))))
                    .as(String.valueOf(value)).isInstanceOf(BadRequestException.class);
        }
        assertThatThrownBy(() -> legal(Map.of("tenants", Map.of(AADHAAR, "tenant one"))))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    @DisplayName("near misses pass: a bad checksum, a UUID tail, a mobile with its country code")
    void nearMisses() {
        String badChecksum = AADHAAR.substring(0, 11) + ((AADHAAR.charAt(11) - '0' + 1) % 10);
        String mobile = withCheckDigit("91987654321");
        assertThatCode(() -> legal(Map.of("uid", badChecksum,
                "listingId", "550e8400-e29b-41d4-a716-" + AADHAAR,
                "requestId", "Request 550E8400-E29B-41D4-A716-" + AADHAAR + " opened",
                "contactMobile", mobile,
                "startedAt", 1717000000000L,
                "flat", "ABCDE12345"))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a rent agreement carries only the keys the wizard sends; other desks are free text")
    void rentAgreementKeys() {
        assertThatCode(() -> ServiceRequestDetailsGuard.check(ServiceRequestTypes.RENT_AGREEMENT,
                Map.of("property", "B-1204", "rent", 30000, "deposit", 150000, "nrDeposit", 0,
                        "_state", Map.of()))).doesNotThrowAnyException();
        assertThatThrownBy(() -> ServiceRequestDetailsGuard.check(ServiceRequestTypes.RENT_AGREEMENT,
                Map.of("rent", 30000, "govtId", "x")))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("govtId");
        assertThatCode(() -> legal(Map.of("govtId", "x"))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("tenant police records can carry realistic addresses and family mobiles")
    void tenantPoliceRecordValues() {
        Map<String, Object> police = Map.of(
                "permanentSameAsCurrent", false,
                "permanent", Map.of("address", "44 FC Road, Shivajinagar, Pune", "pincode", "411004",
                        "village", "Shivajinagar", "policeStation", "Deccan Police Station"),
                "addressProofType", "uid",
                "previousSameAsPermanent", true,
                "workplaceAddress", "Draazy Labs, Baner, Pune 411045",
                "workIdProofType", "Employee ID",
                "occupants", List.of(Map.of("type", "family", "relation", "spouse", "fullName",
                        "Sneha Nair", "age", "29", "mobile", "9876543210")));
        assertThatCode(() -> ServiceRequestDetailsGuard.check(ServiceRequestTypes.RENT_AGREEMENT,
                Map.of("_state", Map.of("tenants", List.of(Map.of("police", police)))))).doesNotThrowAnyException();
    }

    @Test
    @DisplayName("a deposit-payment UTR may pass the Aadhaar checksum; a ref anywhere else, spaced, on a cash row, or a PAN may not")
    void paymentReference() {
        assertThatCode(() -> rentAgreement(Map.of("mode", "upi", "ref", AADHAAR))).doesNotThrowAnyException();
        assertThatCode(() -> rentAgreement(Map.of("mode", "dd", "ref", "004512"))).doesNotThrowAnyException();
        String spaced = AADHAAR.substring(0, 4) + " " + AADHAAR.substring(4, 8) + " " + AADHAAR.substring(8);
        for (Map<String, Object> row : List.<Map<String, Object>>of(Map.of("mode", "cash", "ref", AADHAAR),
                Map.of("mode", "upi", "ref", spaced), Map.of("mode", "upi", "ref", "ABCPE1234F"),
                Map.of("mode", "upi", "ref", "612345678901", "note", AADHAAR))) {
            assertThatThrownBy(() -> rentAgreement(row)).as(row.toString()).isInstanceOf(BadRequestException.class);
        }
        assertThatThrownBy(() -> legal(Map.of("terms", Map.of("ref", AADHAAR))))
                .isInstanceOf(BadRequestException.class);
        assertThatThrownBy(() -> ServiceRequestDetailsGuard.check(ServiceRequestTypes.RENT_AGREEMENT,
                Map.of("_state", Map.of("tenants", List.of(Map.of("ref", AADHAAR))))))
                .isInstanceOf(BadRequestException.class);
    }

    private static void rentAgreement(Map<String, Object> payment) {
        ServiceRequestDetailsGuard.check(ServiceRequestTypes.RENT_AGREEMENT,
                Map.of("_state", Map.of("terms", Map.of("depositPayments", List.of(payment)))));
    }

    private static void legal(Map<String, Object> details) {
        ServiceRequestDetailsGuard.check(ServiceRequestTypes.LEGAL, details);
    }

    private static String devanagari(String asciiDigits) {
        return asciiDigits.chars().collect(StringBuilder::new,
                (out, ch) -> out.append((char) ('\u0966' + ch - '0')), StringBuilder::append).toString();
    }

    private static String withCheckDigit(String elevenDigits) {
        return IntStream.rangeClosed(0, 9).mapToObj(d -> elevenDigits + d)
                .filter(AadhaarValidator::isAadhaar).findFirst().orElseThrow();
    }
}
