/** One tappable choice. `n` is the number a person can type instead of tapping. */
export interface Opt {
  id: string;
  title: string;
  description?: string;
  n?: number;
}

export type Inbound = { from: string } & (
  | { kind: 'text'; text: string }
  | { kind: 'choice'; id: string }
  | { kind: 'voice'; mediaId: string; transcript?: string }
  | { kind: 'media'; mediaId: string; mime: string }
);

export type Outbound =
  | { kind: 'text'; body: string }
  | { kind: 'options'; body: string; button: string; options: Opt[] };

export const MORE = '__more';
