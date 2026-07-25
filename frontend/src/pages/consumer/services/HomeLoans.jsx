import { useSearchParams } from 'react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ServiceLanding from '../../../components/ServiceLanding.jsx';
import LoanEmiCalc from './LoanEmiCalc.jsx';
import Icon from '../../../components/Icon.jsx';

const LENDERS = [
  { n: 'SBI', r: '8.50%' }, { n: 'HDFC', r: '8.60%' }, { n: 'ICICI', r: '8.65%' }, { n: 'Axis', r: '8.75%' }, { n: 'LIC HFL', r: '8.45%' },
];

export default function HomeLoans() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [prefillType, setPrefillType] = useState('');

  // Prefill loan type from URL (?type=balance)
  useEffect(() => {
    const typeParam = searchParams.get('type');
    if (typeParam) {
      // Match option value from HTML: search for partial match (case-insensitive)
      const options = ['Home Purchase Loan', 'Plot / Land Loan', 'Home Construction Loan', 'Balance Transfer', 'Top-up Loan', 'Loan Against Property'];
      const match = options.find(opt => opt.toLowerCase().includes(typeParam.toLowerCase()));
      if (match) setPrefillType(match);
    }
  }, [searchParams]);

  const compareSection = (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
      <div className="glass-card rounded-2xl p-6 sm:p-7 reveal">
        <h2 className="text-lg font-bold text-white mb-1">{t('services.homeLoans.compareTitle')}</h2>
        <p className="text-gray-400 text-xs mb-5">{t('services.homeLoans.compareSub')}</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {LENDERS.map((l) => (
            <div key={l.n} className="bg-white/[0.04] rounded-xl p-4 text-center hover:bg-white/[0.06] transition-all">
              <div className="w-10 h-10 mx-auto mb-2 rounded-lg bg-gradient-to-br from-teal-400/20 to-teal-600/20 flex items-center justify-center"><Icon name="landmark" className="w-5 h-5 text-teal-400" /></div>
              <p className="text-white font-semibold text-sm">{l.n}</p>
              <p className="text-teal-400 text-xs mt-0.5">{l.r} {t('services.homeLoans.onwards')}</p>
            </div>
          ))}
        </div>
        <p className="text-gray-600 text-[11px] mt-4">{t('services.homeLoans.ratesNote')}</p>
      </div>
    </section>
  );

  return (
    <ServiceLanding
      team="loans"
      heroGradient="linear-gradient(140deg,#0a1120 0%,#0c2321 48%,#0e3a2c 100%)"
      heroImage="https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=1600&q=80"

      badge={t('services.homeLoans.badge')}
      badgeIcon="badge-percent"
      titleTop={t('services.homeLoans.titleTop')}
      titleAccent={t('services.homeLoans.titleAccent')}
      subtitle={t('services.homeLoans.subtitle')}
      features={[['search-check', t('services.homeLoans.feature1')], ['indian-rupee', t('services.homeLoans.feature2')], ['file-check-2', t('services.homeLoans.feature3')]]}
      quote={{
        icon: 'landmark', title: t('services.homeLoans.quoteTitle'), subtitle: t('services.homeLoans.quoteSub'),
        serviceField: 'loanType', submitLabel: t('services.homeLoans.submitLabel'),
        servicesHeading: t('services.homeLoans.servicesHeading'),
        servicesSub: t('services.homeLoans.servicesSub'),
        trustHeading: t('services.homeLoans.trustHeading'),
        fields: [
          { name: 'loanType', label: t('services.homeLoans.fLoanType'), type: 'select', required: true, full: true, placeholder: t('services.homeLoans.fLoanTypePlaceholder'), options: ['Home Purchase Loan', 'Plot / Land Loan', 'Home Construction Loan', 'Balance Transfer', 'Top-up Loan', 'Loan Against Property'], value: prefillType },
          { name: 'amount', label: t('services.homeLoans.fAmount'), type: 'money', placeholder: t('services.homeLoans.fAmountPlaceholder') },
          { name: 'employment', label: t('services.homeLoans.fEmployment'), type: 'select', options: ['Salaried', 'Self-employed Professional', 'Self-employed Business'] },
          { name: 'income', label: t('services.homeLoans.fIncome'), type: 'money', placeholder: t('services.homeLoans.fIncomePlaceholder') },
          { name: 'city', label: t('services.homeLoans.fCity'), placeholder: 'Pune', value: 'Pune' },
        ],
      }}
      stats={[['25+', t('services.homeLoans.stat.lendingPartners')], ['8.45%', t('services.homeLoans.stat.ratesStarting')], ['₹500 Cr+', t('services.homeLoans.stat.loansFacilitated')], ['48 hrs', t('services.homeLoans.stat.avgApproval')]]}
      services={[
        [t('services.homeLoans.service.0.name'), 'home', t('services.homeLoans.service.0.desc')],
        [t('services.homeLoans.service.1.name'), 'map', t('services.homeLoans.service.1.desc')],
        [t('services.homeLoans.service.2.name'), 'hard-hat', t('services.homeLoans.service.2.desc')],
        [t('services.homeLoans.service.3.name'), 'repeat', t('services.homeLoans.service.3.desc')],
        [t('services.homeLoans.service.4.name'), 'plus-circle', t('services.homeLoans.service.4.desc')],
        [t('services.homeLoans.service.5.name'), 'building', t('services.homeLoans.service.5.desc')],
      ]}
      extra={<>{<LoanEmiCalc t={t} />}{compareSection}</>}
      trust={[
        [t('services.homeLoans.trust.0.t'), 'landmark', t('services.homeLoans.trust.0.d')],
        [t('services.homeLoans.trust.1.t'), 'indian-rupee', t('services.homeLoans.trust.1.d')],
        [t('services.homeLoans.trust.2.t'), 'search-check', t('services.homeLoans.trust.2.d')],
        [t('services.homeLoans.trust.3.t'), 'headset', t('services.homeLoans.trust.3.d')],
      ]}
      steps={[
        [t('services.homeLoans.step.0.t'), 'clipboard-list', t('services.homeLoans.step.0.d')],
        [t('services.homeLoans.step.1.t'), 'scale', t('services.homeLoans.step.1.d')],
        [t('services.homeLoans.step.2.t'), 'file-check-2', t('services.homeLoans.step.2.d')],
        [t('services.homeLoans.step.3.t'), 'wallet', t('services.homeLoans.step.3.d')],
      ]}
      faqs={[
        [t('services.homeLoans.faq.0.q'), t('services.homeLoans.faq.0.a')],
        [t('services.homeLoans.faq.1.q'), t('services.homeLoans.faq.1.a')],
        [t('services.homeLoans.faq.2.q'), t('services.homeLoans.faq.2.a')],
        [t('services.homeLoans.faq.3.q'), t('services.homeLoans.faq.3.a')],
        [t('services.homeLoans.faq.4.q'), t('services.homeLoans.faq.4.a')],
      ]}
      cta={{ title: t('services.homeLoans.ctaTitle'), sub: t('services.homeLoans.ctaSub'), primary: t('services.homeLoans.ctaPrimary'), icon: 'badge-percent', phone: '1800 200 0000' }}
    />
  );
}
