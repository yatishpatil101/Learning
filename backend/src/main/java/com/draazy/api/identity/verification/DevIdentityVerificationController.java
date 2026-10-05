package com.draazy.api.identity.verification;

import com.draazy.api.common.error.NotFoundException;
import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import com.draazy.api.security.LocalOnly;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

// Local-only shortcut so the consumer flow can run without a staff session.
@RestController
@LocalOnly
public class DevIdentityVerificationController {

    private final IdentityVerificationService service;
    private final IdentityReviewService reviews;
    private final IdentityVerificationRepository verifications;

    public DevIdentityVerificationController(IdentityVerificationService service,
            IdentityReviewService reviews, IdentityVerificationRepository verifications) {
        this.service = service;
        this.reviews = reviews;
        this.verifications = verifications;
    }

    // POST /me/verification/identity/simulate?outcome=approve|reject — decide the caller's pending
    // case. The synthetic number is derived from the user id so two dev users never collide.
    @PostMapping(Routes.Verification.IDENTITY_SIMULATE)
    public IdentityVerificationResponse simulate(@CurrentUser AuthPrincipal principal,
            @RequestParam(defaultValue = "approve") String outcome) {
        IdentityVerification v = verifications.findByUserId(principal.userId())
                .orElseThrow(() -> new NotFoundException("No pending case to decide"));
        if ("reject".equals(outcome)) {
            reviews.rejectSystem(v.getId(), new IdentityRejectRequest("blurry", "Simulated rejection"));
        } else {
            reviews.approveSystem(v.getId(),
                    new IdentityApproveRequest(syntheticNumber(v.getDocType(), principal.userId()),
                            "Dev User", LocalDate.of(1990, 1, 1), null));
        }
        return service.status(principal.userId());
    }

    static String syntheticNumber(String docType, UUID userId) {
        long seed = Math.abs(userId.getMostSignificantBits());
        return switch (docType) {
            case IdentityDocTypes.PAN -> "ABCDE" + String.format("%04d", seed % 10_000) + "Z";
            case IdentityDocTypes.DRIVING_LICENCE -> "MH" + String.format("%013d", seed % 10_000_000_000_000L);
            case IdentityDocTypes.PASSPORT -> "A" + String.format("%07d", seed % 10_000_000);
            case IdentityDocTypes.VOTER_ID -> "ABC" + String.format("%07d", seed % 10_000_000);
            default -> {
                String body = "9" + String.format("%010d", seed % 10_000_000_000L);
                for (char d = '0'; d <= '9'; d++) {
                    if (IdentityNumbers.verhoeffValid(body + d)) {
                        yield body + d;
                    }
                }
                yield body + "0";
            }
        };
    }
}
