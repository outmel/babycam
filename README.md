# Lulu

**Lulu turns any two phones into a private, smart baby monitor that alerts every caregiver and never uploads your child's video.**

An old phone becomes the camera. Parents, grandparents, babysitters and daycare staff get alerts on their own phones or a web dashboard. All video and audio analysis happens on the camera phone, so footage of your child never touches a server.

> Lulu is an awareness tool, not a medical device. It does not monitor breathing, prevent SIDS or replace direct supervision.

## What it does

| Feature | How |
|---|---|
| **Live view** | WebRTC peer to peer, DTLS-SRTP end-to-end encryption. Supabase only relays signaling, on private channels limited to owners and caregivers. |
| **Cry detection** | YAMNet on 0.975 s windows every 0.5 s, with episode logic so a cough doesn't page anyone. |
| **Safe zones** | Parents outline the crib or play mat. A warning fires when part of the child is past the edge, and an alert when they leave. |
| **Position alerts** | MediaPipe Pose: sat up, may have rolled onto tummy. |
| **Object alerts** | YOLO11n: scissors, knives, forks or glasses near a child (needs 3 sightings in 2 s). |
| **Multi-child tracking** | ByteTrack with anonymous letter labels (Child A, Child B). Nothing about appearance is stored. |
| **Shared care** | Invite caregivers by code with roles (owner, caregiver, viewer). Everyone gets push alerts and a shared history. |
| **Camera health** | Lens covered, too dark, camera bumped/moved, battery low, and camera offline (a server-side check every minute), so silence is never mistaken for safety. |
| **Sleep log** | A nightly summary built only from event text (settled, stirring, crying). |

Smart suppression keeps alerts trustworthy:
- A child picked up by an adult standing beside them doesn't trigger "left the zone".
- An adult leaning into the crib isn't mistaken for the child.
- A person walking past isn't mistaken for a moved camera.

## How it fits together

```
 Camera phone (Expo, on-device)                         Parent phones / web
 ┌───────────────────────────────────────┐             ┌──────────────────────────┐
 │ VisionCamera 5 frame worklet          │             │ Alerts (push), history,  │
 │   YOLO11n → MediaPipe Pose → image    │             │ sleep log, family, live  │
 │   stats      (react-native-fast-tflite)│             └───────▲──────────▲───────┘
 │ Mic → YAMNet (react-native-audio-api) │   text events       │          │ WebRTC
 │            │                          │   + heartbeats      │          │ (P2P, E2EE)
 │   @lulu/core Pipeline ── offline queue ├────────────► Supabase         │
 │   (ByteTrack, rules)                  │              Postgres + RLS    │
 │                                       │              Realtime ─────────┤ signaling only
 │ LiveHost (react-native-webrtc) ◄──────┼──────────────────────────────────┘
 └───────────────────────────────────────┘              Edge Function → Expo Push
```

The decision logic lives in **`packages/core`**, which is pure TypeScript with no dependencies. The app, the web dashboard and the replay harness all run this same code, so harness numbers describe what the app actually does.

## Repository

| Path | What |
|---|---|
| `apps/mobile` | Expo SDK 58 dev build: camera mode and parent mode |
| `apps/web` | Next.js 16 + Tailwind 4 + Recharts dashboard |
| `packages/core` | Tracker, alert rules, cry/health/activity logic, sleep summaries, trace replay and scoring (+ unit tests) |
| `supabase` | Migration (schema, RLS, RPCs, cron, push trigger), `notify` Edge Function, SQL/RLS tests |
| `harness` | Replay harness, synthetic scenarios, video → trace extractor |
| `models` | Model download/export script |

## Run it

**Prerequisites:** Node 20+, Python 3.10+, a Supabase project, and for the phone app an Android device or iPhone plus the Android SDK or Xcode (or [EAS Build](https://docs.expo.dev/build/introduction/)).

1. **Install:** `npm run setup`
2. **Backend**
   - Run `supabase link`, then `supabase db push` (or paste `supabase/migrations/*.sql` into the SQL editor). Enable the `pg_cron` and `pg_net` extensions if your project doesn't have them.
   - Deploy push: `supabase functions deploy notify --no-verify-jwt`, then `supabase secrets set LULU_NOTIFY_SECRET=<random>`.
   - In the SQL editor: `select vault.create_secret('https://<ref>.supabase.co', 'lulu_project_url'); select vault.create_secret('<same random>', 'lulu_notify_secret');`
3. **Models:** `npm run models`. This downloads YAMNet and MediaPipe Pose. For YOLO11n, see [models/README.md](models/README.md); on Windows use the GitHub Action.
4. **Mobile**
   - Copy `apps/mobile/.env.example` to `.env.local` and fill it in.
   - Run `cd apps/mobile && npx expo run:android` (or `eas build --profile development`).
   - Push needs an EAS project id: run `eas init`.
5. **Web:** copy `apps/web/.env.example` to `.env.local`, then run `npm run web`.

**Deploying the dashboard (Deployxa or any Node host):**
- Set the project root to the **repository root**, because the dashboard imports `packages/core`.
- Install command: `npm --prefix packages/core install && npm --prefix apps/web install`
- Build command: `npm --prefix apps/web run build`
- Start command: `npm --prefix apps/web start`
- Add the two `NEXT_PUBLIC_SUPABASE_*` variables.

**Using it:**
1. Sign in on both phones with the same account (or invite others from Family).
2. Choose **Camera** on the spare phone, draw the safe zone, and leave it on a charger.
3. Choose **Parent** on yours.

## How we know it works

```sh
npm test   # core unit tests + SQL/RLS tests + harness release gate
```

- **Unit tests (30):** tracker and assignment, zones, posture, cry episodes, camera health, the full pipeline (including the caregiver-pickup and adult-leaning cases), sleep summaries and scoring.
- **SQL tests (32):** the real migration runs in embedded Postgres (PGlite) with Supabase stand-ins. They cover:
  - Outsiders can't read or write anything.
  - Caregivers can't promote themselves.
  - Viewers can't open live view.
  - Invites are single-use.
  - Offline-queue retries are idempotent.
  - Offline cameras raise one alert.
  - Only warnings and alerts trigger push.
- **Replay harness** (`harness/`): runs recorded traces through the same pipeline and reports caught alerts, missed alerts, false alarms per hour and alert delay. `npm run gate` fails if `harness/thresholds.json` isn't met.
  - **Recorded traces** come from the camera phone (*Record trace* on the camera screen, exported as JSONL) or from any video via `harness/extract/extract_trace.py`. The extractor runs YOLO11n, MediaPipe Pose and YAMNet. Label what should have alerted in `labels.json`.
  - **Synthetic scenarios** (11 clips, 64 min) simulate detector output with jitter, missed frames, false boxes, coughs and passers-by. Current result: 12/12 caught, 0 false alarms. **These check the alert logic only, not model accuracy.** Recorded clips are reported separately, so the two are never mixed.

## Privacy model

- Frames and audio exist only in memory on the camera phone. Nothing is recorded, encoded or uploaded.
- The database stores short text events ("Crying detected", "Child A left the crib"), heartbeats and settings. Row-level security limits every row to members of that family.
- Live view is peer to peer, with DTLS-SRTP end-to-end encryption. Even through a TURN relay, the relay can't decrypt media.
- Children get anonymous per-session letter labels; there's no face recognition or re-identification.

## Known limitations

- **Not yet tested on physical phones.** It was built on Windows without an Android SDK or Mac, so the native pieces have only been typechecked and bundled: the camera worklet, TFLite, WebRTC and microphone. Expect device-level tuning on first run, such as pixel format, model output layout and delegate fallbacks.
- **One camera owner at a time.** The camera hardware can't be shared, so alerts pause while someone is in live view. They resume when the viewer closes it, and both moments are logged.
- **Simple child/adult rule.** A person who stays fully inside a safe zone for 2 s is treated as a child. An adult lying on a play mat would count as one.
- **Rough position cues.** They need shoulders and hips visible, so a child under a blanket raises no position alerts. Overhead and side cameras use different rules, set per camera.
- **iOS keeps the camera app in the foreground.** Leave the camera phone plugged in with Lulu open. The *Dim screen* button blacks out the display.
- **The sleep log describes the room**, which suits one child per camera.
