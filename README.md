# CourseMate

A Chrome Extension (Manifest V3) that injects RateMyProfessors ratings directly into university course registration pages — so you can see who's teaching before you register.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Installation

### Chrome Web Store (Recommended)

Install directly — no developer mode required:

**[➜ Install CourseMate on the Chrome Web Store](https://chromewebstore.google.com/detail/coursemate/opdladhnlkndlddmfmclfgknogjhnenl)**

1. Click the link above
2. Click **"Add to Chrome"**
3. Navigate to your university's course registration page — badges appear automatically

### Load Unpacked (Development)

1. Clone this repo
2. Go to `chrome://extensions/` and enable **Developer mode**
3. Click **"Load unpacked"** and select the `CourseMate-UH` folder
4. Reload your registration page

---

## Supported Schools

| School | Registration System | Domain |
|--------|---------------------|--------|
| University of Houston | PeopleSoft | `*.uh.edu` |
| University of North Texas | PeopleSoft | `*.unt.edu` |
| UT San Antonio | Ellucian Banner SSB | `*.utsa.edu` |
| UT Austin | PeopleSoft | `*.utexas.edu` |
| UT Dallas | CollegeScheduler | `utdallas.collegescheduler.com` |
| Texas Southern University | Ellucian Banner SSB | `*.tsu.edu` |
| Texas State University | Ellucian Banner SSB | `reg-prod.ec.txstate.edu` |
| Texas A&M University | CollegeScheduler | `tamu.collegescheduler.com` |
| Texas Tech University | Ellucian Banner SSB | `registration.texastech.edu` |

The extension auto-detects which school you're on — no configuration needed.

---

## Features

- **Automatic Detection** — Finds instructor names on PeopleSoft, Ellucian Banner SSB, and CollegeScheduler pages
- **Instant Ratings** — Shows RMP rating, number of reviews, difficulty, and "would take again" %
- **Smart Matching** — Three-stage name matching with department alignment to prevent wrong-professor results
- **Cross-School Fallback** — If a professor isn't listed at your school on RMP, searches nationally with name + department verification
- **One-Click Access** — Click any badge to open the full RMP profile
- **Smart Caching** — Ratings cached locally for 7 days to minimize API calls
- **Dynamic Content** — MutationObserver handles pages that load instructors asynchronously
- **Privacy Focused** — All data stored locally, no tracking

---

## Branch Structure

| Branch | Purpose |
|--------|---------|
| `main` | Production build — all schools enabled |
| `coursemate-texas-state` | Texas State University specific work |
| `coursemate-texas-am` | Texas A&M University specific work |
| `coursemate-texas-tech` | Texas Tech University specific work |

School-specific changes go on that school's branch. Anything that ships to all schools lands on `main` first.

---

## How It Works

1. Content script detects instructor names on the registration page
2. Sends a lookup request to the background service worker
3. Background checks local cache — if miss, queries RateMyProfessors GraphQL API
4. Three-stage matching: exact name + dept → prefix match + dept → cross-school fallback
5. Badge injected next to the instructor name with rating, difficulty, and "would take again" %

---

## Privacy & Permissions

- **`storage`** — Cache ratings and settings locally
- **`host_permissions`** — Run on supported university registration pages and fetch from RateMyProfessors
- No personal data collected. No browsing history tracked. All cached data stays on your device.

---

## Disclaimer

CourseMate is not affiliated with, endorsed by, or connected to RateMyProfessors or any university listed above. All professor ratings are user-submitted content sourced from RateMyProfessors.com.
