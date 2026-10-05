package com.draazy.api.foundation;

import static org.assertj.core.api.Assertions.assertThat;

import com.draazy.api.provider.FileStorage;
import com.draazy.api.provider.OtpSender;
import com.draazy.api.provider.PaymentGateway;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;

/** Every external seam resolving to a keyless mock in dev. */
@SpringBootTest
@AutoConfigureMockMvc
class FoundationIntegrationTest {

    @Autowired
    OtpSender otpSender;
    @Autowired
    FileStorage fileStorage;
    @Autowired
    PaymentGateway paymentGateway;

    @Test
    void everyProviderSeamResolvesToAKeylessMock() {
        // None of these touch the network or need a paid key.
        otpSender.send("9876500011", "123456");
        assertThat(fileStorage.signedDownloadUrl("docs/a.pdf")).contains("docs/a.pdf");
        assertThat(paymentGateway.createOrder(2500, "ref-1").orderId()).isNotBlank();
    }
}
