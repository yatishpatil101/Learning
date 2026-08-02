import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';

/* PostChooser — the single posting entry point for the whole Flatmates page.

   Posting used to present three sibling CTAs ("Post a request", "List your room",
   "Create group"), which asked the user to classify themselves against our storage
   model before they had seen a single form. This asks the one question they can
   always answer instead, and routes from the answer:

       Do you have a place?
         yes → the room/seat flow      (supply for "Move in now")
         no  → just me / we're a group (supply for "Team up")

   The fork deliberately mirrors the two browse tabs, so posting and browsing
   finally share one mental model. */

const Choice = ({ icon, title, desc, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full text-left rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-start gap-3 hover:border-teal-400/40 hover:bg-teal-500/[0.07] transition-all min-h-[44px]"
  >
    <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center shrink-0"><Icon name={icon} className="w-5 h-5 text-teal-400" /></div>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
    </div>
    <Icon name="chevron-right" className="w-4 h-4 text-gray-500 ml-auto mt-3 shrink-0" />
  </button>
);

export default function PostChooser({ onClose, onHasPlace, onSolo, onGroup }) {
  const { t } = useTranslation();
  // 'place' asks the one classifying question; 'who' only appears for people who
  // don't have a home yet, where the remaining choice is solo vs an existing group.
  const [step, setStep] = useState('place');

  return (
    <div className="sf-modal" onClick={onClose}>
      <div className="glass rounded-3xl w-full max-w-md p-6 sm:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center"><Icon name="plus" className="w-5 h-5 text-teal-400" /></div>
            <div>
              <h2 className="text-white font-bold text-lg leading-tight">{step === 'place' ? t('flatmates.chooserTitle') : t('flatmates.chooserWhoTitle')}</h2>
              <p className="text-xs text-gray-400 mt-0.5">{step === 'place' ? t('flatmates.chooserSubtitle') : t('flatmates.chooserWhoSubtitle')}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={t('flatmates.chooserClose')} className="btn-ghost w-9 h-9 rounded-xl inline-flex items-center justify-center text-gray-400 shrink-0"><Icon name="x" className="w-4 h-4" /></button>
        </div>

        {step === 'place' ? (
          <div className="space-y-2.5">
            <Choice icon="door-open" title={t('flatmates.chooserHasPlaceTitle')} desc={t('flatmates.chooserHasPlaceDesc')} onClick={onHasPlace} />
            <Choice icon="users-round" title={t('flatmates.chooserNoPlaceTitle')} desc={t('flatmates.chooserNoPlaceDesc')} onClick={() => setStep('who')} />
          </div>
        ) : (
          <>
            <div className="space-y-2.5">
              <Choice icon="user-search" title={t('flatmates.chooserSoloTitle')} desc={t('flatmates.chooserSoloDesc')} onClick={onSolo} />
              <Choice icon="users" title={t('flatmates.chooserGroupTitle')} desc={t('flatmates.chooserGroupDesc')} onClick={onGroup} />
            </div>
            <button type="button" onClick={() => setStep('place')} className="mt-4 btn-ghost h-9 inline-flex items-center gap-1.5 px-3.5 rounded-full text-gray-300 text-xs font-medium">
              <Icon name="arrow-left" className="w-3.5 h-3.5" /> {t('flatmates.chooserBack')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
