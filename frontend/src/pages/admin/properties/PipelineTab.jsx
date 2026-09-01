import { useMemo, useState } from 'react';
import { classNames } from '../../../lib/format.js';
import { computeQualityScore } from '../../../lib/qualityScore.js';
import { useAdminFlags } from '../../../context/AdminFlagsContext.jsx';
import Select from '../../../components/ui/Select.jsx';
import { PIPELINE_STAGES, HANDBACK_MILESTONES } from './constants.js';

/* Only the four stored stages are offered. `under_review` and `live` are `status`, not stages, and
   the server answers 400 for either — see `constants.js`. Moving a listing into those two columns
   is a moderation decision (the review modal, or clearing a flag), not a dropdown. */
const STAGE_OPTS = PIPELINE_STAGES.filter((s) => !s.derived).map((s) => ({ value: s.key, label: s.label }));

const MILESTONE_LABEL = Object.fromEntries(HANDBACK_MILESTONES.map((m) => [m.key, m.label]));

/**
 * Which column a listing belongs in.
 *
 * Total by construction — every listing lands in exactly one column, which the previous version was
 * not: it invented a stage for anything with a null one and then dropped the row entirely if the
 * invented value was not a known key, so a listing carrying an unrecognised stage silently vanished
 * off the board rather than showing up somewhere wrong. A board that quietly loses rows is worse
 * than one that files them oddly, because nothing on screen says a row is missing.
 *
 * Status wins at both ends. `approved` is Live regardless of how far along the acquisition funnel
 * the desk got, because a published listing is published. A listing with no concierge stage at all
 * is the ordinary verification queue, which is what Under Review means. In between, the stored
 * stage decides.
 */
const columnFor = (l) => {
  if (l.status === 'approved') return 'live';
  if (!l.pipelineStage) return 'under_review';
  return l.pipelineStage;
};

export default function PipelineTab({ all, onAdvancePipeline }) {
  const { optionEnabled } = useAdminFlags();
  const [pipelineExpanded, setPipelineExpanded] = useState({});

  const pipelineData = useMemo(() => {
    const list = all || [];
    const stages = {};
    PIPELINE_STAGES.forEach((s) => { stages[s.key] = []; });
    list.forEach((l) => {
      if (l.archived || l.status === 'rejected') return;
      const key = columnFor(l);
      // An unknown stage is a data problem, not a reason to hide the listing: file it under the
      // status-derived column so it is still on the board and still movable.
      (stages[key] || stages.under_review).push(l);
    });
    return stages;
  }, [all]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-gray-400">Owner onboarding pipeline {'\u2014'} drag-free workflow board</span>
        <span className="ml-auto text-sm text-gray-400">{(all || []).filter((l) => !l.archived).length} total</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {PIPELINE_STAGES.map((stage) => {
          const items = pipelineData[stage.key] || [];
          const isExpanded = pipelineExpanded[stage.key];
          const PAGE = 6;
          const visible = isExpanded ? items : items.slice(0, PAGE);
          const hasMore = items.length > PAGE;
          return (
            <div key={stage.key} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 min-h-[200px]">
              <div className="mb-3">
                <div className="flex items-center justify-between">
                  <span className={classNames('rounded-full border px-2.5 py-0.5 text-xs font-semibold', stage.color)}>
                    {stage.label}
                  </span>
                  <span className="text-xs tabular-nums text-gray-500">{items.length}</span>
                </div>
                {optionEnabled('properties.qualityScore') && items.length > 0 && (
                  <div className="mt-1.5 text-[10px] text-gray-500">
                    Avg quality: {Math.round(items.reduce((sum, it) => sum + computeQualityScore(it), 0) / items.length)}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                {visible.map((l) => {
                  const days = Math.floor((Date.now() - new Date(l.createdAt).getTime()) / 86400000);
                  return (
                    <div key={l.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5 hover:border-white/20 transition">
                      <div className="text-xs font-semibold text-white truncate">{l.title}</div>
                      <div className="mt-1 text-[11px] text-gray-500 truncate">{l.owner} {'\u00B7'} {l.locality}</div>
                      {/* The second axis. Shown on the card rather than as a column of its own,
                          because a listing sits somewhere on the acquisition funnel *and* has a
                          hand-back milestone at once — the thing one column could not express. */}
                      {l.handbackMilestone && (
                        <div className="mt-1 text-[10px] text-violet-300 truncate">
                          Hand-back: {MILESTONE_LABEL[l.handbackMilestone] || l.handbackMilestone}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className={classNames('text-[10px] tabular-nums', days >= 5 ? 'text-rose-300' : days >= 2 ? 'text-amber-300' : 'text-gray-500')}>
                          {days}d
                        </span>
                        <Select
                          size="sm"
                          /* The listing's own stage, not the column it is filed under — a card in
                             Live or Under Review is there because of its status, and showing the
                             column key would offer the desk a value the server refuses. */
                          value={l.pipelineStage || ''}
                          onChange={(v) => onAdvancePipeline(l.id, v)}
                          options={STAGE_OPTS}
                          placeholder="Set stage"
                          ariaLabel={`Change pipeline stage for ${l.title}`}
                        />
                      </div>
                    </div>
                  );
                })}
                {hasMore && (
                  <button
                    onClick={() => setPipelineExpanded((prev) => ({ ...prev, [stage.key]: !isExpanded }))}
                    className="w-full rounded-lg border border-dashed border-white/10 py-1.5 text-center text-[11px] text-gray-400 hover:border-white/20 hover:text-white transition"
                  >
                    {isExpanded ? 'Show less' : `Show all ${items.length}`}
                  </button>
                )}
                {items.length === 0 && (
                  <p className="py-4 text-center text-xs text-gray-600">Empty</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
