import { useMemo, useState } from 'react';
import { classNames } from '../../../lib/format.js';
import { computeQualityScore } from '../../../lib/qualityScore.js';
import { useAdminFlags } from '../../../context/AdminFlagsContext.jsx';
import Select from '../../../components/ui/Select.jsx';
import { PIPELINE_STAGES } from './constants.js';

const STAGE_OPTS = PIPELINE_STAGES.map((s) => ({ value: s.key, label: s.label }));

export default function PipelineTab({ all, onAdvancePipeline }) {
  const { optionEnabled } = useAdminFlags();
  const [pipelineExpanded, setPipelineExpanded] = useState({});

  const pipelineData = useMemo(() => {
    const list = all || [];
    const stages = {};
    PIPELINE_STAGES.forEach((s) => { stages[s.key] = []; });
    list.forEach((l) => {
      if (l.archived || l.status === 'rejected') return;
      let stage = l.pipelineStage;
      if (!stage) {
        if (l.status === 'approved') stage = 'live';
        else stage = 'listed';
      }
      if (stages[stage]) stages[stage].push(l);
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
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <span className={classNames('text-[10px] tabular-nums', days >= 5 ? 'text-rose-300' : days >= 2 ? 'text-amber-300' : 'text-gray-500')}>
                          {days}d
                        </span>
                        <Select
                          size="sm"
                          value={stage.key}
                          onChange={(v) => onAdvancePipeline(l.id, v)}
                          options={STAGE_OPTS}
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
