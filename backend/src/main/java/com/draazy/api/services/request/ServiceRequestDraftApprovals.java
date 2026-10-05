package com.draazy.api.services.request;

import com.draazy.api.common.audit.AuditService;
import com.draazy.api.common.error.BadRequestException;
import com.draazy.api.common.error.ConflictException;
import com.draazy.api.common.error.ForbiddenException;
import com.draazy.api.common.error.RateLimitedException;
import com.draazy.api.common.error.UnauthorizedException;
import com.draazy.api.common.trust.MobileMask;
import com.draazy.api.documents.vault.DocumentRepository;
import com.draazy.api.identity.auth.OtpCode;
import com.draazy.api.identity.auth.OtpService;
import com.draazy.api.identity.auth.Tokens;
import com.draazy.api.identity.user.User;
import com.draazy.api.identity.user.UserRepository;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.security.AuthPrincipal;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ServiceRequestDraftApprovals {

    static final String METHOD_IN_APP = "in_app";
    static final String METHOD_OTP = "otp";

    private final ServiceRequestDraftApprovalRepository approvals;
    private final ServiceRequestPartyRepository parties;
    private final DocumentRepository documents;
    private final UserRepository users;
    private final OtpService otp;
    private final AuditService audit;

    ServiceRequestDraftApprovals(ServiceRequestDraftApprovalRepository approvals,
            ServiceRequestPartyRepository parties, DocumentRepository documents, UserRepository users,
            OtpService otp, AuditService audit) {
        this.approvals = approvals;
        this.parties = parties;
        this.documents = documents;
        this.users = users;
        this.otp = otp;
        this.audit = audit;
    }

    int currentVersion(ServiceRequest request) {
        return Math.toIntExact(documents.countByServiceRequestIdAndCategory(request.getId(), "draft"));
    }

    List<RequiredApproval> required(ServiceRequest request) {
        int version = currentVersion(request);
        if (version < 1 || !ServiceRequestTypes.RENT_AGREEMENT.equals(request.getType())) {
            return List.of();
        }
        Map<String, RequiredApproval> out = new LinkedHashMap<>();
        out.put("requester:" + request.getRequesterId(),
                RequiredApproval.inApp("requester:" + request.getRequesterId(), "Requester",
                        request.getRequesterId()));
        for (ServiceRequestParty party : parties.findByRequestId(request.getId())) {
            if (party.getUserId() != null && CoFillParties.ACCEPTED.equals(party.getStatus())) {
                out.put("user:" + party.getUserId(),
                        RequiredApproval.inApp("user:" + party.getUserId(),
                                label(party.getRole(), party.getUserId()), party.getUserId()));
            }
        }
        inlineParties(request).forEach(p -> out.putIfAbsent(p.key(), p));
        return List.copyOf(out.values());
    }

    @Transactional
    void markOpened(AuthPrincipal caller, ServiceRequest request) {
        RequiredApproval party = inAppParty(caller, request);
        if (party == null) {
            return;
        }
        ServiceRequestDraftApproval row = row(request, party);
        if (row.getOpenedAt() == null) {
            row.opened();
        }
    }

    @Transactional
    boolean approveInApp(AuthPrincipal caller, ServiceRequest request) {
        RequiredApproval party = inAppParty(caller, request);
        if (party == null) {
            throw new ForbiddenException("Only an executing party can approve this draft.");
        }
        ServiceRequestDraftApproval row = row(request, party);
        if (row.getOpenedAt() == null) {
            throw new ConflictException("Open the draft and read it before you approve it.");
        }
        row.approve();
        audit.record(caller, "service-request.draft-approved-party", "service_request",
                request.getId().toString(), "party", party.key(), "method", METHOD_IN_APP);
        return complete(request);
    }

    boolean canReject(AuthPrincipal caller, ServiceRequest request) {
        return required(request).stream().anyMatch(p -> METHOD_IN_APP.equals(p.method()) && caller.userId().equals(p.userId()));
    }

    @Transactional(noRollbackFor = {OtpSender.DeliveryFailedException.class,
            UnauthorizedException.class, RateLimitedException.class})
    public boolean confirmOtp(AuthPrincipal caller, ServiceRequest request, String partyKey, String code) {
        if (!caller.userId().equals(request.getRequesterId())) {
            throw new ForbiddenException("Only the requester can collect an inline party's draft approval.");
        }
        RequiredApproval party = required(request).stream().filter(p -> p.key().equals(partyKey) && METHOD_OTP.equals(p.method())).findFirst().orElseThrow(() -> new BadRequestException("Choose an inline party awaiting OTP approval."));
        String mobile = party.mobile();
        if (code == null || code.isBlank()) {
            otp.sendCode(mobile, purpose(request, party.key()), caller.userId());
            return false;
        }
        otp.verifyCode(mobile, code.strip(), purpose(request, party.key()));
        row(request, party).approve();
        audit.record(caller, "service-request.draft-approved-party", "service_request",
                request.getId().toString(), "party", party.key(), "method", METHOD_OTP,
                "mobile", MobileMask.mask(mobile));
        return complete(request);
    }

    public int resendCooldownSeconds() {
        return otp.resendCooldownSeconds();
    }

    ServiceRequestDto.DraftApproval summary(ServiceRequest request, List<ServiceRequestDraftApproval> rows) {
        List<RequiredApproval> required = required(request);
        if (required.isEmpty()) {
            return null;
        }
        int version = currentVersion(request);
        Map<String, ServiceRequestDraftApproval> byKey = new HashMap<>();
        rows.stream().filter(r -> r.getDraftVersion() == version).forEach(r -> byKey.put(r.getPartyKey(), r));
        List<ServiceRequestDto.DraftApprovalParty> parties = required.stream().map(p -> {
                    ServiceRequestDraftApproval row = byKey.get(p.key());
                    return new ServiceRequestDto.DraftApprovalParty(p.key(), p.label(), p.method(),
                            p.mobile() == null ? null : MobileMask.mask(p.mobile()),
                            row != null && row.getOpenedAt() != null,
                            row != null && row.getApprovedAt() != null,
                            row == null ? null : row.getApprovedAt());
                }).toList();
        long approved = parties.stream().filter(ServiceRequestDto.DraftApprovalParty::approved).count();
        return new ServiceRequestDto.DraftApproval(version, (int) approved, parties.size(), parties);
    }

    private boolean complete(ServiceRequest request) {
        int version = currentVersion(request);
        List<String> approvedKeys = approvals.findByRequestIdAndDraftVersion(request.getId(), version).stream().filter(a -> a.getApprovedAt() != null).map(ServiceRequestDraftApproval::getPartyKey).toList();
        return required(request).stream().allMatch(p -> approvedKeys.contains(p.key()));
    }

    private ServiceRequestDraftApproval row(ServiceRequest request, RequiredApproval party) {
        int version = currentVersion(request);
        return approvals.findByRequestIdAndDraftVersionAndPartyKey(request.getId(), version, party.key()).orElseGet(() -> approvals.save(new ServiceRequestDraftApproval(request.getId(), version,
                        party.key(), party.label(), party.userId(),
                        party.mobile() == null ? null : Tokens.sha256Hex(party.mobile()),
                        party.mobile() == null ? null : MobileMask.mask(party.mobile()), party.method())));
    }

    private RequiredApproval inAppParty(AuthPrincipal caller, ServiceRequest request) {
        return required(request).stream().filter(p -> METHOD_IN_APP.equals(p.method()) && caller.userId().equals(p.userId())).findFirst().orElse(null);
    }

    private List<RequiredApproval> inlineParties(ServiceRequest request) {
        Map<String, Object> state = ServiceRequestPricing.childObject(
                request.getDetails() == null ? Map.of() : request.getDetails(), "_state");
        String requesterSide = requesterSide(request, state);
        List<ServiceRequestParty> acceptedParties = parties.findByRequestId(request.getId()).stream().filter(p -> p.getUserId() != null && CoFillParties.ACCEPTED.equals(p.getStatus())).toList();
        List<RequiredApproval> out = new ArrayList<>();
        if ("tenant".equals(requesterSide)) {
            addInline(out, "owner", 0, "Licensor", ServiceRequestPricing.childObject(state, "owner"),
                    acceptedParties);
            addRows(out, "owner", "Co-owner", state.get("coOwners"), acceptedParties);
        } else {
            addRows(out, "tenant", "Tenant", state.get("tenants"), acceptedParties);
        }
        return out;
    }

    private String requesterSide(ServiceRequest request, Map<String, Object> state) {
        Optional<ServiceRequestParty> accepted = parties.findByRequestId(request.getId()).stream().filter(p -> CoFillParties.ACCEPTED.equals(p.getStatus())).findFirst();
        if (accepted.isPresent()) {
            return "tenant".equals(accepted.get().getRole()) ? "owner" : "tenant";
        }
        String requesterMobile = users.findById(request.getRequesterId()).map(User::getMobile).map(MobileMask::normalise).orElse(null);
        if (requesterMobile != null && requesterMobile.equals(mobile(ServiceRequestPricing.childObject(state, "owner"), "oMobile"))) {
            return "owner";
        }
        if (state.get("coOwners") instanceof List<?> owners) {
            for (Object row : owners) {
                if (row instanceof Map<?, ?> m && requesterMobile != null
                        && requesterMobile.equals(mobile(m, "mobile"))) {
                    return "owner";
                }
            }
        }
        return "tenant";
    }

    private void addRows(List<RequiredApproval> out, String role, String label, Object rows,
            List<ServiceRequestParty> acceptedParties) {
        if (rows instanceof List<?> list) {
            for (int i = 0; i < list.size(); i++) {
                if (list.get(i) instanceof Map<?, ?> row) {
                    addInline(out, role, i, label + " " + (i + 1), row, acceptedParties);
                }
            }
        }
    }

    private void addInline(List<RequiredApproval> out, String role, int index, String label, Map<?, ?> row,
            List<ServiceRequestParty> acceptedParties) {
        String mobile = mobile(row, "mobile");
        if (mobile == null && "owner".equals(role)) {
            mobile = mobile(row, "oMobile");
        }
        String inlineMobile = mobile;
        if (inlineMobile != null && acceptedParties.stream().anyMatch(p -> role.equals(p.getRole()) && index == p.getPartyIndex()
                        && users.findById(p.getUserId()).map(User::getMobile).map(MobileMask::normalise).filter(inlineMobile::equals).isPresent())) {
            return;
        }
        if (inlineMobile != null) {
            out.add(RequiredApproval.otp(role + ":" + index + ":" + Tokens.sha256Hex(inlineMobile),
                    label, inlineMobile));
        }
    }

    private String label(String role, UUID userId) {
        String fallback = "tenant".equals(role) ? "Tenant" : "Co-party";
        return users.findById(userId).map(User::getName).filter(n -> !n.isBlank()).orElse(fallback);
    }

    private static String mobile(Map<?, ?> row, String key) {
        Object value = row.get(key);
        return value == null ? null : MobileMask.normalise(Objects.toString(value));
    }

    private String purpose(ServiceRequest request, String partyKey) {
        return OtpCode.PURPOSE_DRAFT_APPROVAL + ":" + request.getId() + ":" + currentVersion(request)
                + ":" + partyKey;
    }

    record RequiredApproval(String key, String label, String method, UUID userId, String mobile) {
        static RequiredApproval inApp(String key, String label, UUID userId) {
            return new RequiredApproval(key, label, METHOD_IN_APP, userId, null);
        }

        static RequiredApproval otp(String key, String label, String mobile) {
            return new RequiredApproval(key, label, METHOD_OTP, null, mobile);
        }
    }
}
