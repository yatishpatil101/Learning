import { Link } from 'react-router';
import Icon from '../../../components/Icon.jsx';
import HScroll from '../../../components/ui/HScroll.jsx';
import ServiceTracker from '../../../components/ServiceTracker.jsx';
import '../../../styles/routes/rent-agreement.css';
import { invitePath } from '../../../lib/serviceFlow.js';
import { STEP_LABELS } from './rent-agreement/constants.js';
import Hero from './rent-agreement/Hero.jsx';
import DocsRequired from './rent-agreement/DocsRequired.jsx';
import InfoSections from './rent-agreement/InfoSections.jsx';
import StepProperty from './rent-agreement/StepProperty.jsx';
import StepOwner from './rent-agreement/StepOwner.jsx';
import StepTenant from './rent-agreement/StepTenant.jsx';
import StepTerms from './rent-agreement/StepTerms.jsx';
import StepWitnesses from './rent-agreement/StepWitnesses.jsx';
import StepReview from './rent-agreement/StepReview.jsx';
import CostSidebar, { MobileCostSummary } from './rent-agreement/CostSidebar.jsx';
import { useRentAgreement } from './rent-agreement/useRentAgreement.js';

export default function RentAgreement() {
  const ctx = useRentAgreement();
  const {
    rootRef, formRef, tr, isIn, user, navigate,
    step, errors, done, openFaq, setOpenFaq,
    mode, inviteError, inviteResult, copied,
    withdrawInvite, withdrawing,
    aType, setAType, prop, setP, setProp, setShowPropertyPicker, myProperties,
    owner, setO, ownerDocs, setOwnerDocs, vaultEnabled, saveOwnerDocToVault,
    tenantMode, setTenantMode, tenants, setTenant, addTenant, removeTenant, tenantDocs, setTenantDocs, invite, setInvite,
    terms, setT, maint, setMaint, regArea, setRegArea, furnItems, custom, setCustom, clauses, setClauses,
    isChecked, toggleFurn, bumpQty, removeFurn, addCustom, furnitureText,
    wit, setWit,
    declare, setDeclare, generate, submitting, paymentPending, paymentConfirming,
    clearErr, fc, cost, locked, startNewAgreement, restored, startFresh, myInvites,
    copyInviteLink, next, prev,
  } = ctx;

  return (
    <div ref={rootRef} className="ra-page">
      <div>
        <Hero />

        {/* Active requests tracker */}
        <ServiceTracker typeFilter="rental" title={tr('services.ra.trackerTitle')} sampleName={isIn ? user?.name : undefined} />

        {/* Form + Summary */}
        <section ref={formRef} className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 section-y">
          <div className={`grid grid-cols-1 gap-6${locked ? '' : ' lg:grid-cols-[1fr_340px]'}`}>
            {/* Wizard */}
            <div className="glass-card rounded-2xl p-6 sm:p-8">
              {inviteError ? (
                <div className="p-6 rounded-xl bg-amber-500/8 border border-amber-500/25 text-center">
                  <Icon name="alert-triangle" className="w-10 h-10 text-amber-300 mx-auto mb-3" />
                  <p className="text-white font-semibold">{tr(`services.ra.inviteErr.${inviteError.kind}.title`)}</p>
                  <p className="text-gray-400 text-sm mt-1.5 leading-relaxed max-w-md mx-auto">{tr(`services.ra.inviteErr.${inviteError.kind}.desc`, { mobile: inviteError.toMobile ? '••••' + String(inviteError.toMobile).slice(-4) : '' })}</p>
                  <button type="button" onClick={() => navigate('/services/rent-agreement')} className="btn-teal mt-5 px-6 py-3 rounded-xl text-white text-sm font-semibold inline-flex items-center gap-2"><Icon name="file-signature" className="w-4 h-4" /> {tr('services.ra.inviteErr.startOwn')}</button>
                </div>
              ) : (
              <>
              {/* Progress */}
              {!locked && (
              <HScroll wrapClassName="mb-8" className="flex items-center pb-2" fadeColor="#1b1926">
                {STEP_LABELS.map((s, i) => {
                  // In invite mode the Tenant step (index 2) stays PENDING — the owner
                  // hasn't filled it; the tenant will. Never mark it done/checked.
                  const tenantAwaiting = mode === 'owner' && tenantMode === 'invite';
                  const st = i === step ? 'active' : (tenantAwaiting && i === 2 ? 'pending' : (i < step ? 'done' : ''));
                  return (
                  <div key={s} className={'flex items-start ' + (i < STEP_LABELS.length - 1 ? 'flex-1' : '')}>
                    <div className="flex flex-col items-center flex-shrink-0">
                      <div className={'step-dot w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold ' + st}>{st === 'done' ? <Icon name="check" className="w-4 h-4" /> : st === 'pending' ? <Icon name="clock" className="w-4 h-4" /> : i + 1}</div>
                      <span className={'text-[10px] mt-1.5 whitespace-nowrap ' + (st === 'active' ? 'text-teal-400' : st === 'pending' ? 'text-amber-400' : 'text-gray-500')}>{tr(`services.ra.stepLabel.${i}`)}</span>
                    </div>
                    {i < STEP_LABELS.length - 1 && <div className={'step-line flex-1 h-0.5 mx-2 mt-[17px] ' + (i < step ? 'done' : '')} />}
                  </div>
                  );
                })}
              </HScroll>
              )}

              {done ? (
                <div className="space-y-4">
                  {/* The checkout modal resolves on close, not on payment, and the webhook that
                      settles it arrives afterwards. This panel is only reached once the poll has
                      spent its whole budget still seeing `awaiting_payment` — so it says we could
                      not confirm the payment, not that it failed. Claiming failure here sends
                      someone whose money has already left their account to pay a second time. */}
                  {paymentPending ? (
                    <div className="p-6 rounded-xl bg-amber-500/10 text-center">
                      <Icon name="clock" className="w-10 h-10 text-amber-400 mx-auto mb-2" />
                      <p className="text-white font-semibold">{tr('services.ra.donePaymentPendingTitle')}</p>
                      <p className="text-gray-400 text-sm mt-1">{tr('services.ra.donePaymentPendingDesc')}</p>
                      <Link to="/dashboard#rental" className="btn-teal inline-flex items-center justify-center gap-2 px-5 py-3 mt-4 rounded-xl text-white text-sm font-semibold min-h-[44px]"><Icon name="credit-card" className="w-4 h-4" /> {tr('services.ra.donePaymentPendingCta')}</Link>
                    </div>
                  ) : (
                  <div className="p-6 rounded-xl bg-emerald-500/10 text-center">
                    <Icon name="check-circle-2" className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                    <p className="text-white font-semibold">{tenantMode === 'invite' ? tr('services.ra.doneInviteTitle') : tr('services.ra.doneOwnerTitle')}</p>
                    <p className="text-gray-400 text-sm mt-1">{tenantMode === 'invite' ? tr('services.ra.doneInviteDesc') : tr('services.ra.doneOwnerDesc')}</p>
                  </div>
                  )}
                  {tenantMode === 'invite' && inviteResult ? (
                    <div className="p-5 rounded-xl bg-white/[0.03]">
                      <p className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="message-circle" className="w-4 h-4 text-emerald-400" /> {tr('services.ra.invite.sendTitle')}</p>
                      <p className="text-gray-400 text-xs mt-1">{tr('services.ra.invite.sendDesc', { mobile: inviteResult.toMobile ? '••••' + inviteResult.toMobile.slice(-4) : '' })}</p>
                      {/* Two different waits, and they need different advice. A pending party is a
                          number nobody has signed up to yet, so the link cannot open until they
                          create an account; a non-pending one is a real account that has not
                          answered. Saying "resend it" to the first is useless advice. */}
                      {inviteResult.pending ? (
                        <p className="text-amber-200/90 text-[11px] mt-2 flex items-start gap-1.5"><Icon name="clock" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {tr('services.ra.invite.pendingSignup')}</p>
                      ) : (
                        <p className="text-gray-500 text-[11px] mt-2 flex items-start gap-1.5"><Icon name="clock" className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" /> {tr('services.ra.invite.awaitingReply')}</p>
                      )}
                      <div className="flex flex-col sm:flex-row gap-2 mt-3">
                        <a href={inviteResult.waLink} target="_blank" rel="noopener noreferrer" className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold min-h-[44px]"><Icon name="message-circle" className="w-4 h-4" /> {tr('services.ra.invite.sendWhatsapp')}</a>
                        <button type="button" onClick={copyInviteLink} className="btn-outline inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-gray-200 text-sm font-semibold min-h-[44px]"><Icon name={copied ? 'check' : 'copy'} className="w-4 h-4" /> {copied ? tr('services.ra.invite.copied') : tr('services.ra.invite.copyLink')}</button>
                      </div>
                      <p className="text-gray-600 text-[11px] mt-2.5 leading-relaxed">{tr('services.ra.invite.sendNote')}</p>
                      {inviteResult.partyId ? (
                        <button type="button" onClick={withdrawInvite} disabled={withdrawing} className="mt-3 text-gray-500 hover:text-gray-300 disabled:opacity-50 text-[11px] font-semibold underline underline-offset-2">
                          {withdrawing ? tr('services.ra.invite.withdrawing') : tr('services.ra.invite.withdraw')}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : paymentConfirming ? (
                /* For the few seconds between the modal closing and the webhook landing, a paid
                   agreement and an abandoned one are indistinguishable from the browser. Showing
                   either verdict in that window is a lie roughly half the time, so hold this
                   neutral panel until the poll actually knows which one it is. */
                <div className="p-6 rounded-xl bg-teal-500/10 text-center" role="status" aria-live="polite">
                  <Icon name="circle-notch" className="w-10 h-10 text-teal-300 mx-auto mb-2 animate-spin" />
                  <p className="text-white font-semibold">{tr('services.ra.donePaymentConfirmingTitle')}</p>
                  <p className="text-gray-400 text-sm mt-1">{tr('services.ra.donePaymentConfirmingDesc')}</p>
                </div>
              ) : locked ? (
                <div className="text-center py-4">
                  <div className="w-14 h-14 rounded-2xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mx-auto mb-4">
                    <Icon name="lock" className="w-7 h-7 text-teal-300" />
                  </div>
                  <h3 className="text-white font-bold text-lg">{tr('services.ra.locked.title')}</h3>
                  <p className="text-gray-400 text-sm mt-2 max-w-md mx-auto leading-relaxed">{tr('services.ra.locked.desc')}</p>
                  <div className="mt-5 p-4 rounded-xl bg-white/[0.03] border border-white/10 max-w-md mx-auto text-left flex items-start gap-3">
                    <Icon name="info" className="w-4 h-4 text-teal-300 mt-0.5 flex-shrink-0" />
                    <p className="text-gray-300 text-xs leading-relaxed">{tr('services.ra.locked.changesHint')}</p>
                  </div>
                  <button type="button" onClick={startNewAgreement} className="btn-outline mt-6 px-6 py-3 rounded-xl text-gray-200 text-sm font-semibold inline-flex items-center gap-2 min-h-[44px]">
                    <Icon name="plus" className="w-4 h-4" /> {tr('services.ra.locked.startNew')}
                  </button>
                  <p className="text-gray-600 text-[11px] mt-2">{tr('services.ra.locked.startNewHint')}</p>
                </div>
              ) : (
                <>
                  {/* Mobile-only cost summary (collapsible) — desktop uses the sidebar */}
                  <MobileCostSummary cost={cost} />

                  {/* Restored draft — pick up where you left off */}
                  {restored && mode === 'owner' && (
                    <div className="mb-6 p-3.5 rounded-xl bg-teal-500/8 border border-teal-500/20 flex items-center justify-between gap-3">
                      <div className="flex items-start gap-2.5">
                        <Icon name="rotate-ccw" className="w-4 h-4 text-teal-300 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-white font-semibold text-xs">{tr('services.ra.draft.restoredTitle')}</p>
                          <p className="text-gray-400 text-[11px] mt-0.5">{tr('services.ra.draft.restoredDesc')}</p>
                        </div>
                      </div>
                      <button type="button" onClick={startFresh} className="text-gray-400 hover:text-white text-[11px] font-semibold whitespace-nowrap underline underline-offset-2">{tr('services.ra.draft.startFresh')}</button>
                    </div>
                  )}

                  {/* Pending co-fill invites addressed to this signed-in user */}
                  {myInvites.length > 0 && mode === 'owner' && (
                    <div className="mb-6 p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/25">
                      <p className="text-white font-semibold text-sm flex items-center gap-2"><Icon name="user-plus" className="w-4 h-4 text-emerald-400" /> {tr('services.ra.pendingInvite.title', { count: myInvites.length })}</p>
                      <p className="text-gray-400 text-xs mt-1">{tr('services.ra.pendingInvite.desc')}</p>
                      <div className="mt-3 space-y-2">
                        {myInvites.map((inv) => (
                          <a key={inv.inviteId} href={inv.href || invitePath(inv.inviteId)} className="flex items-center justify-between gap-3 px-3.5 py-2.5 rounded-xl bg-white/4 border border-white/8 hover:border-emerald-400/30">
                            <span className="text-gray-200 text-xs">{tr('services.ra.pendingInvite.from', { name: inv.fromName || 'A PuneNest user' })}{inv.property ? ' · ' + inv.property : ''}</span>
                            <span className="text-emerald-300 text-xs font-semibold flex items-center gap-1 whitespace-nowrap">{tr('services.ra.pendingInvite.cta')} <Icon name="arrow-right" className="w-3.5 h-3.5" /></span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Invited tenant: they can view the whole agreement the owner set up,
                      but only their own Tenant step is editable. */}
                  {mode === 'invite' && (
                    step === 2 ? (
                      <div className="mb-6 p-3.5 rounded-xl bg-teal-500/8 border border-teal-500/20 flex items-start gap-2.5">
                        <Icon name="pencil" className="w-4 h-4 text-teal-300 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-white font-semibold text-xs">{tr('services.ra.invite.editableTitle')}</p>
                          <p className="text-gray-400 text-[11px] mt-0.5">{tr('services.ra.invite.editableDesc')}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="mb-6 p-3.5 rounded-xl bg-white/5 border border-white/10 flex items-start gap-2.5">
                        <Icon name="lock" className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-white font-semibold text-xs">{tr('services.ra.invite.readonlyTitle')}</p>
                          <p className="text-gray-400 text-[11px] mt-0.5">{tr('services.ra.invite.readonlyDesc')}</p>
                        </div>
                      </div>
                    )
                  )}

                  {/* Step 1: Property */}
                  <fieldset disabled={mode === 'invite'} className="contents">
                    <StepProperty step={step} aType={aType} setAType={setAType} prop={prop} setP={setP} setProp={setProp} setShowPropertyPicker={setShowPropertyPicker} myProperties={myProperties} errors={errors} fc={fc} clearErr={clearErr} />
                  </fieldset>

                  {/* Step 2: Owner */}
                  <fieldset disabled={mode === 'invite'} className="contents">
                    <StepOwner step={step} owner={owner} setO={setO} errors={errors} fc={fc} clearErr={clearErr} ownerDocs={ownerDocs} setOwnerDocs={setOwnerDocs} vaultEnabled={vaultEnabled} onDocSaved={saveOwnerDocToVault} />
                  </fieldset>

                  {/* Step 3: Tenant — the invited tenant's editable section */}
                  <StepTenant step={step} tenantMode={tenantMode} setTenantMode={setTenantMode} tenants={tenants} setTenant={setTenant} removeTenant={removeTenant} addTenant={addTenant} errors={errors} clearErr={clearErr} tenantDocs={tenantDocs} setTenantDocs={setTenantDocs} invite={invite} setInvite={setInvite} />

                  {/* Step 4: Terms */}
                  <fieldset disabled={mode === 'invite'} className="contents">
                    <StepTerms step={step} terms={terms} setT={setT} errors={errors} fc={fc} clearErr={clearErr} maint={maint} setMaint={setMaint} regArea={regArea} setRegArea={setRegArea} furnItems={furnItems} toggleFurn={toggleFurn} isChecked={isChecked} bumpQty={bumpQty} removeFurn={removeFurn} custom={custom} setCustom={setCustom} addCustom={addCustom} clauses={clauses} setClauses={setClauses} />
                  </fieldset>

                  {/* Step 5: Witnesses */}
                  <fieldset disabled={mode === 'invite'} className="contents">
                    <StepWitnesses step={step} wit={wit} setWit={setWit} />
                  </fieldset>

                  {/* Step 6: Review */}
                  <StepReview step={step} aType={aType} prop={prop} owner={owner} tenantMode={tenantMode} invite={invite} tenants={tenants} terms={terms} cost={cost} maint={maint} furnitureText={furnitureText} regArea={regArea} declare={declare} setDeclare={setDeclare} generate={generate} submitting={submitting} />

                  {/* Nav buttons — sticky at viewport bottom on mobile so step actions stay reachable */}
                  <div className="flex justify-between items-center gap-3 mt-8 sticky bottom-0 z-20 -mx-6 sm:-mx-8 px-6 sm:px-8 py-4 bg-[#12101f]/95 backdrop-blur border-t border-white/10 lg:static lg:mx-0 lg:px-0 lg:py-0 lg:bg-transparent lg:backdrop-blur-none lg:border-0">
                    {step !== 0 ? <button type="button" onClick={prev} className="btn-outline px-6 py-3 rounded-xl text-gray-300 text-sm font-semibold flex items-center gap-2"><Icon name="arrow-left" className="w-4 h-4" /> {tr('services.ra.back')}</button> : <div />}
                    {step !== 5 ? <button type="button" onClick={next} className="btn-teal px-7 py-3 rounded-xl text-white text-sm font-semibold flex items-center gap-2">{tr('services.ra.next')} <Icon name="arrow-right" className="w-4 h-4" /></button> : <div />}
                  </div>
                </>
              )}
              </>
              )}
            </div>

            {/* Summary sidebar — desktop only; mobile uses the collapsible summary inside the wizard */}
            {!locked && (
            <div className="hidden lg:block">
              <CostSidebar cost={cost} />
            </div>
            )}
          </div>
        </section>

        {/* Documents required */}
        <DocsRequired />

        <InfoSections openFaq={openFaq} setOpenFaq={setOpenFaq} />
      </div>
    </div>
  );
}
