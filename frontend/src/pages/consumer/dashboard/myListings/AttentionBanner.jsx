import Icon from '../../../../components/Icon.jsx';

// Nudge banner: prompts the owner to reconfirm listings that have gone quiet,
// so buyers keep trusting them. Rendered only when there is something to confirm.
export default function AttentionBanner({ attentionListings, dormantCount, onConfirmAll }) {
  return (
    <div className="mb-5 rounded-xl bg-amber-500/[0.07] border border-amber-500/20 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-start gap-3 flex-1 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center flex-shrink-0">
          <Icon name="bell" className="w-4.5 h-4.5 text-amber-300" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-amber-200">
            {attentionListings.length} listing{attentionListings.length === 1 ? '' : 's'} need{attentionListings.length === 1 ? 's' : ''} your confirmation
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            Confirm they're still available to keep buyers trusting them.
            {dormantCount > 0 && ` ${dormantCount} ${dormantCount === 1 ? 'is' : 'are'} paused and hidden from search until you reactivate.`}
          </p>
        </div>
      </div>
      <button onClick={onConfirmAll} className="btn-teal text-xs px-4 py-2 rounded-lg text-white font-semibold inline-flex items-center gap-1.5 flex-shrink-0 self-start sm:self-auto">
        <Icon name="check-circle" className="w-4 h-4" /> Confirm all available
      </button>
    </div>
  );
}
