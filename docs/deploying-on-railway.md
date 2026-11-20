# Running realSocial on Railway

This puts the current server (WhatsApp webhook and admin review page) online so pilot users can reach it
without your Mac. Railway builds it from the GitHub repository using the `Dockerfile` and `railway.json`
in this folder. Written 20 November 2026; Railway's dashboard wording may differ slightly.

## Which Railway plan

| Plan | Cost | Fits realSocial? |
|---|---|---|
| Free | $0, $1 of usage a month | For trying the deployment. The server **sleeps after 5 to 10 minutes** with no traffic and wakes on the next request, so the first WhatsApp message or page load after a quiet spell is slow. Storage is limited to 0.5 GB (plenty for now). |
| Trial | $5 of credit for 30 days, no card | Same as free while it lasts; stops when the credit or the 30 days run out. |
| Hobby | $5 a month, includes $5 of usage | **Use this before pilot users start.** Always on, storage up to 5 GB. |

Moving from Free to Hobby is a billing change in Railway; nothing in the project changes.

## One-time setup

1. **Sign in** at railway.com with your GitHub account and allow Railway to read the `Rubaina/realSocial`
   repository.
2. **New project > Deploy from GitHub repo >** `realSocial`. Railway finds the `Dockerfile` and starts a
   build. The first deploy fails until step 4 is done; that is expected.
3. **Add a volume** (storage that survives restarts): in the service, *Settings > Volumes* (or right-click
   the service > *Attach volume*), mount path **`/data`**. The database and uploaded documents are kept
   there. Without it, every redeploy erases all approvals.
4. **Variables** (service > *Variables*). Type the values into Railway, never into chat or the repository:

   | Variable | Value |
   |---|---|
   | `ADMIN_TOKEN` | a **new, long** password for the online admin page (not the one on your Mac) |
   | `OPERATOR_NAME` | `realSocial` |
   | `ANTHROPIC_API_KEY` | optional: your Claude key, for "Read and draft". Anyone with the admin password can then spend Claude credit. |

   `PORT`, `HOST` and `DB_PATH` are already handled; do not add them.
5. **Region:** *Settings > Region*. Choose Singapore or the nearest Asian region if offered.
6. **Public address:** *Settings > Networking > Generate domain*. You get an address such as
   `https://realsocial-production.up.railway.app`.
7. Railway redeploys after each change. When the deploy shows as active, open
   `https://<your address>/health` (should say `{"ok":true}`), then `https://<your address>/admin`.
   Sign in with any name (it is recorded as the reviewer) and the `ADMIN_TOKEN` password.

## First use: approve the programs again

The online server starts with an empty database. On first start, the program files in `catalog/` are added
to *Other approvals* as pending, and nothing reaches WhatsApp until you approve it there. Your approvals on
your Mac (`data/app.db`) are not copied.

Before approving, decide on the Surabaya entries whose application steps were written without an official
source: `sby_sarjana` (1 Keluarga 1 Sarjana), `sby_lansia`, `sby_bpjstk`, `sby_kerja`. Reject them, or check
them against an official source first.

## Connecting WhatsApp

Follow `docs/testing-on-meta-test-number.md`, with two differences:

- Skip the tunnel. The callback URL in Meta is `https://<your Railway address>/webhook`.
- Put the four `WA_*` values in Railway's *Variables*, not in a file. The server refuses to start if only some
  of them are set.

Meta's test number only talks to the few phone numbers registered on it. Pilot users beyond that need your
own WhatsApp Business number.

## Updating

Every push to `main` on GitHub redeploys automatically. The volume (approvals, sources, chat progress) is
kept across deploys.

## Good to know

- The admin page is public behind one shared password. Use a long one, and change it in *Variables* if it is
  shared too widely.
- Server output (start-up messages and errors) is under the service's *Deployments > View logs*.
- If you also connected the repository to Vercel, remove that project there: this version does not run on
  Vercel, and every push would show a failed Vercel build.
