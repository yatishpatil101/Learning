/* Read by both the page and the build-time prerender so the HTML never says more than the screen;
   re-read every source and update AS_OF before changing a figure. */
export const AS_OF = 'October 2026';
export const CHECKED_ON = '9 October 2026';
export const CORRECTIONS_EMAIL = 'support@draazy.com';

export const SOURCES = {
  home: { label: 'NoBroker home page', url: 'https://www.nobroker.in/' },
  tenant: { label: 'NoBroker Tenant Plans', url: 'https://www.nobroker.in/tenant/plans' },
  buyer: { label: 'NoBroker Buyer Plans', url: 'https://www.nobroker.in/buyer/plans' },
  owner: { label: 'NoBroker Owner Plans', url: 'https://www.nobroker.in/owner/plans' },
  agreement: { label: 'NoBroker rent agreement in Pune', url: 'https://www.nobroker.in/rental-agreement-in-pune' },
  terms: { label: 'NoBroker Terms and Conditions (last updated 29 May 2023)', url: 'https://www.nobroker.in/terms-and-condition' },
};

export const COMPARE_NOBROKER = {
  top: 'Draazy vs',
  accent: 'NoBroker',
  subtitle: 'Plans and fees compared for Pune',
  summary: [
    'NoBroker lists homes in many cities and sells assisted plans for tenants, buyers, owners and sellers. Its tenant plans start at \u20B91,649 plus 18% GST.',
    'Draazy focuses on Pune. The first 15 owner contacts and the first listing are free, and paid plans start at \u20B9199.',
    'Which one fits depends on your city and on whether you want a paid plan where a relationship manager works with owners or tenants for you.',
  ],
  rows: [
    {
      label: 'City coverage',
      nobroker: {
        text: 'Lists homes in several cities, including Bangalore, Mumbai, Delhi, Gurgaon, Noida, Hyderabad, Chennai and Pune. Its rent agreement page says that service is available in 150+ cities.',
        src: ['home', 'agreement'],
      },
      draazy: { text: 'Pune. Draazy lists homes in Pune.' },
    },
    {
      label: 'Cost to contact owners',
      nobroker: {
        text: 'Tenant plans: Freedom \u20B91,649 for 25 owner contacts over 90 days; Relax \u20B93,999 and MoneyBack \u20B95,999 for 50 owner contacts each over 45 days. Buyer plans: Power Plan \u20B91,899 for up to 25 contacts; Property Expert Plan \u20B91,999 for up to 50. Every price is shown plus 18% GST.',
        src: ['tenant', 'buyer'],
      },
      draazy: {
        text: 'The first 15 owner contacts are free. Seeker Plus, at \u20B9199, adds more. Checkout shows taxes as included.',
        link: ['See plans and pricing', '/plans'],
      },
    },
    {
      label: 'Owner listing cost',
      nobroker: {
        text: 'The home page offers \u201CPost Free Property Ad\u201D. Owner plans are Relax \u20B93,399, Super Relax \u20B95,899, MoneyBack \u20B96,999 and Super MoneyBack \u20B910,999, each plus 18% GST, with plan validity listed as 45 days.',
        src: ['home', 'owner'],
      },
      draazy: {
        text: 'The first listing is free. Owner Plus is \u20B9999 a year and Owner Pro is \u20B92,499 a year.',
        link: ['List your property', '/list-property'],
      },
    },
    {
      label: 'What paid plans include',
      nobroker: {
        text: 'Features listed on the plan pages include a relationship manager, owner meeting scheduling and rent negotiation for tenants, and showing the property on your behalf, a personal field assistant, a photoshoot and Facebook marketing for owners. The terms say plan fees are non-refundable except under the MoneyBack plan.',
        src: ['tenant', 'owner', 'terms'],
      },
      draazy: {
        text: 'Seeker Plus adds owner contacts. Owner Plus and Owner Pro add live listings and featured placement, and Owner Pro adds a dedicated manager. A plan with no premium feature used can be refunded in full within 7 days of purchase.',
        link: ['Read the refund policy', '/refund-policy'],
      },
    },
    {
      label: 'How listings are checked',
      nobroker: {
        text: 'The home page says it connects people to \u201Cverified owners\u201D.',
        src: ['home'],
      },
      draazy: {
        text: 'A person on the Draazy team reviews every new listing before it appears in search. Owners can also complete ID verification, which staff review.',
        link: ['How verification works', '/how-verification-works'],
      },
    },
    {
      label: 'How your number is shared',
      nobroker: {
        text: 'The Owner Plans page lists \u201CPrivacy of your phone number\u201D among plan features.',
        src: ['owner'],
      },
      draazy: {
        text: 'Phone numbers stay hidden on both sides until the owner approves a contact request.',
      },
    },
    {
      label: 'Rent agreement',
      nobroker: {
        text: 'Offers a government-registered agreement with doorstep biometric, or a notary agreement. The cost is estimated from rent, deposit and duration with a calculator on the page.',
        src: ['agreement'],
      },
      draazy: {
        text: 'A Maharashtra leave and licence agreement, drafted and e-registered online, with an optional doorstep biometric visit. The platform fee is \u20B9500, with GST, stamp duty and registration charges itemised before you pay.',
        link: ['Rent agreement service', '/services/rent-agreement'],
      },
    },
    {
      label: 'Other services',
      nobroker: {
        text: 'The home page menu lists rental agreement, painting and cleaning, packers and movers, rent receipts and tuition fee payment.',
        src: ['home'],
      },
      draazy: {
        text: 'Rent agreements, property legal help and registration, home loans, valuation, packers and movers, and interiors.',
        link: ['Draazy services', '/services'],
      },
    },
  ],
  nobrokerFit: {
    title: 'When NoBroker may suit you better',
    list: [
      'You are searching outside Pune. Draazy is built for Pune.',
      'You want a paid plan where a relationship manager contacts owners or tenants and schedules meetings for you. NoBroker publishes plans of that kind.',
      'You want a MoneyBack plan, which NoBroker\u2019s terms refer to.',
      'You need a rent agreement or another service in a city other than Pune.',
    ],
  },
  draazyFit: {
    title: 'When Draazy may suit you',
    list: [
      'You are renting, buying or listing in Pune and want to start without paying: the first 15 owner contacts and the first listing are free.',
      'You want an owner\u2019s number hidden until the owner approves your request, and your own number hidden until then.',
      'You want a person on the team to review each listing before it appears in search.',
      'You prefer a yearly owner plan at \u20B9999 or \u20B92,499 to a 45-day plan.',
    ],
    links: [['Browse homes in Pune', '/listings'], ['See plans and pricing', '/plans']],
  },
  faq: [
    {
      q: 'Is Draazy cheaper than NoBroker?',
      a: 'The two publish different plans, so there is no single answer. NoBroker lists \u20B91,649 plus 18% GST for 25 owner contacts over 90 days. Draazy makes the first 15 owner contacts free and sells Seeker Plus at \u20B9199. Compare them against the number of owner contacts you expect to need and the city you are searching in.',
    },
    {
      q: 'Does Draazy charge brokerage?',
      a: 'No. Draazy does not charge brokerage on rent or on a sale. NoBroker\u2019s home page also describes listing without any brokerage. Both charge for optional plans and services.',
    },
    {
      q: 'Do I need a paid plan to contact owners on Draazy?',
      a: 'No. The first 15 owner contacts are free. After that, a seeker plan adds more contacts.',
    },
    {
      q: 'Where do the NoBroker details on this page come from?',
      a: `They are read from NoBroker\u2019s own published pages, listed under Sources, and are accurate as of ${AS_OF}. NoBroker can change its plans and prices at any time, so check its page before you pay. To correct anything here, write to ${CORRECTIONS_EMAIL}.`,
    },
  ],
  disclaimer: 'Draazy is not affiliated with NoBroker. NoBroker and its plan names belong to their owner.',
};
