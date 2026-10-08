import { Link } from 'react-router';
import LegalPage from '../../components/LegalPage.jsx';

export default function RefundPolicy() {
  return (
    <LegalPage title="Refund Policy" lastUpdated="24 September 2026" current="refund-policy">
      <p>
        This Refund Policy applies to all paid services and subscription plans purchased through draazy.com
        ("<strong>Platform</strong>") operated by Draazy Technologies Private Limited ("<strong>Draazy</strong>").
      </p>

      <h2>1. Scope</h2>
      <p>This policy covers:</p>
      <ul>
        <li>Premium listing plans (Owner Pro, Owner Plus).</li>
        <li>Subscription packages (monthly and annual).</li>
        <li>Pay-per-service charges for home loans, legal assistance, rent agreements, and other ancillary services.</li>
      </ul>
      <p>
        Property transactions between buyers, tenants, and owners are direct contracts between those parties. Draazy
        is not liable for refunds related to rent deposits, token amounts, or property sale advances exchanged between users.
      </p>

      <h2>2. Subscription refunds</h2>
      <h3>2.1 Within 7 days (cooling-off period)</h3>
      <p>
        If you purchased a subscription plan and have not utilised any premium feature (e.g., featured listing, contact
        reveal, verified badge display), you may request a full refund within 7 calendar days of purchase.
      </p>

      <h3>2.2 After 7 days</h3>
      <p>
        Subscriptions are non-refundable after the 7-day cooling-off period. You may cancel auto-renewal at any time;
        access continues until the end of the current billing cycle.
      </p>

      <h3>2.3 Annual plans</h3>
      <p>
        Annual plans paid upfront may be refunded on a pro-rata basis (unused full months remaining) if requested within
        30 days of purchase, provided fewer than 3 premium features have been consumed. After 30 days, annual plans
        are non-refundable.
      </p>

      <h2>3. Service request refunds</h2>
      <h3>3.1 Before partner assignment</h3>
      <p>
        If you submitted a paid service request (e.g., rent agreement drafting, legal due diligence) and no partner
        has been assigned yet, you may cancel and receive a full refund.
      </p>

      <h3>3.2 After partner assignment</h3>
      <p>
        Once a partner has been assigned and work has commenced, refunds are handled based on completion status:
      </p>
      <ul>
        <li><strong>Less than 25% complete</strong> — 75% refund of the service fee.</li>
        <li><strong>25%–50% complete</strong> — 50% refund of the service fee.</li>
        <li><strong>More than 50% complete</strong> — no refund; you may raise a dispute for service quality issues.</li>
      </ul>

      <h3>3.3 Rent agreements</h3>
      <p>
        For a Leave and License agreement, 3.1 and 3.2 do not apply. Everything you paid is refunded until the
        stamp duty is paid to the Government of Maharashtra on GRAS. After that, the stamp duty and registration
        charges are spent, and only the service fee (and anything you overpaid after a change of terms) is
        refunded. Every refund is approved by a second member of our team.
      </p>

      <h3>3.4 Service quality disputes</h3>
      <p>
        If you are dissatisfied with the quality of a completed service, you may raise a complaint within 7 days of
        delivery. Draazy will review the complaint and may offer a partial refund, re-do at no charge, or credit
        towards future services at its discretion.
      </p>

      <h2>4. Non-refundable items</h2>
      <ul>
        <li>Contact reveal credits once consumed (phone number or email viewed).</li>
        <li>Government fees, stamp duty, or registration charges paid on your behalf.</li>
        <li>Convenience or payment gateway charges.</li>
      </ul>

      <h2>5. How to request a refund</h2>
      <ol>
        <li>Log in and open <strong>Dashboard → Billing</strong> to find the transaction and its transaction ID.</li>
        <li>
          Email <a href="mailto:support@draazy.com">support@draazy.com</a> from your registered email address — or
          raise a ticket from the <Link to="/support">Support</Link> page — with your registered mobile number,
          transaction ID, and the reason for your request.
        </li>
        <li>Our team reviews every request within 2 business days and keeps you updated by email.</li>
      </ol>

      <h2>6. Refund processing</h2>
      <ul>
        <li>Approved refunds are processed within <strong>5–7 business days</strong>.</li>
        <li>Refunds are credited to the original payment method (UPI, bank account, or card).</li>
        <li>In case of technical failures, refunds may be issued as Draazy wallet credits with your consent.</li>
      </ul>

      <h2>7. Chargebacks</h2>
      <p>
        If you initiate a chargeback through your bank or card issuer without first contacting us, Draazy reserves the
        right to suspend your account pending investigation. We encourage you to reach out to our support team before
        disputing a charge externally.
      </p>

      <h2>8. Changes to this policy</h2>
      <p>
        We may update this Refund Policy from time to time. Changes take effect 15 days after notification via email
        or in-app banner. The policy applicable to your purchase is the one in effect at the time of the transaction.
      </p>
    </LegalPage>
  );
}
