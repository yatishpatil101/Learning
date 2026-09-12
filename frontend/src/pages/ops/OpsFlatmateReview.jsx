/**
 * Ops flatmates desk — three boards over `FlatmateModerationController`, live-only.
 *
 * ## Why three boards and not one screen
 *
 * The controller keeps verification and moderation on separate routes deliberately, and this page
 * keeps them on separate boards for the same reason: they are different questions about the same
 * post, with different outcomes and different consequences for getting them wrong.
 *
 *   **Verification** — *has this host proved what they claimed?* Outcome: a trust badge. A post that
 *   fails stays visible, because an unproven claim is not abuse.
 *
 *   **Moderation** — *may this be published at all?* Outcome: visibility. A post that fails is
 *   hidden, and that says nothing about whether the paperwork behind it is real.
 *
 *   **Group applications** — the same moderation axis over a third resource, alongside a status
 *   that belongs to the owner and that this desk may never write.
 *
 * A single merged status column would be a screen that cannot tell a host "we could not verify your
 * agreement" apart from "we took your post down". Those are different things to be told.
 *
 * ## What changed at wave 2c
 *
 * This page used to read a `localStorage` review store the consumer flow wrote into. It could model
 * the verification queue's happy path and nothing else: no moderation axis at all — so the D72
 * backlog, the thing that makes "invisible until moderated" defensible, had **no UI in the product**
 * — no group applications, and no notion of the `flatmates:read` / `flatmates:write` split that
 * decides whether the account looking at this queue is allowed to work it.
 */
import { useState } from 'react';
import { BedDouble, ShieldCheck, Users } from 'lucide-react';
import { classNames } from '../../lib/format.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import VerificationBoard from './flatmate/VerificationBoard.jsx';
import ModerationBoard from './flatmate/ModerationBoard.jsx';
import ApplicationsBoard from './flatmate/ApplicationsBoard.jsx';

const TITLE = 'Flatmate Moderation';
const SUBTITLE = 'Verify what hosts claim, and decide what the board is allowed to show.';

const BOARDS = [
  { id: 'verification', label: 'Verification', icon: ShieldCheck, Panel: VerificationBoard },
  { id: 'moderation', label: 'Moderation', icon: BedDouble, Panel: ModerationBoard },
  { id: 'applications', label: 'Group applications', icon: Users, Panel: ApplicationsBoard },
];

export default function OpsFlatmateReview() {
  const [board, setBoard] = useState('verification');

  /* A "this desk needs the live API" panel stood here, for the case where `flatmate` was left out
     of the domain allow-list. The mock store behind it could model about a third of this desk — no
     moderation axis, no group applications, no read-versus-write permission split — so an empty
     queue would have been indistinguishable from a cleared backlog (D72). Both the allow-list and
     the store are gone; the three boards below each render their own failure. */

  const active = BOARDS.find((b) => b.id === board) || BOARDS[0];

  return (
    <div>
      <PageHeader title={TITLE} subtitle={SUBTITLE} />

      <div role="group" aria-label="Flatmate boards" className="mb-5 flex flex-wrap gap-2">
        {BOARDS.map((b) => (
          <button
            key={b.id}
            type="button"
            aria-pressed={board === b.id}
            onClick={() => setBoard(b.id)}
            className={classNames(
              'inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium transition',
              board === b.id
                ? 'border-brand-teal/40 bg-brand-teal/15 text-brand-teal'
                : 'border-white/10 text-gray-300 hover:bg-white/5',
            )}
          >
            <b.icon className="h-4 w-4" />{b.label}
          </button>
        ))}
      </div>

      {/* Keyed so switching boards remounts rather than reusing the previous board's row state. */}
      <active.Panel key={active.id} />
    </div>
  );
}
