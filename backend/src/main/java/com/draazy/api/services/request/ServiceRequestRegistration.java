package com.draazy.api.services.request;

import com.draazy.api.common.persistence.BaseEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import java.time.LocalDate;
import java.util.UUID;
import lombok.Getter;

@Entity
@Table(name = "service_request_registrations")
@Getter
public class ServiceRequestRegistration extends BaseEntity {

    @Column(name = "service_request_id", nullable = false, updatable = false)
    private UUID serviceRequestId;

    @Column(name = "document_no", nullable = false, updatable = false, length = 40)
    private String documentNo;

    @Column(name = "sro", nullable = false, updatable = false, length = 60)
    private String sro;

    @Column(name = "registered_on", nullable = false, updatable = false)
    private LocalDate registeredOn;

    @Column(name = "grn", nullable = false, updatable = false, length = 25)
    private String grn;

    @Column(name = "stamp_duty", nullable = false, updatable = false)
    private long stampDuty;

    @Column(name = "registration_fee", nullable = false, updatable = false)
    private long registrationFee;

    @Column(name = "recorded_by", updatable = false)
    private UUID recordedBy;

    protected ServiceRequestRegistration() {
    }

    ServiceRequestRegistration(UUID serviceRequestId, RegistrationParticulars.Valid particulars,
            UUID recordedBy) {
        this.serviceRequestId = serviceRequestId;
        this.documentNo = particulars.documentNo();
        this.sro = particulars.sro();
        this.registeredOn = particulars.registeredOn();
        this.grn = particulars.grn();
        this.stampDuty = particulars.stampDuty();
        this.registrationFee = particulars.registrationFee();
        this.recordedBy = recordedBy;
    }
}
