package com.draazy.api.leads.contact;

public record ContactStatusResponse(
        String status,
        boolean verifiedContactOnly,
        boolean verificationRequired,
        boolean ownerHidesNumber) {
}
