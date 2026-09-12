import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../Icon.jsx';

/* Filter-sheet primitives shared by BOTH search surfaces (/listings and /flatmates), so the
   two read as one filter. Styling lives in styles/routes/filters.css, which both import. */

/* `summary` is the header read-out: pass an EMPTY STRING while the value is still the default,
   or a formatted default lights every section up as if it were narrowing the results. */
export function FilterGroup({ icon, title, summary, children, defaultCollapsed = false }) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const toggle = () => setCollapsed((v) => !v);
  return (
    <div className={'filter-group' + (collapsed ? ' collapsed' : '')}>
      {/* Heading plus nested button, so the section stays in the document outline while the
          control stays keyboard-reachable; role="button" on the <h4> would drop the heading. */}
      <h4 className="m-0">
        <button
          type="button"
          className="fg-header w-full text-left text-sm font-semibold text-gray-300 mb-2.5 flex items-center gap-2"
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          <Icon name={icon} className="w-4 h-4 text-gray-500" /> {title}
          {/* `ui.*`, not `listings.*`: route namespaces are code-split, so a listings key would
              resolve to a raw string on every other surface reusing this component. */}
          <span className={'fg-summary' + (summary ? ' active' : '')}>{summary || t('ui.any')}</span>
          <Icon name="chevron-down" className="fg-chev" />
        </button>
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
