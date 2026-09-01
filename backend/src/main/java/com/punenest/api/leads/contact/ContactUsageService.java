package com.punenest.api.leads.contact;

import com.punenest.api.common.trust.ContactUsageLookup;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The {@code leads} side of the contact quota: answers {@link ContactUsageLookup} for
 * {@code billing.entitlement}.
 *
 * <p>A separate bean rather than a method on {@code ContactService} because that class is the write
 * path for a feature and this is a read for a different one. Keeping the port implementation to
 * itself means the entitlement endpoint cannot accidentally reach anything else in the contact
 * gate, and it makes the whole of what {@code billing} is allowed to know about {@code leads} one
 * short file somebody can read in full before changing it.
 */
@Service
public class ContactUsageService implements ContactUsageLookup {

    private final ContactRequestRepository requests;

    public ContactUsageService(ContactRequestRepository requests) {
        this.requests = requests;
    }

    @Override
    @Transactional(readOnly = true)
    public long contactsUsed(UUID userId) {
        return userId == null ? 0L : requests.countByRequesterId(userId);
    }
}
