import Icon from '../../../components/Icon.jsx';
import Modal from '../../../components/ui/Modal.jsx';
import { useTranslation } from 'react-i18next';
import { getCatLabel, getCatIcon, getPrioLabel, getStatusLabel, fmtTime } from '../../../lib/data/support.js';
import { STATUS_CHIP } from './constants.js';

export default function TicketThreadModal({
  threadOpen,
  closeThread,
  curTicket,
  setLightboxImg,
  replyImgs,
  setReplyImgs,
  removeImg,
  replyFilesRef,
  handleFiles,
  replyText,
  setReplyText,
  sendReply,
  fld,
}) {
  const { t } = useTranslation();
  return (
    <Modal open={threadOpen} onClose={closeThread} title={curTicket?.subject || t('misc.ttmTicket')} size="lg">
      {curTicket && (
        <div className="flex flex-col" style={{ maxHeight: '70vh' }}>
          {/* Meta */}
          <div className="flex flex-wrap items-center gap-1.5 mb-4 text-[11px]">
            <span className="text-gray-500 font-mono">{curTicket.id}</span>
            <span className={'inline-flex items-center rounded-full border px-2 py-0.5 font-medium ' + (STATUS_CHIP[curTicket.status] || STATUS_CHIP.new)}>
              {getStatusLabel(curTicket.status)}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-white/6 text-gray-300 px-2 py-0.5">
              <Icon name={getCatIcon(curTicket.category)} className="w-3 h-3" />
              {getCatLabel(curTicket.category)}
            </span>
            {(curTicket.priority === 'urgent' || curTicket.priority === 'high') && (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-400/30 bg-red-500/10 px-2 py-0.5 text-red-300">
                <Icon name="flame" className="w-3 h-3" />
                {getPrioLabel(curTicket.priority)}
              </span>
            )}
            {curTicket.assignedTo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/6 text-gray-300 px-2 py-0.5">
                <Icon name="user-check" className="w-3 h-3" />
                {curTicket.assignedTo}
              </span>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto mb-4 space-y-3" style={{ minHeight: 200 }}>
            {curTicket.messages.map((m) => {
              if (m.system) {
                return (
                  <div key={m.id} className="flex justify-center">
                    <span className="text-[11px] text-gray-500 bg-white/5 px-3 py-1 rounded-full">{m.text}</span>
                  </div>
                );
              }
              const mine = m.by === 'customer';
              return (
                <div key={m.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
                  <div
                    className={
                      'max-w-[84%] px-3 py-2.5 rounded-2xl text-sm ' +
                      (mine
                        ? 'bg-gradient-to-r from-teal-600 to-teal-500 text-white rounded-br-sm'
                        : 'bg-white/8 border border-white/12 text-gray-200 rounded-bl-sm')
                    }
                  >
                    {m.text && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.text}</p>}
                    {m.images && m.images.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {m.images.map((im, idx) => (
                          <img
                            key={idx}
                            src={im.data}
                            alt=""
                            onClick={() => setLightboxImg(im.data)}
                            className="w-21 h-21 object-cover rounded-lg border border-white/12 cursor-zoom-in"
                          />
                        ))}
                      </div>
                    )}
                    <div className="text-[10.5px] opacity-80 mt-1 flex items-center gap-1.5">
                      <span>{mine ? t('misc.ttmYou') : m.name || t('misc.ttmSupport')}</span> · <span>{fmtTime(m.at)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reply */}
          {(curTicket.status === 'resolved' || curTicket.status === 'closed') && (
            <p className="text-[11px] text-gray-500 text-center mb-2">{t('misc.ttmResolvedNote')}</p>
          )}
          {replyImgs.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {replyImgs.map((im, i) => (
                <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-white/10 flex-shrink-0">
                  <img src={im.data} alt="" className="w-full h-full object-cover" />
                  <button
                    onClick={() => removeImg(replyImgs, setReplyImgs, i)}
                    className="absolute top-0.5 right-0.5 w-[18px] h-[18px] rounded-full bg-ink/80 flex items-center justify-center text-white hover:bg-red-500"
                  >
                    <Icon name="x" className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button
              onClick={() => replyFilesRef.current?.click()}
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-gray-300 flex-shrink-0"
              title={t('misc.ttmAttachImage')}
            >
              <Icon name="paperclip" className="w-4 h-4" />
            </button>
            <input
              ref={replyFilesRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleFiles(e.target.files, replyImgs, setReplyImgs);
                e.target.value = '';
              }}
            />
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  sendReply();
                }
              }}
              rows={1}
              placeholder={t('misc.ttmReplyPlaceholder')}
              className={fld + ' flex-1 resize-none'}
            />
            <button
              onClick={sendReply}
              className="btn-teal h-10 px-4 rounded-xl text-white text-sm font-semibold flex items-center gap-1.5 flex-shrink-0"
            >
              <Icon name="send" className="w-4 h-4" />
              <span className="hidden sm:inline">{t('misc.ttmSend')}</span>
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
