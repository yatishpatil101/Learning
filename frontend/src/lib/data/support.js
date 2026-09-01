/* `import { rawDb, saveDb, mutateDb } from '../mockApi.js'` stood here and was never used — not by
   a since-deleted function, but by anything, at any point this file has looked like this. Support
   tickets have always lived in their own `puneNestSupport` key through the `load`/`save` pair
   below, deliberately: the ops side reads the same key (see `providers/mock/supportProvider.js`),
   and putting them in the main mock DB would have coupled a ticket write to the 236 KB seed.

   Left in place it was worse than clutter. This file is one of the ~30 that a `mockApi` grep
   reports as a caller, and the retirement work is driven off exactly that grep — so an import of
   three unused symbols made the mock store look one file harder to remove than it is. */
import i18n from '../../i18n/index.js';

// Persist support tickets in localStorage (matching HTML)
const KEY = 'puneNestSupport';
const MAX_IMAGES = 4;

const CATEGORIES = [
  { key: 'payment', label: 'Payments & Refunds', icon: 'indian-rupee' },
  { key: 'rent', label: 'Rent Payment / HRA', icon: 'receipt-indian-rupee' },
  { key: 'listing', label: 'Property Listing', icon: 'building-2' },
  { key: 'verification', label: 'Verification / KYC', icon: 'badge-check' },
  { key: 'account', label: 'Account & Login', icon: 'user-cog' },
  { key: 'booking', label: 'Visit / Booking', icon: 'calendar-check' },
  { key: 'service', label: 'Home Services', icon: 'concierge-bell' },
  { key: 'technical', label: 'Technical / Bug', icon: 'bug' },
  { key: 'other', label: 'Something else', icon: 'help-circle' },
];

const PRIORITIES = [
  { key: 'low', label: 'Low' },
  { key: 'normal', label: 'Normal' },
  { key: 'high', label: 'High' },
  { key: 'urgent', label: 'Urgent' },
];

const STATUS = {
  open: { label: 'Open' },
  'in-progress': { label: 'In progress' },
  waiting: { label: 'Awaiting your reply' },
  resolved: { label: 'Resolved' },
  closed: { label: 'Closed' },
};

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && d.tickets) return d;
  } catch (e) {}
  return { tickets: [], seq: 10000 };
}

function save(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    return false;
  }
}

function find(db, id) {
  return db.tickets.find((t) => t.id === id) || null;
}

function uid(p) {
  return p + Math.random().toString(36).slice(2, 8);
}

function now() {
  return Date.now();
}

function bump(t) {
  t.updatedAt = now();
}

export function compressImage(file) {
  return new Promise((resolve) => {
    if (!file || !/^image\//.test(file.type)) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const max = 1100;
        let w = img.width;
        let h = img.height;
        if (w > max || h > max) {
          if (w >= h) {
            h = Math.round((h * max) / w);
            w = max;
          } else {
            w = Math.round((w * max) / h);
            h = max;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        try {
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        } catch (er) {}
        let out;
        try {
          out = canvas.toDataURL('image/jpeg', 0.62);
        } catch (er2) {
          out = e.target.result;
        }
        resolve({ name: file.name || 'image', type: 'image/jpeg', data: out });
      };
      img.onerror = () => resolve(null);
      img.src = e.target.result;
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export async function compressFiles(files) {
  const list = Array.from(files || [])
    .filter((f) => /^image\//.test(f.type))
    .slice(0, MAX_IMAGES);
  if (!list.length) return [];
  const results = await Promise.all(list.map((f) => compressImage(f)));
  return results.filter(Boolean);
}

export function getCatLabel(k) {
  const c = CATEGORIES.find((cat) => cat.key === k);
  return i18n.t('misc.cat_' + k, { defaultValue: c ? c.label : 'Support' });
}

export function getCatIcon(k) {
  const c = CATEGORIES.find((cat) => cat.key === k);
  return c ? c.icon : 'help-circle';
}

export function getPrioLabel(k) {
  const p = PRIORITIES.find((pr) => pr.key === k);
  return i18n.t('misc.prio_' + k, { defaultValue: p ? p.label : 'Normal' });
}

export function getStatusLabel(k) {
  return i18n.t('misc.status_' + k, { defaultValue: STATUS[k] ? STATUS[k].label : k });
}

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const n = new Date();
  const diff = (n - d) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400 && d.getDate() === n.getDate())
    return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return (
    d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) +
    ', ' +
    d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  );
}

export function allTickets() {
  return load().tickets.slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function ticketsForUser(mobile) {
  return allTickets().filter((t) => t.mobile === mobile);
}

export function getTicket(id) {
  return find(load(), id);
}

export function createTicket(o) {
  const db = load();
  db.seq = (db.seq || 10000) + 1;
  const t = {
    id: 'SUP-' + db.seq,
    mobile: o.mobile || '',
    name: o.name || 'Customer',
    email: o.email || '',
    category: o.category || 'other',
    subject: String(o.subject || '').slice(0, 140),
    priority: o.priority || 'normal',
    status: 'open',
    assignedTo: null,
    assignedId: null,
    createdAt: now(),
    updatedAt: now(),
    unreadStaff: 1,
    unreadCustomer: 0,
    messages: [
      {
        id: uid('m'),
        by: 'customer',
        name: o.name || 'Customer',
        text: o.message || '',
        images: o.images || [],
        at: now(),
      },
    ],
  };
  db.tickets.unshift(t);
  return save(db) ? t : null;
}

export function replyToTicket(id, o) {
  const db = load();
  const t = find(db, id);
  if (!t) return null;
  const role = o.role === 'staff' ? 'staff' : 'customer';
  t.messages.push({
    id: uid('m'),
    by: role,
    name: o.name || (role === 'staff' ? 'Support' : 'You'),
    text: o.text || '',
    images: o.images || [],
    at: now(),
  });
  bump(t);
  if (role === 'staff') {
    t.unreadCustomer = (t.unreadCustomer || 0) + 1;
    if (t.status === 'open' || t.status === 'resolved') t.status = 'in-progress';
  } else {
    t.unreadStaff = (t.unreadStaff || 0) + 1;
    if (t.status === 'resolved' || t.status === 'closed' || t.status === 'waiting') t.status = 'open';
  }
  return save(db) ? t : null;
}

export function markTicketRead(id, role) {
  const db = load();
  const t = find(db, id);
  if (!t) return null;
  if (role === 'staff') t.unreadStaff = 0;
  else t.unreadCustomer = 0;
  save(db);
  return t;
}

export { CATEGORIES, PRIORITIES, STATUS, MAX_IMAGES };
