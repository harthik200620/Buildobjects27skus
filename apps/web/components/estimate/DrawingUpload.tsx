'use client';

import type { DrawingExtraction } from '@buildobjects/estimator';
import React from 'react';
import { IconUpload } from '@/components/icons';

const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,application/pdf';
const MAX = 20 * 1024 * 1024;

/** Drag-drop a plan / elevation / render → the reader → a prefill the wizard asks you to confirm. */
export default function DrawingUpload({ onReading }: { onReading: (reading: DrawingExtraction, fileName: string) => void }) {
  const [over, setOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [last, setLast] = React.useState<{ reading: DrawingExtraction; name: string } | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Use a JPEG, PNG, WebP, GIF or PDF.');
      return;
    }
    if (file.size > MAX) {
      setError('That file is over 20 MB.');
      return;
    }
    const fd = new FormData();
    fd.append('file', file);
    setBusy(true);
    try {
      const res = await fetch('/api/estimate/drawing', { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not read the drawing');
      setLast({ reading: j, name: file.name });
      onReading(j, file.name);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div
        className="drawing-drop"
        data-over={over ? 'true' : undefined}
        role="button"
        tabIndex={0}
        aria-busy={busy}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          upload(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {/* Three centred lines around a centred icon made this the emptiest thing in the
            column. Two short lines, left of the icon's right edge, at the height of a control. */}
        <IconUpload size={18} style={{ color: 'var(--color-brand)', flex: 'none' }} />
        {busy ? (
          <span className="dz-t">
            <span className="skel" style={{ width: 12, height: 12, borderRadius: 6, display: 'inline-block', verticalAlign: -1, marginRight: 6 }} />
            Reading your drawing…
          </span>
        ) : (
          <span>
            <span className="dz-t">Upload a design</span>
            <span className="dz-s">Floor plan, elevation or render — we fill the form, you confirm.</span>
          </span>
        )}
      </div>
      {last && (
        <p className="note mt-2">
          {last.reading.provider === 'mock' ? <span className="prov prov-typical mr-2">Mock reader</span> : <span className="prov mr-2">Read by Claude</span>}
          {last.reading.notes} · confidence <span className="fig">{Math.round(last.reading.confidence * 100)}%</span>
        </p>
      )}
      {error && (
        <p className="note mt-2" style={{ color: 'var(--color-brand)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
