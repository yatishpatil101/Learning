/* Button.jsx — the canonical 3-tier button for PuneNest.
   Tiers (variant): 'primary' | 'secondary' | 'icon'.
   Sizes: 'sm' (32px) | 'md' (40px, default) | 'lg' (48px).
   Renders a native <button> by default, or a router <Link> when `to` is set,
   or any element via `as`. Styling lives in styles/index.css (.btn* classes). */

import { Link } from 'react-router';
import Icon from '../Icon.jsx';

const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  icon: 'btn-icon',
};

const SIZE_CLASS = {
  sm: 'btn-sm',
  md: '',
  lg: 'btn-lg',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconRight,
  iconOnly = false,
  loading = false,
  disabled = false,
  fullWidth = false,
  className = '',
  children,
  to,
  as,
  type,
  ...rest
}) {
  const isIcon = iconOnly || variant === 'icon';
  const classes = [
    'btn',
    VARIANT_CLASS[isIcon ? 'icon' : variant] || VARIANT_CLASS.primary,
    SIZE_CLASS[size] || '',
    fullWidth ? 'w-full' : '',
    loading ? 'is-loading' : '',
    className,
  ].filter(Boolean).join(' ');

  const leadIcon = loading ? 'loader' : icon;
  const iconSize = size === 'sm' ? 'w-4 h-4' : size === 'lg' ? 'w-5 h-5' : 'w-4 h-4';

  const content = (
    <>
      {leadIcon ? <Icon name={leadIcon} className={`${iconSize}${loading ? ' animate-spin' : ''}`} /> : null}
      {!isIcon && children ? <span>{children}</span> : null}
      {!isIcon && iconRight ? <Icon name={iconRight} className={iconSize} /> : null}
    </>
  );

  const isDisabled = disabled || loading;

  if (to && !isDisabled) {
    return (
      <Link to={to} className={classes} aria-busy={loading || undefined} {...rest}>
        {content}
      </Link>
    );
  }

  const Comp = as || 'button';
  const compProps = Comp === 'button' ? { type: type || 'button', disabled: isDisabled } : { 'aria-disabled': isDisabled || undefined };

  return (
    <Comp className={classes} aria-busy={loading || undefined} {...compProps} {...rest}>
      {content}
    </Comp>
  );
}
