import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

export function FilterGroup({ icon, title, summary, children, defaultCollapsed = false }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <div className={'filter-group' + (collapsed ? ' collapsed' : '')}>
      <h4
        className="fg-header text-sm font-semibold text-gray-300 mb-2.5 flex items-center gap-2"
        onClick={() => setCollapsed((v) => !v)}
      >
        <Icon name={icon} className="w-4 h-4 text-gray-500" /> {title}
        <span className={'fg-summary' + (summary ? ' active' : '')}>{summary || t('listings.any')}</span>
        <Icon name="chevron-down" className="fg-chev" />
      </h4>
      <div className="fg-body"><div className="fg-body-inner">{children}</div></div>
    </div>
  );
}
export const Divider = () => <div className="h-px bg-white/5" />;
export const Cb = ({ id, label, checked, onChange }) => (
  <div>
    <input type="checkbox" id={id} className="custom-cb" checked={checked} onChange={onChange} />
    <label htmlFor={id}>{label}</label>
  </div>
);
export const Rb = ({ id, name, label, checked, onChange }) => (
  <div>
    <input type="radio" id={id} name={name} className="custom-radio" checked={checked} onChange={onChange} />
    <label htmlFor={id}>{label}</label>
  </div>
);
