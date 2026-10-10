import { Link } from 'react-router';

export default function Byline({ updated, label, className = '', children }) {
  return (
    <p className={`text-xs text-gray-500 ${className}`}>
      By <Link to="/about" className="hover:text-teal-400">Draazy Editorial Team</Link> · Updated <time dateTime={updated}>{label}</time>
      {children}
    </p>
  );
}
