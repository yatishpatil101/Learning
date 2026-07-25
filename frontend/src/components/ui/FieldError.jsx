/* Single source of truth for inline required-field error text.
   Pair it with the `.pn-invalid` border (see styles/index.css) so every mandatory
   field across the app reads the same way: red border on the control + a short red
   message directly below it. Renders nothing when there's no error so layout stays
   clean. Works with either the `useFieldErrors` hook (pass `err.has(name)` +
   `err.msg(name)`) or a boolean/string of your own. */
export default function FieldError({ show, children, className = '' }) {
  const visible = show === undefined ? !!children : !!show;
  if (!visible || !children) return null;
  return <p className={`pn-field-error ${className}`.trim()} role="alert">{children}</p>;
}
