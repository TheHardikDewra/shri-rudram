# Cloud Sync Setup (Firebase)

How login + cross-device progress sync works across the six sadhana apps, and
how to change or extend it.

The six: `shodashi-ashtottara`, `lalita-sahasranama`, `lalita-trishati`,
`shri-rudram`, `vishnu-sahasranama-stotram`, `bala-sadhana`. They share **one**
Firebase project, so one account signs you in to all six.

## Architecture

- **Local-first.** The app reads and writes localStorage exactly as it did
  before sync existed. It works fully offline and without ever signing in.
- **`sync.js` is byte-identical in all six repos.** Everything app-specific -
  which localStorage keys sync, and how each one merges - lives in
  `firebase-config.js`. Fix a bug once, copy the file six times.
- One Firestore doc per user per app: `users/{uid}/apps/{appId}`.
- **Realtime.** A Firestore `onSnapshot` listener pushes changes from other
  devices in live; `sync.js` merges them into localStorage and fires
  `sync:remote-applied`, which the app uses to repaint the current view in
  place. No reload.
- **Merges never destroy progress.** Every merge rule is union or max based, so
  it is commutative and idempotent: two devices offline for a week both keep
  everything when they reconnect, in whatever order they reconnect.
- **First sign-in on a device merges** that device's existing progress into the
  account instead of overwriting it. Nobody starts from scratch.
- Device preferences - theme, font size, language, chant display settings, a
  running timer - deliberately stay per-device.
- The Firebase web config in `firebase-config.js` is public by design. Security
  comes from `firestore.rules`: a signed-in user can only touch documents under
  their own uid.
- **Dormant until configured.** While `apiKey`/`projectId` are `REPLACE_ME`,
  `sync.js` never loads the SDK, never shows the account button, and the app
  behaves exactly as it did before.

## firebase-config.js

```js
window.SADHANA_SYNC_CONFIG = {
  appId: 'lalita-sahasranama',   // namespace: the doc id under users/{uid}/apps/
  deviceKey: 'lsn_device_id',    // localStorage key for this browser's id
  fields: [
    { name: 'learned',  key: 'lsn_learned',   merge: 'idset' },
    // ...
  ],
  firebase: { /* console values */ },
};
```

`name` is the Firestore field, `key` is the localStorage key, `merge` names the
rule. An optional `preserve: ['running', 'since']` lists sub-keys that stay
device-local and survive a remote merge (bala's stopwatch uses this - without
it, a sync from another device would silently stop a running timer).

### Merge rules

| `merge` | Shape | Rule |
|---|---|---|
| `idset` | array of ids | union, sorted |
| `srs` | `{id: card}` | whichever card is further along (`nextReview`, then `repetitions`) |
| `notes` | `{id: text}` | longer text wins |
| `sadhana` | `{total, log:[{date,count}]}` | per-date max; total never decreases |
| `bookmark` | number | most recent writer (not the max - jumping back must survive) |
| `japa` | `{date, secs:[]}` | same date, per-segment max; otherwise the later date |

To add a rule, add an entry to `TYPES` in `sync.js` with `empty`, `coerce` and
`merge`. Keep `merge` commutative and idempotent or devices will not converge.

Adding a rule means re-testing: `merge(a, b) === merge(b, a)` and
`merge(a, a) === a` for every rule.

## One-time Firebase project setup (shared by all six apps)

1. [console.firebase.google.com](https://console.firebase.google.com) -> Add project (Analytics not needed).
2. Build -> Authentication -> Get started:
   - Enable **Google** (pick a support email).
   - Enable **Email/Password**.
3. Build -> Firestore Database -> Create database -> production mode,
   location `asia-south1` (Mumbai).
4. Firestore -> Rules -> paste `firestore.rules` -> Publish.
   Or from a repo that has `firebase.json`: `firebase deploy --only firestore:rules`.
5. Project settings -> General -> Your apps -> Web app (`</>`) -> register,
   copy the config object into every repo's `firebase-config.js`.
6. Authentication -> Settings -> **Authorized domains** -> add every domain the
   apps are served from. This is the step that is easy to forget - a domain
   that is not listed fails Google sign-in with `auth/unauthorized-domain`:

   ```
   lalita-sahasranama.com          www.lalita-sahasranama.com
   lalita-trishati.com             www.lalita-trishati.com
   shodashi-ashtottara.com         www.shodashi-ashtottara.com
   shri-rudram.com                 www.shri-rudram.com
   vishnu-sahasranama-stotram.com  www.vishnu-sahasranama-stotram.com
   bala-sadhana.com                www.bala-sadhana.com
   ```

   Plus every `*.vercel.app` alias still in use, so people who bookmarked those
   keep working. `localhost` is pre-authorized for dev.

## Adding sync to another app

1. Copy `sync.js`, `firestore.rules`, `firebase.json` in unchanged.
2. Write `firebase-config.js` - same `firebase` block, new `appId`, `deviceKey`
   and `fields` for that app's keys.
3. `index.html`: account button in the header controls, the auth modal markup,
   and `firebase-config.js` + `sync.js` script tags after `app.js`.
4. `app.js`: a `syncNotify(key)` helper that dispatches `sync:local-change`,
   called after every localStorage write of a synced key, plus a
   `sync:remote-applied` listener that repaints the current view.
5. `style.css`: the Account / Cloud Sync block.
6. `sw.js`: bump the cache version, add the two new files, and keep the
   same-origin GET guard in the fetch handler - without it the service worker
   intercepts Firebase auth and Firestore traffic.
7. Add the app's domains to Firebase Authorized domains (step 6 above).

## Free tier reality check

Spark plan: 50k Firestore reads + 20k writes per day, unlimited Google/email
auth users, no billing account. A session costs about one read and a handful of
debounced writes, so hundreds of daily users across all six apps fit
comfortably.

## Testing

`test/sync.test.mjs` at the repo root exercises the merge rules directly in
Node - convergence, commutativity, idempotence, and the "progress can only be
added" guarantee. Run `node test/sync.test.mjs`.
