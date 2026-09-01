/* The month a payment defaults to.
   This file used to be the prototype's rent-payment engine: one `pay()` that wrote the tenant's
   payment row, credited the owner's ledger, booked the platform's fee revenue, set an autopay
   mandate and minted an HRA receipt — five different parties' records, all in one browser's
   localStorage, all stamped `status: 'paid'` before any money moved. `POST /me/rent-payments` does
   that work now (D232), and it opens a gateway order and returns the row `due`, because paying is
   not the same event as paid. What is left is the one thing in here that was never about money. */

export function thisMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}
