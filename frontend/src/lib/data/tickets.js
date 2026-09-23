/* Service-request desk vocabulary for the Admin › Service Requests page.

   Only the part with no server representation lives here: `TEAMS` is the display order the console
   lists desks in, and `TEAM_LABEL` turns the wire value into the name a customer would recognise
   ("rental" is the `tickets_team_check` value; "Rent Agreement" is the service they bought).

   Status labels are deliberately absent — `TicketStatuses` is the vocabulary, and a second hand-kept
   one drifts. Notes are appended by `POST /tickets/{id}/notes`, which stamps `by` and `at` itself
   rather than trusting whatever the caller claimed. */

export const TEAMS = ['rental', 'legal', 'loans', 'interior', 'packers', 'valuation'];

export const TEAM_LABEL = {
  rental: 'Rent Agreement',
  legal: 'Property & Legal',
  loans: 'Home Loans',
  interior: 'Interior & Renovation',
  packers: 'Packers & Movers',
  valuation: 'Property Valuation',
};
