import { useTranslation } from 'react-i18next';
import Icon from '../../../components/Icon.jsx';
import NativeSelect from '../../../components/ui/NativeSelect.jsx';
import MultiSelect from '../../../components/ui/MultiSelect.jsx';
import LocalitySelect from '../../../components/ui/LocalitySelect.jsx';
import DateField from '../../../components/ui/DateField.jsx';
import AutosaveBanner from '../../../components/AutosaveBanner.jsx';
import FieldError from '../../../components/ui/FieldError.jsx';
import { LOCALITIES, TAGS } from './constants.js';

// A move-in value is either 'now' (immediate) or an ISO date from the picker —
// only the latter contains a '-'. Mirrors the FilterBar control.
const isDateVal = (v) => typeof v === 'string' && v.includes('-');
// Local-time today as ISO, so the picker never offers a past move-in date.
const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function PostModal({ setPostOpen, submitPost, postFormRef, postDraft, post, setPost, postErr, editingId, seg }) {
  const { t: tr } = useTranslation();
  return (
    <div className="sf-modal" onClick={() => setPostOpen(false)}>
      <div className="glass rounded-3xl w-full max-w-xl p-6 sm:p-7" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-5">
          <div><h2 className="text-xl font-bold text-white">{tr('shareFlat.postModalTitle')}</h2><p className="text-gray-400 text-xs mt-1">{tr('shareFlat.postModalSubtitle')}</p></div>
          <button onClick={() => setPostOpen(false)} className="p-2 rounded-xl hover:bg-white/5 text-gray-400 hover:text-white"><Icon name="x" className="w-5 h-5" /></button>
        </div>
        <form onSubmit={submitPost} className="space-y-4" ref={postFormRef}>
          <AutosaveBanner restored={postDraft.restored} onStartFresh={postDraft.startFresh} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.nameLabel')} <span className="text-rose-400">*</span></label><input value={post.name} onChange={(e) => { setPost({ ...post, name: e.target.value }); postErr.clear('name'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + postErr.cx('name')} data-err="name" placeholder={tr('shareFlat.namePlaceholder')} /><FieldError show={postErr.has('name')}>{postErr.msg('name')}</FieldError></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.iAmA')} <span className="text-rose-400">*</span></label><NativeSelect value={post.gender} onChange={(e) => setPost({ ...post, gender: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="female">{tr('shareFlat.optWoman')}</option><option value="male">{tr('shareFlat.optMan')}</option><option value="any">{tr('shareFlat.optPreferNotSay')}</option></NativeSelect></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.age')}</label><input type="number" value={post.age} onChange={(e) => setPost({ ...post, age: e.target.value })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('shareFlat.agePlaceholder')} /></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.occupation')}</label><input value={post.occupation} onChange={(e) => setPost({ ...post, occupation: e.target.value })} className="field w-full rounded-xl px-3.5 py-2.5 text-sm" placeholder={tr('shareFlat.occupationPlaceholder')} /></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.budgetShareLabel')} <span className="text-rose-400">*</span></label><input type="number" min="1" value={post.budget} onChange={(e) => { setPost({ ...post, budget: e.target.value }); postErr.clear('budget'); }} className={'field w-full rounded-xl px-3.5 py-2.5 text-sm' + postErr.cx('budget')} data-err="budget" placeholder={tr('shareFlat.budgetPlaceholder')} /><FieldError show={postErr.has('budget')}>{postErr.msg('budget')}</FieldError></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.moveIn')}</label><div className="flex items-center gap-2"><button type="button" onClick={() => setPost({ ...post, moveIn: 'now' })} aria-pressed={post.moveIn === 'now'} className={seg(post.moveIn === 'now') + ' shrink-0'}>{tr('shareFlat.immediate')}</button><DateField value={isDateVal(post.moveIn) ? post.moveIn : ''} min={todayIso()} onChange={(iso) => setPost({ ...post, moveIn: iso })} className="field rounded-full px-4 h-10 text-sm flex-1 min-w-0" ariaLabel={tr('shareFlat.ariaMoveInDate')} placeholder={tr('shareFlat.byDate')} /></div></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.lookingToShareWith')}</label><NativeSelect value={post.flatPref} onChange={(e) => setPost({ ...post, flatPref: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="any">{tr('shareFlat.optAnyone')}</option><option value="women">{tr('shareFlat.optWomenOnly')}</option><option value="men">{tr('shareFlat.optMenOnly')}</option></NativeSelect></div>
            <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.roomPreference')}</label><NativeSelect value={post.roomPref} onChange={(e) => setPost({ ...post, roomPref: e.target.value })} className="field w-full rounded-full px-4 py-2 text-sm"><option value="any">{tr('shareFlat.optNoPreference')}</option><option value="private">{tr('shareFlat.optPrivateRoom')}</option><option value="shared">{tr('shareFlat.optSharedRoom')}</option></NativeSelect></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.preferredLocalities')} <span className="text-rose-400">*</span> <span className="text-gray-600">{tr('shareFlat.upTo5')}</span></label>
              <LocalitySelect
                multi
                values={post.localities}
                onChange={(arr) => { if (arr.length <= 5) { setPost({ ...post, localities: arr }); postErr.clear('localities'); } }}
                options={LOCALITIES}
                placeholder={tr('shareFlat.addLocalities')}
                invalid={postErr.has('localities')}
                dataErr="localities"
                ariaLabel={tr('shareFlat.preferredLocalities')}
              />
              <FieldError show={postErr.has('localities')}>{postErr.msg('localities')}</FieldError>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.lifestyle')} <span className="text-gray-600">{tr('shareFlat.optional')}</span></label>
              <MultiSelect
                values={post.tags}
                onChange={(arr) => setPost({ ...post, tags: arr })}
                options={TAGS}
                placeholder={tr('shareFlat.addLifestyle')}
                ariaLabel={tr('shareFlat.lifestylePreferences')}
              />
              {post.tags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {post.tags.map((t) => (
                    <button key={t} type="button" onClick={() => setPost({ ...post, tags: post.tags.filter((x) => x !== t) })} className="pick active inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs" aria-label={tr('shareFlat.ariaRemoveTag', { tag: t })}>
                      {t} <Icon name="x" className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div><label className="block text-xs font-medium text-gray-400 mb-1.5">{tr('shareFlat.shortNote')} <span className="text-gray-600">{tr('shareFlat.optional')}</span></label><textarea value={post.note} onChange={(e) => setPost({ ...post, note: e.target.value })} rows={2} className="field w-full rounded-xl px-3.5 py-2.5 text-sm resize-none" placeholder={tr('shareFlat.notePlaceholder')} /></div>
          <label className="flex items-center gap-2.5 text-xs text-gray-300 cursor-pointer select-none rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
            <input type="checkbox" checked={post.verifiedContactOnly} onChange={(e) => setPost({ ...post, verifiedContactOnly: e.target.checked })} className="w-4 h-4 accent-teal-500" />
            <span className="inline-flex items-center gap-1.5"><Icon name="shield-check" className="w-3.5 h-3.5 text-teal-400" /> {tr('shareFlat.verifiedContactPre')} <span className="text-teal-300 font-semibold">{tr('shareFlat.verifiedSeekersTerm')}</span> {tr('shareFlat.verifiedContactSuf')}</span>
          </label>
          <div className="flex items-center justify-end gap-3 pt-1">
            <button type="button" onClick={() => setPostOpen(false)} className="btn-ghost text-sm font-medium text-gray-300 px-5 py-2.5 rounded-xl">{tr('shareFlat.cancel')}</button>
            <button type="submit" className="btn-teal text-sm font-semibold text-white px-6 py-2.5 rounded-xl inline-flex items-center gap-2"><Icon name="send" className="w-4 h-4" /> {editingId ? tr('shareFlat.updateRequest') : tr('shareFlat.postRequestBtn')}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
