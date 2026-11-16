import fs from 'node:fs';
import readline from 'node:readline';
import { createApp } from '../app';
import { numberedLines } from './whatsapp';
import type { Inbound, Outbound } from './types';

/**
 * Developer-only terminal chat for testing the conversation without a WhatsApp account.
 * It is not a customer interface.
 *
 *   npm run sim -- [--phone 6281234567890] [--fresh] [--approve-all]
 *
 * Only approved programs are shown, exactly as on WhatsApp. Approve them on the review page, or pass
 * --approve-all to approve everything pending in the simulator's own database (testing only).
 *
 * Type a number to "tap" an option, or any text. Commands:
 *   /voice <words>   pretend to send a voice note that was heard as <words>
 *   /photo           pretend to send a photo
 *   /phone <number>  become a different person (the country is guessed from the prefix)
 *   /quit
 */
const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const dbPath = process.env.DB_PATH ?? 'data/sim.db';
if (args.includes('--fresh')) for (const f of [dbPath, `${dbPath}-journal`]) fs.rmSync(f, { force: true });

const { engine, catalog } = createApp({ dbPath, operator: process.env.OPERATOR_NAME ?? '[OPERATOR_NAME not set]' });
if (args.includes('--approve-all')) for (const { change } of catalog.pending()) catalog.approve(change.id, 'simulator (testing only)');
let phone = flag('--phone') ?? '6281234567890';

function show(messages: Outbound[]): void {
  for (const m of messages) {
    console.log(`\n🤖 ${m.body.replace(/\n/g, '\n   ')}`);
    if (m.kind === 'options') console.log(`   ${numberedLines(m.options).replace(/\n/g, '\n   ')}`);
  }
  console.log();
}

function toInbound(line: string): Inbound | null {
  if (line.startsWith('/voice ')) return { from: phone, kind: 'voice', mediaId: 'sim', transcript: line.slice(7) };
  if (line === '/voice') return { from: phone, kind: 'voice', mediaId: 'sim' };
  if (line === '/photo') return { from: phone, kind: 'media', mediaId: 'sim', mime: 'image/jpeg' };
  if (line.startsWith('/')) return null;
  return { from: phone, kind: 'text', text: line };
}

console.log(`Simulator: you are +${phone}. ${catalog.liveSummary().length} program(s) live, ${catalog.pending().length} waiting for review.`);
console.log('Say anything to begin. /quit to leave.\n');
const rl = readline.createInterface({ input: process.stdin, terminal: false });
process.stdout.write('> ');
for await (const raw of rl) {
  const line = raw.trim();
  if (!process.stdin.isTTY) console.log(line); // echo piped input so transcripts are readable
  if (line === '/quit') break;
  if (line.startsWith('/phone ')) {
    phone = line.slice(7).replace(/\D/g, '');
    console.log(`You are now +${phone}.\n`);
  } else if (line) {
    const msg = toInbound(line);
    if (msg) show(await engine.handle(msg));
    else console.log('Unknown command.\n');
  }
  process.stdout.write('> ');
}
console.log();
