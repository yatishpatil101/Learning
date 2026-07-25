import Icon from '../../Icon.jsx';

export const Card = ({ children, className = '', id }) => (
  <div id={id} className={'glass-card rounded-2xl ' + className}>{children}</div>
);

// Currency inputs follow the app standard (see TenantProfile): a ₹ prefix with a
// grouped, digits-only value so amounts read the same everywhere.
export const onlyDigits = (v) => String(v ?? '').replace(/\D/g, '').slice(0, 12);
export const grpINR = (v) => (v === '' || v == null ? '' : Number(String(v).replace(/\D/g, '') || 0).toLocaleString('en-IN'));

export const SectionHead = ({ icon, iconCls = 'text-teal-400', title, sub, action }) => (
  <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
    <div>
      <h2 className="text-lg font-bold text-white flex items-center gap-2">
        {icon ? <Icon name={icon} className={'w-5 h-5 ' + iconCls} /> : null} {title}
      </h2>
      {sub ? <p className="text-gray-500 text-xs mt-0.5">{sub}</p> : null}
    </div>
    {action}
  </div>
);
