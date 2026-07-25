import { useSearchParams } from 'react-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ServiceLanding from '../../../components/ServiceLanding.jsx';
import PackersEstimator from './PackersEstimator.jsx';

export default function PackersMovers() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const [prefillService, setPrefillService] = useState('');

  // Prefill service from URL (?service=vehicle)
  useEffect(() => {
    const serviceParam = searchParams.get('service');
    if (serviceParam) {
      const options = ['Home Shifting — Local (within Pune)', 'Home Shifting — Intercity / Domestic', 'Office / Commercial Shifting', 'Vehicle Transport (Car / Bike)', 'Storage & Warehousing'];
      const match = options.find(opt => opt.toLowerCase().includes(serviceParam.toLowerCase()));
      if (match) setPrefillService(match);
    }
  }, [searchParams]);

  return (
    <ServiceLanding
      team="packers"
      flowType="packers"
      draftKey="pnDraft:packers-movers"
      trackerTitle={t('services.packers.trackerTitle')}
      heroGradient="linear-gradient(140deg,#0a1120 0%,#0b2530 46%,#123a4a 100%)"
      heroImage="https://images.unsplash.com/photo-1600518464441-9154a4dea21b?w=1600&q=80"
      heroOverlay="linear-gradient(140deg,rgba(10,17,32,.93) 0%,rgba(11,37,48,.87) 46%,rgba(18,58,74,.9) 100%)"

      badge={t('services.packers.badge')}
      titleTop={t('services.packers.titleTop')}
      titleAccent={t('services.packers.titleAccent')}
      subtitle={t('services.packers.subtitle')}
      features={[['shield-check', t('services.packers.feature1')], ['indian-rupee', t('services.packers.feature2')], ['headset', t('services.packers.feature3')]]}
      quote={{
        icon: 'truck', title: t('services.packers.quoteTitle'), subtitle: t('services.packers.quoteSub'),
        serviceField: 'service', submitLabel: t('services.packers.submitLabel'),
        servicesHeading: t('services.packers.servicesHeading'),
        servicesSub: t('services.packers.servicesSub'),
        trustHeading: t('services.packers.trustHeading'),
        fields: [
          { name: 'service', label: t('services.packers.fService'), type: 'select', required: true, full: true, placeholder: t('services.packers.fServicePlaceholder'), options: ['Home Shifting — Local (within Pune)', 'Home Shifting — Intercity / Domestic', 'Office / Commercial Shifting', 'Vehicle Transport (Car / Bike)', 'Storage & Warehousing'], value: prefillService },
          { name: 'from', label: t('services.packers.fFrom'), type: 'locality', unrestricted: true, placeholder: t('services.packers.fFromPlaceholder') },
          { name: 'to', label: t('services.packers.fTo'), type: 'locality', unrestricted: true, placeholder: t('services.packers.fToPlaceholder') },
          { name: 'size', label: t('services.packers.fSize'), type: 'select', options: ['1 RK', '1 BHK', '2 BHK', '3 BHK', '4 BHK / Villa', 'Office / Commercial', 'Few items only'] },
          { name: 'date', label: t('services.packers.fDate'), type: 'date' },
        ],
        successMessage: t('services.packers.successMessage'),
      }}
      stats={[['50+', t('services.packers.stat.verifiedPartners')], ['12K+', t('services.packers.stat.homesRelocated')], ['4.7★', t('services.packers.stat.averageRating')], ['₹0', t('services.packers.stat.platformFee')]]}
      services={[
        [t('services.packers.service.0.name'), 'home', t('services.packers.service.0.desc')],
        [t('services.packers.service.1.name'), 'map-pinned', t('services.packers.service.1.desc')],
        [t('services.packers.service.2.name'), 'package', t('services.packers.service.2.desc')],
        [t('services.packers.service.3.name'), 'building-2', t('services.packers.service.3.desc')],
        [t('services.packers.service.4.name'), 'car', t('services.packers.service.4.desc')],
        [t('services.packers.service.5.name'), 'warehouse', t('services.packers.service.5.desc')],
      ]}
      extra={<PackersEstimator t={t} />}
      trust={[
        [t('services.packers.trust.0.t'), 'badge-check', t('services.packers.trust.0.d')],
        [t('services.packers.trust.1.t'), 'indian-rupee', t('services.packers.trust.1.d')],
        [t('services.packers.trust.2.t'), 'shield-check', t('services.packers.trust.2.d')],
        [t('services.packers.trust.3.t'), 'headset', t('services.packers.trust.3.d')],
      ]}
      steps={[
        [t('services.packers.step.0.t'), 'clipboard-list', t('services.packers.step.0.d')],
        [t('services.packers.step.1.t'), 'calculator', t('services.packers.step.1.d')],
        [t('services.packers.step.2.t'), 'handshake', t('services.packers.step.2.d')],
        [t('services.packers.step.3.t'), 'truck', t('services.packers.step.3.d')],
      ]}
      faqs={[
        [t('services.packers.faq.0.q'), t('services.packers.faq.0.a')],
        [t('services.packers.faq.1.q'), t('services.packers.faq.1.a')],
        [t('services.packers.faq.2.q'), t('services.packers.faq.2.a')],
        [t('services.packers.faq.3.q'), t('services.packers.faq.3.a')],
        [t('services.packers.faq.4.q'), t('services.packers.faq.4.a')],
      ]}
      cta={{ title: t('services.packers.ctaTitle'), sub: t('services.packers.ctaSub'), primary: t('services.packers.ctaPrimary'), icon: 'truck', phone: '1800 200 0000' }}
    />
  );
}
