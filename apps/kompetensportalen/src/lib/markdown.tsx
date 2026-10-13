import React from "react";

// Minimal, säker markdown (rubriker, listor, fet/kursiv, länkar, citat). All text escapas av React; bara http(s)/mailto/tel-länkar tillåts.
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []; const re = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g; let last = 0; let m: RegExpExecArray | null; let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith("**")) out.push(<strong key={`${key}b${i}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith("*")) out.push(<em key={`${key}i${i}`}>{t.slice(1, -1)}</em>);
    else { const lm = /\[([^\]]+)\]\(([^)]+)\)/.exec(t)!; const href = lm[2].trim(); out.push(/^(https?:\/\/|mailto:|tel:|\/)/i.test(href) ? <a key={`${key}a${i}`} href={href} rel="noopener noreferrer">{lm[1]}</a> : lm[1]); }
    last = m.index + t.length; i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { source: string }) {
  const lines = source.replace(/\r/g, "").split("\n"); const blocks: React.ReactNode[] = []; let list: { ordered: boolean; items: string[]; levels: number[] } | null = null; let para: string[] = []; let k = 0;
  const flushPara = () => { if (para.length) { blocks.push(<p key={`p${k++}`}>{inline(para.join(" "), `p${k}`)}</p>); para = []; } };
  const flushList = () => { if (list) { const Tag = list.ordered ? "ol" : "ul"; blocks.push(<Tag key={`l${k++}`}>{list.items.map((it, i) => <li key={i} style={list!.levels[i] ? { marginLeft: list!.levels[i] * 22, listStyleType: "circle" } : undefined}>{inline(it, `li${k}${i}`)}</li>)}</Tag>); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd(); let m: RegExpExecArray | null;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flushPara(); flushList(); const level = m[1].length + 1; const Tag = (`h${Math.min(level, 4)}`) as keyof JSX.IntrinsicElements; blocks.push(<Tag key={`h${k++}`}>{inline(m[2], `h${k}`)}</Tag>); continue; }
    if ((m = /^\s*[-*]\s+(.*)$/.exec(line))) { flushPara(); if (!list || list.ordered) { flushList(); list = { ordered: false, items: [], levels: [] }; } list.items.push(m[1]); list.levels.push(Math.min(2, Math.floor((line.length - line.trimStart().length) / 2))); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushPara(); if (!list || !list.ordered) { flushList(); list = { ordered: true, items: [], levels: [] }; } list.items.push(m[1]); list.levels.push(0); continue; }
    if ((m = /^>\s?(.*)$/.exec(line))) { flushPara(); flushList(); blocks.push(<blockquote key={`q${k++}`}>{inline(m[1], `q${k}`)}</blockquote>); continue; }
    flushList(); para.push(line.trim());
  }
  flushPara(); flushList();
  return <div className="prose">{blocks}</div>;
}
