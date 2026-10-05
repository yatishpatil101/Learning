export const STAGES = ['Paid', 'Picked up', 'Papers verified', 'Draft shared', 'Approved', 'Registered', 'Police intimation'];

export const papersVerified = (checklist) =>
  !!checklist?.items?.length && checklist.items.every((i) => i.review === 'verified');

/** How many of `STAGES` are behind this case. `checklist` is optional: rows in the queue don't carry it. */
export function stagesDone(request, checklist) {
  switch (request.status) {
    case 'submitted': return 1;
    case 'docs_review': return papersVerified(checklist) ? 3 : 2;
    case 'draft_shared':
    case 'changes_requested': return 4;
    case 'approved': return 5;
    case 'completed': return request.policeIntimation?.confirmed ? 7 : 6;
    default: return 0;
  }
}

/** The one move this case is waiting on, and whose move it is. */
export function nextStep(request, checklist) {
  if (request.draftCheck?.status === 'pending') return { who: 'colleague', text: 'A colleague must check this draft before the customer sees it' };
  switch (request.status) {
    case 'submitted': return { who: 'desk', text: 'Take the case and start the paper check' };
    case 'docs_review':
      if (!checklist) return { who: 'desk', text: 'Verify papers, then share the draft' };
      if (checklist.ready < checklist.total) return { who: 'customer', text: `Waiting for ${checklist.total - checklist.ready} paper(s) from the customer` };
      return papersVerified(checklist)
        ? { who: 'desk', text: 'Papers verified — prepare and share the draft' }
        : { who: 'desk', text: 'Verify or reject each uploaded paper' };
    case 'draft_shared': return { who: 'customer', text: 'Waiting for every party to approve the draft' };
    case 'changes_requested': return { who: 'desk', text: 'Customer asked for changes — revise and re-share the draft' };
    case 'approved': return { who: 'desk', text: 'Book the registration, then upload the registered copy' };
    case 'completed': return request.policeIntimation?.confirmed
      ? { who: 'done', text: 'All done' }
      : { who: 'desk', text: 'Confirm police intimation to close the case' };
    case 'cancelled': return { who: 'done', text: 'Cancelled' };
    default: return { who: 'customer', text: 'Awaiting payment' };
  }
}

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const str = (v) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim());
const num = (v) => Number(str(v).replace(/,/g, '')) || 0;

/** Owner, tenants, flat and terms for a queue row, from the wizard snapshot with flat fields as fallback. */
export function caseSummary(details) {
  const d = obj(details);
  const s = obj(d._state);
  const prop = obj(s.prop);
  const terms = obj(s.terms);
  const tenants = Array.isArray(s.tenants) ? s.tenants.map((t) => str(obj(t).name)).filter(Boolean) : [];
  return {
    owner: str(obj(s.owner).oName) || str(d.ownerName),
    tenants: tenants.length ? tenants.join(', ') : str(d.tenants),
    flat: [str(prop.flatNo), str(prop.society)].filter(Boolean).join(', ') || str(d.property),
    locality: str(prop.locality) || str(d.location),
    rent: num(terms.rent) || num(d.rent),
    deposit: num(terms.deposit) || num(d.deposit),
    months: str(terms.months) || str(d.months),
  };
}
