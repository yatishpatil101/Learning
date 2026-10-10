import { Children, isValidElement, useMemo } from 'react';
import Select from './Select.jsx';

function collectOptions(children) {
  const out = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      const raw = child.props.children;
      const label = Array.isArray(raw) ? raw.join('') : String(raw ?? '');
      out.push({ value: child.props.value ?? label, label, disabled: child.props.disabled });
    } else if (child.props && child.props.children) {
      out.push(...collectOptions(child.props.children)); // optgroup
    }
  });
  return out;
}

export default function NativeSelect({ value, onChange, children, className, disabled, searchable, title, id, name, invalid, dataErr, size, ...rest }) {
  // First empty-value <option> becomes the placeholder and is excluded from the
  // menu — exactly matching dropdowns.js buildMenuFromSelect in the HTML app.
  const { placeholder, options } = useMemo(() => {
    const all = collectOptions(children);
    let ph = null;
    const menu = [];
    all.forEach((o) => {
      if (o.value === '' && ph === null) ph = o.label;
      else menu.push(o);
    });
    return { placeholder: ph, options: menu };
  }, [children]);
  const ariaLabel = rest['aria-label'] || title;
  return (
    <Select
      value={value ?? ''}
      onChange={(v) => onChange && onChange({ target: { value: v } })}
      options={options}
      placeholder={placeholder || 'Select…'}
      className="w-full"
      disabled={disabled}
      searchable={searchable}
      ariaLabel={ariaLabel}
      ariaDescribedBy={rest['aria-describedby']}
      id={id}
      invalid={invalid}
      dataErr={dataErr}
      size={size}
    />
  );
}
