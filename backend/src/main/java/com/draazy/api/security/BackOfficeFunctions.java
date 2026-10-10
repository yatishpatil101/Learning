package com.draazy.api.security;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public final class BackOfficeFunctions {

    private BackOfficeFunctions() {
    }

    public static final String KYC = "kyc";
    public static final String PROPERTY_VERIFICATION = "propertyVerification";
    public static final String LISTING_MODERATION = "listingModeration";
    public static final String POST_ON_BEHALF = "postOnBehalf";
    public static final String FLATMATES = "flatmates";
    public static final String LOCALITIES = "localities";
    public static final String REVIEWS = "reviews";
    public static final String ANALYTICS = "analytics";
    public static final String SUPPORT = "support";
    public static final String ENQUIRIES = "enquiries";
    public static final String USERS = "users";
    public static final String CONTENT = "content";
    public static final String SOCIETIES = "societies";
    public static final String REPORTS = "reports";
    public static final String REFERRALS = "referrals";

    public static String desk(String desk) {
        return "desk:" + desk;
    }

    public record Function(String name, String label, String group, List<String> atoms, String desk) {
    }

    public static final List<Function> CATALOGUE = List.of(
            new Function(KYC, "KYC review", "Verification", List.of(
                    BackOfficePermissions.IDENTITY_READ,
                    BackOfficePermissions.IDENTITY_WRITE,
                    BackOfficePermissions.USERS_READ), null),
            new Function(PROPERTY_VERIFICATION, "Property verification", "Verification", List.of(
                    BackOfficePermissions.PROPERTIES_READ,
                    BackOfficePermissions.PROPERTIES_VERIFY), null),
            new Function(LISTING_MODERATION, "Listing moderation", "Listings", List.of(
                    BackOfficePermissions.PROPERTIES_READ,
                    BackOfficePermissions.PROPERTIES_MODERATE), null),
            new Function(POST_ON_BEHALF, "Post on behalf", "Listings", List.of(
                    BackOfficePermissions.POSTONBEHALF_WRITE,
                    BackOfficePermissions.PROPERTIES_READ), null),
            new Function(FLATMATES, "Flatmates", "Listings", List.of(
                    BackOfficePermissions.FLATMATES_READ,
                    BackOfficePermissions.FLATMATES_WRITE), null),
            new Function(LOCALITIES, "Localities", "Listings", List.of(
                    BackOfficePermissions.LOCALITIES_READ,
                    BackOfficePermissions.LOCALITIES_WRITE), null),
            new Function(REVIEWS, "Review moderation", "Listings", List.of(
                    BackOfficePermissions.REVIEWS_READ,
                    BackOfficePermissions.REVIEWS_WRITE), null),
            deskFunction(Teams.RENTAL, "Rent Agreement"),
            deskFunction(Teams.LEGAL, "Property & Legal"),
            deskFunction(Teams.LOANS, "Home Loans"),
            deskFunction(Teams.INTERIOR, "Interior & Renovation"),
            deskFunction(Teams.PACKERS, "Packers & Movers"),
            deskFunction(Teams.VALUATION, "Valuation"),
            new Function(SUPPORT, "Support", "Support", List.of(
                    BackOfficePermissions.TICKETS_READ,
                    BackOfficePermissions.TICKETS_WRITE,
                    BackOfficePermissions.NOTES_READ,
                    BackOfficePermissions.NOTES_WRITE), null),
            new Function(ENQUIRIES, "Enquiries", "Support", List.of(
                    BackOfficePermissions.ENQUIRIES_READ,
                    BackOfficePermissions.NOTES_WRITE), null),
            new Function(USERS, "User lookup", "Support", List.of(
                    BackOfficePermissions.USERS_READ), null),
            new Function(REPORTS, "Reports", "Trust & safety", List.of(
                    BackOfficePermissions.REPORTS_READ,
                    BackOfficePermissions.REPORTS_WRITE), null),
            new Function(REFERRALS, "Referrals", "Trust & safety", List.of(
                    BackOfficePermissions.REFERRALS_READ,
                    BackOfficePermissions.REFERRALS_WRITE), null),
            new Function(CONTENT, "Content", "Content", List.of(
                    BackOfficePermissions.CONTENT_READ,
                    BackOfficePermissions.CONTENT_WRITE), null),
            new Function(SOCIETIES, "Societies", "Content", List.of(
                    BackOfficePermissions.SOCIETIES_READ,
                    BackOfficePermissions.SOCIETIES_WRITE), null),
            new Function(ANALYTICS, "Analytics", "Insights", List.of(
                    BackOfficePermissions.ANALYTICS_READ), null));

    private static final Map<String, Function> BY_NAME = byName();
    private static final Set<String> ALL_NAMES = Set.copyOf(BY_NAME.keySet());

    private static Function deskFunction(String desk, String label) {
        return new Function(desk(desk), label, "Service desks", deskAtoms(desk), desk);
    }

    // Home Loans works the ticket board, which TicketService scopes to the caller's desks.
    private static List<String> deskAtoms(String desk) {
        return switch (desk) {
            case Teams.RENTAL -> List.of(BackOfficePermissions.SERVICES_READ,
                    BackOfficePermissions.SERVICES_WRITE,
                    BackOfficePermissions.REGISTRATIONS_WRITE);
            case Teams.LOANS -> List.of(BackOfficePermissions.SERVICES_READ,
                    BackOfficePermissions.SERVICES_WRITE,
                    BackOfficePermissions.TICKETS_READ,
                    BackOfficePermissions.TICKETS_WRITE);
            default -> List.of(BackOfficePermissions.SERVICES_READ,
                    BackOfficePermissions.SERVICES_WRITE);
        };
    }

    private static Map<String, Function> byName() {
        Map<String, Function> index = new LinkedHashMap<>();
        for (Function function : CATALOGUE) {
            if (index.put(function.name(), function) != null) {
                throw new IllegalStateException("duplicate back-office function: " + function.name());
            }
        }
        return Map.copyOf(index);
    }

    public static boolean isKnown(String name) {
        return name != null && BY_NAME.containsKey(name);
    }

    public static Set<String> assignableForRole(String role) {
        return Roles.isBackOffice(role) ? ALL_NAMES : Set.of();
    }

    public static Set<String> defaultForRole(String role) {
        if (Roles.Wire.ADMIN.equals(role) || Roles.Wire.MANAGER.equals(role)) {
            return ALL_NAMES;
        }
        return Set.of();
    }

    public static Set<String> atomsFor(Set<String> functions) {
        Set<String> atoms = new LinkedHashSet<>();
        atoms.add(BackOfficePermissions.DASHBOARD_READ);
        for (String name : functions) {
            Function function = BY_NAME.get(name);
            if (function != null) {
                atoms.addAll(function.atoms());
            }
        }
        return atoms;
    }

    public static Set<String> effectiveAtoms(String role, Set<String> functions) {
        Set<String> atoms = atomsFor(functions);
        atoms.retainAll(BackOfficePermissions.baselineFor(role));
        if (Roles.isBackOffice(role)) {
            atoms.add(BackOfficePermissions.DASHBOARD_READ);
        }
        return atoms;
    }

    public static Set<String> desksFor(Set<String> functions) {
        Set<String> desks = new LinkedHashSet<>();
        for (String name : functions) {
            Function function = BY_NAME.get(name);
            if (function != null && function.desk() != null) {
                desks.add(function.desk());
            }
        }
        return desks;
    }
}
