import { Link } from 'react-router';
import LegalPage from '../../components/LegalPage.jsx';

export default function Privacy() {
  return (
    <LegalPage title="Privacy Policy" lastUpdated="1 July 2026" current="privacy">
      <p>
        PuneNest Technologies Private Limited ("<strong>PuneNest</strong>", "we", "us", or "our") operates the website
        punenest.com and associated mobile applications. This Privacy Policy explains how we collect, use, disclose, and
        safeguard your personal information when you use our platform.
      </p>

      <h2>1. Information we collect</h2>
      <h3>1.1 Information you provide</h3>
      <ul>
        <li><strong>Account data</strong> — name, mobile number, email address, role (buyer / tenant / owner).</li>
        <li><strong>Property listings</strong> — address, photos, pricing, floor plans, and other listing details you publish.</li>
        <li><strong>Service requests</strong> — details submitted via our packers &amp; movers, home loans, legal assistance, rent agreement, interior renovation, or property valuation forms.</li>
        <li><strong>Payment data</strong> — billing name, address, UPI ID, or card details processed via our PCI-DSS compliant payment gateway. We do not store full card numbers on our servers.</li>
        <li><strong>Communications</strong> — messages exchanged with other users or our support team through the platform.</li>
      </ul>

      <h3>1.2 Information collected automatically</h3>
      <ul>
        <li>Device type, operating system, browser, IP address, and approximate geolocation.</li>
        <li>Pages visited, search queries, time spent, and interaction events (clicks, scrolls).</li>
        <li>Cookies and similar tracking technologies (see Section 6).</li>
      </ul>

      <h3>1.3 Information from third parties</h3>
      <ul>
        <li>Identity verification partners (Aadhaar-based eKYC, PAN verification) for owner accounts.</li>
        <li>Credit bureaus and lending partners when you apply for a home loan through us.</li>
        <li>Social login providers (Google) if you sign in via third-party authentication.</li>
      </ul>

      <h2>2. How we use your information</h2>
      <ul>
        <li>To create and manage your account, verify your identity, and enable property transactions.</li>
        <li>To connect buyers/tenants with property owners and facilitate direct communication.</li>
        <li>To process service requests and share relevant details with our verified partners (movers, banks, legal firms).</li>
        <li>To send transactional notifications (OTPs, booking confirmations, payment receipts).</li>
        <li>To personalise property recommendations, search results, and locality insights.</li>
        <li>To improve our platform, detect fraud, resolve disputes, and comply with legal obligations.</li>
        <li>To send marketing communications (only with your consent; you may opt out at any time).</li>
      </ul>

      <h2>3. Information sharing and disclosure</h2>
      <p>We do not sell your personal information. We share data only in the following circumstances:</p>
      <ul>
        <li><strong>With other users</strong> — your name and verified status are visible on your listings. Contact details are shared only when you expressly initiate or accept a connection request.</li>
        <li><strong>With service partners</strong> — when you submit a service request (e.g., home loan eligibility check), we share the minimum details needed to fulfil your request with the selected partner(s).</li>
        <li><strong>With payment processors</strong> — to process transactions securely.</li>
        <li><strong>For legal compliance</strong> — when required by law, court order, or government authority.</li>
        <li><strong>Business transfers</strong> — in the event of a merger, acquisition, or asset sale, your data may be transferred to the successor entity.</li>
      </ul>

      <h2>4. Data retention</h2>
      <p>
        We retain your personal data for as long as your account is active or as needed to provide services. After account
        deletion, we anonymise or delete your data within 90 days, except where retention is required by law (e.g., financial
        records under the Income Tax Act — 8 years; RERA transaction records — 5 years after project completion).
      </p>

      <h2>5. Data security</h2>
      <p>
        We implement industry-standard security measures including TLS 1.3 encryption in transit, AES-256 encryption at rest,
        role-based access controls, regular penetration testing, and SOC 2 Type II audited infrastructure. Despite these
        measures, no system is perfectly secure — we cannot guarantee absolute security of your data.
      </p>

      <h2>6. Cookies and tracking</h2>
      <p>We use the following categories of cookies:</p>
      <ul>
        <li><strong>Strictly necessary</strong> — session authentication, CSRF protection, load balancing.</li>
        <li><strong>Functional</strong> — language preferences, recently viewed properties, saved searches.</li>
        <li><strong>Analytics</strong> — aggregated usage statistics to improve the platform (e.g., page performance, feature adoption).</li>
        <li><strong>Marketing</strong> — only with your explicit consent; used for retargeting and conversion measurement.</li>
      </ul>
      <p>
        Non-essential cookies (functional, analytics, and marketing) are set only after you consent via our
        cookie banner, which is shown on your first visit. Strictly necessary cookies do not require consent.
        You can change or withdraw your choices at any time from the cookie banner or your browser settings.
      </p>

      <h2>7. Your rights</h2>
      <p>Under the Digital Personal Data Protection Act, 2023 (DPDPA), you have the right to:</p>
      <ul>
        <li>Access your personal data held by us.</li>
        <li>Correct inaccurate or incomplete data.</li>
        <li>Erase your data (subject to legal retention requirements).</li>
        <li>Withdraw consent for optional processing activities.</li>
        <li>Nominate a person to exercise your rights in your absence.</li>
        <li>Lodge a grievance with the Data Protection Board of India.</li>
      </ul>
      <p>
        You may withdraw consent for any optional processing at any time — withdrawing is as easy as giving it.
        To exercise these rights, email <a href="mailto:privacy@punenest.com">privacy@punenest.com</a> or open the{' '}
        <Link to="/dashboard#profile">Privacy &amp; Account</Link> section under Dashboard → Profile, where you can
        download or permanently delete your data. Where a registered Consent Manager is available, you may also use it
        to review and manage your consents. We acknowledge requests within 72 hours and resolve them within the
        timelines prescribed under the DPDPA, 2023 and its rules.
      </p>

      <h2>8. Children's privacy</h2>
      <p>
        Our platform is not intended for individuals under 18 years of age. We do not knowingly collect personal data
        from minors. If we learn that we have collected data from a child, we will delete it promptly.
      </p>

      <h2>9. Changes to this policy</h2>
      <p>
        We may update this Privacy Policy periodically. Material changes will be communicated via in-app notification
        or email at least 15 days before they take effect. Continued use of the platform after the effective date
        constitutes acceptance of the revised policy.
      </p>

      <h2>10. Company details &amp; grievance redressal</h2>
      <p>
        In accordance with the Information Technology Act, 2000 and the Intermediary Guidelines Rules, 2021, the
        Consumer Protection (E-Commerce) Rules, 2020, and the DPDPA, 2023, our company and grievance-officer details are:
      </p>
      <p>
        <strong>Legal entity:</strong> PuneNest Technologies Private Limited<br />
        <strong>CIN:</strong> U72900PN2024PTC000000<br />
        <strong>GSTIN:</strong> 27ABCDE1234F1Z5<br />
        <strong>Registered office:</strong> 201, Business Bay, Baner Road, Pune 411045, Maharashtra, India
      </p>
      <p>
        <strong>Grievance Officer:</strong> Mr. Rohan Deshpande<br />
        <strong>Email:</strong> <a href="mailto:grievance@punenest.com">grievance@punenest.com</a><br />
        <strong>Phone:</strong> +91 98765 43210 (Mon–Sat, 9 AM – 6 PM)<br />
        <strong>Acknowledgement:</strong> within 24 hours; grievances resolved within 15 days as required by law.
      </p>
      <p>
        <strong>Data Protection / Nodal Officer:</strong> Ms. Ananya Kulkarni<br />
        <strong>Email:</strong> <a href="mailto:dpo@punenest.com">dpo@punenest.com</a>
      </p>
      <p>
        If your grievance is not resolved to your satisfaction, you may escalate to the{' '}
        <strong>Data Protection Board of India</strong> under the DPDPA, 2023.
      </p>
    </LegalPage>
  );
}
