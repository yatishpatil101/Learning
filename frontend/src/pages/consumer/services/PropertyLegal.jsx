import { useTranslation } from 'react-i18next';
import ServiceLanding from '../../../components/ServiceLanding.jsx';
import LegalCostCalc from './LegalCostCalc.jsx';
import Icon from '../../../components/Icon.jsx';

const TIMELINE_ICONS = [null, null, null, null, null, null];
const DOC_COUNT = 8;

export default function PropertyLegal() {
  const { t } = useTranslation();

  const registrationSection = (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
      <div className="text-center mb-10 reveal">
        <h2 className="text-2xl sm:text-3xl font-bold text-white">{t('services.legal.regProcessTitle')}</h2>
        <p className="text-gray-400 text-sm mt-2 max-w-2xl mx-auto">{t('services.legal.regProcessSub')}</p>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-6 items-start">
        <div className="glass-card rounded-2xl p-6 sm:p-8">
          <div className="space-y-5">
            {TIMELINE_ICONS.map((_x, i) => (
              <div key={i} className="relative pl-14">
                <div className="absolute left-0 top-0 w-10 h-10 rounded-xl bg-gradient-to-br from-teal-400/20 to-teal-600/20 border border-teal-400/20 flex items-center justify-center text-teal-400 font-bold text-sm">{i + 1}</div>
                <h4 className="text-white font-semibold text-sm mb-1">{t(`services.legal.timeline.${i}.t`)}</h4>
                <p className="text-gray-400 text-xs leading-relaxed">{t(`services.legal.timeline.${i}.d`)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="glass-card rounded-2xl p-6 sm:p-8">
          <div className="flex items-center gap-2 mb-4"><Icon name="folder-check" className="w-5 h-5 text-teal-400" /><h3 className="text-white font-bold">{t('services.legal.docsNeeded')}</h3></div>
          <ul className="space-y-2.5">
            {Array.from({ length: DOC_COUNT }).map((_x, i) => (
              <li key={i} className="flex items-start gap-2.5 text-gray-300 text-sm"><Icon name="check-circle-2" className="w-4 h-4 text-teal-400 mt-0.5 flex-shrink-0" /><span>{t(`services.legal.doc.${i}`)}</span></li>
            ))}
          </ul>
          <div className="mt-5 flex items-start gap-2 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <Icon name="alert-triangle" className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-amber-200/90 text-xs leading-relaxed">{t('services.legal.regWarning')}</p>
          </div>
        </div>
      </div>
    </section>
  );

  return (
    <ServiceLanding
      team="legal"
      flowType="legal"
      draftKey="pnDraft:property-legal"
      trackerTitle={t('services.legal.trackerTitle')}
      heroGradient="linear-gradient(140deg,#0a1022 0%,#111a33 50%,#1a2445 100%)"
      heroImage="https://images.unsplash.com/photo-1589829545856-d10d557cf95f?w=1600&q=80"
      heroOverlay="linear-gradient(140deg,rgba(10,16,34,.93) 0%,rgba(17,26,51,.88) 50%,rgba(26,36,69,.9) 100%)"

      badge={t('services.legal.badge')}
      badgeIcon="scale"
      titleTop={t('services.legal.titleTop')}
      titleAccent={t('services.legal.titleAccent')}
      subtitle={t('services.legal.subtitle')}
      features={[['shield-check', t('services.legal.feature1')], ['indian-rupee', t('services.legal.feature2')], ['file-check-2', t('services.legal.feature3')]]}
      quote={{
        icon: 'gavel', title: t('services.legal.quoteTitle'), subtitle: t('services.legal.quoteSub'),
        serviceField: 'service', submitLabel: t('services.legal.submitLabel'),
        servicesHeading: t('services.legal.servicesHeading'),
        servicesSub: t('services.legal.servicesSub'),
        trustHeading: t('services.legal.trustHeading'),
        fields: [
          { name: 'service', label: t('services.legal.fService'), type: 'select', required: true, full: true, placeholder: t('services.legal.fServicePlaceholder'), options: ['Sale Deed Drafting & Registration', 'Title Search & Due Diligence', 'Stamp Duty & Registration Charges', 'Property Mutation / Name Transfer', 'Encumbrance Certificate', 'Gift Deed / POA / Will'] },
          { name: 'role', label: t('services.legal.fRole'), type: 'select', options: ['Buyer', 'Seller', 'Both / Family transfer', 'Just exploring'] },
          { name: 'location', label: t('services.legal.fLocation'), type: 'locality', placeholder: t('services.legal.fLocationPlaceholder') },
          { name: 'note', label: t('services.legal.fNote'), type: 'textarea', full: true, placeholder: t('services.legal.fNotePlaceholder') },
        ],
      }}
      stats={[['8K+', t('services.legal.stat.deedsRegistered')], ['30-yr', t('services.legal.stat.titleSearch')], ['100%', t('services.legal.stat.verifiedAdvocates')], [t('services.legal.stat.fixedValue'), t('services.legal.stat.transparentFees')]]}
      services={[
        [t('services.legal.service.0.name'), 'file-signature', t('services.legal.service.0.desc')],
        [t('services.legal.service.1.name'), 'search-check', t('services.legal.service.1.desc')],
        [t('services.legal.service.2.name'), 'indian-rupee', t('services.legal.service.2.desc')],
        [t('services.legal.service.3.name'), 'file-pen-line', t('services.legal.service.3.desc')],
        [t('services.legal.service.4.name'), 'file-search', t('services.legal.service.4.desc')],
        [t('services.legal.service.5.name'), 'scroll-text', t('services.legal.service.5.desc')],
      ]}
      extra={<>{<LegalCostCalc t={t} />}{registrationSection}</>}
      trust={[
        [t('services.legal.trust.0.t'), 'badge-check', t('services.legal.trust.0.d')],
        [t('services.legal.trust.1.t'), 'indian-rupee', t('services.legal.trust.1.d')],
        [t('services.legal.trust.2.t'), 'workflow', t('services.legal.trust.2.d')],
        [t('services.legal.trust.3.t'), 'calendar-check', t('services.legal.trust.3.d')],
      ]}
      faqs={[
        [t('services.legal.faq.0.q'), t('services.legal.faq.0.a')],
        [t('services.legal.faq.1.q'), t('services.legal.faq.1.a')],
        [t('services.legal.faq.2.q'), t('services.legal.faq.2.a')],
        [t('services.legal.faq.3.q'), t('services.legal.faq.3.a')],
        [t('services.legal.faq.4.q'), t('services.legal.faq.4.a')],
      ]}
      cta={{ title: t('services.legal.ctaTitle'), sub: t('services.legal.ctaSub'), primary: t('services.legal.ctaPrimary'), icon: 'scale', phone: '1800 200 0000' }}
    />
  );
}
