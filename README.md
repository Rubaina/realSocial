# Bantuan WA

A WhatsApp assistant that helps a household find government support it may be eligible for, then gives
specific steps to apply in person or online. People use it only through WhatsApp: no app, website, or login.
Nothing is uploaded; the person only confirms they have the documents listed.

Pilot: Indonesia (national programs) plus Kota Surabaya, in Bahasa Indonesia or English. Countries are
data, so another one is added by writing a folder under `catalog/`, with no code change.

## The rule that matters most

**No program reaches people until a human approves it.** Program files and manually entered updates are
proposals. They wait in a review queue, and only approved versions are shown in the chat. An edit to a live
program does not replace it until the edit is approved.

## Try it without WhatsApp

```bash
npm install
npm run sim -- --fresh --approve-all
```

`--approve-all` approves everything pending in the simulator's own database, for testing only. Without it
you see exactly what the public would: only what has been approved on the review page.

Type a number to "tap" an option, or type words. `/voice iya` pretends to send a voice note,
`/phone 919812345678` switches to another person (and country). The simulator is a developer tool, not a
customer interface.

## Review page (admin only)

```bash
ADMIN_TOKEN=choose-a-long-password npm start
```

Open `http://localhost:3000/admin` and sign in with your name and that password. The page lists pending
programs and changes (with what differs from the live version), lets you approve or reject, and has a form
to enter an update when an official site or the news announces a change. Your name is recorded with each
decision, and approval dates the program as checked.

**Draft from an official page.** Paste the link to a government web page, policy PDF, or service poster image and press "Read page
and draft". The portal reads the page and fills the form with a draft entry (eligibility, steps, documents,
in every language), plus the quotes it relied on and a list of things to check. Nothing is saved until you
press "Save as pending", and nothing is published until you approve it. This needs `ANTHROPIC_API_KEY`.
It reads one page when you ask; it does not watch sites for changes. It only reads public addresses, and
pages that need a browser to load (or a sign-in) cannot be read directly: for those, open the page yourself
and paste its text into "Paste its text instead", keeping the link so the source is recorded.

There is one reviewer password. The page has no HTTPS of its own, so it listens on this machine only
unless you put it behind a secure proxy and set `HOST`.

To review for the simulator, point both at the same database: `DB_PATH=data/sim.db`.

## Run on WhatsApp

1. Create a Meta WhatsApp Business app and phone number.
2. Copy `.env.example` to `.env`, fill in `OPERATOR_NAME`, `ADMIN_TOKEN` and the `WA_*` values, and load it
   into the environment. `OPERATOR_NAME` (who runs the service) is shown in the first message and is required.
3. `npm start`, expose the port over HTTPS, and set `https://<host>/webhook` as the webhook URL in Meta,
   using `WA_VERIFY_TOKEN` as the verify token. Subscribe to the `messages` field.

The bot only replies when a person writes. It sends no reminders.

## How it works

| Part | Where | What it does |
|---|---|---|
| Country packs | `catalog/<country>/` | Messages, questions, offices, and one proposal file per program |
| Approval gate | `src/catalog/live.ts` | Review queue; serves only approved programs |
| Review page | `src/admin/` | The one admin page |
| Page reader | `src/extract/` | Fetches an official page and drafts an entry for review |
| Eligibility | `src/eligibility/` | Written rules decide; only useful questions are asked |
| Conversation | `src/conversation/engine.ts` | The chat flow, identical on every channel |
| Next steps | `src/nextsteps/builder.ts` | The "where, what to bring, what to do" checklist |
| Channels | `src/channels/` | WhatsApp Cloud API adapter and the terminal simulator |
| Understanding | `src/understand/` | Maps typed words or a voice transcript to an on-screen option |
| Store | `src/store/` | Users, results, tracking events, review queue |

Eligibility is never decided by AI. A model (optional, `ANTHROPIC_API_KEY`) is only asked "which of these
options did the person mean?", and can answer "not sure".

## Adding or changing a program

Either paste the program text into the review page form, or edit a file under `catalog/` (see
`catalog/id/national/kip_kuliah.yaml`) and restart: new or edited files join the review queue. The folder
decides where a program applies: `national/` for everyone, `regions/<province>/<city>/` for one city.

In a country with several languages, every piece of text is written once per language:

```yaml
title: { id: Subsidi listrik, en: Electricity subsidy }
```

Proposals are checked before they are queued: every language must be complete, titles must fit WhatsApp
limits, rules must refer to real questions and answers, and there must be a source and a way to apply.
Messages, questions and office descriptions live in files and are not part of the review queue.

## Data kept

- `users`: phone, country, language, region, answers, first and last seen
- `results`: programs shown as likely eligible, and the answers that led to each
- `events`: started, language_set, region_set, profile_completed, results_shown, program_picked, steps_sent,
  documents_confirmed, documents_missing, self_reported_applied, country_changed
- `program_changes`: every proposal with who submitted it, who reviewed it, and when

No documents or ID numbers are collected. A person can type `HAPUS DATA SAYA` / `DELETE MY DATA` to erase
everything about them. The first three tables are what a future admin portal (user list, tracking,
dashboard) will read.

## Not done yet

- Voice notes need a speech-to-text provider (`src/understand/stt.ts`).
- Automatic deletion after a retention period.
- The rest of the admin portal (user list, tracking, dashboard).
- Automatic monitoring of official sites for changes; updates are entered by hand.
