import { useTranslation } from 'react-i18next';
import DocCard from './DocCard.jsx';
import { DOC_OWNER, DOC_TENANT, DOC_OTHER } from './constants.js';

export default function DocsRequired() {
  const { t } = useTranslation();
  const docOwner = t('services.ra.docs.docOwner', { returnObjects: true });
  const docTenant = t('services.ra.docs.docTenant', { returnObjects: true });
  const docOther = t('services.ra.docs.docOther', { returnObjects: true });
  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-pb">
      <h2 className="text-2xl font-bold text-white mb-2">{t('services.ra.docs.title')}</h2>
      <p className="text-gray-400 text-sm mb-6">{t('services.ra.docs.subtitle')}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <DocCard icon="key-round" color="teal" title={t('services.ra.docs.ownerTitle')} items={Array.isArray(docOwner) ? docOwner : DOC_OWNER} />
        <DocCard icon="user" color="teal" title={t('services.ra.docs.tenantTitle')} items={Array.isArray(docTenant) ? docTenant : DOC_TENANT} />
        <DocCard icon="users" color="amber" title={t('services.ra.docs.otherTitle')} items={Array.isArray(docOther) ? docOther : DOC_OTHER} />
      </div>
    </section>
  );
}
