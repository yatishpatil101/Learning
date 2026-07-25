import { Link } from 'react-router';
import LegalPage from '../../components/LegalPage.jsx';

export default function Terms() {
  return (
    <LegalPage title="Terms of Service" lastUpdated="1 July 2026" current="terms">
      <p>
        These Terms of Service ("<strong>Terms</strong>") govern your access to and use of punenest.com and associated
        applications (the "<strong>Platform</strong>") operated by PuneNest Technologies Private Limited, a company
        incorporated under the Companies Act, 2013, with its registered office at 201, Business Bay, Baner Road, Pune 411045
        ("<strong>PuneNest</strong>", "we", "us").
      </p>
      <p>
        By registering an account or using the Platform, you agree to be bound by these Terms. If you do not agree,
        please do not use the Platform.
      </p>

      <h2>1. Eligibility</h2>
      <ul>
        <li>You must be at least 18 years old and competent to enter into a binding contract under the Indian Contract Act, 1872.</li>
        <li>If you represent a company or partnership firm, you confirm you have authority to bind that entity to these Terms.</li>
      </ul>

      <h2>2. Account and verification</h2>
      <ul>
        <li>You are responsible for maintaining the confidentiality of your OTP and login credentials.</li>
        <li>Property owners must complete identity verification (Aadhaar/PAN eKYC) before publishing listings.</li>
        <li>PuneNest may suspend or terminate accounts that fail verification or violate these Terms.</li>
      </ul>

      <h2>3. Platform services</h2>
      <h3>3.1 Property marketplace</h3>
      <p>
        PuneNest is an intermediary platform that connects property owners, buyers, and tenants. We do not own, manage,
        or guarantee any property listed on the Platform. All transactions are between the parties directly.
      </p>

      <h3>3.2 Ancillary services</h3>
      <p>
        We facilitate access to third-party services including home loans, legal assistance, packers &amp; movers, rent
        agreements, interior renovation, and property valuation through verified partners. PuneNest acts as a facilitator
        and is not a party to the underlying service contract between you and the partner.
      </p>

      <h3>3.3 No brokerage</h3>
      <p>
        PuneNest does not charge brokerage or commission from buyers or tenants for property transactions. Revenue is
        generated through premium listing plans, subscription packages, and referral fees from service partners.
      </p>

      <h2>4. User obligations</h2>
      <p>When using the Platform, you agree not to:</p>
      <ul>
        <li>Post false, misleading, or fraudulent property listings or personal details.</li>
        <li>Use the Platform for any unlawful purpose or in violation of RERA, 2016 or other applicable laws.</li>
        <li>Scrape, crawl, or use automated tools to extract data from the Platform.</li>
        <li>Harass, threaten, or defame other users.</li>
        <li>Circumvent security measures, access controls, or rate limits.</li>
        <li>Use contact details obtained via the Platform for unsolicited marketing or spam.</li>
        <li>Post duplicate listings for the same property from multiple accounts.</li>
      </ul>

      <h2>5. Listing guidelines</h2>
      <ul>
        <li>Listings must represent real, available properties that you own or are authorised to list.</li>
        <li>Pricing must be accurate and inclusive of any non-negotiable charges disclosed upfront.</li>
        <li>Photos must be of the actual property. Stock images, AI-generated images, or images of other properties are prohibited.</li>
        <li>RERA-registered projects must display valid RERA registration numbers.</li>
        <li>PuneNest reserves the right to remove listings that violate these guidelines without prior notice.</li>
      </ul>

      <h2>6. Intellectual property</h2>
      <p>
        All content on the Platform — including the logo, design, code, locality insights, and analytics data — is owned
        by PuneNest or its licensors and protected under the Copyright Act, 1957 and the Trade Marks Act, 1999.
      </p>
      <p>
        You grant PuneNest a non-exclusive, royalty-free, worldwide licence to display, distribute, and promote content
        you upload (photos, descriptions) for the purpose of operating the Platform. This licence terminates when you
        remove the content or delete your account.
      </p>

      <h2>7. Payments and subscriptions</h2>
      <ul>
        <li>Subscription plans are billed in advance as per the plan selected (monthly or annual).</li>
        <li>Prices are inclusive of applicable GST (currently 18%).</li>
        <li>Auto-renewal can be cancelled at any time before the next billing cycle from your account settings.</li>
        <li>Refunds are governed by our <Link to="/refund-policy">Refund Policy</Link>.</li>
      </ul>

      <h2>8. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, PuneNest shall not be liable for any indirect, incidental, consequential,
        or punitive damages arising from your use of the Platform, including but not limited to:
      </p>
      <ul>
        <li>Loss arising from reliance on information provided by other users or third-party partners.</li>
        <li>Disputes between buyers, tenants, and owners regarding property condition, title, or possession.</li>
        <li>Service quality, delays, or failures by third-party service partners facilitated through the Platform.</li>
        <li>Unauthorised access to your account due to your failure to secure credentials.</li>
      </ul>
      <p>
        Our total aggregate liability for any claim shall not exceed the fees paid by you to PuneNest in the 12 months
        preceding the event giving rise to the claim, or INR 10,000, whichever is higher.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless PuneNest, its officers, directors, and employees from any claims,
        damages, or expenses arising from your breach of these Terms, your content, or your violation of any law or
        third-party rights.
      </p>

      <h2>10. Dispute resolution</h2>
      <ul>
        <li>These Terms are governed by the laws of India.</li>
        <li>Any dispute shall first be referred to mediation in Pune. If unresolved within 30 days, the dispute shall be referred to binding arbitration under the Arbitration and Conciliation Act, 1996, with a sole arbitrator appointed mutually.</li>
        <li>The courts of Pune shall have exclusive jurisdiction for any proceedings ancillary to arbitration.</li>
      </ul>

      <h2>11. Termination</h2>
      <p>
        We may suspend or terminate your access to the Platform at any time, with or without cause, upon reasonable notice.
        Upon termination, your right to use the Platform ceases immediately. Clauses that by their nature should survive
        (indemnification, limitation of liability, dispute resolution) shall survive termination.
      </p>

      <h2>12. Amendments</h2>
      <p>
        We may modify these Terms at any time. Material changes will be notified via email or in-app notification at
        least 15 days before they take effect. Your continued use of the Platform after the effective date constitutes
        acceptance of the revised Terms.
      </p>

      <h2>13. Grievance redressal &amp; contact</h2>
      <p>
        For questions about these Terms, contact us at <a href="mailto:legal@punenest.com">legal@punenest.com</a>.
        Complaints and grievances may be addressed to our Grievance Officer, whose details (along with our company
        identity, CIN, and GSTIN) are published in our <Link to="/privacy">Privacy Policy</Link>. We acknowledge
        grievances within 24 hours and resolve them within 15 days, as required under applicable law.
      </p>
    </LegalPage>
  );
}
