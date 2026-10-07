/* Tiny client-side CSV exporter shared by admin modules. */
export function exportCsv(filename, headers, rows) {
  // A leading = + - @ makes spreadsheets run the cell as a formula; customer-typed text must stay text.
  const esc = (v) => {
    const text = String(v ?? '');
    const safe = typeof v !== 'number' && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [headers.map(esc).join(',')];
  rows.forEach((r) => lines.push(r.map(esc).join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
