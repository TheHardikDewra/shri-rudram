# Sri Rudram

Interactive website for learning and chanting Sri Rudram (Rudra Prashna / Shatarudriya) - the most revered Vedic hymn to Lord Shiva, from Krishna Yajurveda, Taittiriya Samhita.

**Live site**: [shri-rudram.com](https://shri-rudram.com)


## Accounts and sync

Signing in is **optional**. The site is local-first: everything works offline
and without an account, exactly as it did before accounts existed.

Sign in with Google or an email address and your progress follows you across
devices in realtime, with no reload. Signing in for the first time on a device
**merges** what is already on that device into the account rather than
replacing it, and every merge rule only ever adds - union or maximum, never
overwrite. Progress cannot be lost by signing in, signing out, or two devices
being offline at the same time.

Theme, font size and chant display settings deliberately stay per-device. The
Export / Import buttons in the footer still work as a manual backup.

One account covers all six sadhana sites. See [`SYNC_SETUP.md`](SYNC_SETUP.md)
for the architecture, the merge rules, and the Firebase setup.

## What's inside

- All 22 anuvakas (11 Namakam + 11 Chamakam) with Sanskrit (Devanagari), IAST transliteration, theme, and meaning
- Full Vedic chanting audio embedded from Om Swami ji's production with 7 Ghanapathi Vedabrahma chanters
- Anuvaka-synced chanting mode - audio automatically highlights the current anuvaka text
- Rudra Gayatri mantra, Maha Mrityunjaya mantra with word-by-word breakdown
- Traditional practice flow (Purvanga, Namakam, Chamakam, Uttaranga)
- Beginner's path guidance for progressive learning
- Rudrabhishekam explainer with traditional offerings and their significance

## Features

### Home
Introduction to Sri Rudram, stats dashboard, embedded audio video, sadhana tracker for daily recitations.

### Namakam
All 11 anuvakas of salutations to Rudra. Click any anuvaka to expand and see full Sanskrit, IAST, meaning, and "Play from this Anuvaka" button that jumps to the corresponding audio timestamp.

### Chamakam
All 11 anuvakas of invocations for divine blessings. Same interface as Namakam.

### Chant
Full chanting mode with embedded YouTube player synchronized with the text. As the chanting progresses, the current anuvaka automatically updates. Controls for previous/next, anuvaka selector, and toggles for IAST and meaning visibility. Fullscreen supported.

### About
- Background and significance of Sri Rudram
- Rudra Gayatri mantra (traditionally chanted before and after Rudram)
- Maha Mrityunjaya mantra with word-by-word meaning
- Traditional practice flow (12 steps from Achamana to Shanti Mantra)
- Beginner's path with 5 progressive stages
- Rudrabhishekam - offerings and their significance, best days for the ritual
- Credits to Om Swami ji and the Ghanapathi chanters

## Audio Source

Om Swami ji's official production:
- URL: https://youtu.be/L4yT_UpfJdw
- Executive Producer: Om Swami
- Chanters: 7 Ghanapathi Vedabrahmas (Sri Lakshminarayana Bhattaru, Sri Subrahmanya Swami, Sri Sudarshana Acharya, Sri Satish Sharma, Sri Shashidhara Sharma, Sri Naresh Somayaji, Sri Prasad Parasuraman)

## Text Source

Krishna Yajurveda, Taittiriya Samhita, Kanda 4:
- Prapathaka 5: Namakam (11 anuvakas)
- Prapathaka 7: Chamakam (11 anuvakas)

Text verified against Anandashrama recension (the most widely chanted form across South India and the tradition followed by Om Swami ji).

## Seeker tools

- **Progress tracking** - Mark anuvakas as chanted, saved in your browser
- **Sadhana tracker** - Log daily recitations, track streaks and monthly count
- **Font size controls** - Adjustable for comfortable reading
- **Light/Dark/System themes** - Switch based on preference or let it follow your system
- **Export/Import** - Backup your progress as JSON
- **Installable PWA** - Add to home screen on mobile, works offline

## Tech

Pure vanilla HTML/CSS/JS. No frameworks, no build step.

- Fonts: Haffer (local), Geist, Inter for body; Tiro Devanagari Sanskrit for Sanskrit headings
- Dark theme default with light and system modes
- YouTube iframe API for audio synchronization
- localStorage for all user data
- Service worker for offline support
- Deployed on Vercel

## Running locally

```bash
python3 -m http.server 9000
# visit http://localhost:9000
```

## Sister project

Sri Lalita Sahasranama - 1000 names of the Divine Mother
[lalita-sahasranama.vercel.app](https://lalita-sahasranama.vercel.app)

## About

This is a devotional offering at the feet of Lord Rudra. May it serve any seeker walking the path.

Om Namah Shivaya.
