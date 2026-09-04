'use client';

import React from 'react';
import { lovesLink, readShopper, SHOPPER_EVENT } from '@/lib/shopper';

/**
 * The other half of "Loved by friends": a link to what YOU love, for you to send.
 *
 * It lives in the Filters panel, next to the chip it feeds, because a filter for something nobody
 * can create is a dead control — somebody has to be able to make the list before anybody can be
 * shown it. The name is asked for rather than known: this store has no idea who you are, and the
 * link is the only thing that travels.
 */
export default function ShareLoves() {
  const [loved, setLoved] = React.useState<string[]>([]);
  const [name, setName] = React.useState('');
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    const read = () => setLoved(Object.keys(readShopper().loved));
    read();
    window.addEventListener(SHOPPER_EVENT, read);
    return () => window.removeEventListener(SHOPPER_EVENT, read);
  }, []);

  if (!loved.length) {
    return (
      <fieldset className="shelf-field">
        <legend className="shelf-legend">Your list</legend>
        <p className="shelf-note">Press “Love it” on a product to start a list you can send to someone.</p>
      </fieldset>
    );
  }

  const share = async () => {
    const url = lovesLink(window.location.origin, window.location.pathname, name, loved);
    try {
      /* The share sheet where there is one — it is the gesture people expect on a phone — and the
         clipboard everywhere else. Either way the link is the whole payload. */
      if (navigator.share) await navigator.share({ title: 'What I love at Build Objects', url });
      else await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      /* Cancelled, or no permission. Nothing to recover from. */
    }
  };

  return (
    <fieldset className="shelf-field">
      <legend className="shelf-legend">Your list</legend>
      <p className="shelf-note">
        You love <span className="fig">{loved.length}</span> {loved.length === 1 ? 'thing' : 'things'} in the store.
      </p>
      <label className="shelf-name">
        <span className="shelf-sr">Your name, for the link</span>
        <input type="text" value={name} maxLength={40} placeholder="Your name" onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="button" className="btn btn-secondary btn--sm btn--block" onClick={share}>
        {copied ? 'Link copied' : 'Share my list'}
      </button>
    </fieldset>
  );
}
