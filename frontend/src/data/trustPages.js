import { SITE_DESCRIPTION } from './routeHeads.js';

/* Read by both the page and the build-time prerender (scripts/vite-plugin-route-heads.mjs),
   so the HTML never says more than the screen; change claims with the code and help centre. */
export const TRUST_PAGES = {
  '/about': {
    top: 'About',
    accent: 'Draazy',
    intro: SITE_DESCRIPTION,
    sections: [
      {
        title: 'What Draazy is',
        body: [
          'Owners list their own homes, plots and commercial spaces on Draazy. Tenants and buyers contact them directly, so there is no broker in between and no brokerage to pay.',
          'Draazy is run by Draazy Technologies. Built in Pune by the Draazy team, and Pune is where we focus.',
        ],
      },
      {
        title: 'What you can do here',
        list: [
          'Search homes, plots and commercial spaces for rent or sale in Pune.',
          'Contact owners, schedule visits and make offers in one place.',
          'Find a flatmate or a room in a shared flat.',
          'Read locality guides and the Draazy blog before you decide.',
          'Book optional services such as rent agreements, legal checks, valuation, home loans and packers and movers.',
        ],
        links: [['Browse locality guides', '/locality'], ['Read the blog', '/blog']],
      },
      {
        title: 'How Draazy makes money',
        body: [
          'Draazy never takes a share of your rent, deposit or sale price. Searching and posting a basic listing are free, and so are your first 15 owner contacts.',
          'We earn from optional extras: paid plans (more live listings and featured placement for owners, unlimited owner contacts for seekers) and services such as rent agreements. The price is shown before you pay.',
        ],
        links: [['See plans and pricing', '/plans'], ['Explore services', '/services'], ['Draazy vs NoBroker', '/compare/nobroker']],
      },
      {
        title: 'Trust and privacy',
        body: [
          'A person on our team reviews every listing before it appears in search. Owners can also verify their identity, and our staff review it. Phone numbers stay hidden until the owner approves a contact request.',
        ],
        links: [['How verification works', '/how-verification-works'], ['Privacy policy', '/privacy']],
      },
      {
        title: 'Contact us',
        body: ['Write to support@draazy.com or use the contact form. The help centre answers most questions about searching, listing, payments and verification.'],
        links: [['Contact Draazy', '/contact'], ['Help centre', '/help']],
      },
    ],
  },
  '/how-verification-works': {
    top: 'How verification',
    accent: 'works',
    intro: 'Draazy checks people and listings in separate steps. Here is what each step is, who does it, and what it does not prove.',
    sections: [
      {
        title: 'What "Draazy Assured" means',
        body: ['Draazy Assured is our name for the protections every listing gets:'],
        list: [
          'A person on our team reviews every listing before it appears in search. Nothing goes live automatically.',
          'Phone numbers stay hidden. The owner\u2019s number is masked until they approve your contact request, and yours stays masked from them until then.',
          'Any signed-in user can report a listing. We re-verify it, and we can correct it, take it down or restrict the account.',
        ],
        links: [['Browse listings', '/listings']],
      },
      {
        title: 'How we check owners',
        body: [
          'Owner identity verification is optional and earns an ID verified badge. The owner photographs a government ID (Aadhaar, PAN, driving licence or passport) with the camera and records a live selfie. A reviewer on our team compares the two and decides. No badge is granted automatically, and submitting is not the same as passing.',
          'Some owners accept contact requests from ID verified people only. If you meet one, you are asked to verify first.',
        ],
      },
      {
        title: 'How we check listings',
        body: [
          'Every new listing waits for staff review. The reviewer checks the photos, the details, the address and locality, and whether the same home is already listed. The listing is then approved, sent back to the owner with a reason, or rejected.',
        ],
      },
      {
        title: 'Ownership documents',
        body: [
          'Owners can also submit ownership papers, such as an electricity bill, property tax receipt, sale deed or society share certificate. For land, a 7/12 extract or 8A is accepted. Staff review them, and an accepted listing carries a Verified property badge. The badge lapses when the documents expire, until the owner submits again.',
        ],
      },
      {
        title: 'After a listing is live',
        body: [
          'If an owner changes something fundamental, such as the BHK, property type, locality or deal type, the listing leaves search until staff approve it again. Smaller changes, such as price, photos or description, keep it live while we re-check them.',
          'Owners are asked to confirm availability regularly. Listings left unconfirmed are demoted and then hidden. An owner can mark a listing Under Offer while they work through a shortlist.',
        ],
        links: [['Report a listing', '/help/a/report-a-listing']],
      },
      {
        title: 'What verification does not mean',
        body: [
          'An ID verified badge confirms who posted the listing. A Verified property badge means the accepted papers were current when reviewed. Neither certifies legal title, the condition of the building, society approvals or the final rent.',
          'Before you pay for a purchase, get an independent title check.',
        ],
        links: [['Full guide in the help centre', '/help/a/how-we-verify'], ['Spotting a rental scam', '/help/a/spot-a-scam']],
      },
    ],
    faq: [
      {
        q: 'Does Draazy check every listing?',
        a: 'Yes. A person on our team reviews every new listing before it appears in search. They can approve it, ask the owner for more information, or reject it.',
      },
      {
        q: 'What does the ID verified badge mean?',
        a: 'The owner photographed a government ID and recorded a live selfie, and a reviewer on our team accepted them. It confirms who posted the listing. It is optional, so many listings do not have it.',
      },
      {
        q: 'Who can see my phone number?',
        a: 'Other users cannot see it until a contact request is approved. The owner\u2019s number is masked for you in the same way, and approval unlocks both sides.',
      },
      {
        q: 'What happens when I report a listing?',
        a: 'A person reviews the report. We may ask for more detail, correct the listing, take it down or restrict the account. The owner is not told who reported it.',
      },
      {
        q: 'What does Under Offer mean?',
        a: 'The owner is finalising with an interested tenant or buyer, but has not yet taken a token or signed an agreement. The listing stays live for backup enquiries until it is marked Rented or Sold.',
      },
      {
        q: 'Does verification guarantee legal title?',
        a: 'No. Badges show what we checked, not that the property has clear title. For a purchase, get an independent title check before you pay.',
      },
    ],
  },
};
