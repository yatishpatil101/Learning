import Icon from '../../../components/Icon.jsx';

export const ownerVerificationMeta = (p, t) => {
  const identityVerified = !!p.ownerVerified;
  const anyVerified = identityVerified || !!p.ownershipVerified;
  const verifiedLabel = [
    identityVerified ? t('property.verifiedOwner') : '',
    p.ownershipVerified ? t('property.ownershipVerified') : '',
  ].filter(Boolean).join(' · ');
  return {
    identityVerified,
    anyVerified,
    verifiedLabel,
    roleAndVerification: [t('listings.owner'), verifiedLabel].filter(Boolean).join(' · '),
  };
};

export function OwnerVerifiedMark({ anyVerified }) {
  return anyVerified ? <Icon name="badge-check" className="w-4 h-4 text-brand-teal-2" /> : null;
}

export function OwnerRoleLine({ anyVerified, roleAndVerification, ownerLabel }) {
  return roleAndVerification ? (
    <span className="text-xs text-emerald-300 flex items-center gap-1">
      <Icon name={anyVerified ? 'badge-check' : 'user'} className="w-3 h-3" /> {roleAndVerification}
    </span>
  ) : (
    <span className="text-xs text-gray-400">{ownerLabel}</span>
  );
}
