import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from './Icon.jsx';
import Modal from './ui/Modal.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSignInGate } from '../lib/useSignInGate.js';

/* The one posting entry point for the whole consumer app — exactly one trigger per viewport,
   every branch navigates. See docs/flows/consumer/flatmates.md § One posting entry point. */

const Choice = ({ icon, title, desc, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-busy={disabled || undefined}
    className="w-full text-left rounded-2xl border border-white/10 bg-white/[0.03] p-4 flex items-center gap-3 hover:border-teal-400/40 hover:bg-teal-500/[0.07] transition-all min-h-[44px] disabled:opacity-60"
  >
    <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center shrink-0 self-start"><Icon name={icon} className="w-5 h-5 text-teal-400" /></div>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-white">{title}</p>
      <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
    </div>
    {/* Centred against the whole row, not nudged down by a fixed margin — the
        descriptions run to three lines in mr, which a magic offset cannot follow. */}
    <Icon name="chevron-right" className="w-4 h-4 text-gray-500 ml-auto shrink-0" />
  </button>
);

export default function PostChooser({ open, onClose }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const sendToSignIn = useSignInGate();
  const { isIn, loading } = useAuth();
  // 'what' asks the one classifying question; 'who' only appears for people who
  // have no place yet, where the remaining choice is solo vs an existing group.
  const [step, setStep] = useState('what');

  /* Every way out of the sheet resets the fork, so someone who backed out on the second
     question cannot reopen it mid-flow looking at an answer they were never asked for. */
  const close = () => { setStep('what'); onClose(); };

  const go = (to) => {
    close();
    /* `to`, not the page the sheet was opened from: the choice the visitor just made is where they
       were going, so that is where sign-in should return them. Every navigating choice is
       `disabled` while the session is still being read, so the gate's deferral branch is not
       reachable from here and there is nothing to re-enable on a `false` return. */
    if (!isIn) { sendToSignIn('listproperty', to); return; }
    navigate(to);
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={step === 'what' ? t('postChooser.title') : t('postChooser.whoTitle')}
    >
      <p className="text-xs text-gray-400 mb-4 leading-relaxed">
        {step === 'what' ? t('postChooser.subtitle') : t('postChooser.whoSubtitle')}
      </p>

      {step === 'what' ? (
        <div className="space-y-2.5">
          {/* Supply-first, and the same order on every route — a sheet that reshuffles itself
              by where it was opened has to be re-read each time. */}
          <Choice icon="building-2" title={t('postChooser.propertyTitle')} desc={t('postChooser.propertyDesc')} onClick={() => go('/list-property')} disabled={loading} />
          <Choice icon="door-open" title={t('postChooser.roomTitle')} desc={t('postChooser.roomDesc')} onClick={() => go('/list-property?flatmate=1')} disabled={loading} />
          <Choice icon="users-round" title={t('postChooser.lookingTitle')} desc={t('postChooser.lookingDesc')} onClick={() => setStep('who')} />
        </div>
      ) : (
        <>
          <div className="space-y-2.5">
            <Choice icon="user-search" title={t('postChooser.soloTitle')} desc={t('postChooser.soloDesc')} onClick={() => go('/flatmates?post=solo')} disabled={loading} />
            <Choice icon="users" title={t('postChooser.groupTitle')} desc={t('postChooser.groupDesc')} onClick={() => go('/flatmates?post=group')} disabled={loading} />
          </div>
          <button type="button" onClick={() => setStep('what')} className="mt-4 btn-ghost h-9 inline-flex items-center gap-1.5 px-3.5 rounded-full text-gray-300 text-xs font-medium">
            <Icon name="arrow-left" className="w-3.5 h-3.5" /> {t('postChooser.back')}
          </button>
        </>
      )}
    </Modal>
  );
}
