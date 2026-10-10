import { Children, cloneElement, isValidElement, useId } from 'react';
import FieldError from './FieldError.jsx';

// Errors are not role=alert here; the form announces its failure count once, in a single polite region.
export default function Field({ label, required, error, className, children }) {
  const id = useId();
  const errorId = `${id}-err`;
  const [control, ...rest] = Children.toArray(children);
  return (
    <div className={className}>
      <label className={required ? 'lbl req' : 'lbl'} htmlFor={id}>{label}</label>
      {isValidElement(control) ? cloneElement(control, error ? { id, 'aria-invalid': true, 'aria-describedby': errorId } : { id }) : control}
      {rest}
      <FieldError id={errorId} alert={false}>{error}</FieldError>
    </div>
  );
}