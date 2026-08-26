'use client';

import React from 'react';
import { mediaUrl } from '@/lib/media';
import { IconDoc, IconDownload } from './icons';

/** Inline PDF (the browser's own viewer, first page) + a Download button per document. */
export default function BrochureViewer({
  documents,
  skuCode,
}: {
  documents: { id: number; type: string; title: string; key: string; pages: number | null; sizeKb: number | null }[];
  skuCode: string;
}) {
  const [active, setActive] = React.useState(0);
  if (!documents.length) {
    return (
      <div className="empty" style={{ padding: 'var(--s-5)' }}>
        <IconDoc size={22} style={{ color: 'var(--ink-3)' }} />
        <p>No brochure is published for this product yet — the datasheet values on this page were read from the brand's own pages.</p>
      </div>
    );
  }
  const d = documents[active];
  const url = mediaUrl(d.key)!;
  return (
    <div>
      <iframe className="pdf-frame" src={`${url}#page=1&view=FitH&toolbar=0`} title={d.title} loading="lazy" />
      {documents.map((doc, i) => (
        <div key={doc.id} className="doc-row">
          <button
            type="button"
            className="flex items-center gap-2 text-left"
            onClick={() => setActive(i)}
            aria-current={i === active ? 'true' : undefined}
            style={{ color: i === active ? 'var(--ink-1)' : 'var(--ink-2)' }}
          >
            <IconDoc size={16} style={{ color: 'var(--color-brand)' }} />
            <span>
              {doc.title}
              <span className="ml-2 text-[11px]" style={{ color: 'var(--ink-3)' }}>
                {doc.type}
                {doc.pages ? ` · ${doc.pages} pages` : ''}
                {doc.sizeKb ? ` · ${doc.sizeKb >= 1024 ? `${(doc.sizeKb / 1024).toFixed(1)} MB` : `${doc.sizeKb} KB`}` : ''}
              </span>
            </span>
          </button>
          <a href={mediaUrl(doc.key)!} download={`${skuCode}-${doc.type}.pdf`} className="btn-ghost h-9 px-3 text-[12px] flex items-center gap-1.5 shrink-0">
            <IconDownload size={15} /> Download
          </a>
        </div>
      ))}
    </div>
  );
}
