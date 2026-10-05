import Icon from '../../../components/Icon.jsx';

export default function ActionSheet({ title, actions, onClose }) {
  return (
    <div
      className="dz-modal-backdrop pc-sheet-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="dz-action-sheet pc-action-sheet" role="menu" aria-label={title}>
        <div className="pc-sheet-title">{title}</div>
        {actions.filter(Boolean).map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            className={action.danger ? 'danger' : ''}
            onClick={() => { onClose(); action.onClick?.(); }}
          >
            {action.icon ? <Icon name={action.icon} className="w-4 h-4" /> : null}
            <span>{action.label}</span>
          </button>
        ))}
        <button type="button" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
