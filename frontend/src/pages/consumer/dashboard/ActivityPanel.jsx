import { useState } from 'react';
import { SubNav } from './components.jsx';
import SavedPanel from './SavedPanel.jsx';
import RecentPanel from './RecentPanel.jsx';
import AlertsPanel from './AlertsPanel.jsx';
import FollowedSocietiesPanel from './FollowedSocietiesPanel.jsx';
import MyFlatmateGroupsPanel from './MyFlatmateGroupsPanel.jsx';
/* "Saved & Activity" — one home for everything the seeker is tracking. */

const ITEMS = [
  { key: 'saved', label: 'Saved', icon: 'heart' },
  { key: 'recent', label: 'Recently Viewed', icon: 'history' },
  { key: 'alerts', label: 'Alerts', icon: 'bell-plus' },
  { key: 'groups', label: 'Flatmate groups', icon: 'users-round' },
];

export default function ActivityPanel({ initialSub, recent = [] }) {
  const [sub, setSub] = useState(ITEMS.some((i) => i.key === initialSub) ? initialSub : 'saved');
  return (
    <div>
      <SubNav items={ITEMS} active={sub} onChange={setSub} />
      {sub === 'saved' && <SavedPanel />}
      {sub === 'recent' && <RecentPanel recent={recent} />}
      {sub === 'groups' && <MyFlatmateGroupsPanel />}
      {sub === 'alerts' && (
        <div className="space-y-5">
          <AlertsPanel />
          <FollowedSocietiesPanel />
        </div>
      )}
    </div>
  );
}
