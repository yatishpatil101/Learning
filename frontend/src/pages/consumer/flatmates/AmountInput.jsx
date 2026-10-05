import { formatIndian, moneyWords } from '../list-property/format.js';

const MAX_DIGITS = 8;

/* Keeps payloads as bare digits while the field displays Indian grouping and words. */
export default function AmountInput({ value, onChange, className = '', ...rest }) {
  const words = moneyWords(value);
  return (
    <>
      <div className="relative">
        <span aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-teal-400 font-semibold text-sm">₹</span>
        <input
          inputMode="numeric"
          value={formatIndian(value)}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS))}
          className={'field w-full rounded-xl pl-8 pr-3.5 py-2.5 text-sm' + className}
          {...rest}
        />
      </div>
      {words && <p className="mt-1.5 ml-1 text-xs text-gray-500">{words}</p>}
    </>
  );
}
