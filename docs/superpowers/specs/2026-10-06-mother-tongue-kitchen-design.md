# Mother Tongue Kitchen: Design (v1)

Working title. Status: draft for review. Date: 2026-10-06.

## 1. Purpose

Capture recipes spoken by older people, in any Indian language, and keep both the original voice and a searchable, correctable transcript. The point is to pass recipes to the next generation in the cook's own words and language.

- **Market:** India only for now. Expansion to other record types (stories, memories) is a later, separate app.
- **Users:** one account type. A person can narrate, help someone else narrate, or both. Solo and team use are both supported.
- **UI:** normal-sized, clean, few screens. No voice guidance and no oversized accessibility mode (elders are not visually impaired).

### Success criteria for v1
- Zero lost recordings in the device checks (section 8).
- An elder can record a recipe unaided on the first try.
- A helper can correct a transcript in about 2 minutes.
- Words needing correction per recipe are measured with 3-5 real elders. The target is set after the Sarvam test (section 7, step 1).

### Out of scope for v1
Re-recording a section of a recipe, Hindi screens (next after v1), photos, families or groups, SMS OTP fallback, non-recipe record types.

## 2. Users and flow

One app, one account type.

1. **Sign in:** phone number, then an OTP delivered on WhatsApp. First sign-in asks for a name only. The session persists afterwards.
2. **Home:** a single large **Record a recipe** button (recording starts one tap after opening the app). Below it: search, and a list of the user's recipes with a status (Saved, Transcribing, Ready, Needs review). A second tab lists recipes shared with the user.
3. **Record:** large record button, timer, live level meter, pause, stop. No title or form first. After stop the app confirms "Saved" and returns home. Upload and transcription run in the background. When a helper records someone else, a short consent line is shown before recording starts (wording to be decided).
4. **Recipe:** title, ingredients and steps built from the transcript, in the original language. A button plays the original audio. A **Review words** button carries a badge with the count of uncertain words.
5. **Review:** the transcript scrolls and highlights in sync with the audio. Tapping a word plays from that point; tapping again edits it. Uncertain words are underlined. Edits change text only, never the audio. An edit updates the recipe view and the search index.
6. **Share:** add a person by phone number, with **view** or **edit** access.

**Search** covers the title and the full transcript, in any language.

## 3. Architecture

**Client: PWA (Next.js, App Router).** Approach 1 of three considered (Supabase all-in-one and an offline-first sync layer were rejected as respectively splitting the backend and over-building).

- **Recorder:** MediaRecorder writes audio chunks to IndexedDB every 5 seconds. It requests a screen wake lock while recording. After a reload or browser kill, the app offers "Recover your last recording" (up to 5 seconds may be missing).
- **Upload:** on stop, chunks are joined into one file and uploaded to private Blob storage. The local copy is deleted only after the server confirms receipt.

**Server: Vercel.**
- **Audio:** private Vercel Blob. Playback uses short-lived signed links.
- **Pipeline:** a durable background workflow with independently retried steps:
  1. Send audio to Sarvam STT (batch mode) with language auto-detect and word timestamps.
  2. Send the transcript to an LLM that produces title, ingredients and steps in the original language (no translation).
  3. Persist results and set status to Ready.
- **Auth:** phone number plus WhatsApp OTP, via the WhatsApp Business platform (direct or through a provider such as Gupshup, MSG91 or Twilio).

**Data: Neon Postgres.**
- `users`: phone number, name.
- `recipes`: owner, title, status, language, audio reference, duration.
- `words`: recipe, index, text, start, end, confidence (if available), `edited_text`. The original STT text is never overwritten.
- `structured recipe`: ingredients and steps.
- `shares`: recipe, person, role (view or edit).
- **Search:** Postgres full-text search with a simple tokenizer plus trigram matching, because built-in language configurations do not cover Indian scripts well. To be tested.

## 4. Failure handling

| Failure | Behaviour |
|---|---|
| Phone offline after recording | Status "Waiting for network". Audio stays safe on the phone and uploads later. |
| Sarvam error | Retried 3 times, then "Couldn't transcribe, tap to retry". Audio is safe on the server. |
| LLM error | Raw transcript shown. Recipe is still usable and searchable. |
| Browser kills the recording | Recovery prompt on next open. |

## 5. Privacy

Voice recordings are personal data and India's DPDP Act applies. Audio is private and accessed only through short-lived signed links. A consent step appears when someone records another person. Exact wording, retention and deletion rules are to be decided before launch.

## 6. Known risks

1. **Sarvam capabilities (unverified):** long-audio support, word timestamps, accuracy on dish names and regional words, and whether word confidence is returned. If confidence is not returned, "underline uncertain words" needs another mechanism (for example LLM-flagged doubtful words).
2. **Browser recording on lock or background:** the PWA may lose audio if the browser suspends it. Mitigated by chunked saving, wake lock and recovery; must be proven on real phones. A native app is the fallback.
3. **WhatsApp OTP setup:** needs Meta business verification, a business number and an approved authentication template. The wait is outside our control and must start on day 1. Reach is limited to people who have WhatsApp.
4. **Indian-script search quality:** Postgres full-text search needs testing across languages.

## 7. Build order (riskiest first)

1. **Sarvam test (throwaway, about one day):** 10 real narrations in 3+ languages, including long ones with kitchen noise. Check long audio, word timestamps, dish-name accuracy and confidence output.
2. **Recorder:** crash-safe chunks and recovery, on real phones.
3. **Upload, pipeline and recipe view.**
4. **Review screen** with synced playback and tap-to-fix.
5. **WhatsApp OTP and sharing.** Start Meta verification and template approval on day 1, in parallel with steps 1-4.
6. **Search.**

## 8. Testing

- **Unit:** chunk joining and recovery; word-edit logic (original preserved); each pipeline step with Sarvam and the LLM mocked.
- **Integration:** the real pipeline on the recordings from build step 1.
- **Manual device checks:** low-end Android phone on Chrome, screen lock mid-recording, incoming call, airplane mode mid-recording, closing the tab.
- **Field test:** 3-5 real elders. Measure unaided completion and words corrected per recipe.

## 9. Domains and trademark

mothertonguekitchen.in and .app looked free on RDAP at the time of checking (not verified at a registrar). `.com` is taken. A US catering business uses the exact name; this is accepted for an India-only launch, but the name needs a proper trademark check before any launch abroad. No Indian trademark search has been done.
