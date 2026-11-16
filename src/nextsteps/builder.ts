import { fmt, isStale, officeFor, type Pack } from '../catalog/loader';
import type { Program } from '../catalog/schema';

export type Route = 'in_person' | 'online';

const bullets = (items: string[]) => items.map((i) => `• ${i}`).join('\n');
const numbered = (items: string[]) => items.map((s, i) => `${i + 1}. ${s}`).join('\n');

/**
 * The message a person can act on today (and show at the counter): where to go, what to bring,
 * what to do, cost, waiting time, and the official source.
 */
export function checklist(pack: Pack, region: string[], program: Program, route: Route, now: Date): string {
  const S = pack.strings;
  const parts: string[] = [];

  if (route === 'in_person') {
    const r = program.how_to_apply.in_person!;
    const office = officeFor(pack, region, r.office);
    parts.push(`*${program.title}* · ${S.in_person}`);
    parts.push(`📍 ${S.where}\n${office.name}\n${office.find}`);
    parts.push(`🧾 ${S.bring}\n${bullets(r.bring)}`);
    parts.push(`👣 ${S.steps}\n${numbered(r.steps)}`);
    parts.push(`💰 ${S.cost} ${r.cost}\n⏱ ${S.time} ${r.time}`);
  } else {
    const r = program.how_to_apply.online!;
    parts.push(`*${program.title}* · ${S.online}`);
    parts.push(`🔗 ${r.url}`);
    if (r.ready.length) parts.push(`🧾 ${S.ready}\n${bullets(r.ready)}`);
    parts.push(`👣 ${S.steps}\n${numbered(r.steps)}`);
    const extra = [r.cost && `💰 ${S.cost} ${r.cost}`, r.time && `⏱ ${S.time} ${r.time}`].filter(Boolean);
    if (extra.length) parts.push(extra.join('\n'));
  }

  if (program.note) parts.push(`ℹ️ ${program.note}`);
  parts.push(fmt(S.source, { url: program.source_url }));
  if (isStale(program, now)) parts.push(`⚠️ ${S.unverified}`);
  return parts.join('\n\n');
}
