/* Pairs with the `.dz-invalid` border (styles/index.css) so every required field reads the same way. */
export default function FieldError({ show, children, className = '', id, alert = true }) {
  const visible = show === undefined ? !!children : !!show;
  if (!visible || !children) return null;
  return <p id={id} className={`dz-field-error ${className}`.trim()} role={alert ? 'alert' : undefined}>{children}</p>;
}
