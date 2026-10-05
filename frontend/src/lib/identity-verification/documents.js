export const IDENTITY_DOCUMENTS = [
  { key: 'aadhaar', icon: 'fingerprint', needsBack: true },
  { key: 'pan', icon: 'credit-card', needsBack: false },
  { key: 'driving_licence', icon: 'car', needsBack: true },
  { key: 'passport', icon: 'book-open', needsBack: false },
];

export const DEFAULT_IDENTITY_DOCUMENT = IDENTITY_DOCUMENTS[0];

export function getIdentityDocument(key) {
  return IDENTITY_DOCUMENTS.find((item) => item.key === key) || DEFAULT_IDENTITY_DOCUMENT;
}

export const REJECTION_COPY = {
  blurry: 'blurry',
  cropped: 'cropped',
  mismatch: 'mismatch',
  expired: 'expired',
  not_holder: 'not_holder',
  unsupported: 'unsupported',
  other: 'other',
  not_reviewed: 'not_reviewed',
};
