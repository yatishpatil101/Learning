/* Knowledge base for "Nestor", the Draazy help assistant.
   Pure data — no backend. Each entry answers a "how do I / how does it work"
   question in the app's voice and offers the matching in-app action(s).
   The matcher (lib/assistant/match.js) ranks entries by keyword overlap, so
   keep `keywords` broad (synonyms + the words a real user would type).

   Action shape: { label, to, icon, external? }
     - to: a react-router path ("/listings") OR an external url / tel: / https://wa.me/...
     - external: true  → open in a new tab / hand off to the OS (tel, whatsapp)
   Gated routes (list-property, schedule-visit, support…) are fine to link to
   directly: ProtectedRoute redirects an unauthenticated user to sign in. */

export const ASSISTANT = {
  name: 'Nestor',
  tagline: 'Draazy guide',
  /* First bubble when the panel opens with an empty thread. */
  greeting:
    "Hi, I'm Nestor — your Draazy guide. I can show you how anything here works and take you straight to it. What are you looking to do?",
};

/* Top-of-panel chips: the highest-intent starting points. `ask` chips run the
   text through the matcher; `nav` chips jump straight to a route. */
export const QUICK_ACTIONS = [
  { label: 'Find a home', icon: 'search', kind: 'nav', to: '/listings' },
  { label: 'List my property', icon: 'plus-circle', kind: 'nav', to: '/list-property' },
  { label: 'How Draazy works', icon: 'sparkles', kind: 'ask', text: 'How does Draazy work' },
  { label: 'Talk to a human', icon: 'headset', kind: 'ask', text: 'Talk to a human' },
];

/* Human-support escalation — surfaced on every low-confidence answer so the
   assistant is never a dead end. */
export const ESCALATION = {
  intro: "Happy to hand you to a person. You can:",
  actions: [
    { label: 'Raise a support ticket', to: '/support', icon: 'ticket-plus' },
    { label: 'Contact us', to: '/contact', icon: 'mail' },
    { label: 'Call 1800 200 0000', to: 'tel:18002000000', icon: 'phone', external: true },
  ],
};

export const KB = [
  {
    id: 'how-it-works',
    keywords: ['how', 'work', 'works', 'draazy', 'about', 'what', 'is', 'zero', 'brokerage', 'broker', 'commission', 'fee', 'free', 'direct', 'owner'],
    q: 'How does Draazy work?',
    a: "Draazy is zero-brokerage: you deal directly with verified owners, so there's no broker fee — ever. Search homes to buy or rent, shortlist what you like, and contact the owner directly. Owners list free; we add trust with identity and document checks.",
    actions: [
      { label: 'Browse listings', to: '/listings', icon: 'search' },
      { label: 'How owners are verified', icon: 'shield-check', ask: 'How are owners verified' },
    ],
  },
  {
    id: 'search',
    keywords: ['search', 'find', 'buy', 'rent', 'browse', 'listings', 'flats', 'apartment', 'home', 'house', 'property', 'smart', 'filter', 'bhk', 'budget', 'locality', 'area'],
    q: 'How do I search for a property?',
    a: "Open Listings and switch between Buy and Rent. Use Smart search to type plain English like “2 BHK under 40k in Baner, ready to move”, or use the filters for BHK, budget, furnishing, possession and owner-vs-broker. Your filters stay in the URL, so you can share or bookmark a search.",
    actions: [
      { label: 'Open Listings', to: '/listings', icon: 'search' },
      { label: 'View on map', to: '/listings?view=map', icon: 'map-pin' },
    ],
    pages: ['/listings', '/'],
  },
  {
    id: 'save-search',
    keywords: ['save', 'saved', 'search', 'alert', 'alerts', 'notify', 'notification', 'shortlist', 'favourite', 'favorite', 'wishlist', 'bookmark'],
    q: 'How do saved searches and alerts work?',
    a: "Tap Save search on any Listings result to store your filters — we'll notify you when new matching homes go live. Tap the heart on a property to shortlist it; find everything later under Saved.",
    actions: [
      { label: 'Go to Saved', to: '/saved', icon: 'heart' },
      { label: 'Notifications', to: '/notifications', icon: 'bell' },
    ],
  },
  {
    id: 'contact-gate',
    keywords: ['contact', 'owner', 'call', 'number', 'phone', 'details', 'gate', 'aadhaar', 'verify', 'reveal', 'reach', 'message', 'connect'],
    q: 'How do I contact an owner?',
    a: "Open a property and tap Contact owner. To keep listings spam-free and genuine, contact details unlock after you sign in and verify your number (Aadhaar-backed). Once verified you can call or message the owner directly — no broker in between.",
    actions: [
      { label: 'Sign in to contact', to: '/signin', icon: 'log-in' },
      { label: 'Browse listings', to: '/listings', icon: 'search' },
    ],
    pages: ['/property'],
  },
  {
    id: 'verification',
    keywords: ['verify', 'verified', 'verification', 'trust', 'genuine', 'fake', 'scam', 'safe', 'aadhaar', 'document', 'authentic', 'rera'],
    q: 'How are owners and listings verified?',
    a: "We verify owner identity (Aadhaar) and, where available, ownership documents, and we surface RERA IDs on projects that have them. Look for the verified badge and the “posted” freshness date on each card — genuine, recent listings rank higher.",
    actions: [{ label: 'See verified listings', to: '/listings', icon: 'shield-check' }],
  },
  {
    id: 'schedule-visit',
    keywords: ['visit', 'schedule', 'tour', 'see', 'inspection', 'viewing', 'appointment', 'book', 'site'],
    q: 'How do I schedule a property visit?',
    a: "On a property page, tap Schedule visit and pick a slot that suits you. The owner confirms, and you'll see the confirmation under Notifications. You can reschedule if plans change.",
    actions: [
      { label: 'Schedule a visit', to: '/schedule-visit', icon: 'calendar-check' },
      { label: 'My notifications', to: '/notifications', icon: 'bell' },
    ],
    pages: ['/property'],
  },
  {
    id: 'compare',
    keywords: ['compare', 'comparison', 'versus', 'vs', 'shortlist', 'side', 'difference'],
    q: 'Can I compare properties?',
    a: "Yes. Tap the compare icon on any listing card to add it, then open Compare to see price, area, BHK, furnishing and amenities side by side — so you can decide with the facts in front of you.",
    actions: [{ label: 'Open Compare', to: '/compare', icon: 'git-compare' }],
  },
  {
    id: 'list-property',
    keywords: ['list', 'post', 'add', 'sell', 'rent', 'out', 'owner', 'my', 'property', 'upload', 'advertise', 'landlord'],
    q: 'How do I list my property?',
    a: "Tap List property and follow the step-by-step wizard: property type, location, specs, photos, price and contact. It autosaves as you go, so a refresh never loses your work. Basic listing is free; paid plans add featured placement and more buyer contacts.",
    actions: [
      { label: 'List my property', to: '/list-property', icon: 'plus-circle' },
      { label: 'See plans', to: '/plans', icon: 'badge-check' },
    ],
  },
  {
    id: 'plans',
    keywords: ['plan', 'plans', 'price', 'pricing', 'paid', 'premium', 'featured', 'subscription', 'cost', 'upgrade', 'package'],
    q: 'What do the paid plans include?',
    a: "Listing is free to start. Paid plans add featured placement so your property shows higher, more buyer/tenant contacts, and priority support. Compare tiers on the Plans page and upgrade whenever you're ready.",
    actions: [{ label: 'View Plans', to: '/plans', icon: 'badge-check' }],
  },
  {
    id: 'emi',
    keywords: ['emi', 'loan', 'home', 'calculate', 'calculator', 'interest', 'monthly', 'installment', 'afford', 'finance', 'mortgage'],
    q: 'Is there an EMI / home-loan calculator?',
    a: "Yes — the EMI calculator estimates your monthly instalment from loan amount, interest rate and tenure, so you know your budget before you shortlist. Need the actual loan? Our Home Loans service helps you compare and apply.",
    actions: [
      { label: 'EMI calculator', to: '/emi-calculator', icon: 'calculator' },
      { label: 'Home loans', to: '/home-loans', icon: 'landmark' },
    ],
  },
  {
    id: 'rent-agreement',
    keywords: ['rent', 'agreement', 'lease', 'e-stamp', 'stamp', 'registration', 'legal', 'document', 'draft', 'notarise', 'contract', 'leave', 'licence', 'license'],
    q: 'Can you help with a rent agreement?',
    a: "Yes. We draft your rent agreement, e-stamp it and deliver it to your doorstep — from ₹999. Track every step online. This is document assistance, not legal advice; for disputes consult a lawyer.",
    actions: [{ label: 'Rent agreement', to: '/services/rent-agreement', icon: 'file-signature' }],
  },
  {
    id: 'services',
    keywords: ['service', 'services', 'packers', 'movers', 'shifting', 'interior', 'renovation', 'painting', 'legal', 'valuation', 'valuate', 'worth', 'help'],
    q: 'What services does Draazy offer?',
    a: "Beyond search, Draazy offers home services: packers & movers, interior & renovation, property legal help, property valuation, home loans and rent agreements. Each has upfront pricing and online tracking.",
    actions: [
      { label: 'All services', to: '/services', icon: 'concierge-bell' },
      { label: 'Property valuation', to: '/services/property-valuation', icon: 'trending-up' },
    ],
  },
  {
    id: 'pay-rent',
    keywords: ['pay', 'rent', 'online', 'payment', 'card', 'upi', 'transfer', 'monthly', 'landlord'],
    q: 'Can I pay rent online?',
    a: "Not yet — paying rent through Draazy is coming. In the meantime, record the home you rent in your Rent Wallet and it works out your yearly total, your deposit and your HRA exemption for you.",
    actions: [{ label: 'Rent Wallet', to: '/dashboard?tab=finances', icon: 'wallet' }],
  },
  {
    id: 'flatmate',
    keywords: ['flatmate', 'flatmates', 'roommate', 'share', 'sharing', 'pg', 'paying', 'guest', 'co-living', 'partner'],
    q: 'Can I find a flatmate or flatmates?',
    a: "Yes — use Flatmates to list a spare room or find a flatmate whose preferences match yours (budget, locality, habits). Great for splitting rent in Pune's IT hubs.",
    actions: [{ label: 'Flatmates', to: '/flatmates', icon: 'users' }],
  },
  {
    id: 'locality',
    keywords: ['locality', 'area', 'neighbourhood', 'neighborhood', 'baner', 'wakad', 'hadapsar', 'where', 'live', 'guide', 'insights', 'connectivity'],
    q: 'How do I learn about a locality?',
    a: "Open Locality guides for insights on Pune neighbourhoods — connectivity, price trends, and what living there is like — so you can pick the right area before you pick the flat.",
    actions: [{ label: 'Locality guides', to: '/locality', icon: 'map-pin' }],
  },
  {
    id: 'account',
    keywords: ['account', 'sign', 'signin', 'signup', 'login', 'log', 'register', 'password', 'profile', 'dashboard', 'my'],
    q: 'How do I sign in or manage my account?',
    a: "Sign in (or create an account) with your mobile number. Your Dashboard is home base — saved homes, enquiries, listings and visits all in one place.",
    actions: [
      { label: 'Sign in', to: '/signin', icon: 'log-in' },
      { label: 'My dashboard', to: '/dashboard', icon: 'gauge' },
    ],
  },
  {
    id: 'refer',
    keywords: ['refer', 'referral', 'invite', 'friend', 'reward', 'earn', 'bonus'],
    q: 'Is there a referral programme?',
    a: "Yes — invite friends from the Refer page and both of you earn rewards when they join and transact. Share your link over WhatsApp in a tap.",
    actions: [{ label: 'Refer & earn', to: '/refer', icon: 'gift' }],
  },
  {
    id: 'city',
    keywords: ['city', 'cities', 'mumbai', 'bangalore', 'expand', 'available', 'live', 'waitlist', 'launch', 'other'],
    q: 'Which cities is Draazy available in?',
    a: "We're Pune-first and going deep here before we expand. If your city isn't live yet, join the waitlist from the banner and we'll notify you the moment we launch — the most-requested cities jump the queue.",
    actions: [{ label: 'Explore Pune homes', to: '/listings', icon: 'search' }],
  },
  {
    id: 'support',
    keywords: ['support', 'help', 'human', 'agent', 'talk', 'contact', 'ticket', 'complaint', 'issue', 'problem', 'stuck', 'call', 'reach', 'someone'],
    q: 'How do I reach a human / get support?',
    a: "You can raise a support ticket and track every reply, or contact us directly. Our team is available Mon–Sat, 9 AM–8 PM.",
    actions: [
      { label: 'Raise a ticket', to: '/support', icon: 'ticket-plus' },
      { label: 'Contact us', to: '/contact', icon: 'mail' },
    ],
  },
];

/* Per-route follow-up suggestions: KB ids surfaced as chips when the panel opens
   on that page, so the assistant is context-aware. Matched by path prefix. */
export const ROUTE_SUGGESTIONS = {
  '/listings': ['search', 'save-search', 'contact-gate', 'compare'],
  '/property': ['contact-gate', 'schedule-visit', 'verification'],
  '/list-property': ['list-property', 'plans', 'verification'],
  '/services': ['services', 'rent-agreement', 'emi'],
  '/plans': ['plans', 'list-property'],
  '/emi-calculator': ['emi', 'rent-agreement'],
  '/dashboard': ['account', 'save-search', 'list-property'],
  '/saved': ['save-search', 'contact-gate'],
  '/support': ['support', 'contact-gate', 'how-it-works'],
  '/': ['how-it-works', 'search', 'list-property'],
};
