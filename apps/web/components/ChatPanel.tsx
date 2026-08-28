'use client';

import Link from 'next/link';
import React from 'react';
import { IconChat, IconClose, IconSend } from '@/components/icons';
import { useDismiss } from '@/components/useDismiss';

/**
 * The Build Objects assistant, as a docked panel.
 *
 * WHAT IT IS ALLOWED TO SAY: nothing it was not handed. Every price, product and figure in a reply
 * came back from a tool in lib/chat/tools.ts during that turn, and the draft was held against a
 * ledger of those facts before the server returned it (lib/chat/validator.ts). This component
 * renders; there is no path through it that can print an unchecked number.
 *
 * AND WHAT IT WILL NOT: anything that is not Build Objects gets one sentence — "You can ask me any
 * question you have regarding Build Objects" — from a scope gate that runs BEFORE a token is spent.
 * The refusal is the same sentence for an off-topic question, a prompt injection and an unsafe one,
 * because three different refusals tell somebody probing it which guard they tripped.
 *
 * A PANEL, NOT A MODAL. It docks to the corner and the page keeps scrolling behind it. Somebody
 * asking "what does this cost" while looking at a product should still be able to look at the
 * product; a modal would make them choose. No scrim, no scroll lock, nothing that can lose the
 * reader's place — a lesson this store has already paid for twice.
 */

interface Msg {
  /** Its own identity, because a chat log is append-only and its INDEX is not one: a re-render
      that inserts a pending turn would re-key every card below it. */
  id: number;
  role: 'user' | 'assistant';
  content: string;
  ui?: UiCard[];
  refused?: boolean;
}

type UiCard =
  | { kind: 'products'; rows: Array<{ sku: string; name: string; brand?: string; price_text?: string | null; unit?: string; href: string }> }
  | { kind: 'estimate'; total: string; sub: string; rows: Array<{ label: string; value: string }>; href: string };

const OPENERS = [
  { label: 'What cement do you have?', prompt: 'What cement do you have and what does it cost?' },
  { label: 'Cost of a 30×40 G+1', prompt: 'What would a 30 by 40 plot G+1 house cost in Hyderabad?' },
  { label: 'Show me floor tiles', prompt: 'What floor tiles do you stock?' },
];

export default function ChatPanel() {
  const [open, setOpen] = React.useState(false);
  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [q, setQ] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const seq = React.useRef(0);
  const panel = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const log = React.useRef<HTMLDivElement>(null);
  const input = React.useRef<HTMLInputElement>(null);

  useDismiss(open, () => setOpen(false), { panel, trigger });

  /* The newest turn, every time. Jumped rather than smooth-scrolled: a smooth scroll races the
     next reply and lands halfway up it. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: msgs and busy are the triggers, not inputs — the body reads neither
  React.useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [msgs, busy]);

  React.useEffect(() => {
    if (open) input.current?.focus({ preventScroll: true });
  }, [open]);

  const send = React.useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      const history = msgs.map((m) => ({ role: m.role, content: m.content }));
      seq.current += 1;
      setMsgs((m) => [...m, { id: seq.current, role: 'user', content: message }]);
      setQ('');
      setBusy(true);
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message, history }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'The assistant could not answer that.');
        seq.current += 1;
        setMsgs((m) => [...m, { id: seq.current, role: 'assistant', content: data.reply, ui: (data.ui ?? []) as UiCard[], refused: data.refused }]);
      } catch (e) {
        seq.current += 1;
        setMsgs((m) => [...m, { id: seq.current, role: 'assistant', content: (e as Error).message, refused: true }]);
      } finally {
        setBusy(false);
        input.current?.focus({ preventScroll: true });
      }
    },
    [busy, msgs],
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="chat-fab"
        aria-expanded={open}
        aria-label={open ? 'Close the assistant' : 'Ask Build Objects'}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <IconClose size={20} /> : <IconChat size={20} />}
      </button>

      {open && (
        <div ref={panel} className="chat-panel" role="dialog" aria-label="Build Objects assistant">
          <header className="chat-head">
            <div>
              <p className="chat-title">Ask Build Objects</p>
              <p className="chat-sub micro">Every figure here comes from the catalogue, not from the model.</p>
            </div>
            <button type="button" className="chat-x" onClick={() => setOpen(false)} aria-label="Close">
              <IconClose size={16} />
            </button>
          </header>

          <div className="chat-log" ref={log}>
            {msgs.length === 0 && (
              <div className="chat-empty">
                <p>Ask me what something costs, or what your house will come to.</p>
                <div className="chat-chips">
                  {OPENERS.map((c) => (
                    <button key={c.prompt} type="button" className="chip" onClick={() => send(c.prompt)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {msgs.map((m) => (
              <div key={m.id} className={`chat-msg chat-msg--${m.role}${m.refused ? ' is-refused' : ''}`}>
                <p className="chat-text">{m.content}</p>
                {m.ui?.map((card) => (
                  <Card key={`${m.id}-${card.kind}-${card.kind === 'products' ? card.rows.map((r) => r.sku).join() : card.total}`} card={card} />
                ))}
              </div>
            ))}

            {busy && (
              <div className="chat-msg chat-msg--assistant">
                <p className="chat-text chat-thinking">
                  <span />
                  <span />
                  <span />
                </p>
              </div>
            )}
          </div>

          <form
            className="chat-form"
            onSubmit={(e) => {
              e.preventDefault();
              send(q);
            }}
          >
            <input
              ref={input}
              className="chat-input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Ask about a product, a price, or your house"
              aria-label="Ask Build Objects"
              maxLength={600}
              enterKeyHint="send"
            />
            <button type="submit" className="chat-send" disabled={!q.trim() || busy} aria-label="Send">
              <IconSend size={17} />
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/** The cards under a reply. They carry the detail so the sentence above them does not have to. */
function Card({ card }: { card: UiCard }) {
  if (card.kind === 'products') {
    return (
      <ul className="chat-cards">
        {card.rows.map((r) => (
          <li key={r.sku}>
            <Link href={r.href} className="chat-card">
              <span className="chat-card-main">
                <span className="chat-card-name">{r.name}</span>
                {r.brand && <span className="chat-card-sub">{r.brand}</span>}
              </span>
              {r.price_text && (
                <span className="chat-card-price fig">
                  {r.price_text}
                  {r.unit && <span className="chat-card-unit">/{r.unit}</span>}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Link href={card.href} className="chat-est">
      <span className="chat-est-total fig">{card.total}</span>
      <span className="chat-est-sub">{card.sub}</span>
      <span className="chat-est-rows">
        {card.rows.map((r) => (
          <span key={r.label}>
            <span>{r.label}</span>
            <span className="fig">{r.value}</span>
          </span>
        ))}
      </span>
    </Link>
  );
}
