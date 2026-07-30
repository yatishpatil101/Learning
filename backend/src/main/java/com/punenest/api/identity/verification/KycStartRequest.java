package com.punenest.api.identity.verification;

/**
 * Optional body of {@code submitAadhaar} (contract {@code KycStartRequest}).
 *
 * <p><strong>Note what is not here: an Aadhaar number.</strong> The user enters it on DigiLocker, not
 * on us. Accepting one would make this endpoint a collection point for the most sensitive identifier
 * in the country, which is precisely the liability the DigiLocker rail exists to avoid.
 *
 * @param redirectUrl where DigiLocker should return the user after consent; optional, the provider
 *                    falls back to its configured default
 */
public record KycStartRequest(String redirectUrl) {
}
