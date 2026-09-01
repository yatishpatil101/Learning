// ---------------- WhatsApp Templates ----------------
/* Pre-built message templates for owner communication. Variables use {var} syntax
   and get interpolated with listing/owner data before sending. */
import { rawLoad, rawSave } from './core.js';

const DEFAULT_WA_TEMPLATES = [
  {
    id: 'wa-onboard',
    name: 'Onboarding welcome',
    category: 'onboarding',
    body: 'Hi {owner_name}, welcome to PuneNest! 🏠\n\nYour property "{title}" in {locality} has been listed by our team. To make it live, please:\n\n1️⃣ Open your claim link\n2️⃣ Upload property photos\n3️⃣ Complete Aadhaar verification\n\nNeed help? Reply here or call us.\n— {staff_name}, PuneNest Team',
  },
  {
    id: 'wa-photos',
    name: 'Photo upload reminder',
    category: 'reminder',
    body: 'Hi {owner_name},\n\nYour listing "{title}" is almost ready! We just need property photos to publish it.\n\n📸 Upload 4-6 clear photos showing:\n• Living room/bedrooms\n• Kitchen & bathrooms\n• Balcony/exterior\n\nListings with photos get 3x more enquiries!\n\nUpload here: {claim_link}\n— PuneNest Team',
  },
  {
    id: 'wa-aadhaar',
    name: 'Aadhaar verification',
    category: 'reminder',
    body: 'Hi {owner_name},\n\nOne last step! Please complete Aadhaar verification for "{title}" to go live.\n\n🔒 This is a one-time identity check to build trust with buyers.\n\nVerify here: {claim_link}\n— PuneNest Team',
  },
  {
    id: 'wa-gentle',
    name: 'Gentle follow-up',
    category: 'reminder',
    body: 'Hi {owner_name},\n\nJust checking in on "{title}" in {locality}. We have interested buyers waiting!\n\nIs there anything blocking you from completing the listing? Happy to help over call.\n\n— {staff_name}, PuneNest',
  },
  {
    id: 'wa-live',
    name: 'Listing live notification',
    category: 'notification',
    body: 'Great news, {owner_name}! 🎉\n\nYour property "{title}" is now LIVE on PuneNest!\n\n🔗 View: punenest.com/property/{listing_id}\n\nBuyers can now see your listing and send enquiries. We\'ll notify you when someone is interested.\n\n— PuneNest Team',
  },
  {
    id: 'wa-enquiry',
    name: 'New enquiry alert',
    category: 'notification',
    body: 'Hi {owner_name},\n\nYou have a new enquiry for "{title}"! 📩\n\nA buyer is interested in your property. Please check your PuneNest dashboard to approve or decline the contact request.\n\n— PuneNest Team',
  },
  {
    id: 'wa-pricing',
    name: 'Pricing suggestion',
    category: 'advice',
    body: 'Hi {owner_name},\n\nQuick market update for {locality}:\n\n📊 Avg rate: ₹{market_rate}/sqft\n🏷️ Your listing: ₹{price}\n\nProperties priced within 10% of market rate get 2x more views. Would you like to adjust?\n\n— {staff_name}, PuneNest',
  },
  {
    id: 'wa-docs',
    name: 'Document request',
    category: 'verification',
    body: 'Hi {owner_name},\n\nTo complete verification of "{title}", we need:\n\n📄 Property ownership proof (sale deed / society NOC)\n📄 Recent electricity bill\n\nPlease upload via your dashboard or share photos here.\n\n— {staff_name}, PuneNest Team',
  },
  {
    id: 'wa-stale',
    name: 'Confirm still available (stale)',
    category: 'reminder',
    body: 'Hi {owner_name}, 👋\n\nQuick check on your listing "{title}" in {locality} — buyers are still finding it, but you haven\'t confirmed availability in a while.\n\nIs it still available?\n✅ Reply "YES" to confirm and keep it live & trusted\n🏠 Reply "DONE" if it\'s already rented/sold and we\'ll close it\n\nConfirming takes one tap: 🔗 punenest.com/property/{listing_id}\n\n— PuneNest Team',
  },
  {
    id: 'wa-dormant',
    name: 'Dormant listing reactivation',
    category: 'reminder',
    body: 'Hi {owner_name}, ⏰\n\nYour listing "{title}" in {locality} has been *paused* because it hasn\'t been confirmed as available in a while — so buyers can no longer see it.\n\nIf it is still available, reactivate it in one tap:\n🔗 punenest.com/property/{listing_id}\n\nJust reply "YES" and we\'ll make it live again instantly. If it\'s already rented/sold, reply "DONE" and we\'ll close it for you.\n\n— PuneNest Team',
  },
];

export function getWhatsappTemplates() {
  const db = rawLoad();
  if (!db.whatsappTemplates || !db.whatsappTemplates.length) {
    db.whatsappTemplates = DEFAULT_WA_TEMPLATES;
    rawSave(db);
  } else {
    // Merge in any default templates the stored DB is missing (e.g. new templates added
    // after a user's localStorage was seeded), so they appear without a KEY bump/reset.
    const have = new Set(db.whatsappTemplates.map((t) => t.id));
    const missing = DEFAULT_WA_TEMPLATES.filter((t) => !have.has(t.id));
    if (missing.length) {
      db.whatsappTemplates = [...db.whatsappTemplates, ...missing];
      rawSave(db);
    }
  }
  return db.whatsappTemplates;
}

/* `sendWhatsappTemplate(listingId, templateId)` stood here. It interpolated a template against a
   listing out of `db.listings`, bumped `reminderCount`, wrote a staff-activity row and returned a
   `wa.me` URL. Its last caller was the owner dashboard's "WhatsApp reminder" button, deleted with
   register item 28 — the admin console moved to `outreachService` some time earlier, so with that
   button gone the function had no callers left anywhere, including `e2e/`.

   `getWhatsappTemplates` above survives: the mock outreach provider still reads it to serve the
   template library the admin console lists. Only the *send* went. */

