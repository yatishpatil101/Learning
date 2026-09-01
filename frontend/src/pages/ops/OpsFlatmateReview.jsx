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
import { BedDouble, ShieldAlert, ShieldCheck, Users } from 'lucide-react';
import { isHttpDomain } from '../../services/config.js';
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
  const liveApi = isHttpDomain('flatmate');

  if (!liveApi) {
    return (
      <div>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        <div className="pn-card flex items-start gap-3 p-6 text-sm text-gray-300">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
          <div>
            <div className="font-semibold text-gray-100">This desk needs the live API.</div>
            <p className="mt-1 max-w-2xl text-gray-400">
              There is no offline store behind these queues, and the one that used to be here could
              only model a third of the desk: it knew nothing of the moderation axis that decides
              whether a post is visible at all, nothing of group applications, and nothing of the
              read-versus-write permission split that says whether this account may decide anything.
              A queue that always looked empty would be indistinguishable from a cleared backlog,
              which is the exact failure D72 warns about. Enable the
              <code className="mx-1">flatmate</code> domain to work these boards.
            </p>
          </div>
        </div>
      </div>
    );
  }

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
