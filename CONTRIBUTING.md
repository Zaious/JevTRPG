# Contributing to JevTRPG

Thanks for wanting to help. Small, concrete changes are the easiest to review.

## Good first contributions

- **A skill or occupation that is missing or described badly.** Everything lives in
  [`systems/coc/system.yaml`](systems/coc/system.yaml) (Traditional Chinese, the source of truth) and the English and
  Japanese versions in [`systems/coc/locales/`](systems/coc/locales/). Descriptions must be your own words; please do
  not paste text from any published rulebook. After changing the lists, run `node web/worker/wire-freeze.mjs`
  (existing share links keep working only if you do; additions are fine, deletions and renames are refused).
- **A judgment that was clearly wrong.** Open an issue with the (made-up or anonymised) text, the skill, and what you
  expected. Please do not post a real résumé with personal details.
- **A translation fix**, especially the Japanese criteria, which are machine-translated and not yet reviewed.
- **Masking**: a phone, ID or address format that is not masked. Add it to [`web/public/redact.js`](web/public/redact.js)
  with a test for it *and* a test for something that looks similar but must stay (dates, years, amounts).

## Before you open a pull request

```bash
python web/build.py --check
node web/worker/test.mjs
cd web/worker && npm run dev        # another terminal: npm run e2e
```

Scoring exists twice (Python in `engine/`, JavaScript in `web/worker/src/`). If you touch one, `test.mjs` must still pass.
Do not add anything that stores what visitors paste, or sends it anywhere except the judging request.

## Not accepted

Text copied from a published rulebook, logos or artwork that belong to someone else, and anything that makes the site
a tracker.

## Licence

By contributing you agree that your contribution is licensed under the MIT License of this project.
