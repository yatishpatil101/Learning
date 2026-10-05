export const REVIEW_REASONS = [
  {
    code: 'photos_not_real',
    label: 'Photos not real',
    ownerMessage: 'Please upload clear, real photos of this home so we can verify the listing.',
  },
  {
    code: 'duplicate',
    label: 'Duplicate',
    ownerMessage: 'This looks like another listing already on Draazy. Please confirm the correct listing.',
  },
  {
    code: 'broker',
    label: 'Broker',
    ownerMessage: 'Draazy is owner-only. Please confirm that you are the owner or an immediate family member.',
  },
  {
    code: 'wrong_details',
    label: 'Wrong details',
    ownerMessage: 'Some listing details do not match what was submitted. Please correct the details and resubmit.',
  },
  {
    code: 'locality_unclear',
    label: 'Locality unclear',
    ownerMessage: 'Please update the locality and address details so we can verify the exact property.',
  },
  {
    code: 'document_unreadable',
    label: 'Document unreadable',
    ownerMessage: 'Please upload a clearer document photo or scan so the details can be read.',
  },
  {
    code: 'name_mismatch',
    label: 'Name mismatch',
    ownerMessage: 'The name on the submitted document does not match the lister. Please clarify or upload the right proof.',
  },
  {
    code: 'other',
    label: 'Other',
    ownerMessage: 'Please check the note below and update the listing so we can complete verification.',
  },
];

export const REVIEW_REASON_BY_CODE = Object.fromEntries(REVIEW_REASONS.map((reason) => [reason.code, reason]));

export const ownerMessagePreview = (decision, reasonCode, note = '') => {
  const reason = REVIEW_REASON_BY_CODE[reasonCode];
  const base = reason?.ownerMessage || 'Please update the listing so we can complete verification.';
  const suffix = note.trim() ? `\n\nReviewer note: ${note.trim()}` : '';
  if (decision === 'reject') {
    return `${base}${suffix}\n\nThis decision is final. The listing cannot be resubmitted.`;
  }
  return `${base}${suffix}`;
};

export const SIGNAL_LABELS = {
  photo_match_other_account: 'Photo match',
  conflict: 'Conflict',
  brokerage_reports: 'Brokerage reports',
  many_societies: 'Many societies',
  broker_wording: 'Broker wording',
  copied_description: 'Copied description',
  many_localities_30d: 'Many localities',
};

export const signalLabel = (code) => SIGNAL_LABELS[code] || String(code || '').replace(/_/g, ' ');

export const signalsForChecklistItem = (signals, item = '') => {
  const text = item.toLowerCase();
  const rows = Array.isArray(signals?.items) ? signals.items : [];
  if (text.includes('photo')) return rows.filter((row) => row.code === 'photo_match_other_account');
  if (text.includes('duplicate')) {
    const matches = rows.filter((row) => row.code === 'copied_description' || row.code === 'photo_match_other_account');
    return signals?.conflict ? [{ code: 'conflict', severity: 'hard', detail: 'Duplicate or cross-owner conflict' }, ...matches] : matches;
  }
  if (text.includes('details') || text.includes('location') || text.includes('locality')) {
    return rows.filter((row) => row.code === 'many_localities_30d');
  }
  return [];
};

export const reasonTemplateHints = (reasonCode) => {
  if (!reasonCode) return [];
  return [`reason_${reasonCode}`, reasonCode, reasonCode.replace(/_/g, '-'), reasonCode.replace(/_/g, ' ')];
};
