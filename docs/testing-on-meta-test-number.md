# Testing changes on the Meta test number

**Rule:** every change that a citizen could notice is tested on Meta's WhatsApp test number, from a real
phone, before it reaches the live number. The terminal simulator and `npm test` come first, but they do
not replace this: only real WhatsApp shows how buttons, lists, long messages, voice notes and photos
actually behave on a phone.

This guide reflects the code as of 15 November 2026. Meta's dashboard wording changes from time to time;
if a screen looks different, the steps still apply.

## 1. One-time setup

1. **Meta app.** At developers.facebook.com create a Business app and add the WhatsApp product. Under
   *WhatsApp > API Setup* Meta provides a **test number** and its **phone number ID**.
2. **Tester phones.** On the same screen, add each tester's own WhatsApp number as a recipient and confirm
   the code Meta sends. The test number can only talk to numbers on this list (Meta allows a small number
   of them, five at the time of writing).
3. **A separate test environment.** Create `.env.test` from `.env.example`:

   | Setting | Value for testing |
   |---|---|
   | `WA_PHONE_NUMBER_ID` | the test number's ID |
   | `WA_ACCESS_TOKEN` | the token from *API Setup* (the temporary one expires after about 24 hours) |
   | `WA_APP_SECRET` | *App settings > Basic > App secret* |
   | `WA_VERIFY_TOKEN` | any phrase you choose |
   | `OPERATOR_NAME` | for example `TEST - <your organisation>` so testers can tell it is not live |
   | `ADMIN_TOKEN` | a password for the review page |
   | `DB_PATH` | `data/test.db` so test chats never mix with real people's data |
   | `ANTHROPIC_API_KEY` | set it if free-text understanding should be tested; leave empty to test the keyword fallback |

   Never put the live number's values in this file.
4. **A public address for your machine.** WhatsApp must reach the server over HTTPS. Run a tunnel
   (for example `cloudflared` or `ngrok`) to port 3000 and note the HTTPS address it gives.
5. **Webhook.** Under *WhatsApp > Configuration* set the callback URL to `https://<tunnel-address>/webhook`,
   enter the same verify token, and subscribe to the `messages` field.

## 2. Before each test session

1. Run the local checks. Do not continue if either fails.

   ```bash
   npm test
   ```

   ```bash
   npm run typecheck
   ```

2. Start the server with the test settings loaded, and start the tunnel.

   ```bash
   npm start
   ```

3. If the tunnel address changed, update the callback URL in Meta. If the access token expired, copy a
   new one and restart.
4. Open the review page at `http://localhost:3000/admin` and approve the programs you want to test.
   Only approved programs appear in the chat, on the test number exactly as on the live one.
5. From a tester phone, send `hapus data saya` (or `delete my data`) and confirm, so you start as a new person.

## 3. What to test for each kind of change

Always do the local step first. The last column is what must be seen on a real phone.

| What changed | Local check | On the test number |
|---|---|---|
| **Wording of a message or button** (`catalog/<country>/strings.*.yaml`) | `npm test` rejects button text that is too long | Read the message on a small phone. Nothing cut off, no stray symbols, bold shows as bold. Check every language the country offers. |
| **A question or its answers** (`questions.yaml`) | `npm test`; walk through in `npm run sim` | The question appears at the right moment. Up to 3 short answers show as tap buttons; more show as a list. Tapping, typing the number, and typing the word all work. |
| **A program or its rules** (program file, or an edit on the review page) | `npm test`; in the simulator, a household that should qualify sees it and one that should not does not | Approve it on the review page, then repeat both households on the phone. Open the program, pick each apply route, and read the whole checklist. Tap the links. |
| **Office or region details** (`offices.yaml`, `pack.yaml`) | `npm test` | Pick that region in the chat and confirm the checklist names the right office. Pick a different region and confirm it does not. |
| **A new country or language** | `npm test`; simulator with `/phone <number with that country code>` | Use *Change country* / *Change language* in the chat. Every message after the switch is in the right language. |
| **Conversation flow** (`src/conversation/engine.ts`) | `npm test`; simulator | Run the full script in section 4, including the "wrong input" steps. |
| **WhatsApp connection** (`src/channels/whatsapp.ts`, `src/server.ts`) | `npm test` | Full script in section 4. Also send two messages quickly and confirm the replies arrive in order and none is repeated. |
| **Free-text understanding** (`src/understand/intent.ts`) | `npm test` | Section 5. |
| **Voice to text** (`src/understand/stt.ts`) | simulator with `/voice <words>` | Section 5. |

## 4. The full script (run for any flow or connection change, and before every release)

Use a tester phone. Tick each line.

1. Send "halo". The first message names the operator, explains what is asked and why, and offers Start.
2. Tap **Start**. Choose a region by tapping; choose the next level by typing its number.
3. Answer the questions with a mix of taps, numbers and typed words ("ya", "tidak ada").
4. Send something unrelated ("berapa harga beras?"). The bot says it did not understand and shows the
   same options again. Your earlier answers are unchanged.
5. Scroll up and tap a button from an **earlier** question. It must be ignored, not taken as an answer.
6. Reach the results. Each program is one short line. Typing a number opens that program.
7. Open a program, read why it fits, tap **How to apply**, and try both routes if offered. The checklist
   shows where to go, what to bring, steps, cost, time and source, and fits the screen without being cut.
8. Answer the documents question both ways on different runs.
9. Send a **photo**. The bot must say photos are not needed and must not store it.
10. Send a **voice note**. See section 5 for the expected reply.
11. Type `menu`. Your results come back without repeating the questions.
12. Type `ganti negara`, pick another country, and confirm language and questions change. Switch back.
13. Type `hapus data saya` and confirm. Send "halo" again: you are treated as a new person.
14. Close WhatsApp, wait a few minutes, reopen and continue a chat halfway through. It resumes correctly.

After the run, check the server window for error lines. There should be none.

## 5. Voice notes and free text

**Today no speech-to-text service is connected.** The expected result on the test number is: a voice note
gets the "I cannot listen to voice notes yet" reply and the options are shown again. Confirm this still
happens after any change near voice handling.

**When a speech-to-text service is added**, test all of these on the test number before going live, with
real recordings from a phone, not typed text:

- A clear "ya" and a clear "tidak" answer the current question correctly.
- A spoken option name ("Kota Surabaya") selects that option.
- A spoken number ("dua") selects option 2.
- A regional accent, a quiet voice, and a recording with street or household noise. Record how many of ten
  attempts are understood. When unsure, the bot must show the options again and never guess.
- An unrelated sentence, silence, and a recording longer than a minute. None may change an answer.
- A spoken "hapus data saya" still asks for confirmation before erasing anything.
- The service being unavailable (wrong key, or network off). The chat keeps working with the
  "cannot listen" reply.
- Time from sending the voice note to the reply. Note it; more than a few seconds feels broken.

**Free text.** Run these twice: once with `ANTHROPIC_API_KEY` set and once with it empty.

- Informal and misspelled answers ("iy", "gk ada", "blm").
- A sentence that clearly picks one option ("saya tinggal di surabaya").
- A sentence that could mean two options. The bot must ask again, not pick one.
- A question instead of an answer. The bot must ask again.

Eligibility never depends on these features: they only map words to an option already on screen. If a
spoken or typed answer is misread, that is a release blocker, because a wrong answer changes which
programs a family is shown.

## 6. Recording the result and releasing

1. Note the date, tester, what changed, which sections were run, and anything that failed.
2. A change is ready for the live number only when: local checks pass, the rows in section 3 for that
   change pass on the test number, and the section 4 script passes with no errors in the server window.
3. Program content still needs a reviewer's approval on the **live** review page. Approving it in the
   test database does not approve it for real users.
4. Switch to the live settings only after the above. Then repeat steps 1 to 7 of section 4 once on the
   live number from a team phone.

## 7. What the test number cannot show

- **Unknown users.** Only listed tester phones can chat with it. First contact from a stranger is first
  seen on the live number.
- **Display name and verified badge.** The test number shows Meta's test identity, not yours.
- **Message templates and the 24-hour rule.** The test number has only Meta's sample template. Any message
  the bot should send more than 24 hours after a person's last message needs your own approved template,
  which is tested on your own number.
- **Volume.** It says nothing about many people chatting at once.
- **Older or low-cost phones.** Include at least one in the tester list; buttons and lists look different
  on small screens and old WhatsApp versions.
