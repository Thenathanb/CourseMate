# Privacy Policy for CourseMate

**Last Updated:** November 2, 2026

## Overview

CourseMate shows RateMyProfessors ratings and CougarGrades grade distributions next to instructor names on University of Houston course registration pages. It does not collect any personal information.

## Data Collection

**CourseMate does NOT collect, store, or transmit any personal information.**

Specifically, we do NOT collect:

- Your name, email, student ID, or contact information
- Your UH login or account details
- Your browsing history
- Your search queries
- Your course selections, shopping cart, or schedule
- Any personally identifiable information (PII)

CourseMate has no server of its own and does not use analytics or tracking.

## Data Storage

The extension stores the following data **locally on your device only**:

1. **Professor Ratings Cache**: RateMyProfessors results are cached in your browser's local storage (7 days by default, adjustable in settings) to improve performance and reduce API calls. This cache includes:
   - Professor names
   - Overall ratings and number of ratings
   - Difficulty scores
   - "Would take again" percentages
   - RateMyProfessors profile links
2. **Grade Distribution Cache**: CougarGrades data is cached in your browser's local storage to reduce repeat requests. This cache includes:
   - Course codes
   - Instructor names
   - Grade distribution counts and percentages, average GPA, and withdrawal rates
3. **Extension Settings**: Whether the extension is enabled, your default school, how long to cache ratings, and whether debug mode is on.

All data is stored locally using Chrome's `chrome.storage.local` API and **never leaves your device**. Recent reviews shown in the hover card are fetched when you hover over a badge and are not saved.

## Third-Party Services

CourseMate requests public data from two services. When you view a supported course page:

1. The extension reads instructor names and the course code from the page
2. It queries the RateMyProfessors public GraphQL API (`www.ratemyprofessors.com`) for ratings and reviews
3. It queries the CougarGrades public API (`api.cougargrades.io`) for grade distributions
4. The results are displayed on the page and cached locally

**No personal information is sent to external services.** Only professor names, course codes, and the University of Houston's RateMyProfessors school ID are used in these requests. These services' own privacy policies apply to requests made to them.

## Clipboard

The "Copy #" button in the hover card copies that section's class number to your clipboard, only when you click it. CourseMate never reads your clipboard.

## Permissions

- **storage**: To cache ratings, grade data, and your settings locally in your browser
- **host_permissions for *.uh.edu**: To show ratings on University of Houston course registration pages. The extension runs only on these pages.
- **host_permissions for www.ratemyprofessors.com**: To fetch professor ratings and reviews from the RateMyProfessors API
- **host_permissions for cougargrades.io**: To fetch grade distribution data from CougarGrades

## Data Sharing

**CourseMate does NOT share, sell, or transmit any data to third parties.**

The extension operates entirely within your browser. Its only external communication is the RateMyProfessors and CougarGrades requests described above.

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in the "Last Updated" date above and posted at this address.

## Contact

If you have questions about this privacy policy, email nathanbakare1@gmail.com or open an issue on the [GitHub repository](https://github.com/Thenathanb/CourseMate).

## Your Rights

You can:

- **Clear cached data**: Click the extension icon and use the "Clear Cache" button
- **Disable the extension**: Turn it off in the extension's settings or in Chrome's extension settings
- **Uninstall**: Remove the extension completely from your browser

All locally stored data is deleted when you uninstall the extension.

**CourseMate is not affiliated with or endorsed by the University of Houston, RateMyProfessors.com, or CougarGrades.io.**
