import { useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { getFaqs } from '../../lib/mockApi.js';
import {
  MAX_IMAGES,
  ticketsForUser,
  getTicket,
  createTicket,
  replyToTicket,
  markTicketRead,
  compressFiles,
} from '../../lib/data/support.js';
import TicketForm from './support/TicketForm.jsx';
import TicketList from './support/TicketList.jsx';
import TicketThreadModal from './support/TicketThreadModal.jsx';
import FaqSection from './support/FaqSection.jsx';
import Lightbox from './support/Lightbox.jsx';
import ContactCard from './support/ContactCard.jsx';

export default function Support() {
  const { t: tr } = useTranslation();
  const rootRef = useScrollReveal();
  const { toast } = useToast();
  const { user } = useAuth();
  const [params] = useSearchParams();

  const [tickets, setTickets] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [openFaq, setOpenFaq] = useState(null);
  const [form, setForm] = useState({
    name: user?.name || '',
    mobile: user?.mobile || '',
    category: params.get('cat') || 'payment',
    priority: 'normal',
    subject: '',
    message: '',
  });
  const [newImgs, setNewImgs] = useState([]);
  const filesInRef = useRef(null);

  const [threadOpen, setThreadOpen] = useState(false);
  const [curTicket, setCurTicket] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [replyImgs, setReplyImgs] = useState([]);
  const replyFilesRef = useRef(null);
  const [lightboxImg, setLightboxImg] = useState(null);

  const loadTicketsForUser = () => {
    const mobile = (user?.mobile || form.mobile || '').replace(/\D/g, '').replace(/^91/, '');
    setTickets(ticketsForUser(mobile));
  };

  useEffect(() => {
    let alive = true;
    getFaqs().then((f) => alive && setFaqs(f));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    loadTicketsForUser();
    // Deep-link: auto-open a ticket from URL ?open=SUP-10001
    const openId = params.get('open');
    if (openId) {
      setTimeout(() => {
        const t = ticketsForUser((user?.mobile || '').replace(/\D/g, '').replace(/^91/, '')).find((x) => x.id === openId);
        if (t) { setCurTicket(t); setThreadOpen(true); }
      }, 100);
    }
  }, [user, form.mobile]);

  useEffect(() => {
    if (user?.name && !form.name) setForm((p) => ({ ...p, name: user.name }));
    if (user?.mobile && !form.mobile) {
      const m = user.mobile.replace(/\D/g, '').replace(/^91/, '');
      setForm((p) => ({ ...p, mobile: m }));
    }
  }, [user]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleFiles = async (files, target, setter) => {
    const room = MAX_IMAGES - target.length;
    if (room <= 0) {
      toast(tr('misc.supportUpToImages', { max: MAX_IMAGES }), 'error');
      return;
    }
    const imgs = await compressFiles(files);
    setter((prev) => [...prev, ...imgs.slice(0, room)]);
  };

  const removeImg = (arr, setter, idx) => {
    setter(arr.filter((_, i) => i !== idx));
  };

  const submit = async () => {
    const name = form.name.trim();
    const digits = form.mobile.replace(/\D/g, '').replace(/^91/, '');
    const subject = form.subject.trim();
    const msg = form.message.trim();
    if (!name) {
      toast(tr('misc.supportErrName'), 'error');
      return;
    }
    if (!/^[6-9]\d{9}$/.test(digits)) {
      toast(tr('misc.supportErrMobile'), 'error');
      return;
    }
    if (subject.length < 4) {
      toast(tr('misc.supportErrSubject'), 'error');
      return;
    }
    if (msg.length < 8) {
      toast(tr('misc.supportErrDescribe'), 'error');
      return;
    }
    const t = createTicket({
      mobile: digits,
      name,
      email: user?.email || '',
      category: form.category,
      priority: form.priority,
      subject,
      message: msg,
      images: newImgs,
    });
    if (!t) {
      toast(tr('misc.supportErrSave'), 'error');
      return;
    }
    setNewImgs([]);
    setForm((p) => ({ ...p, subject: '', message: '' }));
    toast(tr('misc.supportTicketRaised', { id: t.id }), 'success');
    loadTicketsForUser();
    openThread(t.id);
  };

  const openThread = (id) => {
    const t = getTicket(id);
    if (!t) return;
    markTicketRead(id, 'customer');
    setCurTicket(t);
    setReplyText('');
    setReplyImgs([]);
    setThreadOpen(true);
    loadTicketsForUser();
  };

  const closeThread = () => {
    setThreadOpen(false);
    setCurTicket(null);
    loadTicketsForUser();
  };

  const sendReply = () => {
    if (!curTicket) return;
    const txt = replyText.trim();
    if (!txt && !replyImgs.length) {
      toast(tr('misc.supportErrReply'), 'error');
      return;
    }
    const updated = replyToTicket(curTicket.id, {
      role: 'customer',
      name: form.name || user?.name || 'You',
      text: txt,
      images: replyImgs,
    });
    if (!updated) {
      toast(tr('misc.supportErrSend'), 'error');
      return;
    }
    setReplyText('');
    setReplyImgs([]);
    openThread(curTicket.id);
  };

  const fld = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';

  return (
    <div ref={rootRef}>
      <main className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-8 reveal">
            <div className="inline-flex items-center gap-2 px-3 py-1 mb-3 rounded-full bg-teal-500/10 border border-teal-500/20">
              <Icon name="life-buoy" className="w-3.5 h-3.5 text-teal-400" />
              <span className="text-xs text-teal-300 font-semibold">{tr('misc.supportBadge')}</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-white">
              {tr('misc.supportHelpPre')}<span className="gradient-text">{tr('misc.supportSupportWord')}</span>
            </h1>
            <p className="text-gray-400 text-sm mt-2 max-w-2xl">
              {tr('misc.supportSubtitle')}
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6">
            {/* Raise a ticket */}
            <TicketForm
              form={form}
              set={set}
              fld={fld}
              filesInRef={filesInRef}
              newImgs={newImgs}
              setNewImgs={setNewImgs}
              handleFiles={handleFiles}
              removeImg={removeImg}
              submit={submit}
            />

            {/* Your tickets */}
            <div className="space-y-6">
              <ContactCard />
              <TicketList tickets={tickets} openThread={openThread} />
            </div>
          </div>
        </div>
      </main>

      {/* Thread modal */}
      <TicketThreadModal
        threadOpen={threadOpen}
        closeThread={closeThread}
        curTicket={curTicket}
        setLightboxImg={setLightboxImg}
        replyImgs={replyImgs}
        setReplyImgs={setReplyImgs}
        removeImg={removeImg}
        replyFilesRef={replyFilesRef}
        handleFiles={handleFiles}
        replyText={replyText}
        setReplyText={setReplyText}
        sendReply={sendReply}
        fld={fld}
      />

      {/* Lightbox */}
      <Lightbox lightboxImg={lightboxImg} setLightboxImg={setLightboxImg} />

      {/* FAQs */}
      <FaqSection faqs={faqs} openFaq={openFaq} setOpenFaq={setOpenFaq} />
    </div>
  );
}
