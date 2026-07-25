/* Shared HRA rent-receipt PDF engine (prototype). ESM port of rent-receipt.js.
   Generates the legal-format HRA rent receipt used on the Pay Rent flow and the
   owner dashboard bulk generator. Uses jsPDF. */

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

export function drawReceipt(doc, x, y, w, h, d) {
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
  if (d.txnRef) doc.text('Transaction ref: ' + d.txnRef, x + 8, y + 48 + lines.length * 5 + 9);
  doc.setDrawColor(190); doc.setLineWidth(0.3); doc.rect(x + 8, y + h - 30, 24, 18);
  doc.setFontSize(6.5); doc.setTextColor(130);
  doc.text('Affix Rs.1', x + 20, y + h - 23, { align: 'center' });
  doc.text('Revenue', x + 20, y + h - 20, { align: 'center' });
  doc.text('Stamp', x + 20, y + h - 17, { align: 'center' });
  doc.setTextColor(0);
  doc.setLineWidth(0.3); doc.line(x + w - 70, y + h - 20, x + w - 8, y + h - 20);
  doc.setFontSize(9); doc.text('Signature of Landlord / Owner', x + w - 8, y + h - 16, { align: 'right' });
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
  doc.text(d.landlord, x + w - 8, y + h - 10, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  if (d.pan) doc.text('PAN: ' + d.pan, x + w - 8, y + h - 5.5, { align: 'right' });
  doc.setFontSize(7); doc.setTextColor(150);
  doc.text('Generated via PuneNest' + (d.paidOnline ? ' · Paid online' : ''), x + 8, y + h - 5.5);
  doc.setTextColor(0);
}

export function monthMeta(ym) {
  const p = String(ym || '').split('-').map(Number);
  let y = p[0], m = (p[1] || 1) - 1;
  if (!y) { const now = new Date(); y = now.getFullYear(); m = now.getMonth(); }
  const dd = (dte) => ('0' + dte.getDate()).slice(-2) + '/' + ('0' + (dte.getMonth() + 1)).slice(-2) + '/' + dte.getFullYear();
  const start = new Date(y, m, 1), end = new Date(y, m + 1, 0);
  return { label: MN[m] + ' ' + y, startStr: dd(start), endStr: dd(end), receiptDate: dd(end) };
}

/* Generate + save a single-month receipt PDF. Returns filename. */
export function generateSingle(d, filename) {
  const meta = monthMeta(d.month);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  drawReceipt(doc, 15, 20, 180, 124, {
    no: d.no || 1, tenant: d.tenant || '—', landlord: d.landlord || '—', address: d.address || '—',
    rent: d.rent || 0, pan: (d.pan || '').toUpperCase(), mode: d.mode || 'UPI',
    label: meta.label, startStr: meta.startStr, endStr: meta.endStr, receiptDate: meta.receiptDate,
    txnRef: d.txnRef || '', paidOnline: d.paidOnline !== false,
  });
  const name = filename || ('Rent-Receipt-' + meta.label.replace(/\s+/g, '-') + '.pdf');
  doc.save(name);
  return name;
}
