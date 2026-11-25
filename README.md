# Pace Card

Target erg splits from your test results. Enter a test (1k, 2k, 6k, 20 min, 30 min or custom), then set a target as a **percentage of that test's power** or as **your 2k split plus seconds**. The page shows the split to hold, the watts, and the training zone (UT2 to AN) with stroke rate, heart rate and sample sessions.

It's a static site with no build step and no backend. Tests are saved in each rower's own browser (`localStorage`) and never leave the device.

## How the numbers are worked out

| What | How |
|---|---|
| Split | test time ÷ distance × 500 |
| Watts | Concept2 formula: 2.80 ÷ (split / 500)³ |
| % target | that percentage of the test's watts, converted back to a split |
| +seconds target | 2k split + seconds |
| 2k used for zones and +seconds | the most recent saved 2k by date rowed; with no 2k saved, an estimate from the selected test using Paul's Law (+5 s/500m per doubling of distance), marked "est." |
| Zones | 2k split + UT2 20–30 s, UT1 12–18 s, AT 5–10 s, TR −2 to +2 s, AN 5 s or more under, from [ErgManiac's zone guide](https://ergmaniac.com/blog/indoor-rowing-training-zones-explained) |

All of this lives in [`public/pace.js`](public/pace.js), with tests in [`test/pace.test.js`](test/pace.test.js).

## Coach links

Add a target to the URL and every rower sees their own split for it:

- `/?pct=65&test=2k`: 65% of each rower's 2k power
- `/?pct=70&test=20min`: 70% of each rower's 20-minute test power
- `/?sec=18`: 2k + 18 seconds

`test` can be `1k`, `2k`, `6k`, `20min` or `30min`. If a rower hasn't saved that test, the page asks them to add it. The **Copy link to this target** button builds these links.

## Develop

Needs Node 20 or later.

```bash
npm test
```

```bash
npm run dev
```

`npm run dev` serves `public/` at http://localhost:5173.

## Deploy on Vercel

Import the repo in Vercel. `vercel.json` sets the output directory to `public`, and there is no build command. Every push to `main` deploys.

Pace Card is not affiliated with Concept2 or ErgManiac.
