import { ADDRESS_PROOF_TYPES, AREA_UNITS, DEPOSIT_PAY_FIELDS, DUE_DAY_MAX, FAMILY_MEMBER_TYPES, FAMILY_RELATIONS, MAX_AREA, MAX_FLOOR, MAX_MONTHS, MAX_OCCUPANTS, MAX_POLICE_OCCUPANTS, MH_PINCODE, PARTY_TYPES, PAYMENT_REF, POA_DOC, PROPERTY_ATTRIBUTE_KINDS, PUNE_TALUKAS, RESIDENCIES, RESIDENTIAL_PROPERTY_TYPES, START_DATE_FUTURE_DAYS, START_DATE_PAST_DAYS, TENANT_DOCS_REQUIRED, VISIT_DATE_FUTURE_DAYS } from './constants.js';
import { digits, isAadhaar, isEmail, isMobile, isPan, num } from './helpers.js';
/* Every rule here has a twin in the server's `RentAgreementDetailsRules` or checkout gate; the client copy exists so
   the customer hears about it on the step that owns the field, not as a 422 after payment opens. */

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' });
export const todayIst = (now = new Date()) => IST_DAY.format(now);
const shiftIso = (iso, days) => {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
export const ageFromDob = (dob, today = todayIst()) => {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dob || ''));
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!b || !t || dob > today) return '';
  const born = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(born.getTime()) || born.toISOString().slice(0, 10) !== dob) return '';
  let age = Number(t[1]) - Number(b[1]);
  if (`${t[2]}-${t[3]}` < `${b[2]}-${b[3]}`) age -= 1;
  return age >= 0 ? String(age) : '';
};
export const startDateBounds = (now = new Date()) => {
  const today = todayIst(now);
  return { min: shiftIso(today, -START_DATE_PAST_DAYS), max: shiftIso(today, START_DATE_FUTURE_DAYS), today };
};
export const visitDateBounds = (now = new Date()) => {
  const today = todayIst(now);
  return { min: shiftIso(today, 1), max: shiftIso(today, VISIT_DATE_FUTURE_DAYS) };
};

export const docReady = (d) => !!(d?.dataUrl || d?.vaultDocId || d?.filedOn);
export const residencyOf = (row) => (RESIDENCIES.includes(row?.residency) ? row.residency : 'resident');
export const isOfflineParty = (row) => ['nri', 'foreign'].includes(residencyOf(row));
export const isForeignParty = (row) => residencyOf(row) === 'foreign';
export const partyDocSlugs = (row) => ['pan', isOfflineParty(row) ? 'passport' : 'aadhaar', ...(isForeignParty(row) ? ['visa'] : []), 'photo'];
const TENANT_DOC_KEYS = { pan: '0', aadhaar: '1', passport: '1', photo: '2', income: '3', visa: '4', addressproof: '5', prevaddressproof: '6' };
export const tenantDocKey = (i, slug) => `t${i}-${TENANT_DOC_KEYS[slug]}`;
export const workProofRequired = (occupation) => !/\b(student|home\s*maker|homemaker|housewife|retired)\b/i.test(String(occupation || ''));
export const addressProofUploadRequired = (tenant) => (tenant?.police ? tenant.police.addressProofType || '' : 'uid') !== 'uid';
export const previousAddressProofUploadRequired = (tenant) => tenant?.police?.previousSameAsPermanent === false && (tenant.police.previousAddressProofType || '') !== 'uid';
export const ownerDocSlots = (owner) => [
  'o-pan',
  isOfflineParty(owner) ? 'o-passport' : 'o-aadhaar',
  ...(isForeignParty(owner) ? ['o-visa'] : []),
  'o-photo',
  'o-own',
  ...(owner?.capacity === 'poa' ? [POA_DOC] : []),
];
export const coOwnerDocSlots = (c, i) => [...partyDocSlugs(c), ...(c?.capacity === 'poa' ? ['poa'] : [])].map((s) => `c${i}-${s}`);
export const tenantDocSlots = (tenant, i) => {
  const required = (slug) => TENANT_DOCS_REQUIRED.includes(Number(TENANT_DOC_KEYS[slug]))
    || slug === 'passport'
    || slug === 'visa'
    || (slug === 'income' && workProofRequired(tenant?.occupation))
    || (slug === 'addressproof' && addressProofUploadRequired(tenant))
    || (slug === 'prevaddressproof' && previousAddressProofUploadRequired(tenant));
  return [...partyDocSlugs(tenant), 'income', 'addressproof', 'prevaddressproof'].map((slug) => ({ slug, key: tenantDocKey(i, slug), required: required(slug) }));
};

const blank = (v) => !String(v ?? '').trim();
const wholeIn = (v, lo, hi) => /^\d+$/.test(String(v).trim()) && Number(v) >= lo && Number(v) <= hi;
const passportOk = (v) => /^[A-Za-z0-9]{6,20}$/.test(String(v || '').trim());

/* Mobiles and Aadhaars of everyone on the agreement, as [errorKey, value] pairs in form order, so a duplicate is
   pinned on the later field — the one the customer just typed. */
const licensorIds = ({ owner, coOwners = [], ownerMode, invite }) => (ownerMode === 'invite'
  ? [{ m: ['invMobile', invite?.invMobile], a: ['invAadhaar', ''] }]
  : [
  { m: ['oMobile', owner?.oMobile], a: ['oAadhaar', owner?.oAadhaar] },
  ...coOwners.map((c, i) => ({ m: [`c${i}mobile`, c.mobile], a: [`c${i}aadhaar`, c.aadhaar] })),
]);
const tenantIds = ({ tenants = [] }) => tenants.map((t, i) => ({ m: [`t${i}mobile`, t.mobile], a: [`t${i}aadhaar`, t.aadhaar] }));
const witnessIds = ({ wit = {} }) => [1, 2].map((n) => ({ m: [`w${n}Mobile`, wit[`w${n}Mobile`]], a: [`w${n}Aadhaar`, wit[`w${n}Aadhaar`]] }));

const flagDuplicates = (e, before, mine, pick) => {
  const seen = new Set(before.map((p) => digits(pick(p)[1])).filter(Boolean));
  mine.forEach((p) => {
    const [key, raw] = pick(p);
    const v = digits(raw);
    if (!v) return;
    if (seen.has(v) && !e[key]) e[key] = 'dup';
    seen.add(v);
  });
};
const distinctParties = (e, before, mine) => {
  flagDuplicates(e, before, mine, (p) => p.m);
  flagDuplicates(e, before, mine, (p) => p.a);
};

const checkPoa = (e, prefix, row, today) => {
  if (row?.capacity !== 'poa') return;
  ['poaPrincipal', 'poaRegNo', 'poaSro'].forEach((k) => { if (blank(row[k])) e[prefix + k] = 'required'; });
  if (!row.poaDate) e[prefix + 'poaDate'] = 'required';
  else if (row.poaDate > today) e[prefix + 'poaDate'] = 'range';
};

const checkDocs = (e, docs, slots) => slots.forEach((k) => { if (!docReady(docs?.[k])) e['doc-' + k] = 'required'; });

const checkEmail = (e, key, v) => { if (!blank(v) && !isEmail(v)) e[key] = 'format'; };
const checkOptionalArea = (e, key, v) => {
  if (blank(v)) return;
  const area = Number(String(v ?? '').trim());
  if (!/^\d+(\.\d{1,2})?$/.test(String(v ?? '').trim()) || !(area >= 1 && area <= MAX_AREA)) e[key] = 'range';
};
const checkAge = (e, key, v, required) => {
  if (blank(v)) { if (required) e[key] = 'required'; return; }
  if (!wholeIn(v, 18, 120)) e[key] = 'range';
};
const checkIdentity = (e, p, row, keys) => {
  if (blank(row[keys.mother])) e[p + keys.mother] = 'required';
  if (!blank(row[keys.mother]) && String(row[keys.mother]).trim().length > 80) e[p + keys.mother] = 'range';
  if (!blank(row[keys.alias]) && String(row[keys.alias]).trim().length > 80) e[p + keys.alias] = 'range';
  if (blank(row[keys.dob])) { e[p + keys.dob] = 'required'; return; }
  const age = ageFromDob(row[keys.dob]);
  if (!age || !wholeIn(age, 18, 120)) e[p + keys.dob] = 'range';
  else if (!blank(row[keys.age]) && String(row[keys.age]).trim() !== age) e[p + keys.age] = 'match';
};
const checkPerson = (e, p, row) => {
  if (!PARTY_TYPES.includes(row.type || 'individual')) e[p + 'type'] = 'format';
  if (row.type === 'entity') e[p + 'type'] = 'entity';
  if (!RESIDENCIES.includes(row.residency || 'resident')) e[p + 'residency'] = 'format';
  if (blank(row.name)) e[p + 'name'] = 'required';
  checkIdentity(e, p, row, { mother: 'mother', dob: 'dob', alias: 'alias', age: 'age' });
  checkAge(e, p + 'age', row.age, true);
  if (!isPan(row.pan)) e[p + 'pan'] = 'format';
  if (isOfflineParty(row)) {
    if (!passportOk(row.passport)) e[p + 'passport'] = 'format';
    if (isForeignParty(row) && blank(row.visaOci)) e[p + 'visaOci'] = 'required';
  } else if (!isAadhaar(row.aadhaar)) e[p + 'aadhaar'] = 'format';
  if (!isMobile(row.mobile)) e[p + 'mobile'] = 'format';
  checkEmail(e, p + 'email', row.email);
  if (blank(row.addr)) e[p + 'addr'] = 'required';
};

const checkPoliceAddress = (e, p, group, row) => {
  const key = group[0].toUpperCase() + group.slice(1);
  if (blank(row?.address)) e[p + `police${key}Address`] = 'required';
  if (!/^\d{6}$/.test(digits(row?.pincode))) e[p + `police${key}Pincode`] = 'format';
  if (blank(row?.village)) e[p + `police${key}Village`] = 'required';
  if (blank(row?.policeStation)) e[p + `police${key}PoliceStation`] = 'required';
};
const checkPoliceRecord = (e, p, tenant) => {
  const police = tenant.police || {};
  if (!ADDRESS_PROOF_TYPES.includes(police.addressProofType || '')) e[p + 'policeAddressProofType'] = 'required';
  if (!police.permanentSameAsCurrent) checkPoliceAddress(e, p, 'permanent', police.permanent);
  if (!police.previousSameAsPermanent) {
    checkPoliceAddress(e, p, 'previous', police.previous);
    if (!ADDRESS_PROOF_TYPES.includes(police.previousAddressProofType || '')) e[p + 'policePreviousAddressProofType'] = 'required';
  }
  if (workProofRequired(tenant.occupation)) {
    if (blank(police.workplaceAddress)) e[p + 'policeWorkplaceAddress'] = 'required';
    if (blank(police.workIdProofType)) e[p + 'policeWorkIdProofType'] = 'required';
  }
  const occupants = Array.isArray(police.occupants) ? police.occupants : [];
  if (occupants.length > MAX_POLICE_OCCUPANTS) e[p + 'policeOccupants'] = 'range';
  occupants.forEach((row, i) => {
    if (!FAMILY_MEMBER_TYPES.includes(row.type || '')) e[`${p}policeOcc${i}type`] = 'required';
    if (!FAMILY_RELATIONS.includes(row.relation || '')) e[`${p}policeOcc${i}relation`] = 'required';
    if (blank(row.fullName)) e[`${p}policeOcc${i}fullName`] = 'required';
    else if (String(row.fullName).trim().length > 80) e[`${p}policeOcc${i}fullName`] = 'range';
    if (blank(row.age) || !wholeIn(row.age, 0, 120)) e[`${p}policeOcc${i}age`] = 'range';
    if (!isMobile(row.mobile)) e[`${p}policeOcc${i}mobile`] = 'format';
  });
};

function licensorErrors(e, f, today) {
  const { owner, coOwners = [], ownerDocs } = f;
  if (f.ownerMode === 'invite') {
    if (!isMobile(f.invite?.invMobile)) e.invMobile = 'format';
    return;
  }
  if (blank(owner.oName)) e.oName = 'required';
  if (!PARTY_TYPES.includes(owner.type || 'individual')) e.type = 'format';
  if (owner.type === 'entity') e.type = 'entity';
  if (!RESIDENCIES.includes(owner.residency || 'resident')) e.residency = 'format';
  checkIdentity(e, '', owner, { mother: 'oMother', dob: 'oDob', alias: 'oAlias', age: 'oAge' });
  checkAge(e, 'oAge', owner.oAge, true);
  if (!isPan(owner.oPan)) e.oPan = 'format';
  if (isOfflineParty(owner)) {
    if (!passportOk(owner.passport)) e.passport = 'format';
    if (isForeignParty(owner) && blank(owner.visaOci)) e.visaOci = 'required';
  } else if (!isAadhaar(owner.oAadhaar)) e.oAadhaar = 'format';
  if (!isMobile(owner.oMobile)) e.oMobile = 'format';
  checkEmail(e, 'oEmail', owner.oEmail);
  if (blank(owner.oAddr)) e.oAddr = 'required';
  const cap = owner.capacity || 'owner';
  if ((coOwners.length && cap === 'owner') || (!coOwners.length && cap === 'co-owner')) e.capacity = 'mismatch';
  checkPoa(e, '', owner, today);
  checkDocs(e, ownerDocs, ownerDocSlots(owner));
  coOwners.forEach((c, i) => {
    const p = `c${i}`;
    checkPerson(e, p, c);
    checkPoa(e, p, c, today);
    checkDocs(e, ownerDocs, coOwnerDocSlots(c, i));
  });
  distinctParties(e, [], licensorIds(f));
}

function tenantErrors(e, f) {
  const { tenantMode, tenants = [], tenantDocs } = f;
  if (tenantMode === 'invite') {
    tenants.forEach((t, i) => {
      if (!isMobile(t.mobile)) e[`t${i}mobile`] = 'format';
    });
    distinctParties(e, licensorIds(f), tenantIds(f));
    return;
  }
  tenants.forEach((t, i) => {
    checkPerson(e, `t${i}`, t);
    checkPoliceRecord(e, `t${i}`, t);
    checkDocs(e, tenantDocs, tenantDocSlots(t, i).filter((slot) => slot.required).map((slot) => slot.key));
  });
  distinctParties(e, licensorIds(f), tenantIds(f));
}

function depositPaymentErrors(e, terms, today) {
  const rows = Array.isArray(terms.depositPayments) ? terms.depositPayments : [];
  const deposit = num(terms.deposit);
  if (!deposit && !rows.length) return;
  if (!rows.length) { e.depositPayments = 'none'; return; }
  rows.forEach((r, i) => {
    (DEPOSIT_PAY_FIELDS[r.mode] || []).filter((f) => f !== 'branch').forEach((f) => { if (blank(r[f])) e[`dp${i}${f}`] = 'required'; });
    if (!DEPOSIT_PAY_FIELDS[r.mode]) e[`dp${i}mode`] = 'required';
    if (!blank(r.amount) && !num(r.amount)) e[`dp${i}amount`] = 'required';
    if (r.date && r.date > today) e[`dp${i}date`] = 'range';
    if (DEPOSIT_PAY_FIELDS[r.mode]?.includes('ref') && !blank(r.ref) && !PAYMENT_REF.test(r.ref)) e[`dp${i}ref`] = 'format';
  });
  if (rows.reduce((sum, r) => sum + num(r.amount), 0) !== deposit) e.depositPayments = 'total';
}

function termErrors(e, { terms, tenants = [] }, bounds) {
  if (!terms.startDate) e.startDate = 'required';
  else if (terms.startDate < bounds.min || terms.startDate > bounds.max) e.startDate = 'range';
  if (!num(terms.rent)) e.rent = 'required';
  if (blank(terms.deposit)) e.deposit = 'required';
  const months = Number(terms.months);
  if (!wholeIn(terms.months, 1, MAX_MONTHS)) e.months = 'range';
  const cap = Number.isFinite(months) && months >= 1 ? Math.min(months, MAX_MONTHS) : MAX_MONTHS;
  if (!blank(terms.lockin) && !wholeIn(terms.lockin, 0, cap)) e.lockin = 'range';
  if (!blank(terms.notice) && !wholeIn(terms.notice, 0, cap)) e.notice = 'range';
  if (!blank(terms.dueDay) && !wholeIn(terms.dueDay, 1, DUE_DAY_MAX)) e.dueDay = 'range';
  if (!blank(terms.increment) && !wholeIn(terms.increment, 0, 100)) e.increment = 'range';
  if (!blank(terms.occupants) && !wholeIn(terms.occupants, 1, MAX_OCCUPANTS)) e.occupants = 'range';
  const namedOccupants = tenants.length + tenants.reduce((sum, t) => sum + (Array.isArray(t.police?.occupants) ? t.police.occupants.length : 0), 0);
  if (!e.occupants && num(terms.occupants) > 0 && namedOccupants > num(terms.occupants)) e.occupants = 'range';
  checkOptionalArea(e, 'parkingArea', terms.parkingArea);
  if (!blank(terms.parkingAreaUnit) && !AREA_UNITS.includes(terms.parkingAreaUnit)) e.parkingArea = 'range';
  const visit = visitDateBounds();
  if (terms.visitDate && (terms.visitDate < visit.min || terms.visitDate > visit.max)) e.visitDate = 'range';
  depositPaymentErrors(e, terms, bounds.today);
}

function propertyAttributeErrors(e, prop) {
  const rows = prop.propertyAttributes;
  if (rows == null) return;
  if (!Array.isArray(rows)) { e.propertyAttributes = 'format'; return; }
  rows.forEach((row, i) => {
    const hasKind = !blank(row?.kind);
    const hasNumber = !blank(row?.number);
    if (!hasKind && !hasNumber) return;
    if (!PROPERTY_ATTRIBUTE_KINDS.includes(row.kind)) e[`pa${i}kind`] = 'format';
    if (!hasNumber || String(row.number).trim().length > 80) e[`pa${i}number`] = 'required';
  });
}

function witnessErrors(e, f) {
  const wit = f.wit || {};
  [1, 2].forEach((n) => {
    const p = `w${n}`;
    if (blank(wit[p + 'Name'])) e[p + 'Name'] = 'required';
    checkAge(e, p + 'Age', wit[p + 'Age'], true);
    if (!isMobile(wit[p + 'Mobile'])) e[p + 'Mobile'] = 'format';
    if (blank(wit[p + 'Addr'])) e[p + 'Addr'] = 'required';
    if (!isAadhaar(wit[p + 'Aadhaar'])) e[p + 'Aadhaar'] = 'format';
  });
  const tenantSide = tenantIds(f);
  distinctParties(e, [...licensorIds(f), ...tenantSide], witnessIds(f));
}
/* Errors for one wizard step, keyed by field. */

export function stepErrors(step, form, now = new Date()) {
  const e = {};
  if (form.mode === 'invite' && step !== (form.inviteRole === 'owner' ? 1 : 2)) return e;
  const bounds = startDateBounds(now);
  if (step === 0) {
    const { prop } = form;
    ['flatNo', 'locality', 'taluka', 'villageCity'].forEach((k) => { if (blank(prop[k])) e[k] = 'required'; });
    if (blank(prop.society)) e.society = 'required';
    if (typeof prop.gramPanchayat !== 'boolean') e.gramPanchayat = 'required';
    if (!blank(prop.taluka) && !PUNE_TALUKAS.includes(prop.taluka)) e.taluka = 'format';
    if (!/^\d{6}$/.test(prop.pincode)) e.pincode = 'format';
    else if (!MH_PINCODE.test(prop.pincode)) e.pincode = 'state';
    // A draft saved when shops and offices were offered here; those go to the legal desk now.
    if (!RESIDENTIAL_PROPERTY_TYPES.includes(prop.propType)) e.propType = 'commercial';
    const area = Number(String(prop.area ?? '').trim());
    if (!/^\d+(\.\d{1,2})?$/.test(String(prop.area ?? '').trim()) || !(area >= 1 && area <= MAX_AREA)) e.area = 'required';
    if (!blank(prop.floor) && !wholeIn(prop.floor, 0, MAX_FLOOR)) e.floor = 'range';
    propertyAttributeErrors(e, prop);
    checkOptionalArea(e, 'galleryArea', prop.galleryArea);
    if (!blank(prop.galleryAreaUnit) && !AREA_UNITS.includes(prop.galleryAreaUnit)) e.galleryArea = 'range';
  } else if (step === 1) licensorErrors(e, form, bounds.today);
  else if (step === 2) tenantErrors(e, form);
  else if (step === 3) termErrors(e, form, bounds);
  else if (step === 4) witnessErrors(e, form);
  return e;
}
