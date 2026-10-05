package com.draazy.api.services.request;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

@Entity
@Table(name = "service_request_police_intimations")
@Getter
public class ServiceRequestPoliceIntimation extends BaseEntity {

    @Column(name = "service_request_id", nullable = false, updatable = false)
    private UUID serviceRequestId;

    @Column(name = "confirmed_by")
    private UUID confirmedBy;

    @Column(name = "confirmed_at", nullable = false)
    private Instant confirmedAt;

    @Column(name = "reference", length = 80)
    private String reference;

    @Column(name = "submitted_on")
    private LocalDate submittedOn;

    protected ServiceRequestPoliceIntimation() {
    }

    ServiceRequestPoliceIntimation(UUID serviceRequestId) {
        this.serviceRequestId = serviceRequestId;
    }

    void confirm(UUID by, String reference, LocalDate submittedOn) {
        this.confirmedBy = by;
        this.confirmedAt = Instant.now();
        this.reference = reference;
        this.submittedOn = submittedOn;
    }
}
