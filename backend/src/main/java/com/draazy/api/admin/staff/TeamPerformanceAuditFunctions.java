package com.draazy.api.admin.staff;

import com.draazy.api.security.BackOfficeFunctions;

final class TeamPerformanceAuditFunctions {

    private TeamPerformanceAuditFunctions() {
    }

    static String functionFor(String action, String entity, String serviceTeam) {
        if (starts(action, "service-request.") || "service_request".equals(entity)) {
            return desk(serviceTeam);
        }
        if (starts(action, "rentAgreement.")) {
            return BackOfficeFunctions.desk("rental");
        }
        if (starts(action, "identity.verification.") || "identity_verification".equals(entity)
                || "user.name.set_from_identity".equals(action)
                || starts(action, "user.badge")) {
            return BackOfficeFunctions.KYC;
        }
        if (starts(action, "property.verification.") || starts(action, "property.ownership.")
                || "property.documents.read".equals(action)
                || "property_override_request".equals(entity)) {
            return BackOfficeFunctions.PROPERTY_VERIFICATION;
        }
        if (starts(action, "property.status") || starts(action, "property.flag")
                || starts(action, "property.locality") || starts(action, "property.outreach")
                || starts(action, "property.duplicate")) {
            return BackOfficeFunctions.LISTING_MODERATION;
        }
        if ("user.provision_on_behalf".equals(action) || "property.create_on_behalf".equals(action)) {
            return BackOfficeFunctions.POST_ON_BEHALF;
        }
        if (starts(action, "ticket.") || starts(action, "visit.contact.") || starts(action, "deal.contact.")
                || starts(action, "identity.dispute.")) {
            return BackOfficeFunctions.SUPPORT;
        }
        if (starts(action, "enquiry.")) {
            return BackOfficeFunctions.ENQUIRIES;
        }
        if (starts(action, "content.") || starts(action, "city.")) {
            return BackOfficeFunctions.CONTENT;
        }
        if (starts(action, "society.")) {
            return BackOfficeFunctions.SOCIETIES;
        }
        if (starts(action, "flatmate.")) {
            return BackOfficeFunctions.FLATMATES;
        }
        if (starts(action, "review.")) {
            return BackOfficeFunctions.REVIEWS;
        }
        if (starts(action, "referral.")) {
            return BackOfficeFunctions.REFERRALS;
        }
        if (starts(action, "report.")) {
            return BackOfficeFunctions.REPORTS;
        }
        return null;
    }

    private static boolean starts(String value, String prefix) {
        return value != null && value.startsWith(prefix);
    }

    private static String desk(String serviceTeam) {
        return serviceTeam == null || serviceTeam.isBlank() ? null : BackOfficeFunctions.desk(serviceTeam);
    }
}
