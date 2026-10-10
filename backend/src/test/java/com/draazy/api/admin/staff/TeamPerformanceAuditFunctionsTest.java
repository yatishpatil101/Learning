package com.draazy.api.admin.staff;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.security.BackOfficeFunctions;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

@DisplayName("Team performance audit action mapping")
class TeamPerformanceAuditFunctionsTest {

    @Test
    void mapsKnownActionsToFunctions() {
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "identity.verification.approved", "identity_verification", null))
                .isEqualTo(BackOfficeFunctions.KYC);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "property.verification.decision", "property", null))
                .isEqualTo(BackOfficeFunctions.PROPERTY_VERIFICATION);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "property.status", "property", null))
                .isEqualTo(BackOfficeFunctions.LISTING_MODERATION);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "property.create_on_behalf", "property", null))
                .isEqualTo(BackOfficeFunctions.POST_ON_BEHALF);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "ticket.update", "ticket", null))
                .isEqualTo(BackOfficeFunctions.SUPPORT);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "content.update", "faq", null))
                .isEqualTo(BackOfficeFunctions.CONTENT);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "report.triage", "report", null))
                .isEqualTo(BackOfficeFunctions.REPORTS);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "flatmate.adminUpdate", "flatmate_post", null))
                .isEqualTo(BackOfficeFunctions.FLATMATES);
        assertThat(TeamPerformanceAuditFunctions.functionFor("review.status", "review", null))
                .isEqualTo(BackOfficeFunctions.REVIEWS);
        assertThat(TeamPerformanceAuditFunctions.functionFor("referral.approve", "referral", null))
                .isEqualTo(BackOfficeFunctions.REFERRALS);
        assertThat(TeamPerformanceAuditFunctions.functionFor("society.merge", "society", null))
                .isEqualTo(BackOfficeFunctions.SOCIETIES);
        assertThat(TeamPerformanceAuditFunctions.functionFor("enquiry.contact.reveal", "contactRequest", null))
                .isEqualTo(BackOfficeFunctions.ENQUIRIES);
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "service-request.status", "service_request", "rental"))
                .isEqualTo(BackOfficeFunctions.desk("rental"));
        assertThat(TeamPerformanceAuditFunctions.functionFor(
                "user.archive", "user", null))
                .isNull();
    }
}
