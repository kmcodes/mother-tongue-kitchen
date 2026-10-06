# Spike checklist: Sarvam and structuring (Plan 1, Task 1)

**Goal:** answer the seven questions below with real recordings before we build the review screen (Plan 2). **Time:** about half a day. **Cost:** about 40 minutes of audio is about ₹20 of Sarvam credit, plus a few rupees of LLM.

Nothing here is committed except this checklist, the scripts and your findings. Audio and outputs stay in `spike-audio/` (gitignored).

## 0. Before you start

- [ ] **Consent.** Anyone whose voice you record knows it is a test and agrees. Do not post these files anywhere.
- [ ] **Sarvam key** from the dashboard. Add credits if the free ones are low.
- [ ] **AI Gateway key** (Vercel dashboard, AI Gateway).
- [ ] Create `.env.local` (it is gitignored):

```
SARVAM_API_KEY=...
AI_GATEWAY_API_KEY=...
STRUCTURE_MODEL=google/gemini-2.5-flash-lite
```

- [ ] `npm install`, then in each terminal: `set -a; source .env.local; set +a`
- [ ] Smoke test the keys with a 20-second clip (see step 2) before recording everything.

## 1. Record the test set (about 10 files)

Record in `spike-audio/`. Use `tools/spike-recorder.html` for the WebM files (open it with `python3 -m http.server -d tools 8000` and visit `http://localhost:8000/spike-recorder.html` in Chrome). For the phone-recorder files use the phone's own voice recorder app.

Speak like a real cook: loose order, "andaaz se", regional ingredient and dish names, a pause or two, the odd "ummm". Use a recipe you really cook.

| # | File name suggestion | Language | Length | Condition | Format | Why |
|---|---|---|---|---|---|---|
| 1 | `hi-short-quiet.webm` | Hindi | 1 min | quiet room | WebM (laptop Chrome) | Basic check. **Q1** WebM accepted? |
| 2 | `hi-long-quiet.webm` | Hindi | 6+ min | quiet | WebM | **Q2** long audio, **Q3** chunk sizes |
| 3 | `hi-noise.webm` | Hindi | 3 min | kitchen noise (exhaust fan, cooker whistle) | WebM | **Q4** noisy accuracy |
| 4 | `hi-phone.m4a` | Hindi | 3 min | quiet | phone recorder (m4a/aac) | Safari and iPhone will send mp4. Does Sarvam take it? |
| 5 | `ta-quiet.webm` | Tamil | 3 min | quiet | WebM | **Q4** South Indian script |
| 6 | `te-or-kn-or-ml.webm` | Telugu, Kannada or Malayalam | 3 min | quiet | WebM | **Q4** a second South Indian language |
| 7 | `bn-or-mr.webm` | Bengali or Marathi | 3 min | quiet | WebM | **Q4** |
| 8 | `en-hinglish.webm` | English mixed with Hindi | 3 min | quiet | WebM | Code-mixing |
| 9 | `two-voices.webm` | any | 3 min | a helper interrupts and corrects the cook | WebM | Real "team" use |
| 10 | `silent.webm` | none | 20 s | do not speak | WebM | The empty-transcript path |

**For files 1-8, write the truth.** In `spike-audio/truth.md`, list for each file: the dish name and the 8-10 key words you actually said (ingredients, dish name, regional terms). That is how you score accuracy later. Do this right after recording while you remember.

## 2. Run Sarvam on every file

```bash
npx tsx scripts/sarvam-spike.ts spike-audio/hi-short-quiet.webm --lang hi-IN
```

Use `--lang` with the real language (`hi-IN`, `ta-IN`, `te-IN`, `kn-IN`, `ml-IN`, `bn-IN`, `mr-IN`, `en-IN`) for one pass, then run files 1, 5 and 8 again with no `--lang` (auto-detect) to see if detection is good enough to leave out.

The script prints processing time, language, chunk stats and the first 300 characters, and saves the full JSON in `spike-audio/out/`.

- [ ] Files 1-10 run once with the correct language
- [ ] Files 1, 5, 8 run again with auto-detect (no `--lang`)
- [ ] File 4 (m4a) accepted or rejected, noted
- [ ] Any error message copied down exactly (a rejected file gives a clear error)

## 3. The seven questions

Fill the answers into `docs/spike/sarvam-findings.md` (template at the bottom).

**Q1: Is browser WebM/Opus accepted?** Files 1-3, 5-10 run without a format error. *Pass:* yes. *If no:* stop and tell me; we need server-side conversion before Task 7 is real.

**Q2: Does a 6+ minute recording work?** File 2 completes. Note the processing time. *Pass:* completes, transcript covers the whole recording (check the end of the text).

**Q3: Are the timestamps usable?** Open the JSON for file 2. The script prints `looks word-level`, average words per chunk and chunk seconds (min/avg/max). *Good for tap-to-hear:* chunks are about a sentence, a few seconds long, in order, non-overlapping, and cover the whole audio. *Bad:* one huge chunk, or timestamps missing. Run one file with `--no-timestamps` and note what changes. Settle also whether `withTimestamps: true` gave **word-level** output (the SDK says so, Sarvam's docs say chunk-level only). If words come back, say so, it changes Plan 2.

**Q4: How accurate on dish and ingredient names?** For files 1-8, compare the transcript with your `truth.md`. Per file, count: key words correct, key words wrong or missing, and anything invented. Record a rough score such as "7 of 10 key words right". Note which language is worst.

**Q5: Does `keyterms` help?** Re-run files 1, 3 and 5 with your own key words:

```bash
npx tsx scripts/sarvam-spike.ts spike-audio/hi-noise.webm --lang hi-IN --terms "jeera,hing,methi,kasuri methi,andaaz"
```

Compare the two transcripts of the same file. *Pass:* clearly fewer wrong key words. Note how many terms you passed (the limit is 50).

**Q6: Does the batch webhook (callback) fire, and what does it send?** This needs a public URL, so it is checked in Task 12 after the first deploy. Leave a note here: "deferred to Task 12". Remember to log the raw callback body, the header name and the `job_state` casing.

**Q7: Does the AI Gateway call work, and which model structures well?** First a smoke test:

```bash
curl -s https://ai-gateway.vercel.sh/v1/chat/completions \
  -H "Authorization: Bearer $AI_GATEWAY_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"google/gemini-2.5-flash-lite","messages":[{"role":"user","content":"say ok"}]}' | head -c 400
```

Then compare models on 5 real transcripts (use one Hindi, one Tamil, one South Indian, one Hinglish, one noisy):

```bash
npx tsx scripts/structure-compare.ts \
  --models google/gemini-2.5-flash-lite,google/gemini-2.5-flash,anthropic/claude-haiku-4.5 \
  spike-audio/out/hi-short-quiet.webm/*.json spike-audio/out/ta-quiet.webm/*.json
```

Read the saved JSON in `spike-audio/structure/` next to the raw transcript. Score each model per recipe:
- [ ] Output is in the **same language and script** (not translated, not transliterated)
- [ ] **Nothing invented** (no ingredient or step the speaker did not say)
- [ ] Quantities kept as spoken ("andaaz se", "ek chammach")
- [ ] Title sensible
- [ ] JSON valid on the first try (the script retries once; a failure shows as `FAILED`)

*Choose* the cheapest model that passes all five on all recipes. Cost is about ₹0.13 for flash-lite and about ₹1.6 for Haiku per recipe, so a small quality gap may be worth paying for.

## 4. Special cases to look at

- [ ] **File 10 (silent):** what does Sarvam return, an empty transcript, an error, or invented text? This is the `no_speech` path; an invented transcript would be a problem.
- [ ] **File 9 (two voices):** does the transcript run both voices together? Acceptable for v1, but note it.
- [ ] **Numbers and fractions:** did "ek aur aadha" become "1.5" or stay as words? Note which you prefer.
- [ ] **Script:** Devanagari or romanised? The app assumes native script.

## 5. Decisions to write down

At the end of `sarvam-findings.md`, answer in one line each:
1. **Is WebM accepted** or do we need conversion?
2. **Tap-to-hear:** are chunks good enough, or is a different review design needed?
3. **Keyterms:** always send a recipe-vocabulary list? Which list?
4. **Language:** send the user's language, or leave it on auto-detect?
5. **Structuring model** for v1.
6. **Seeking:** play one of your WebM files in the browser audio tag and try dragging the seek bar. If it will not seek or shows no duration, note it. We will need to convert audio on the server for Plan 2.

## Findings template (copy to `docs/spike/sarvam-findings.md`)

```markdown
# Sarvam and structuring spike findings

Date: YYYY-MM-DD   SDK: sarvamai x.y.z   Model: saaras:v4

## Q1 WebM accepted: yes/no
Evidence (file, job id, error text):

## Q2 Long audio (6+ min): yes/no, processing time:

## Q3 Timestamps
- word-level or chunk-level:
- chunk seconds min/avg/max, words per chunk:
- usable for tap-to-hear: yes/no, why:

## Q4 Accuracy (key words right / total)
| file | language | right | wrong or missing | invented |
|---|---|---|---|---|

## Q5 keyterms: helped / no effect (before and after on file X)

## Q6 Webhook: deferred to Task 12

## Q7 Gateway and structuring model
- gateway call works: yes/no, working model id:
- scores (same language, nothing invented, quantities, title, valid JSON):
- chosen model:

## Special cases
- silent audio returns:
- two voices:
- numbers:
- seek bar in the browser:

## Decisions for Plan 2
1. WebM conversion needed:
2. Tap-to-hear design:
3. Keyterms list:
4. Language setting:
5. Structuring model:
6. Server-side audio conversion for seeking:
```
