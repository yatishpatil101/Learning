/* Knowledge base for "Draaz", the Draazy help assistant. Pure data; the matcher ranks entries by
   keyword overlap. Action shape: { label, icon, to | ask, external? } — `external` hands off to the OS. */

import { SUPPORT_PHONE, SUPPORT_TEL } from '../lib/supportContact.js';

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
    { label: `Call ${SUPPORT_PHONE}`, to: SUPPORT_TEL, icon: 'phone', external: true },
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
    a: "Tap Save search on any Listings result and we'll tell you in the app when a new home matches — daily by default. When results are thin, the Create alert card does the same. Tap the heart on a property to shortlist it; everything you saved is under Saved. Flatmates and locality pages have their own alerts too. You can keep up to 10 saved searches and alerts, and you need to be signed in.",
    actions: [
      { label: 'Go to Saved', to: '/saved', icon: 'heart' },
      { label: 'Notifications', to: '/notifications', icon: 'bell' },
    ],
  },
  {
    id: 'contact-gate',
    keywords: ['contact', 'owner', 'call', 'number', 'phone', 'details', 'request', 'reveal', 'reach', 'message', 'connect', 'masked', 'limit'],
    q: 'How do I contact an owner?',
    a: "Open a property and tap Contact Owner (or Request number) — you only need to be signed in with your mobile number. That sends the owner a contact request; your number stays private. Once they accept, you can chat in Messages and you see their number, unless the owner keeps it private. A request with no answer lapses after 30 days. A free account includes 15 owner contacts for life (asking again on the same home is free); referring friends or Seeker Plus gets you more. A few owners only accept people with the Verified badge.",
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
    a: "Every listing is checked by our team before it goes live: real photos, not a duplicate, details that add up. Owners can also earn a Verified property badge with an ownership proof such as an electricity bill or society share certificate; changing the address, society or price later removes it until it's re-checked. Anyone can get the ID verified badge by photographing a government ID with a live selfie — a person on our team decides, never a machine, and the images are deleted 7 days after the decision. Badges are optional trust signals, never a requirement to browse, post or contact.",
    actions: [
      { label: 'Verify identity', to: '/verify-identity', icon: 'shield-check' },
      { label: 'How verification works', to: '/how-verification-works', icon: 'shield-check' },
      { label: 'Browse listings', to: '/listings', icon: 'search' },
    ],
  },
  {
    id: 'schedule-visit',
    keywords: ['visit', 'visits', 'schedule', 'tour', 'see', 'inspection', 'viewing', 'appointment', 'book', 'site', 'video'],
    q: 'How do I schedule a property visit?',
    a: "On a property page, tap Schedule a Visit, choose In-person or Video tour, pick a date and time and tap Confirm Visit. The owner confirms or suggests another slot, and you'll get a notification. Your visits are in your Dashboard under Visits, where you can cancel if plans change. Once the owner marks a visit completed, you can leave a “Visited” review.",
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
    a: "Tap List property and follow the 4 steps: details, location (pick your society first), pricing, and photos & documents. Draazy is owner-only — brokers and agents can't list. Your draft saves as you go, and the wizard asks you to sign in with your mobile number when it needs to. Add at least one real photo and label the key rooms; keep phone numbers and emails out of the headline and description. Our team reviews the listing before it goes live. The free plan includes 1 live listing.",
    actions: [
      { label: 'List my property', to: '/list-property', icon: 'plus-circle' },
      { label: 'Why isn’t it live yet?', icon: 'help-circle', ask: 'Why is my listing not live' },
    ],
  },
  {
    id: 'listing-status',
    keywords: ['live', 'pending', 'review', 'approved', 'rejected', 'status', 'listing', 'pause', 'resume', 'edit', 'needs', 'info', 'archived', 'hidden'],
    q: 'Why is my listing not live yet?',
    a: "New listings stay Under review until our team approves them. If something is missing the status becomes Needs info — fix it and resubmit; we remind you on day 3 and 7, and an unanswered listing is archived on day 14. A final rejection comes with the reason. Editing key details sends a live listing back for a quick re-check. You can pause a listing and resume it later, or Finalize rental / sale once it's done — it all lives in your Dashboard under My Properties.",
    actions: [{ label: 'My properties', to: '/dashboard#properties', icon: 'home' }],
  },
  {
    id: 'plans',
    keywords: ['plan', 'plans', 'price', 'pricing', 'paid', 'premium', 'featured', 'subscription', 'cost', 'upgrade', 'package', 'seeker', 'plus'],
    q: 'What do the paid plans include?',
    a: "Starting is free: 1 listing for owners and 15 owner contacts for home-seekers. Seeker Plus removes the contact limit for 1 month on one payment and does not renew by itself. Owner Plus and Owner Pro add more listings, featured placement so your home shows higher, and unlimited contacts. Compare current prices on the Plans page.",
    actions: [{ label: 'View Plans', to: '/plans', icon: 'badge-check' }],
  },
  {
    id: 'emi',
    keywords: ['emi', 'loan', 'home', 'calculate', 'calculator', 'interest', 'monthly', 'installment', 'afford', 'finance', 'mortgage'],
    q: 'Is there an EMI / home-loan calculator?',
    a: "Yes — the EMI calculator estimates your monthly instalment from loan amount, interest rate and tenure. The free Tools page also has a stamp duty calculator, a rent receipt generator, a rent agreement cost estimator and a rental yield calculator. Need the actual loan? Our Home Loans service gives free advice and a callback within 24 hours.",
    actions: [
      { label: 'EMI calculator', to: '/emi-calculator', icon: 'calculator' },
      { label: 'All free tools', to: '/tools', icon: 'calculator' },
      { label: 'Home loans', to: '/home-loans', icon: 'landmark' },
    ],
  },
  {
    id: 'rent-agreement',
    keywords: ['rent', 'agreement', 'lease', 'e-stamp', 'stamp', 'registration', 'register', 'legal', 'draft', 'notarise', 'contract', 'leave', 'licence', 'license', 'biometric'],
    q: 'Can you help with a rent agreement?',
    a: "Yes, for residential homes. Fill one guided form for a Maharashtra Leave & Licence agreement — or invite your tenant to fill their half. You see the stamp duty, registration and our ₹500 + GST fee before you pay; our team drafts it, every party approves the draft, and we register it with a biometric visit at your door, no office trip. Track every step online. This is document help, not legal advice.",
    actions: [{ label: 'Rent agreement', to: '/services/rent-agreement', icon: 'file-signature' }],
  },
  {
    id: 'services',
    keywords: ['service', 'services', 'packers', 'movers', 'shifting', 'interior', 'renovation', 'painting', 'legal', 'valuation', 'valuate', 'worth'],
    q: 'What services does Draazy offer?',
    a: "Beyond search, Draazy offers home services: packers & movers (free quote), interior & renovation, property legal help (fixed fee told upfront), property valuation (free instant estimate or a valuer-signed report), home loans (free advice) and rent agreements. Most send a callback within 24 hours, and you track every request online.",
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
    a: "Open Flatmates. Under Move in now you'll find spare rooms (single or double sharing, rent split equally) and open seats; under Team up, people and groups looking for a flat together. Send interest — once the host accepts, you can message them. Got a spare room? List it, start a group, or post what you're looking for. Posts with phone numbers in the text are refused, our team reviews room posts to keep them genuine, and each post stays up for 30 days (you can have 3 live at once).",
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
    a: "Sign in with your mobile number and a one-time code sent on WhatsApp — there's no password. Your Dashboard is home base: requests waiting on you, your properties, visits, rental details and your account settings. You can ask for your data to be deleted from Profile; our team reviews the request.",
    actions: [
      { label: 'Sign in', to: '/signin', icon: 'log-in' },
      { label: 'My dashboard', to: '/dashboard', icon: 'gauge' },
    ],
  },
  {
    id: 'refer',
    keywords: ['refer', 'referral', 'invite', 'friend', 'reward', 'earn', 'bonus'],
    q: 'Is there a referral programme?',
    a: "Yes — share your link from the Refer page. A referral counts once your friend qualifies — for an owner, when their first listing is verified. Each qualified friend earns you 15 extra owner contacts, and every 3 also earn a free rent agreement (we waive our fee and GST at checkout; government charges still apply) and an extra listing slot. Up to 10 referrals can qualify in 30 days. Rewards are non-cash.",
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
    id: 'offers',
    keywords: ['offer', 'offers', 'negotiate', 'negotiation', 'counter', 'bargain', 'finalize', 'finalise', 'close', 'deal', 'under', 'backup', 'token'],
    q: 'How do I make an offer or close a deal?',
    a: "On the property page use Make an offer — one offer per home, and Revise offer updates it. The owner can accept, counter or decline, and you can agree at their counter or counter back. An accepted offer agrees the price but doesn't close the home. To close, use Request to Finalize once your contact request is approved; when the owner accepts, the home comes off the market. If a home shows Under Offer, you can Register backup interest.",
    actions: [{ label: 'Offers & closing guide', to: '/help/a/offers-and-closing', icon: 'book-open' }],
    pages: ['/property'],
  },
  {
    id: 'owner-requests',
    keywords: ['requests', 'leads', 'enquiries', 'enquiry', 'tenants', 'buyers', 'accept', 'decline', 'interested', 'approve', 'hide', 'privacy', 'serious'],
    q: 'I am an owner — how do I handle contact requests?',
    a: "Number, photo, document and flatmate requests all wait in your Dashboard under Requests, and anything urgent also shows in the Action Center on Home. Open one to accept or decline it; a verified tick tells you the team has checked that person's ID. Once you accept a number request, Call and WhatsApp buttons appear — or keep your number private in Settings and talk only in Messages. Offers and finalize requests show on your listing.",
    actions: [
      { label: 'My requests', to: '/dashboard#leads', icon: 'inbox' },
      { label: 'My messages', to: '/messages', icon: 'message-circle' },
    ],
  },
  {
    id: 'report',
    keywords: ['report', 'fraud', 'fake', 'scam', 'suspicious', 'wrong', 'broker', 'spam', 'abuse', 'misleading', 'flag'],
    q: 'How do I report a suspicious listing?',
    a: "Open the listing and tap Report listing (you need to be signed in). Our team reviews it and can hide the listing or suspend the account; you can't file again while a report is under review. Never pay a token or deposit before you've seen the home and the owner's documents.",
    actions: [{ label: 'Spot a scam', to: '/help/a/spot-a-scam', icon: 'shield-check' }],
    pages: ['/property'],
  },
  {
    id: 'notifications',
    keywords: ['notification', 'notifications', 'notify', 'push', 'browser', 'bell', 'whatsapp', 'sms', 'email', 'mute', 'quiet', 'updates'],
    q: 'How will Draazy notify me?',
    a: "Everything lands in the bell at the top of the app: owner replies, visit updates and new homes for your alerts. In Dashboard › Profile you can turn match alerts on or off, set quiet hours overnight, and allow message alerts on this device. Your sign-in code comes on WhatsApp; alerts are not sent by SMS.",
    actions: [
      { label: 'Notifications', to: '/notifications', icon: 'bell' },
      { label: 'Settings', to: '/dashboard#profile', icon: 'user-cog' },
    ],
  },
  {
    id: 'theme',
    keywords: ['dark', 'light', 'theme', 'mode', 'night', 'appearance', 'colour', 'color', 'bright', 'screen'],
    q: 'Can I switch to dark mode?',
    a: "Yes. Draazy opens in light mode. Tap your name at the top and use the sun / moon button next to it, or turn off Light mode in Dashboard › Profile. The choice is saved on this device.",
    actions: [{ label: 'Appearance settings', to: '/dashboard#profile', icon: 'user-cog' }],
  },
  {
    id: 'explore',
    keywords: ['blog', 'reels', 'video', 'videos', 'articles', 'guide', 'guides', 'tips', 'news', 'read', 'tools', 'calculator', 'stamp', 'receipt', 'yield'],
    q: 'What else can I explore on Draazy?',
    a: "Reels lets you swipe through homes as short videos. The Pune blog has renting and buying guides. Free Tools cover EMI, stamp duty, rent receipts, rent agreement cost and rental yield.",
    actions: [
      { label: 'Reels', to: '/reels', icon: 'play-circle' },
      { label: 'Blog', to: '/blog', icon: 'book-open' },
      { label: 'Free tools', to: '/tools', icon: 'calculator' },
    ],
  },
  {
    id: 'whats-new',
    keywords: ['whats', 'latest', 'changelog', 'release', 'version', 'changed', 'features'],
    q: "What's new on Draazy?",
    a: "The latest release (1.9.0, October 2026) made light mode the default, simplified the locality and near-a-place search, added locality guides with a Pune map and the Pune blog, and made listing location society-first. The changelog lists every release.",
    actions: [{ label: "See what's new", to: '/help/changelog', icon: 'sparkles' }],
  },
  {
    id: 'support',
    keywords: ['support', 'help', 'human', 'agent', 'talk', 'contact', 'ticket', 'complaint', 'issue', 'problem', 'stuck', 'call', 'reach', 'someone'],
    q: 'How do I reach a human / get support?',
    a: "Raise a support ticket and track every reply, browse the Help Centre, or contact us directly. Our support team is available 9 AM – 8 PM, Monday to Saturday.",
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
  '/property': ['contact-gate', 'schedule-visit', 'offers', 'report'],
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
  '/tools': ['emi', 'explore'],
  '/blog': ['explore', 'locality'],
  '/reels': ['explore', 'contact-gate'],
  '/notifications': ['notifications', 'save-search'],
  '/dashboard': ['listing-status', 'owner-requests', 'schedule-visit', 'messages'],
  '/saved': ['save-search', 'contact-gate'],
  '/support': ['support', 'contact-gate', 'how-it-works'],
  '/': ['how-it-works', 'search', 'list-property'],
};
