import type { Inbound } from '../channels/types';

/**
 * Speech-to-text for voice notes. No provider is wired in yet: this returns the transcript only when the
 * channel already supplies one (the terminal simulator does, via "/voice ..."). To add a provider, download
 * the audio with the channel's fetchMedia and return the recognised text here.
 */
export async function transcribe(msg: Extract<Inbound, { kind: 'voice' }>): Promise<string | null> {
  return msg.transcript?.trim() || null;
}
