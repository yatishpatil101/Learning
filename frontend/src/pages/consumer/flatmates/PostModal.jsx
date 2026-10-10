import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import MultiSelect from '../../../components/ui/MultiSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import AutosaveBanner from '../../../components/AutosaveBanner.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import HeadlineField from '../../../components/ui/HeadlineField.jsx';
import AmountInput from './AmountInput.jsx';
import MoveInField from './MoveInField.jsx';
import { MAX_LOCALITIES, TAGS } from './constants.js';
import { seekerHeadline } from './helpers.js';
import useScrollLock from '../../../hooks/useScrollLock.js';
import useModalDialog from '../../../hooks/useModalDialog.js';

export default function PostModal({ setPostOpen, submitPost, postFormRef, postDraft, post, setPost, postErr, editingId }) {
  const [localityBusy, setLocalityBusy] = useState(false);
  const { t: tr } = useTranslation();
  /* Without the lock a thumb that reaches the end of this form goes on scrolling the results
   * behind it, so the sheet closes onto a board that has moved. */
  useScrollLock();
  const panelRef = useModalDialog(true, () => setPostOpen(false));
  return (
    <div className="sf-modal" onClick={() => setPostOpen(false)}>
      <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr('flatmates.postModalTitle')} className="dz-modal-panel border border-white/10 rounded-3xl w-full max-w-xl p-6 sm:p-7 outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div><h2 className="text-xl font-bold text-white">{tr('flatmates.postModalTitle')}</h2></div>
          <button onClick={() => setPostOpen(false)} aria-label={tr('common.close')} className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submitPost} className="space-y-4" ref={postFormRef}>
          <AutosaveBanner restored={postDraft.restored} onStartFresh={postDraft.startFresh} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.nameLabel')} <span className="text-rose-400">*</span></label><input value={post.name} onChange={(e) => { setPost({ ...post, name: e.target.value }); postErr.clear('name'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + postErr.cx('name')} data-err="name" placeholder={tr('flatmates.namePlaceholder')} /><FieldError show={postErr.has('name')}>{postErr.msg('name')}</FieldError></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.iAmA')} <span className="text-rose-400">*</span></label><NativeSelect value={post.gender} onChange={(e) => setPost({ ...post, gender: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="female">{tr('flatmates.optWoman')}</option><option value="male">{tr('flatmates.optMan')}</option><option value="any">{tr('flatmates.optPreferNotSay')}</option></NativeSelect></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.age')}</label><input type="number" value={post.age} onChange={(e) => setPost({ ...post, age: e.target.value })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('flatmates.agePlaceholder')} /></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.occupation')}</label><input value={post.occupation} onChange={(e) => setPost({ ...post, occupation: e.target.value })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('flatmates.occupationPlaceholder')} /></div>

            <div className="sm:col-span-2">
              <span className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.budgetShareLabel')} <span className="text-rose-400">*</span></span>
              <div className="grid grid-cols-2 gap-3">
                <div><AmountInput value={post.budget} onChange={(v) => { setPost({ ...post, budget: v }); postErr.clear('budget'); }} className={postErr.cx('budget')} data-err="budget" placeholder={tr('flatmates.rangeFrom')} aria-label={tr('flatmates.budgetMinAria')} aria-required="true" /><FieldError show={postErr.has('budget')}>{postErr.msg('budget')}</FieldError></div>
                <div><AmountInput value={post.budgetMax} onChange={(v) => { setPost({ ...post, budgetMax: v }); postErr.clear('budgetMax'); }} className={postErr.cx('budgetMax')} data-err="budgetMax" placeholder={tr('flatmates.rangeUpTo')} aria-label={tr('flatmates.budgetMaxAria')} /><FieldError show={postErr.has('budgetMax')}>{postErr.msg('budgetMax')}</FieldError></div>
              </div>
            </div>
            <div className="sm:col-span-2"><span className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.moveIn')}</span><MoveInField value={post.moveIn} onChange={(v) => setPost({ ...post, moveIn: v })} label={tr('flatmates.moveIn')} /></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.flatmatePrefWith')}</label><NativeSelect title={tr('flatmates.flatmatePrefWith')} value={post.flatPref} onChange={(e) => setPost({ ...post, flatPref: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="any">{tr('flatmates.optAnyone')}</option><option value="women">{tr('flatmates.optWomenOnly')}</option><option value="men">{tr('flatmates.optMenOnly')}</option></NativeSelect></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.roomPreference')}</label><NativeSelect title={tr('flatmates.roomPreference')} value={post.roomPref} onChange={(e) => setPost({ ...post, roomPref: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="any">{tr('flatmates.optNoPreference')}</option><option value="private">{tr('flatmates.optPrivateRoom')}</option><option value="shared">{tr('flatmates.optSharedRoom')}</option></NativeSelect></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.preferredLocalities')} <span className="text-rose-400">*</span> <span className="text-gray-600">{tr('flatmates.upToN', { count: MAX_LOCALITIES })}</span></label>
              <LocalitySelect
                multi
                autoClose
                values={post.localities}
                onChange={(arr) => { if (arr.length <= MAX_LOCALITIES) { setPost({ ...post, localities: arr }); postErr.clear('localities'); } }}
                placeholder={tr('flatmates.addLocalities')}
                invalid={postErr.has('localities')}
                dataErr="localities"
                ariaLabel={tr('flatmates.preferredLocalities')}
                onBusyChange={setLocalityBusy}
              />
              <FieldError show={postErr.has('localities')}>{postErr.msg('localities')}</FieldError>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.lifestyle')} <span className="text-gray-600">{tr('flatmates.optional')}</span></label>
              <MultiSelect
                values={post.tags}
                onChange={(arr) => setPost({ ...post, tags: arr })}
                options={TAGS}
                placeholder={tr('flatmates.addLifestyle')}
                ariaLabel={tr('flatmates.lifestylePreferences')}
              />
              {post.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {post.tags.map((t) => (
                    <button key={t} type="button" onClick={() => setPost({ ...post, tags: post.tags.filter((x) => x !== t) })} className="pick active inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs" aria-label={tr('flatmates.ariaRemoveTag', { tag: t })}>
                      {t} <Icon name="x" className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <HeadlineField
            value={post.title}
            onChange={(value) => { setPost({ ...post, title: value }); postErr.clear('title'); }}
            suggestion={seekerHeadline(post)}
            error={postErr.has('title') ? postErr.msg('title') : ''}
            labelClassName="block text-xs font-medium text-gray-400"
            inputClassName="field w-full rounded-xl px-3.5 py-2.5 text-sm"
          />
          <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('flatmates.shortNote')} <span className="text-gray-600">{tr('flatmates.optional')}</span></label><textarea value={post.note} onChange={(e) => setPost({ ...post, note: e.target.value })} rows={2} className="field w-full rounded-xl px-3.5 py-2.5 text-sm resize-none" placeholder={tr('flatmates.notePlaceholder')} /></div>
          <label className="flex items-start gap-2.5 text-xs leading-5 text-gray-300 cursor-pointer select-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
            <input type="checkbox" checked={post.verifiedContactOnly} onChange={(e) => setPost({ ...post, verifiedContactOnly: e.target.checked })} className="w-4 h-4 mt-0.5 shrink-0 accent-teal-500" />
            <Icon name="shield-check" className="w-3.5 h-3.5 mt-[3px] shrink-0 text-teal-400" />
            <span className="min-w-0">{tr('flatmates.verifiedContactPre')} <span className="text-teal-300 font-semibold">{tr('flatmates.verifiedSeekersTerm')}</span> {tr('flatmates.verifiedContactSuf')}</span>
          </label>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={() => setPostOpen(false)} className="btn-ghost text-sm font-medium text-gray-300 px-5 py-2.5 rounded-xl">{tr('flatmates.cancel')}</button>
            <button type="submit" disabled={localityBusy} className="btn-teal text-sm font-semibold text-white px-6 py-2.5 rounded-xl inline-flex items-center gap-2 disabled:opacity-70"><Icon name="send" className="w-4 h-4" /> {editingId ? tr('flatmates.updateRequest') : tr('flatmates.postRequestBtn')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
