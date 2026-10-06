package com.draazy.api.engagement.society;

import com.draazy.api.catalog.society.SocietyRepository;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SocietyQueueSummaryService {

    public record Summary(long claims, long residents, long candidates, long moderation) {
    }

    private final SocietyClaimRepository claims;
    private final SocietyResidentRepository residents;
    private final SocietyProposalRepository proposals;
    private final SocietyRepository societies;

    public SocietyQueueSummaryService(SocietyClaimRepository claims,
            SocietyResidentRepository residents, SocietyProposalRepository proposals,
            SocietyRepository societies) {
        this.claims = claims;
        this.residents = residents;
        this.proposals = proposals;
        this.societies = societies;
    }

    @Transactional(readOnly = true)
    public Summary summary() {
        return new Summary(
                claims.countByStatus(SocietyClaimStatuses.PENDING),
                residents.countByStatus(SocietyResidentStatuses.PENDING),
                societies.countCandidates(),
                proposals.countByStatusAndKindIn(SocietyProposalStatuses.PENDING,
                        List.of(SocietyProposalKinds.WHATSAPP, SocietyProposalKinds.LOCATION)));
    }
}