import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import Icon from '../../components/Icon.jsx';
import { useScrollReveal } from '../../lib/useScrollReveal.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { listFaqs } from '../../services/contentService.js';
import {
  listTickets,
  getTicket,
  createTicket,
  replyToTicket,
  markTicketRead,
} from '../../services/supportService.js';
import TicketForm from './support/TicketForm.jsx';
import TicketList from './support/TicketList.jsx';
import TicketThreadModal from './support/TicketThreadModal.jsx';
import FaqSection from './support/FaqSection.jsx';
import ContactCard from './support/ContactCard.jsx';

export default function Support() {
  const { t: tr } = useTranslation();
  const rootRef = useScrollReveal();
  const { toast } = useToast();
  const { user } = useAuth();
  const [params] = useSearchParams();

  /* No priority or image-attachment control: neither is on the wire, and unknown properties are ignored rather
     than rejected, so sending one would appear to work while ops never sees it. */

  const [tickets, setTickets] = useState([]);
  const [faqs, setFaqs] = useState([]);
  const [openFaq, setOpenFaq] = useState(null);
  const [form, setForm] = useState({
    name: user?.name || '',
    mobile: user?.mobile || '',
    category: params.get('cat') || 'payment',
    subject: '',
    message: '',
  });

  const [threadOpen, setThreadOpen] = useState(false);
  const [curTicket, setCurTicket] = useState(null);
  const [replyText, setReplyText] = useState('');

  const reload = useCallback(async () => {
    const list = await listTickets().catch(() => []);
    setTickets(list);
    return list;
  }, []);

  useEffect(() => {
    let alive = true;
    listFaqs().then((f) => alive && setFaqs(f));
    return () => {
      alive = false;
    };
  }, []);

  const openId = params.get('open');
  useEffect(() => {
    let alive = true;
    reload().then((list) => {
      if (!alive) return;
      // Deep-link: auto-open a ticket from URL ?open=<id>. Resolved from the list we just loaded
      // rather than on a timer, which would race the request and lose.
      if (openId && list.some((x) => x.id === openId)) openThread(openId);
    });
    return () => { alive = false; };
  }, [user, reload, openId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (user?.name && !form.name) setForm((p) => ({ ...p, name: user.name }));
    if (user?.mobile && !form.mobile) {
      const m = user.mobile.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
      setForm((p) => ({ ...p, mobile: m }));
    }
  }, [user]);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    /** `name` and `digits` are validated but not sent: the server takes the raiser from the session and
     * `SupportTicketCreate` has no identity field, yet a human still reads them as contact details. */
    const name = form.name.trim();
    const digits = form.mobile.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
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
    let t;
    try {
      t = await createTicket({
        category: form.category,
        subject,
        message: msg,
      });
    } catch {
      t = null;
    }
    if (!t) {
      toast(tr('misc.supportErrSave'), 'error');
      return;
    }
    setForm((p) => ({ ...p, subject: '', message: '' }));
    toast(tr('misc.supportTicketRaised', { id: t.id }), 'success');
    await reload();
    openThread(t.id);
  };

  const openThread = (id) => {
    // Optimistic: the badge clears on tap, not on the round trip. `markTicketRead` is idempotent on
    // both providers, which is what makes firing it on every open safe.
    setTickets((cur) => cur.map((x) => (x.id === id ? { ...x, unread: false } : x)));
    markTicketRead(id).catch(() => {});
    setReplyText('');
    setThreadOpen(true);
    getTicket(id)
      .then((t) => { if (t) setCurTicket(t); })
      .catch(() => {});
  };

  const closeThread = () => {
    setThreadOpen(false);
    setCurTicket(null);
    reload();
  };

  const sendReply = async () => {
    if (!curTicket) return;
    const txt = replyText.trim();
    if (!txt) {
      toast(tr('misc.supportErrReply'), 'error');
      return;
    }
    let sent;
    try {
      sent = await replyToTicket(curTicket.id, txt);
    } catch {
      sent = null;
    }
    if (!sent) {
      toast(tr('misc.supportErrSend'), 'error');
      return;
    }
    setReplyText('');
    // Re-read rather than append locally: the server owns the message id, the timestamp and the
    // resulting ticket status, and a reply can move a ticket out of `waiting`.
    const full = await getTicket(curTicket.id).catch(() => null);
    if (full) setCurTicket(full);
    reload();
  };

  const fld = 'field w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder-gray-500';

  return (
    <div ref={rootRef}>
      <div className="pt-8 lg:pt-10 pb-20 min-h-[100dvh]">
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

          {/* Deflection: most tickets are questions the help centre answers, and offering it before the form,
              not after, is what gets it read. */}
          <Link
            to="/help"
            className="reveal mb-6 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5 transition-colors hover:border-teal-400/40 hover:bg-white/[0.05]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-400/10">
              <Icon name="book-open" className="w-4 h-4 text-teal-400" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-white">{tr('help.deflectTitle')}</span>
              <span className="block text-xs text-gray-500">{tr('help.deflectBody')}</span>
            </span>
            <Icon name="arrow-right" className="w-4 h-4 shrink-0 text-gray-500" />
          </Link>

          <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-6">
            {/* Raise a ticket */}
            <TicketForm
              form={form}
              set={set}
              fld={fld}
              submit={submit}
            />

            {/* Your tickets */}
            <div className="space-y-6">
              <ContactCard />
              <TicketList tickets={tickets} openThread={openThread} />
            </div>
          </div>
        </div>
      </div>

      {/* Thread modal */}
      <TicketThreadModal
        threadOpen={threadOpen}
        closeThread={closeThread}
        curTicket={curTicket}
        replyText={replyText}
        setReplyText={setReplyText}
        sendReply={sendReply}
        fld={fld}
      />

      {/* FAQs */}
      <FaqSection faqs={faqs} openFaq={openFaq} setOpenFaq={setOpenFaq} />
    </div>
  );
}
