import { z } from 'zod';

// WhatsApp interactive message limits. Enforced on catalog text so nothing is cut off in the chat.
export const LIMITS = { rowTitle: 24, rowDescription: 72, buttonTitle: 20, listRows: 10, buttons: 3 };

export type Rule = { all: Rule[] } | { any: Rule[] } | { not: Rule } | { fact: string; in: string[] };

export const RuleSchema: z.ZodType<Rule> = z.lazy(() =>
  z.union([
    z.object({ all: z.array(RuleSchema).min(1) }).strict(),
    z.object({ any: z.array(RuleSchema).min(1) }).strict(),
    z.object({ not: RuleSchema }).strict(),
    z.object({ fact: z.string().min(1), in: z.array(z.string()).min(1) }).strict(),
  ]),
);

const text = z.string().min(1);
const title = text.max(LIMITS.rowTitle);

export interface RegionNode {
  id: string;
  name: string;
  children?: RegionNode[];
}
const RegionSchema: z.ZodType<RegionNode> = z.lazy(() =>
  z.object({ id: text, name: title, children: z.array(RegionSchema).optional() }).strict(),
);

export const PackMetaSchema = z
  .object({
    code: text,
    name: title,
    languages: z.array(text).min(1),
    phone_prefix: z.string().regex(/^\d+$/),
    region_levels: z.array(text).min(1),
    regions: z.array(RegionSchema).min(1),
  })
  .strict();
export type PackMeta = z.infer<typeof PackMetaSchema>;

export const QuestionSchema = z
  .object({
    id: text,
    text,
    options: z
      .array(z.object({ value: text, label: title }).strict())
      .min(2)
      .max(LIMITS.listRows),
  })
  .strict();
export type Question = z.infer<typeof QuestionSchema>;

export const OfficeSchema = z.object({ name: text, find: text }).strict();
export type Office = z.infer<typeof OfficeSchema>;

const InPersonSchema = z
  .object({ office: text, bring: z.array(text).min(1), steps: z.array(text).min(1), cost: text, time: text })
  .strict();
const OnlineSchema = z
  .object({ url: z.string().url(), ready: z.array(text).default([]), steps: z.array(text).min(1), cost: text.optional(), time: text.optional() })
  .strict();

export const ProgramSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+$/),
    title,
    benefit: text.max(LIMITS.rowDescription),
    why: text,
    priority: z.number().int(),
    eligibility: RuleSchema,
    how_to_apply: z
      .object({ in_person: InPersonSchema.optional(), online: OnlineSchema.optional() })
      .strict()
      .refine((h) => h.in_person || h.online, 'needs at least one of in_person / online'),
    note: text.optional(),
    source_url: z.string().url(),
    // Set when a reviewer approves the entry. Catalog files leave it out.
    last_verified: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
  })
  .strict();
export type Program = z.infer<typeof ProgramSchema> & { scope: string[] };

/** Every message the bot can send. Each country pack must provide all of them. */
export const STRING_KEYS = [
  'pick_language', 'change_language', 'welcome', 'start', 'change_country', 'choose', 'more', 'pick_country',
  'region_prompt', 'not_understood', 'voice_unavailable', 'no_media', 'results_intro', 'results_none', 'restart',
  'why_label', 'how_apply', 'back', 'route_prompt', 'in_person', 'online',
  'where', 'bring', 'ready', 'steps', 'cost', 'time', 'source', 'unverified',
  'docs_prompt', 'docs_have', 'docs_missing', 'docs_tip',
  'after_prompt', 'applied', 'other_program', 'done', 'thanks_applied', 'goodbye',
  'delete_confirm', 'delete_yes', 'delete_no', 'deleted',
  'cmd_delete', 'cmd_country', 'cmd_language', 'cmd_menu',
] as const;
export type Strings = Record<(typeof STRING_KEYS)[number], string>;

/** Strings shown on buttons; they must fit WhatsApp's button title limit. */
export const BUTTON_KEYS = [
  'change_language', 'start', 'change_country', 'choose', 'more', 'restart', 'how_apply', 'back', 'in_person', 'online',
  'docs_have', 'docs_missing', 'applied', 'other_program', 'done', 'delete_yes', 'delete_no',
] as const;

export const LANGUAGE_NAMES: Record<string, string> = { id: 'Bahasa Indonesia', en: 'English' };
