import type React from 'react';

/**
 * The subset of Markdown the pipeline's descriptions use: ###/## headings, paragraphs,
 * bullet lists, **bold**, *italic*. Rendered to React nodes — no HTML injection, no dependency.
 */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0,
    m: RegExpExecArray | null,
    i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`'))
      out.push(
        <code key={`${key}-${i++}`} className="fig">
          {t.slice(1, -1)}
        </code>,
      );
    else out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export default function Markdown({ text, className = 'prose' }: { text: string; className?: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [],
    list: string[] = [],
    k = 0;
  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={k++}>{inline(para.join(' '), `p${k}`)}</p>);
      para = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push(
        <ul key={k++}>
          {list.map((l, i) => (
            // Parsed from one markdown string: a list item has no identity beyond its position,
            // and any content change re-renders the whole block anyway.
            // biome-ignore lint/suspicious/noArrayIndexKey: positional items of a parsed block
            <li key={i}>{inline(l, `l${k}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      flushList();
      continue;
    }
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      flushList();
      blocks.push(<h3 key={k++}>{h[2].replace(/[*_]/g, '')}</h3>);
      continue;
    }
    const li = line.match(/^[-*•]\s+(.*)$/) ?? line.match(/^\d+[.)]\s+(.*)$/);
    if (li) {
      flushPara();
      list.push(li[1]);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  return <div className={className}>{blocks}</div>;
}
