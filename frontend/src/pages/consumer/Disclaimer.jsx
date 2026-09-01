import LegalPage from '../../components/LegalPage.jsx';

export default function Disclaimer() {
  return (
    <LegalPage title="Disclaimer" lastUpdated="1 July 2026" current="disclaimer">
      <p>
        The information provided on draazy.com ("<strong>Platform</strong>") is for general informational purposes only.
        By using the Platform, you acknowledge and agree to the following disclaimers.
      </p>

      <h2>1. No real-estate advisory</h2>
      <p>
        Draazy is a technology platform that facilitates property discovery and direct owner-buyer/tenant connections.
        We are <strong>not</strong> a registered real estate agent, broker, or advisor under the Real Estate (Regulation
        and Development) Act, 2016 (RERA). Content on the Platform — including locality insights, price trends, EMI
        calculations, and investment scores — is for informational purposes only and does not constitute professional
        real-estate, financial, or investment advice.
      </p>

      <h2>2. Property information accuracy</h2>
      <ul>
        <li>Listing details (price, area, amenities, photos, possession date) are provided by property owners and are not independently verified by Draazy unless explicitly marked as "Verified".</li>
        <li>A "Verified" tag — including "Verified by Draazy" and any per-document "Verified" badge — means only that Draazy confirmed the owner's identity and sighted the document the owner provided. It is <strong>not</strong> a certification of that document's authenticity or legal validity, nor a confirmation of clear, marketable, or dispute-free title.</li>
        <li>Users must conduct their own due diligence — including title search, encumbrance certificate check, approved building plan verification, and physical inspection — and consult a qualified lawyer before entering into any transaction or paying any advance.</li>
      </ul>

      <h2>3. Pricing and market data</h2>
      <p>
        Price trends, locality scores, rental yields, and comparative market data displayed on the Platform are derived
        from publicly available data sources, user-reported transactions, and algorithmic estimates. They may not reflect
        actual market conditions and should not be relied upon as the sole basis for financial decisions.
      </p>

      <h2>4. Third-party services</h2>
      <p>
        The Platform facilitates access to third-party service providers including banks, NBFCs, legal firms, packers
        &amp; movers, interior designers, and property valuers. Draazy:
      </p>
      <ul>
        <li>Does not guarantee the quality, timeliness, or outcome of services rendered by these partners.</li>
        <li>Is not a party to the contract between you and the service provider.</li>
        <li>Does not provide legal, tax, financial, or architectural advice through these partners.</li>
        <li>Recommends that you independently verify credentials (RERA registration, RBI licence, Bar Council enrolment) of any professional engaged through the Platform.</li>
      </ul>

      <h2>5. EMI calculator and loan eligibility</h2>
      <p>
        The EMI calculator and loan eligibility tools provide <strong>indicative estimates only</strong>. Actual loan
        amounts, interest rates, tenure, and EMIs are determined solely by the lending institution based on your credit
        profile, income documentation, and their internal policies. Draazy does not guarantee loan approval or specific
        terms.
      </p>

      <h2>6. No guarantee of transactions</h2>
      <p>
        Draazy does not guarantee that using the Platform will result in a successful property purchase, sale, or rental.
        We do not guarantee the availability, suitability, or legal status of any property listed.
      </p>

      <h2>7. Limitation of liability</h2>
      <p>
        Under no circumstances shall Draazy, its directors, employees, or affiliates be liable for any direct, indirect,
        incidental, special, or consequential damages arising from:
      </p>
      <ul>
        <li>Reliance on information published on the Platform by other users.</li>
        <li>Any transaction or dispute between users of the Platform.</li>
        <li>Errors, omissions, or inaccuracies in property data, pricing, or market insights.</li>
        <li>Temporary unavailability of the Platform due to maintenance or technical issues.</li>
        <li>Actions or omissions of third-party service providers.</li>
      </ul>

      <h2>8. External links</h2>
      <p>
        The Platform may contain links to external websites (e.g., RERA portals, bank websites, government services).
        These links are provided for convenience; Draazy does not endorse, control, or assume responsibility for the
        content or practices of third-party sites.
      </p>

      <h2>9. Regulatory compliance</h2>
      <p>
        Users are solely responsible for ensuring their transactions comply with applicable laws including but not limited
        to RERA 2016, the Registration Act 1908, the Indian Stamp Act 1899 (as applicable in Maharashtra), FEMA regulations
        for NRI transactions, and income tax provisions related to property transactions (TDS under Section 194-IA).
      </p>

      <h2>10. Updates</h2>
      <p>
        This Disclaimer may be updated from time to time. Continued use of the Platform after changes are posted
        constitutes acceptance of the revised Disclaimer.
      </p>
    </LegalPage>
  );
}
