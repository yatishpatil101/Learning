import { useState } from 'react';
import { Send } from 'lucide-react';
import { classNames } from '../../../lib/format.js';
import { fmtAgo } from './helpers.js';

export default function MessageThread({ messages, onSend }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await onSend(body);
      setText('');
    } catch {
      // The desk has already toasted the reason; keep the text for a retry.
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="rounded-2xl border border-white/10 p-4" aria-labelledby="service-thread-title">
      <h4 id="service-thread-title" className="text-sm font-semibold">Customer thread</h4>
      {messages?.length ? (
        <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto" aria-live="polite">
          {messages.map((message) => (
            <li key={message.id} className={classNames(
              'rounded-xl p-3 text-sm',
              message.from === 'staff' ? 'bg-sky-500/10 text-sky-50' : 'bg-white/5 text-gray-100',
            )}>
              <div className="mb-1 flex justify-between gap-3 text-xs text-gray-400">
                <span>{message.from === 'staff' ? 'Desk' : 'Customer'}</span>
                <span>{fmtAgo(message.at)}</span>
              </div>
              <p className="whitespace-pre-wrap">{message.text}</p>
            </li>
          ))}
        </ul>
      ) : <p className="mt-2 text-sm text-gray-500">No messages yet.</p>}
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="service-thread-message">Reply to customer</label>
        <input
          id="service-thread-message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={4000}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm"
          placeholder="Reply to the customer"
        />
        <button type="submit" disabled={!text.trim() || sending} className="dz-btn dz-btn-primary disabled:opacity-40">
          <Send className="h-4 w-4" aria-hidden="true" /> {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </section>
  );
}
