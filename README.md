# CourseMate

A Chrome/Firefox extension that injects RateMyProfessors ratings directly into university course registration pages — so you can see who's teaching before you register.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-blue)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-green)
![License](https://img.shields.io/badge/license-MIT-blue)

---

## Supported Schools

| School | Branch | Registration System | Domain |
|--------|--------|---------------------|--------|
| University of Houston | `main` | PeopleSoft | `*.uh.edu` |
| University of North Texas | `coursemate-unt` | PeopleSoft | `*.unt.edu` |
| UT San Antonio | `coursemate-utsa` | Ellucian Banner SSB | `*.utsa.edu` |
| UT Austin | `coursemate-utaustin` | PeopleSoft | `*.utexas.edu` |
| UT Dallas | `coursemate-utd` | CollegeScheduler | `utdallas.collegescheduler.com` |

> **Testing all schools at once?** Use the `coursemate-test` branch — a single build that covers all five schools and auto-detects which one you're on.

**Coming soon (Group B — different registration systems):**
Texas A&M · Texas State · Texas Tech · Texas Southern

---

## Features

- **Automatic Detection** — Finds instructor names on supported registration pages (PeopleSoft, Banner SSB, CollegeScheduler)
- **Live RMP Ratings** — Shows overall rating, review count, difficulty, and "would take again %" directly on the page
- **Hover Tooltip** — Hover any badge to see up to 3 recent RMP reviews and a direct link to the full profile
- **Smart Matching** — Handles name format variants ("Last, First", "First Last", all-caps, hyphenated, compound surnames), first-name prefix matching (Matt ↔ Matthew), and department-based disambiguation when multiple professors share a last name
- **Cross-School Fallback** — Finds professors whose RMP profile is still listed under a previous institution (e.g., transferred from another school)
- **Not-Found Badge** — Shows `?` for professors not on RMP with a hover link to add their rating at `ratemyprofessors.com/add/professor`
- **Grey N/A Badge** — Professors with an RMP account but zero ratings show grey `N/A` instead of a misleading red `0.0`
- **CougarGrades Integration** — UH branch only: shows historical grade distribution (A–F %) and average GPA per professor/course, sourced from public CougarGrades data
- **Smart Caching** — Results cached for 7 days to minimize API calls; cache prefix is versioned so stale entries are automatically ignored after updates
- **Dynamic Content** — MutationObserver detects instructors loaded by AJAX/SPA frameworks (Banner SSB, CollegeScheduler)
- **Privacy Focused** — All data stored locally via `chrome.storage.local`; nothing sent to third parties except RateMyProfessors when fetching ratings

---

## Installation

### Load Unpacked (Development / Testing)

1. **Clone the repo and check out the branch for your school**
   ```bash
   git clone https://github.com/Thenathanb/CourseMate.git
   cd CourseMate
   git checkout coursemate-unt   # or main, coursemate-utsa, etc.
   ```

2. **Open Chrome Extensions**
   - Navigate to `chrome://extensions/`
   - Enable **Developer mode** (top-right toggle)

3. **Load Unpacked**
   - Click **Load unpacked**
   - Select the `CourseMate` folder (the one containing `manifest.json`)

4. **Test it**
   - Navigate to your school's course registration page
   - Instructor names will automatically get rating badges

### Multi-School Test Build

To test all five schools from a single extension install:

```bash
git checkout coursemate-test
```

Load that folder as an unpacked extension. It detects your current school from the hostname and uses the correct RMP school ID automatically.

---

## Branch Structure

```
main                  UH (PeopleSoft) — includes CougarGrades
├── coursemate-unt    UNT (PeopleSoft) — CougarGrades removed
├── coursemate-utsa   UTSA (Banner SSB) — CougarGrades removed
├── coursemate-utaustin  UT Austin (PeopleSoft) — CougarGrades removed
├── coursemate-utd    UTD (CollegeScheduler) — CougarGrades removed
└── coursemate-test   Multi-school build (all 5 schools, auto-detect)
```

Each school branch is an independent, deployable extension — only the school-specific values differ:

| Config | Location |
|--------|----------|
| RMP School ID | `background.js` → `SCHOOL_CONFIGS` |
| Domain matches | `manifest.json` → `host_permissions` / `content_scripts.matches` |
| School name filter | `background.js` → `SCHOOL_CONFIGS` |
| Accent color | `ui.css` → `.coursemate-grade-bar-fill` |

---

## How It Works

### Rating Lookup

1. Content script detects instructor name elements using system-specific CSS selectors
2. Sends name + hostname to the background service worker
3. Background looks up the school config from hostname, queries RMP's GraphQL API
4. **Three-attempt matching strategy:**
   - Attempt 1: search by last name with school ID filter
   - Attempt 2: swap first/last (handles "Last First" without comma)
   - Attempt 3: search without school ID (catches transferred professors)
5. Within each attempt, candidates are scored by first-name prefix match and department ↔ course subject alignment before a winner is selected
6. Result is cached for 7 days

### Supported Registration Systems

| System | Selector used |
|--------|--------------|
| PeopleSoft | `span.ps_box-value[id*="SSR_INSTR_LONG"]` |
| Ellucian Banner SSB | `td[data-property="instructor"]` (anchor or plain text) |
| CollegeScheduler | `[id^="instructor-option-"] > span:first-child` |

---

## File Structure

```
CourseMate/
├── manifest.json          # Extension configuration (MV3)
├── background.js          # Service worker: RMP API, caching, school routing
├── contentScript.js       # DOM detection, badge injection, tooltip
├── ui.css                 # Badge and tooltip styling
├── options.html           # Settings page
├── icons/                 # Extension icons (16px, 48px, 128px)
└── README.md
```

---

## Settings

Click the CourseMate icon in the Chrome toolbar to open settings:

- **Enable/Disable** — Toggle the extension on or off
- **Default School** — University to search (auto-detected by hostname in most cases)
- **Cache Duration** — How long to remember ratings (default: 7 days)
- **Debug Mode** — Enable detailed console logging
- **Clear Cache** — Force fresh lookups for all professors

---

## Adding a New School

**If the school uses PeopleSoft or Banner SSB:**

1. Branch from `main`:
   ```bash
   git checkout main
   git checkout -b coursemate-<schoolname>
   ```

2. Update `manifest.json` — set `host_permissions` and `content_scripts.matches` to the school's domain

3. Update `background.js` — add an entry to `SCHOOL_CONFIGS`:
   ```js
   'school.edu': { schoolId: '<base64 RMP school ID>', filter: '<school name lowercase>' }
   ```
   To get the RMP school ID: find the school at `ratemyprofessors.com`, note the numeric ID in the URL, then `btoa('School-<id>')`.

4. Update `options.html` — change the school name in the settings page

5. Remove CougarGrades (UH-only): delete `COUGARGRADES_CONFIG` and related functions from `background.js`, and the grade distribution section from `contentScript.js`

**If the school uses a different registration system:**
Inspect the instructor name element, identify a unique CSS selector, add it to `SELECTORS.instructorElements` in `contentScript.js`, and add lenient name extraction if the system wraps names in known containers.

---

## RMP School IDs (Texas Schools)

| School | RMP URL | Base64 ID |
|--------|---------|-----------|
| University of Houston | /school/1109 | `U2Nob29sLTExMDk=` |
| University of North Texas | /school/1252 | `U2Nob29sLTEyNTI=` |
| UT San Antonio | /school/1516 | `U2Nob29sLTE1MTY=` |
| UT Austin | /school/1255 | `U2Nob29sLTEyNTU=` |
| UT Dallas | /school/1273 | `U2Nob29sLTEyNzM=` |
| Texas A&M | /school/1003 | `U2Nob29sLTEwMDM=` |
| Texas Southern | /school/1010 | `U2Nob29sLTEwMTA=` |
| Texas Tech | /school/1011 | `U2Nob29sLTEwMTE=` |
| Texas State | /school/938 | `U2Nob29sLTkzOA==` |

---

## Privacy & Permissions

- **No personal data collected** — CourseMate does not track users or collect analytics
- **Local storage only** — Cached ratings live in `chrome.storage.local` on your device
- **External requests** — Only to `ratemyprofessors.com` (rating lookups) and `unpkg.com` / `cougargrades.io` (UH branch only, for grade distribution data)

### Permissions used

| Permission | Reason |
|------------|--------|
| `storage` | Cache ratings and settings locally |
| `host_permissions` (school domains) | Run content script on registration pages |
| `host_permissions` (ratemyprofessors.com) | Fetch professor ratings |

---

## Disclaimer

CourseMate is not affiliated with, endorsed by, or connected to RateMyProfessors.com, University of Houston, or any other university. Professor ratings are user-submitted content from RateMyProfessors and may not reflect actual teaching quality.

---

## Support / Issues

[GitHub Issues](https://github.com/Thenathanb/CourseMate/issues)

---

**Version:** 1.0.0  
**Last Updated:** June 2026
