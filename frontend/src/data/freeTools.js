export const TOOLS_AS_OF = '9 October 2026';

export const SOURCES = {
  igrSchedule: {
    label: 'Maharashtra Stamp Act, 1958: Schedule I, Articles 25 and 36A (IGR Maharashtra)',
    url: 'https://igrmaharashtra.gov.in/pdf/documents/The_Maharashtra_Act_Schedule_1_and_2.pdf',
  },
  igr: {
    label: 'Inspector General of Registration and Controller of Stamps, Maharashtra',
    url: 'https://igrmaharashtra.gov.in',
  },
  hra: {
    label: 'Income Tax Department: CBDT Circular 8/2013 on landlord PAN for HRA',
    url: 'https://incometaxindia.gov.in/w/employees-benefits-allowable',
  },
  stampAct: {
    label: 'Indian Stamp Act, 1899: Schedule I, Article 53, Receipt (India Code)',
    url: 'https://www.indiacode.nic.in/',
  },
};

const NO_SOURCES = 'These are standard formulas. No outside rate or rule is involved, so there is nothing to cite.';

export const FREE_TOOLS = [
  {
    path: '/tools/rent-receipt-generator',
    name: 'Rent receipt generator',
    summary: 'Monthly rent receipts for your HRA claim, ready to print or save as PDF.',
    top: 'Rent receipt generator',
    accent: 'for HRA',
    subtitle: 'Make monthly rent receipts for your HRA claim. Print them or save them as PDF. Your details stay on this device.',
    how: [
      'Enter the names, address, monthly rent and period. The tool makes one receipt for each month, up to 12 at a time. Each receipt shows the month, the amount, how it was paid and the landlord\'s PAN if you add it.',
      'Landlord PAN: if you pay more than ₹1,00,000 rent in a year, your employer needs the landlord\'s PAN to allow the HRA exemption. If the landlord has no PAN, a declaration from the landlord with name and address is needed instead.',
      'Revenue stamp: under Article 53 of the Indian Stamp Act, 1899, a receipt for more than ₹5,000 needs a ₹1 revenue stamp. The tool leaves a stamp box on cash receipts above ₹5,000. The landlord affixes the stamp and signs across it. Rent paid by bank transfer, UPI or cheque also leaves a bank record.',
    ],
    sources: ['hra', 'stampAct'],
    faq: [
      { q: 'Do I need rent receipts to claim HRA?', a: 'Employers usually ask for rent receipts as proof when you claim HRA, and what they accept is their decision. Keep the receipts, your rent agreement and a record of each payment.' },
      { q: 'When do I need my landlord\'s PAN?', a: 'When the rent you pay in a year is more than ₹1,00,000. If the landlord has no PAN, you need a declaration from the landlord with their name and address.' },
      { q: 'Do rent receipts need a revenue stamp?', a: 'A receipt for more than ₹5,000 needs a ₹1 revenue stamp under the Indian Stamp Act. It matters mainly for cash payments. This tool adds a stamp box to cash receipts above ₹5,000.' },
      { q: 'Does Draazy keep what I enter?', a: 'No. The receipts are made in your browser. Nothing is sent to Draazy or saved.' },
    ],
    cta: { text: 'Own the flat you rent out? List it on Draazy free and talk to tenants directly.', label: 'List your property', to: '/list-property' },
  },
  {
    path: '/tools/stamp-duty-calculator-maharashtra',
    name: 'Stamp duty calculator for Maharashtra',
    summary: 'Stamp duty, registration fee and total for a flat in Pune Municipal Corporation or PCMC limits.',
    top: 'Stamp duty calculator',
    accent: 'for Maharashtra',
    subtitle: 'Stamp duty and registration fee for a flat in Pune Municipal Corporation or PCMC limits. Add the agreement value and, if you have it, the ready reckoner value.',
    how: [
      'Value used = the higher of the agreement value and the ready reckoner value. Stamp duty = value × 7%. Registration fee = 1% of the value, capped at ₹30,000. Total = stamp duty + registration fee.',
      'Stamp duty on a sale deed is charged on the true market value of the property (Article 25, Schedule I, Maharashtra Stamp Act). IGR Maharashtra publishes the ready reckoner rates.',
      '7% is the rate Draazy uses for Pune Municipal Corporation and PCMC limits. Other areas, such as municipal councils and rural areas, have other rates, and some buyers may get concessions. This tool does not cover them, so check the current rate with IGR Maharashtra or your Sub-Registrar office before you pay.',
    ],
    sources: ['igrSchedule', 'igr'],
    faq: [
      { q: 'Is stamp duty charged on the agreement value or the ready reckoner value?', a: 'On the higher of the two. The ready reckoner rate is the government\'s minimum value per area, so a flat sold below it is still taxed at the ready reckoner value.' },
      { q: 'What is the stamp duty in Pune?', a: 'Draazy uses 7% for Pune Municipal Corporation and PCMC limits. Check the current rate with IGR Maharashtra before you pay.' },
      { q: 'How much is the registration fee?', a: '1% of the property value, up to a maximum of ₹30,000.' },
      { q: 'Does this calculator apply concessions for women buyers?', a: 'No. Concessions depend on the buyer and the date, so this tool shows the standard rate. Ask IGR Maharashtra or the Sub-Registrar office whether one applies to you.' },
    ],
    cta: { text: 'Know your costs? See flats for sale in Pune from owners, with no brokerage.', label: 'Browse flats for sale', to: '/listings?deal=buy' },
  },
  {
    path: '/tools/rent-agreement-cost-pune',
    name: 'Rent agreement cost calculator for Pune',
    summary: 'Stamp duty and registration fee for a Pune leave and licence agreement, from rent, deposit and term.',
    top: 'Rent agreement cost',
    accent: 'in Pune',
    subtitle: 'Stamp duty and registration fee for a leave and licence agreement in Pune, worked out from the rent, deposit and term.',
    how: [
      'Stamp duty = 0.25% of (rent for the whole term, including any yearly increase, + 10% a year of the refundable deposit), rounded up to the next ₹100, with a minimum of ₹100. This is Article 36A of the Maharashtra Stamp Act, for agreements of up to 60 months.',
      'The 10% on the deposit is counted for each year or part of a year of the term, so an 11-month agreement counts as one year. A non-refundable deposit or premium is added to the total in the same way. This tool leaves it out.',
      'Registration fee: ₹1,000 for urban areas such as Pune, plus ₹300 document handling for e-registration, as in Draazy\'s rent agreement service. If you book through Draazy there is also our service fee plus GST, shown separately below.',
    ],
    sources: ['igrSchedule', 'igr'],
    faq: [
      { q: 'Is it compulsory to register a rent agreement in Maharashtra?', a: 'Yes. Section 55 of the Maharashtra Rent Control Act, 1999 makes registration compulsory for every leave and licence agreement, whatever its term.' },
      { q: 'How is stamp duty on a rent agreement calculated?', a: '0.25% of the rent for the whole term plus 10% a year of the refundable deposit, rounded up to the next ₹100. The calculator above does the sum.' },
      { q: 'Does an 11-month agreement avoid registration?', a: 'No. A shorter term means less stamp duty, but every leave and licence agreement in Maharashtra must be registered, whether it runs 11 months or 60.' },
      { q: 'Does this work for a shop or office?', a: 'No. It is for homes. Commercial agreements involve GST and TDS and are quoted by Draazy\'s legal desk.' },
    ],
    cta: { text: 'Renting out a flat? List it free on Draazy and let tenants contact you directly.', label: 'List your property', to: '/list-property' },
  },
  {
    path: '/tools/rental-yield-calculator',
    name: 'Rental yield calculator',
    summary: 'Gross and net rental yield from price, rent, running costs and vacancy.',
    top: 'Rental yield',
    accent: 'calculator',
    subtitle: 'Work out gross and net rental yield from the price, monthly rent, running costs and empty months.',
    how: [
      'Gross yield = monthly rent × 12 ÷ price × 100.',
      'Net yield = (monthly rent × (12 − empty months) − monthly maintenance × 12 − yearly property tax) ÷ price × 100. Payback in years = price ÷ net yearly income.',
      'Net yield is before income tax and loan interest. Add stamp duty and registration to the price if you want the full cost of buying; the stamp duty calculator works them out. Rent and costs change, so treat the result as a guide.',
    ],
    sources: [],
    noSources: NO_SOURCES,
    faq: [
      { q: 'What is the difference between gross and net yield?', a: 'Gross yield counts only the yearly rent against the price. Net yield also takes off maintenance, property tax and the months the flat stands empty.' },
      { q: 'How many empty months should I use?', a: 'The months your flat has stood empty between tenants, or may stand empty. Your own history is the best guide.' },
      { q: 'What is a good rental yield?', a: 'There is no single number. Compare the net yield with what else your money could earn, such as the interest on your home loan, and remember that prices can rise or fall.' },
      { q: 'Does it include the loan or tax on rent?', a: 'No. It shows the return on the full price, before any loan interest and before income tax on the rent.' },
    ],
    cta: { text: 'Looking for a flat to buy and rent out? Browse listings from owners in Pune.', label: 'Browse flats for sale', to: '/listings?deal=buy' },
  },
];

export const TOOLS_HUB = {
  path: '/tools',
  top: 'Free property tools',
  accent: 'for Pune',
  subtitle: 'Calculators and generators for renters, buyers and owners. No sign-in, and nothing you enter leaves your device.',
  cta: { text: 'Done with the sums? Find a home in Pune directly from the owner.', label: 'Browse listings', to: '/listings' },
};

export const toolByPath = (path) => FREE_TOOLS.find((t) => t.path === path);
