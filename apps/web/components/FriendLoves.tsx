'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import React from 'react';
import { addFriendLoves, readLovesLink } from '@/lib/shopper';

/**
 * Someone sent you a link to what they love. This is the only way "Loved by friends" ever gets
 * anything to show.
 *
 * NO ACCOUNTS AND NO SERVER. A shared list is a link and nothing else — the SKU codes and a name,
 * in the query string. Nobody is followed, no contacts are read, and the store learns nothing:
 * what you keep is written to this device and stays there (lib/shopper.ts). That is the whole
 * social graph, and it is the only version of one this store can offer honestly.
 *
 * IT ASKS. A link that silently wrote to your device would be a link that could be sent to you by
 * anyone, so the offer is shown and the params are cleared either way.
 */
export default function FriendLoves() {
  return (
    <React.Suspense fallback={null}>
      <Offer />
    </React.Suspense>
  );
}

function Offer() {
  const params = useSearchParams();
  const pathname = usePathname();
  const [offer, setOffer] = React.useState<{ from: string; skus: string[] } | null>(null);
  const [kept, setKept] = React.useState<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `pathname` is a re-run trigger — a client navigation can land on a new URL carrying a different list, and there is nothing in the path itself to read.
  React.useEffect(() => {
    const next = readLovesLink(new URLSearchParams(params.toString()));
    setOffer(next);
    /* Only a NEW list asks a new question. Clearing this unconditionally wiped the "kept it"
       confirmation the instant it appeared: taking the list out of the URL re-runs this effect,
       so the answer erased itself before anyone could read it. */
    if (next) setKept(null);
  }, [params, pathname]);

  const done = React.useCallback(() => {
    setOffer(null);
    /* Take the list out of the URL so a reload, or a link shared onward, does not ask again. */
    const p = new URLSearchParams(window.location.search);
    p.delete('loves');
    p.delete('from');
    const q = p.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${q ? `?${q}` : ''}`);
  }, []);

  if (!offer && kept === null) return null;

  return (
    <div className="friendbar" role="status">
      {kept === null ? (
        <>
          <p className="friendbar-msg">
            <strong>{offer?.from}</strong> shared <span className="fig">{offer?.skus.length}</span> {offer?.skus.length === 1 ? 'thing' : 'things'} they love.
          </p>
          <div className="friendbar-acts">
            <button
              type="button"
              className="btn btn-primary btn--sm"
              onClick={() => {
                setKept(addFriendLoves(offer?.from ?? '', offer?.skus ?? []));
                done();
              }}
            >
              Keep the list
            </button>
            <button type="button" className="btn btn-secondary btn--sm" onClick={done}>
              No thanks
            </button>
          </div>
        </>
      ) : (
        <p className="friendbar-msg">
          Kept. <span className="fig">{kept}</span> {kept === 1 ? 'item is' : 'items are'} now under “Loved by friends”.
        </p>
      )}
    </div>
  );
}
