package com.punenest.api.identity.kyc;

import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The owner's own KYC record.
 *
 * <p><strong>Self-scoped throughout.</strong> The subject is always the JWT's user id; there is no
 * parameter that could name someone else, so there is no way to read or write another owner's KYC
 * through this surface. Staff review of KYC is a back-office concern and does not exist yet.
 */
@Service
public class OwnerKycService {

    private final OwnerKycRepository records;

    public OwnerKycService(OwnerKycRepository records) {
        this.records = records;
    }

    /** Contract {@code getOwnerKyc} — the caller's record, or an empty one if they have none. */
    @Transactional(readOnly = true)
    public OwnerKycDto get(UUID userId) {
        return records.findById(userId).map(OwnerKycDto::of).orElseGet(OwnerKycDto::empty);
    }

    /**
     * Contract {@code saveOwnerKyc} — submit PAN and Aadhaar for verification.
     *
     * <p>Upsert rather than create-then-update: there is exactly one record per user by primary
     * key, so "have you submitted before" is not a question the client should have to answer with
     * a different verb.
     *
     * <p>Returns the server's view (spec fix S39) so the caller sees the {@code pending} status and
     * the masks it did not send, instead of having to trust that its own input was applied.
     */
    @Transactional
    public OwnerKycDto save(UUID userId, OwnerKycUpdateRequest body) {
        OwnerKyc record = records.findById(userId).orElseGet(() -> new OwnerKyc(userId));
        record.submit(KycMasks.maskPan(body.pan()), KycMasks.maskAadhaar(body.aadhaar()));
        return OwnerKycDto.of(records.saveAndFlush(record));
    }
}
