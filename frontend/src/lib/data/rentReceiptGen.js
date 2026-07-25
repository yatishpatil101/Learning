/* PuneNest — HRA Rent Receipt generator for Dashboard Documents tab.
   Port of the static app's rent-receipt.js using jsPDF ESM. */

import { jsPDF } from 'jspdf';

const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function numToWordsIndian(n) {
  n = Math.round(Number(n) || 0);
  if (n === 0) return 'Zero';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? ' ' + ones[x % 10] : ''));
  const three = (x) => {
    let s = '';
    if (x > 99) { s += ones[Math.floor(x / 100)] + ' Hundred'; x %= 100; if (x) s += ' '; }
    if (x) s += two(x);
    return s;
  };
  let w = '';
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thou = Math.floor(n / 1000); n %= 1000;
  if (crore) w += three(crore) + ' Crore';
  if (lakh) w += (w ? ' ' : '') + two(lakh) + ' Lakh';
  if (thou) w += (w ? ' ' : '') + two(thou) + ' Thousand';
  if (n) w += (w ? ' ' : '') + three(n);
  return w.trim();
}

function drawReceipt(doc, x, y, w, h, d) {
  doc.setDrawColor(150); doc.setLineWidth(0.4); doc.rect(x, y, w, h);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(0);
  doc.text('RENT RECEIPT', x + w / 2, y + 11, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(110);
  doc.text('(For HRA exemption under Section 10(13A) of the Income-tax Act)', x + w / 2, y + 16, { align: 'center' });
  doc.setTextColor(0); doc.setLineWidth(0.2); doc.line(x + 8, y + 20, x + w - 8, y + 20);
  doc.setFontSize(9.5);
  doc.text('Receipt No: ' + d.no, x + 8, y + 28);
  doc.text('Date: ' + d.receiptDate, x + w - 8, y + 28, { align: 'right' });
  const rupees = Math.round(d.rent).toLocaleString('en-IN');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('Rs. ' + rupees + '/-', x + 8, y + 39);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  const amtWords = 'Rupees ' + numToWordsIndian(d.rent) + ' Only';
  const body = 'Received with thanks a sum of Rs. ' + rupees + ' (' + amtWords + ') from Mr./Ms. ' + d.tenant +
    ' towards the rent of the property situated at ' + d.address + ' for the period ' + d.startStr + ' to ' + d.endStr + ' (' + d.label + ').';
  const lines = doc.splitTextToSize(body, w - 16);
  doc.text(lines, x + 8, y + 48);
  doc.text('Mode of payment: ' + d.mode, x + 8, y + 48 + lines.length * 5 + 3);
  // Revenue stamp box
  doc.setDrawColor(190); doc.setLineWidth(0.3); doc.rect(x + 8, y + h - 30, 24, 18);
  doc.setFontSize(6.5); doc.setTextColor(130);
  doc.text('Affix Rs.1', x + 20, y + h - 23, { align: 'center' });
  doc.text('Revenue', x + 20, y + h - 20, { align: 'center' });
  doc.text('Stamp', x + 20, y + h - 17, { align: 'center' });
  doc.setTextColor(0);
  // Signature
  doc.setLineWidth(0.3); doc.line(x + w - 70, y + h - 20, x + w - 8, y + h - 20);
  doc.setFontSize(9); doc.text('Signature of Landlord / Owner', x + w - 8, y + h - 16, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(d.landlord, x + w - 8, y + h - 10, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  if (d.pan) doc.text('PAN: ' + d.pan, x + w - 8, y + h - 5.5, { align: 'right' });
  doc.setFontSize(7); doc.setTextColor(150);
  doc.text('Generated via PuneNest', x + 8, y + h - 5.5);
  doc.setTextColor(0);
}

function monthMeta(ym) {
  const p = String(ym || '').split('-').map(Number);
  let y = p[0], m = (p[1] || 1) - 1;
  if (!y) { const now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
  const dd = (dte) => ('0' + dte.getDate()).slice(-2) + '/' + ('0' + (dte.getMonth() + 1)).slice(-2) + '/' + dte.getFullYear();
  const start = new Date(y, m, 1), end = new Date(y, m + 1, 0);
  return { label: MN[m] + ' ' + y, startStr: dd(start), endStr: dd(end), receiptDate: dd(end) };
}

function monthRange(fromStr, toStr) {
  const f = (fromStr || '').split('-').map(Number);
  const t = (toStr || '').split('-').map(Number);
  let y = f[0], m = (f[1] || 1) - 1, ty = t[0], tm = (t[1] || 1) - 1;
  if (!y) return [];
  const out = [];
  let guard = 0;
  const dd = (dte) => ('0' + dte.getDate()).slice(-2) + '/' + ('0' + (dte.getMonth() + 1)).slice(-2) + '/' + dte.getFullYear();
  while ((y < ty || (y === ty && m <= tm)) && guard < 240) {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    out.push({ label: MN[m] + ' ' + y, startStr: dd(start), endStr: dd(end), receiptDate: dd(end) });
    m++;
    if (m > 11) { m = 0; y++; }
    guard++;
  }
  return out;
}

/* Generate & download HRA rent receipts PDF for a range of months. */
export function generateRentReceipts({ tenant, landlord, address, rent, pan, fromMonth, toMonth, mode }) {
  const months = monthRange(fromMonth, toMonth);
  if (!months.length) return { ok: false, error: 'Invalid month range' };

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const perPage = 2, boxH = 124, top = 16, gap = 14;

  months.forEach((mo, i) => {
    const slot = i % perPage;
    if (i > 0 && slot === 0) doc.addPage();
    const yy = top + slot * (boxH + gap);
    drawReceipt(doc, 15, yy, 180, boxH, {
      no: i + 1,
      tenant: tenant || '—',
      landlord: landlord || '—',
      address: address || '—',
      rent: Number(rent) || 0,
      pan: (pan || '').toUpperCase(),
      mode: mode || 'Online / Bank transfer',
      label: mo.label,
      startStr: mo.startStr,
      endStr: mo.endStr,
      receiptDate: mo.receiptDate,
    });
  });

  const filename = `Rent-Receipts-${(tenant || 'tenant').replace(/\s+/g, '-')}.pdf`;
  doc.save(filename);
  return { ok: true, count: months.length, filename };
}

/* Get current FY start (April-March) as a YYYY-MM string */
export function fyStart() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${y}-04`;
}

/* Get current month as YYYY-MM string */
export function thisMonth() {
  const now = new Date();
  return now.toISOString().slice(0, 7);
}

export { monthMeta, monthRange };
