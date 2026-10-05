import { digits, isFullMobile } from '../../../lib/contact.js';

export const dialableMobile = (mobile) => (isFullMobile(mobile) ? digits(mobile) : '');

export const telHref = (mobile) => {
  const d = dialableMobile(mobile);
  return d ? `tel:+91${d}` : '';
};

export const whatsappHref = (mobile, text) => {
  const d = dialableMobile(mobile);
  if (!d) return '';
  const query = text ? `?text=${encodeURIComponent(text)}` : '';
  return `https://wa.me/91${d}${query}`;
};
