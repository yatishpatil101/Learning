/* Service-request desk vocabulary for the Admin › Service Requests page.

   What used to be here and is not any more: `addTicketNote`, and a `STATUS_LABEL`/`statusLabel`
   pair. Both were ports of the HTML app and both described the mock store rather than the system.
   The note appender wrote into the browser's `db.tickets`, where no colleague could read it;
   `POST /tickets/{id}/notes` is the append that reaches the desk, and it stamps `by` and `at`
   itself rather than trusting whatever the caller claimed. The status labels named four words
   (`new`, `in_progress`, `done`, `cancelled`) that `TicketStatuses` does not have.

   What stays is the part with no server representation: `TEAMS` is the display order the console
   lists desks in, and `TEAM_LABEL` turns the wire value into the name a customer would recognise
   ("rental" is the `tickets_team_check` value; "Rent Agreement" is the service they bought). */

export const TEAMS = ['rental', 'legal', 'loans', 'interior', 'packers', 'valuation'];

export const TEAM_LABEL = {
  rental: 'Rent Agreement',
  legal: 'Property & Legal',
  loans: 'Home Loans',
  interior: 'Interior & Renovation',
  packers: 'Packers & Movers',
  valuation: 'Property Valuation',
};
