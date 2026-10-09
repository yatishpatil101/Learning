/* Knowledge base for "Draaz", the Draazy help assistant. Pure data; the matcher ranks entries by
   keyword overlap. Action shape: { label, icon, to | ask, external? } — `external` hands off to the OS. */

export const ASSISTANT = {
  name: 'Draaz',
  tagline: 'Draazy guide',
  /* First bubble when the panel opens with an empty thread. */
  greeting:
    "Hi, I'm Draaz — your Draazy guide. I can show you how anything here works and take you straight to it. What are you looking to do?",
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
    a: "Draazy is zero-brokerage: every home is posted by its owner, so there's no broker and no commission. Our team checks each listing before it goes live. Search to buy or rent, shortlist what you like, and send the owner a contact request — once they accept, you chat right here on Draazy.",
    actions: [
      { label: 'Browse listings', to: '/listings', icon: 'search' },
      { label: 'How verification works', icon: 'shield-check', ask: 'How are owners and listings verified' },
    ],
  },
  {
    id: 'search',
    keywords: ['search', 'find', 'buy', 'rent', 'browse', 'listings', 'flats', 'apartment', 'home', 'house', 'property', 'smart', 'filter', 'filters', 'bhk', 'budget', 'locality', 'area', 'map'],
    q: 'How do I search for a property?',
    a: "Open Listings and pick Buy or Rent. Type plain English like “2 BHK under 40k in Baner, ready to move” and we turn it into filters — or set BHK, budget, furnishing and possession yourself; each option shows how many homes match. On the map, focus up to 5 localities to see their pins. Your filters live in the link, so you can share or bookmark a search.",
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
    a: "Tap Save search on any Listings result and we'll tell you when a new home matches. Tap the heart on a property to shortlist it — everything you saved is under Saved, where the bell on a home turns it into an alert. Flatmates and locality pages have their own alerts too. You need to be signed in to save.",
    actions: [
      { label: 'Go to Saved', to: '/saved', icon: 'heart' },
      { label: 'Notifications', to: '/notifications', icon: 'bell' },
    ],
  },
  {
    id: 'contact-gate',
    keywords: ['contact', 'owner', 'call', 'number', 'phone', 'details', 'request', 'reveal', 'reach', 'message', 'connect', 'masked', 'limit'],
    q: 'How do I contact an owner?',
    a: "Open a property and tap Contact owner — you only need to be signed in with your mobile number. That sends the owner a contact request; once they accept, a chat opens in Messages. Their number stays private throughout. A free account includes 15 owner contacts (asking again on the same home is free), and paid plans remove the limit. A few owners only accept people with the Verified badge.",
    actions: [
      { label: 'Browse listings', to: '/listings', icon: 'search' },
      { label: 'My messages', to: '/messages', icon: 'message-circle' },
    ],
    pages: ['/property'],
  },
  {
    id: 'verification',
    keywords: ['verify', 'verified', 'verification', 'trust', 'genuine', 'fake', 'scam', 'safe', 'aadhaar', 'pan', 'badge', 'document', 'authentic', 'rera', 'selfie', 'kyc'],
    q: 'How are owners and listings verified?',
    a: "Every listing is checked by our team before it goes live: real photos, not a duplicate, details that add up.     Owners can also earn a Verified property badge with an ownership proof such as an electricity bill or society share certificate. Anyone can get the ID verified badge by photographing a government ID with a live selfie — a person on our team decides, never a machine. Badges are optional trust signals, never a requirement to browse, post or contact.",
    actions: [
          { label: 'Verify identity', to: '/verify-identity', icon: 'shield-check' },
      { label: 'Browse listings', to: '/listings', icon: 'search' },
    ],
  },
  {
    id: 'schedule-visit',
    keywords: ['visit', 'visits', 'schedule', 'tour', 'see', 'inspection', 'viewing', 'appointment', 'book', 'site', 'video'],
    q: 'How do I schedule a property visit?',
    a: "On a property page, tap Visit and choose in-person or a video walkthrough, then a date and time. The owner confirms or suggests another slot, and you'll get a notification. Your visits are in your Dashboard under Visits. Once the owner marks a visit completed, you can leave a “Visited” review.",
    actions: [
      { label: 'My visits', to: '/dashboard#visits', icon: 'calendar-check' },
      { label: 'Browse listings', to: '/listings', icon: 'search' },
    ],
    pages: ['/property'],
  },
  {
    id: 'compare',
    keywords: ['compare', 'comparison', 'versus', 'vs', 'side', 'difference'],
    q: 'Can I compare properties?',
    a: "Yes. Tap the compare icon on any listing card to add it, then open Compare to see price, area, BHK, furnishing and amenities side by side.",
    actions: [{ label: 'Open Compare', to: '/compare', icon: 'git-compare' }],
  },
  {
    id: 'list-property',
    keywords: ['list', 'post', 'add', 'sell', 'rent', 'out', 'my', 'property', 'upload', 'advertise', 'landlord', 'photos', 'headline'],
    q: 'How do I list my property?',
    a: "Tap List property and follow the 4 steps: details, location, pricing, and photos & documents. Draazy is owner-only — brokers and agents can't list. Your draft saves as you go, and the wizard asks you to sign in with your mobile number when it needs to. Add your own photos (up to the limit shown) and a headline, or use our suggestion. Our team reviews the listing before it goes live. The free plan includes 1 listing.",
    actions: [
      { label: 'List my property', to: '/list-property', icon: 'plus-circle' },
      { label: 'Why isn’t it live yet?', icon: 'help-circle', ask: 'Why is my listing not live' },
    ],
  },
  {
    id: 'listing-status',
    keywords: ['live', 'pending', 'review', 'approved', 'rejected', 'status', 'listing', 'pause', 'resume', 'edit', 'needs', 'info', 'archived', 'hidden'],
    q: 'Why is my listing not live yet?',
    a: "New listings stay under review until our team approves them. If something is missing, we ask for more info and you can fix it and resubmit; a final rejection comes with the reason. Editing key details sends a live listing back for a quick re-check. You can pause a listing and resume it later — it all lives in your Dashboard under My Properties.",
    actions: [{ label: 'My properties', to: '/dashboard#properties', icon: 'home' }],
  },
  {
    id: 'plans',
    keywords: ['plan', 'plans', 'price', 'pricing', 'paid', 'premium', 'featured', 'subscription', 'cost', 'upgrade', 'package', 'seeker', 'plus'],
    q: 'What do the paid plans include?',
    a: "Starting is free: 1 listing for owners and 15 owner contacts for home-seekers. Seeker Plus removes the contact limit. Owner Plus and Owner Pro add more listings, featured placement so your home shows higher, and unlimited contacts. Compare current prices on the Plans page.",
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
    keywords: ['rent', 'agreement', 'lease', 'e-stamp', 'stamp', 'registration', 'register', 'legal', 'draft', 'notarise', 'contract', 'leave', 'licence', 'license', 'biometric'],
    q: 'Can you help with a rent agreement?',
    a: "Yes. Fill one guided form for a Maharashtra Leave & Licence agreement — or invite your tenant to fill their half. You see the stamp duty, registration and service fee before you pay; our team drafts it and registers it with a biometric visit at your door, no office trip. Track every step online. This is document help, not legal advice.",
    actions: [{ label: 'Rent agreement', to: '/services/rent-agreement', icon: 'file-signature' }],
  },
  {
    id: 'services',
    keywords: ['service', 'services', 'packers', 'movers', 'shifting', 'interior', 'renovation', 'painting', 'legal', 'valuation', 'valuate', 'worth'],
    q: 'What services does Draazy offer?',
    a: "Beyond search, Draazy offers home services: packers & movers, interior & renovation, property legal help, property valuation, home loans and rent agreements — each with upfront pricing and online tracking.",
    actions: [
      { label: 'All services', to: '/services', icon: 'concierge-bell' },
      { label: 'Property valuation', to: '/services/property-valuation', icon: 'trending-up' },
    ],
  },
  {
    id: 'pay-rent',
    keywords: ['pay', 'rent', 'online', 'payment', 'card', 'upi', 'transfer', 'monthly', 'wallet', 'hra'],
    q: 'Can I pay rent online?',
    a: "Not yet — paying rent through Draazy is coming. Meanwhile, record the home you rent in your Rent Wallet and it works out your yearly total, your deposit and your HRA exemption for you.",
    actions: [{ label: 'Rent Wallet', to: '/dashboard#finances', icon: 'wallet' }],
  },
  {
    id: 'flatmate',
    keywords: ['flatmate', 'flatmates', 'roommate', 'room', 'share', 'sharing', 'co-living', 'partner', 'spare', 'interest'],
    q: 'How do I find a flatmate or a room?',
    a: "Open Flatmates. Under Move in now you'll find spare rooms (single or double sharing, rent split equally) and open seats; under Team up, people and groups looking for a flat together. Send interest — once the host accepts, you can message them. Got a spare room? List it, start a group, or post what you're looking for. Posts with phone numbers in the text are refused, and our team reviews posts to keep them genuine.",
    actions: [
      { label: 'Flatmates', to: '/flatmates', icon: 'users' },
      { label: 'Flatmate groups', icon: 'help-circle', ask: 'How do flatmate groups work' },
    ],
  },
  {
    id: 'flatmate-groups',
    keywords: ['group', 'groups', 'team', 'join', 'seat', 'seats', 'members', 'leave', 'host', 'together'],
    q: 'How do flatmate groups work?',
    a: "Anyone can start a group — with a flat you already have, or while still looking (pick up to 3 localities, BHK and a budget range). Others ask to join, and the host's Accept gives them a seat. You can be in up to 2 groups at a time, counting requests still waiting. Members can leave or cancel a request, the host can remove members, and every group has its own chat in Messages.",
    actions: [
      { label: 'Team up', to: '/flatmates?view=team-up', icon: 'users' },
      { label: 'My messages', to: '/messages', icon: 'message-circle' },
    ],
  },
  {
    id: 'messages',
    keywords: ['message', 'messages', 'chat', 'chats', 'inbox', 'reply', 'conversation', 'talk'],
    q: 'Where are my chats?',
    a: "All your chats are in Messages: with owners once they accept your contact request, with flatmate hosts once they accept your interest, and your flatmate group chats. Unread chats show a badge in the top bar.",
    actions: [{ label: 'Open Messages', to: '/messages', icon: 'message-circle' }],
  },
  {
    id: 'locality',
    keywords: ['locality', 'area', 'neighbourhood', 'neighborhood', 'baner', 'wakad', 'hadapsar', 'where', 'live', 'guide', 'insights', 'connectivity', 'prices'],
    q: 'How do I learn about a locality?',
    a: "Open Locality guides to see who each Pune area suits, how you get around and what to check before you rent or buy. Each area page also shows the homes live there, and you can set an alert for new ones.",
    actions: [{ label: 'Locality guides', to: '/locality', icon: 'map-pin' }],
  },
  {
    id: 'societies',
    keywords: ['society', 'societies', 'building', 'apartment', 'complex', 'follow', 'resident', 'residents', 'reviews', 'ratings'],
    q: 'Can I look up a housing society?',
    a: "Yes. Societies lets you search Pune buildings and open each one's page: specs, ratings, homes for sale or rent, community tips and location. Follow a society to hear about new homes there, and add yours if it's missing.",
    actions: [{ label: 'Explore societies', to: '/societies', icon: 'building' }],
  },
  {
    id: 'account',
    keywords: ['account', 'sign', 'signin', 'signup', 'login', 'log', 'register', 'otp', 'password', 'profile', 'dashboard'],
    q: 'How do I sign in or manage my account?',
    a: "Sign in with your mobile number and a one-time code — there's no password. Your Dashboard is home base: requests waiting on you, your properties, visits, rental details and your account settings.",
    actions: [
      { label: 'Sign in', to: '/signin', icon: 'log-in' },
      { label: 'My dashboard', to: '/dashboard', icon: 'gauge' },
    ],
  },
  {
    id: 'refer',
    keywords: ['refer', 'referral', 'invite', 'friend', 'reward', 'earn', 'bonus'],
    q: 'Is there a referral programme?',
    a: "Yes — share your link from the Refer page. When a friend you invite qualifies, home-seekers earn 15 extra owner contacts, and owners earn a free rent agreement for every 3. Rewards are non-cash.",
    actions: [{ label: 'Refer & earn', to: '/refer', icon: 'gift' }],
  },
  {
    id: 'city',
    keywords: ['city', 'cities', 'mumbai', 'bangalore', 'expand', 'available', 'waitlist', 'launch', 'other'],
    q: 'Which cities is Draazy available in?',
    a: "We're Pune-first and going deep here before we expand. If your city isn't live yet, join the waitlist from the banner and we'll let you know when we launch there.",
    actions: [{ label: 'Explore Pune homes', to: '/listings', icon: 'search' }],
  },
  {
    id: 'support',
    keywords: ['support', 'help', 'human', 'agent', 'talk', 'contact', 'ticket', 'complaint', 'issue', 'problem', 'stuck', 'call', 'reach', 'someone'],
    q: 'How do I reach a human / get support?',
    a: "Raise a support ticket and track every reply, browse the Help Centre, or contact us directly. Our support team is available 9 AM – 9 PM, all days.",
    actions: [
      { label: 'Raise a ticket', to: '/support', icon: 'ticket-plus' },
      { label: 'Help Centre', to: '/help', icon: 'book-open' },
    ],
  },
];

/* Per-route follow-up suggestions: KB ids surfaced as chips when the panel opens
   on that page, so the assistant is context-aware. Matched by path prefix. */
export const ROUTE_SUGGESTIONS = {
  '/listings': ['search', 'save-search', 'contact-gate', 'compare'],
  '/property': ['contact-gate', 'schedule-visit', 'verification'],
  '/list-property': ['list-property', 'listing-status', 'plans'],
  '/flatmates': ['flatmate', 'flatmate-groups', 'messages'],
  '/messages': ['messages', 'contact-gate'],
  '/societies': ['societies', 'locality'],
  '/society': ['societies', 'locality'],
  '/locality': ['locality', 'societies', 'save-search'],
  '/verify-identity': ['verification'],
  '/services': ['services', 'rent-agreement', 'emi'],
  '/plans': ['plans', 'list-property'],
  '/emi-calculator': ['emi', 'rent-agreement'],
  '/dashboard': ['listing-status', 'schedule-visit', 'messages'],
  '/saved': ['save-search', 'contact-gate'],
  '/support': ['support', 'contact-gate', 'how-it-works'],
  '/': ['how-it-works', 'search', 'list-property'],
};
