import { Trans, useTranslation } from 'react-i18next';
import Icon from '../../../../components/Icon.jsx';
import { CONTRIB_META, CONTRIB_FILTERS, prettyDate, timeAgo } from '../constants.js';
import { MonthCalendar } from '../helpers.jsx';

export default function CommunityTab({ ctx }) {
  const { t, i18n } = useTranslation();
  /* timeAgo returns { key, count } rather than a formatted string, so every
     relative timestamp on this page is rendered in the reader's language. */
  const ago = (ts) => { const r = timeAgo(ts); return t(r.key, { count: r.count }); };
  const {
    iAmResidentOrAdmin, openBoard, calMonth, setCalMonth, eventDots, calDay, setCalDay,
    dayEvents, myMob, iAmAdmin, openReport, onRemoveBoard, boardNotices,
    contribCounts, openContribute, contribFilter, setContribFilter, shownContribs,
    onRemoveContribution, openReply, replyFor, replyText, setReplyText, submitReply,
    onHelpful, onRemoveReply, inp,
  } = ctx;
  return (
            <>
            {/* Events & notices — resident/committee-gated society board */}
            <section className="reveal">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-lg font-bold flex items-center gap-2"><Icon name="calendar" className="w-5 h-5 text-teal-400" /> {t('society.eventsNoticesTitle')}</h2>
                {iAmResidentOrAdmin ? (
                  <div className="flex gap-2">
                    <button onClick={() => openBoard('event')} className="btn-outline !h-9 !px-3 text-sm"><Icon name="plus" className="w-4 h-4 mr-1.5" /> {t('society.boardAddEvent')}</button>
                    <button onClick={() => openBoard('notice')} className="btn-outline !h-9 !px-3 text-sm"><Icon name="megaphone" className="w-4 h-4 mr-1.5" /> {t('society.boardAddNotice')}</button>
                  </div>
                ) : null}
              </div>
              <p className="text-sm text-gray-400 mb-3">{t('society.eventsNoticesSub')} {iAmResidentOrAdmin ? t('society.canPostAsResident') : <span className="text-slate-500">{t('society.onlyResidentsPost')}</span>}</p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <MonthCalendar month={calMonth} onMonth={setCalMonth} events={eventDots} selected={calDay} onSelect={setCalDay} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Icon name="calendar" className="w-4 h-4 text-brand-teal-3" /> {prettyDate(calDay, i18n.language) || t('society.selectedDay')}</h3>
                  {dayEvents.length ? (
                    <div className="space-y-2">
                      {dayEvents.map((e) => {
                        const canDel = (e.mobile && e.mobile === myMob) || iAmAdmin;
                        return (
                          <div key={e.id} className="glass rounded-xl p-3">
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-semibold text-brand-teal-3 inline-flex items-center gap-1.5"><Icon name="calendar" className="w-3.5 h-3.5" /> {e.time || t('society.allDay')}{e.category ? <span className="text-gray-500 font-normal">· {e.category}</span> : null}</span>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <button onClick={() => openReport({ targetType: 'board', targetId: e.id, snapshot: e.title })} aria-label={t('society.reportEvent')} className="text-gray-500 hover:text-amber-300"><Icon name="flag" className="w-3.5 h-3.5" /></button>
                                {canDel ? <button onClick={() => onRemoveBoard(e.id)} aria-label={t('society.removeEvent')} className="text-gray-500 hover:text-red-300"><Icon name="trash-2" className="w-3.5 h-3.5" /></button> : null}
                              </div>
                            </div>
                            <p className="text-sm font-medium text-white mt-1">{e.title}</p>
                            {e.body ? <p className="text-sm text-gray-400 mt-0.5">{e.body}</p> : null}
                            <p className="text-[11px] text-slate-500 mt-1">{t('society.byUser', { user: e.user })}</p>
                          </div>
                        );
                      })}
                    </div>
                  ) : <p className="text-gray-500 text-sm glass rounded-xl p-4">{t('society.noEventsDay')}{iAmResidentOrAdmin ? t('society.addEventHint') : t('society.pickAnotherDay')}</p>}
                </div>
              </div>

              {boardNotices.length ? (
                <div className="mt-4">
                  <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-1.5"><Icon name="megaphone" className="w-4 h-4 text-brand-teal-3" /> {t('society.noticesTitle')}</h3>
                  <div className="space-y-2">
                    {boardNotices.map((n) => {
                      const canDel = (n.mobile && n.mobile === myMob) || iAmAdmin;
                      return (
                        <div key={n.id} className="glass rounded-xl p-3">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-sm font-medium text-white flex items-start gap-2"><Icon name="megaphone" className="w-4 h-4 text-brand-teal-3 mt-0.5 flex-shrink-0" /> {n.title}{n.category ? <span className="text-gray-500 font-normal text-xs mt-0.5">· {n.category}</span> : null}</p>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <button onClick={() => openReport({ targetType: 'board', targetId: n.id, snapshot: n.title })} aria-label={t('society.reportNotice')} className="text-gray-500 hover:text-amber-300"><Icon name="flag" className="w-3.5 h-3.5" /></button>
                              {canDel ? <button onClick={() => onRemoveBoard(n.id)} aria-label={t('society.removeNotice')} className="text-gray-500 hover:text-red-300"><Icon name="trash-2" className="w-3.5 h-3.5" /></button> : null}
                            </div>
                          </div>
                          {n.body ? <p className="text-sm text-gray-400 mt-0.5 ml-6">{n.body}</p> : null}
                          <p className="text-[11px] text-slate-500 mt-1 ml-6">{t('society.byUser', { user: n.user })}{n.resident ? ` · ${t('society.residentBadge')}` : ''} · {ago(n.at)}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </section>

            {/* Community insights — resident contributions (sign-in only) */}
            <section className="reveal">
              <div className="flex items-center justify-between gap-3 mb-1">
                <h2 className="text-lg font-bold flex items-center gap-2"><Icon name="users" className="w-5 h-5 text-teal-400" /> {t('society.insightsTitle')}</h2>
                {contribCounts.all > 0 ? <span className="text-xs text-gray-500">{t('society.sharedCount', { count: contribCounts.all })}</span> : null}
              </div>
              <p className="text-sm text-gray-400 mb-3"><Trans i18nKey="society.insightsSub" components={{ 1: <b className="text-teal-300" /> }} /></p>

              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries(CONTRIB_META).map(([kind, m]) => (
                  <button key={kind} onClick={() => openContribute(kind)} className="btn-outline !h-9 !px-3 text-sm"><Icon name={m.icon} className="w-4 h-4 mr-1.5" /> {t(m.addKey)}</button>
                ))}
              </div>

              {contribCounts.all > 0 ? (
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {CONTRIB_FILTERS.map(([key, labelKey]) => {
                    const n = key === 'all' ? contribCounts.all : contribCounts[key];
                    const on = contribFilter === key;
                    return (
                      <button key={key} onClick={() => setContribFilter(key)} className={`rounded-full px-3 py-1 text-xs font-medium border transition ${on ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}>{t(labelKey)}{n ? ` (${n})` : ''}</button>
                    );
                  })}
                </div>
              ) : null}

              {shownContribs.length ? (
                <div className="space-y-3">
                  {shownContribs.map((c) => {
                    const m = CONTRIB_META[c.kind] || CONTRIB_META.tip;
                    const canRemove = (c.mobile && c.mobile === myMob) || iAmAdmin;
                    const helpfulOn = (c.helpful || []).includes(myMob);
                    const helpfulN = (c.helpful || []).length;
                    const rawPhoto = c.photo && (typeof c.photo === 'string' ? c.photo : c.photo.dataUrl);
                    const photoUrl = typeof rawPhoto === 'string' && rawPhoto.startsWith('data:image/') ? rawPhoto : null;
                    return (
                      <div key={c.id} className="glass rounded-xl p-4">
                        <div className="flex items-start justify-between gap-2 mb-1.5">
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-teal-3"><Icon name={m.icon} className="w-4 h-4" /> {t(m.labelKey)}{c.category ? <span className="text-gray-500 font-normal">· {c.category}</span> : null}</span>
                          {canRemove ? <button onClick={() => onRemoveContribution(c.id)} aria-label={t('society.removeContribution')} className="text-gray-500 hover:text-red-300 transition-colors flex-shrink-0"><Icon name="trash-2" className="w-3.5 h-3.5" /></button> : null}
                        </div>
                        {c.kind === 'photo' && photoUrl ? <img src={photoUrl} alt={c.caption || t('society.societyPhoto')} className="rounded-lg w-full max-h-72 object-cover mb-2" /> : null}
                        {c.kind === 'pick' ? <p className="text-sm text-white font-medium">{c.name}{c.contact ? <a href={`tel:${c.contact}`} className="ml-2 text-xs font-normal text-brand-teal-3 inline-flex items-center gap-1"><Icon name="phone" className="w-3 h-3" /> {c.contact}</a> : null}</p> : null}
                        {c.kind === 'tip' && c.text ? <p className="text-sm text-gray-300">{c.text}</p> : null}
                        {c.kind === 'pick' && c.note ? <p className="text-sm text-gray-400 mt-0.5">{c.note}</p> : null}
                        {c.kind === 'photo' && c.caption ? <p className="text-sm text-gray-300">{c.caption}</p> : null}
                        <div className="flex items-center justify-between gap-2 mt-2.5">
                          <span className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap">
                            {c.user}
                            {c.resident
                              ? <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-bold text-violet-300"><Icon name="badge-check" className="w-3 h-3" /> {t('society.residentBadge')}</span>
                              : <span className="inline-flex items-center gap-1 rounded-full bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-bold text-teal-300"><Icon name="user-check" className="w-3 h-3" /> {t('society.verifiedBadge')}</span>}
                            · {ago(c.at)}
                          </span>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => openReply(c.id)} className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium border border-white/10 text-gray-400 hover:border-white/25 transition"><Icon name="message-circle" className="w-3.5 h-3.5" /> {t('society.reply')}{(c.replies || []).length ? ` (${c.replies.length})` : ''}</button>
                            <button onClick={() => openReport({ targetType: 'contribution', targetId: c.id, snapshot: c.text || c.name || c.caption || c.kind })} aria-label={t('society.reportContribution')} title={t('society.reportContribution')} className="text-gray-500 hover:text-amber-300 transition-colors"><Icon name="flag" className="w-3.5 h-3.5" /></button>
                            <button onClick={() => onHelpful(c.id)} aria-pressed={helpfulOn} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border transition ${helpfulOn ? 'border-brand-teal bg-brand-teal/15 text-white' : 'border-white/10 text-gray-400 hover:border-white/25'}`}><Icon name="hand-heart" className="w-3.5 h-3.5" /> {t('society.helpful')}{helpfulN ? ` (${helpfulN})` : ''}</button>
                          </div>
                        </div>
                        {(c.replies && c.replies.length) || replyFor === c.id ? (
                          <div className="mt-3 ml-3 pl-3 border-l border-white/10 space-y-2">
                            {(c.replies || []).map((r) => {
                              const canDelR = (r.mobile && r.mobile === myMob) || iAmAdmin;
                              return (
                                <div key={r.id} className="text-sm">
                                  <p className="text-gray-300">{r.text}</p>
                                  <span className="text-[11px] text-slate-500 flex items-center gap-1.5 flex-wrap mt-0.5">
                                    {r.user}
                                    {r.resident
                                      ? <span className="inline-flex items-center gap-0.5 text-violet-400 font-semibold"><Icon name="badge-check" className="w-3 h-3" /> {t('society.residentBadge')}</span>
                                      : <span className="inline-flex items-center gap-0.5 text-teal-400 font-semibold"><Icon name="user-check" className="w-3 h-3" /> {t('society.verifiedBadge')}</span>}
                                    · {ago(r.at)}
                                    <button onClick={() => openReport({ targetType: 'reply', targetId: r.id, parentId: c.id, snapshot: r.text })} aria-label={t('society.reportReply')} className="text-slate-600 hover:text-amber-300"><Icon name="flag" className="w-3 h-3" /></button>
                                    {canDelR ? <button onClick={() => onRemoveReply(c.id, r.id)} aria-label={t('society.removeReply')} className="text-slate-600 hover:text-red-300"><Icon name="trash-2" className="w-3 h-3" /></button> : null}
                                  </span>
                                </div>
                              );
                            })}
                            {replyFor === c.id ? (
                              <div className="flex gap-2 pt-1">
                                <input value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submitReply(c.id)} placeholder={t('society.replyPlaceholder')} className={inp} />
                                <button onClick={() => submitReply(c.id)} className="btn-teal flex-shrink-0">{t('society.post')}</button>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="glass rounded-xl p-6 text-center">
                  <span className="w-11 h-11 rounded-xl bg-brand-teal/10 flex items-center justify-center mx-auto mb-2"><Icon name="users" className="w-5 h-5 text-brand-teal-3" /></span>
                  <p className="text-sm text-gray-300 font-medium">{contribCounts.all ? t('society.emptyFilter') : t('society.emptyContribs')}</p>
                  <p className="text-xs text-gray-500 mt-1">{t('society.emptyContribsSub')}</p>
                </div>
              )}
            </section>

            </>
  );
}
