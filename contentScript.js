/**
 * Content Script - Detects professor names and injects rating badges
 * Works on University of Houston course catalog and schedule pages
 */

// Configuration for DOM selectors
const SELECTORS = {
  // TODO: Update these selectors based on actual UH course catalog pages
  // Common patterns to look for:
  // - Table cells with instructor names
  // - Spans/divs with class names like "instructor", "faculty", "professor"
  // - Elements within course listings

  instructorElements: [
    // UH-specific selectors (PeopleSoft system)
    'span.ps_box-value[id*="SSR_INSTR_LONG"]',  // Most specific - targets instructor fields

    // Generic selectors (fallback for other pages)
    '.instructor-name',          // Class-based selector
    '.faculty-name',
    '[data-instructor]',         // Data attribute selector
    'td.instructor',             // Table cell with class
    '.course-instructor',
    'span[title*="Instructor"]', // Attribute contains

    // Generic fallback (be careful with these - they may match too much)
    // Uncomment and test carefully:
    // 'td:nth-child(4)',        // If instructors are always in 4th column
    // '.schedule-row .instructor'
  ],

  // Elements to exclude (navigation, headers, etc.)
  excludeElements: [
    'nav',
    'header',
    'footer',
    '.navigation',
    '.menu'
  ]
};

// Track processed elements to avoid duplicates
const processedElements = new WeakSet();

// Track active badges
const activeBadges = new Map();

let courseMateTooltip = null;
const hoverState = {
  activeBadge: null,
  hideTimeout: null,
  requestId: 0
};

/**
 * Extract professor name from element
 */
function extractProfessorName(element) {
  let text = element.textContent.trim();

  // Skip empty or very short text
  if (!text || text.length < 3) return null;

  // Skip common non-name patterns
  const skipPatterns = [
    /^(TBA|TBD|Staff|Various|Multiple|Online)$/i,
    /^\d+$/,  // Just numbers
    /^[A-Z]{2,5}\s*\d{4}$/,  // Course codes like "CS 1234"
  ];

  for (const pattern of skipPatterns) {
    if (pattern.test(text)) return null;
  }

  // Look for name patterns
  // Matches: "Last, First", "First Last", "First M. Last"
  const namePatterns = [
    /^([A-Z][a-z]+),\s*([A-Z][a-z]+)/,  // Last, First
    /^([A-Z][a-z]+)\s+([A-Z]\.?\s+)?([A-Z][a-z]+)$/,  // First M. Last or First Last
    /^([A-Z\s]+),\s*([A-Z\s]+)$/  // ALL CAPS: LAST, FIRST
  ];

  for (const pattern of namePatterns) {
    if (pattern.test(text)) {
      return text;
    }
  }

  return null;
}

/**
 * Try to find a course code near the instructor element
 */
function findCourseInfo(element) {
  const coursePattern = /\b([A-Z]{2,4})\s*([0-9]{4})\b/;
  const container = element.closest('tr') || element.closest('[role="row"]') || element.parentElement;

  if (!container) {
    return null;
  }

  const match = container.textContent.match(coursePattern);
  if (!match) {
    return null;
  }

  const subject = match[1].toUpperCase();
  const catalog = match[2];
  return {
    subject,
    catalog,
    display: `${subject} ${catalog}`
  };
}

function findSectionContainer(element) {
  let node = element;
  while (node && node !== document.body) {
    if (node.matches && node.matches('tr, [role="row"]')) {
      const text = node.textContent.toUpperCase();
      if (/\bLECTURE\b|\bLEC\b|\bLABORATORY\b|\bLAB\b/.test(text)) {
        return node;
      }
    }
    node = node.parentElement;
  }

  return element.closest('tr') || element.closest('[role="row"]') || element.parentElement;
}

function isLabSection(element) {
  const container = findSectionContainer(element);
  if (!container) {
    return false;
  }

  const text = container.textContent.toUpperCase();
  const hasLab = /\bLAB\b|\bLABORATORY\b/.test(text);
  const hasLecture = /\bLEC\b|\bLECTURE\b/.test(text);
  return hasLab && !hasLecture;
}

function isDuplicateOptionRow(element, professorName) {
  const row = element.closest('tr');
  if (!row || !professorName) {
    return false;
  }

  const cells = Array.from(row.children).filter(node => node.nodeType === Node.ELEMENT_NODE);
  if (cells.length === 0) {
    return false;
  }

  const firstCellText = cells[0].textContent.trim();
  if (firstCellText !== '') {
    return false;
  }

  const previousRow = row.previousElementSibling;
  if (!previousRow || !previousRow.matches('tr')) {
    return false;
  }

  const previousText = previousRow.textContent || '';
  if (!previousText.includes(professorName)) {
    return false;
  }

  const upper = previousText.toUpperCase();
  const hasLecture = /\bLEC\b|\bLECTURE\b/.test(upper);
  return hasLecture || !/\bLAB\b|\bLABORATORY\b/.test(upper);
}

function shouldShowForLectureOnly(element) {
  const row = element.closest('tr');
  if (!row) {
    return true;
  }

  let classGroups = Array.from(
    row.querySelectorAll('td.CMPNT_CLASS_NBR .ps_box-link')
  );
  if (classGroups.length === 0) {
    classGroups = Array.from(
      row.querySelectorAll('td.CMPNT_CLASS_NBR a[id*="SSR_CLSRCH_F_WK_SSR_CMPNT_DESCR"]')
    );
  }
  if (classGroups.length === 0) {
    return true;
  }

  const cell = element.closest('td');
  if (!cell) {
    return true;
  }

  const instructorGroup = element.closest('.ps_box-longedit, .ps_box-edit, .ps_box-link') || element;
  const instructorGroups = Array.from(
    cell.querySelectorAll('.ps_box-longedit, .ps_box-edit, .ps_box-link')
  );
  const elementIndex = instructorGroups.indexOf(instructorGroup);
  const classIndex = elementIndex >= 0 && elementIndex < classGroups.length ? elementIndex : 0;
  const classText = (classGroups[classIndex]?.textContent || '').toUpperCase();

  if (!classText) {
    return true;
  }

  const isLecture = /\bLEC\b|\bLECTURE\b/.test(classText);
  const isLab = /\bLAB\b|\bLABORATORY\b/.test(classText);
  return isLecture || !isLab;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncateText(text, maxLength) {
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function ensureTooltip() {
  if (courseMateTooltip) {
    return courseMateTooltip;
  }

  courseMateTooltip = document.createElement('div');
  courseMateTooltip.className = 'coursemate-tooltip';
  courseMateTooltip.addEventListener('mouseenter', () => {
    if (hoverState.hideTimeout) {
      clearTimeout(hoverState.hideTimeout);
    }
  });
  courseMateTooltip.addEventListener('mouseleave', () => {
    scheduleHideTooltip();
  });

  document.body.appendChild(courseMateTooltip);
  return courseMateTooltip;
}

function positionTooltip(target) {
  const tooltip = ensureTooltip();
  const rect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  const padding = 10;

  let top = rect.bottom + padding;
  let left = rect.left;

  if (top + tooltipRect.height > window.innerHeight) {
    top = rect.top - tooltipRect.height - padding;
  }
  if (left + tooltipRect.width > window.innerWidth - padding) {
    left = window.innerWidth - tooltipRect.width - padding;
  }
  if (left < padding) {
    left = padding;
  }

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function renderTooltipContent({ professorName, baseData, hoverData, courseInfo, loading, error }) {
  const tooltip = ensureTooltip();
  const displayName = professorName || baseData?.name || 'Professor';
  const rating = baseData?.overallRating ? baseData.overallRating.toFixed(1) : 'N/A';
  const difficulty = baseData?.difficulty !== undefined ? baseData.difficulty.toFixed(1) : 'N/A';
  const wouldTakeAgain = baseData?.wouldTakeAgainPercent !== undefined ? `${baseData.wouldTakeAgainPercent}%` : 'N/A';
  const rmpUrl = baseData?.rmpUrl;
  const reviews = hoverData?.reviews || [];
  const isLoading = loading && !hoverData;

  const reviewsHtml = isLoading
    ? '<div class="coursemate-tooltip-loading">Loading reviews...</div>'
    : reviews.length > 0 ? reviews.map(review => `
      <div class="coursemate-review">"${escapeHtml(truncateText(review.comment || '', 160))}"</div>
    `).join('') : '<div class="coursemate-tooltip-loading">No recent reviews found.</div>';

  tooltip.innerHTML = `
    <div class="coursemate-tooltip-header">
      <div class="coursemate-tooltip-name">${escapeHtml(displayName)}</div>
      <div class="coursemate-tooltip-rating">${rating} *</div>
    </div>
    <div class="coursemate-tooltip-subheader">Difficulty: ${difficulty} | ${wouldTakeAgain} Would Take Again</div>
    <div class="coursemate-tooltip-section">
      <div class="coursemate-tooltip-section-title">Recent Reviews</div>
      ${reviewsHtml}
    </div>
    <div class="coursemate-tooltip-footer">
      ${rmpUrl ? `<a class="coursemate-tooltip-link" href="${rmpUrl}" target="_blank" rel="noreferrer">View on RMP -></a>` : '<span></span>'}
    </div>
  `;

  if (error) {
    tooltip.innerHTML += `<div class="coursemate-tooltip-loading">${escapeHtml(error)}</div>`;
  }
}

function scheduleHideTooltip() {
  if (hoverState.hideTimeout) {
    clearTimeout(hoverState.hideTimeout);
  }

  hoverState.hideTimeout = setTimeout(() => {
    const tooltip = ensureTooltip();
    tooltip.classList.remove('show');
    hoverState.activeBadge = null;
  }, 150);
}

async function showTooltipForBadge(badge, baseData, context) {
  const tooltip = ensureTooltip();
  hoverState.activeBadge = badge;
  hoverState.requestId += 1;
  const requestId = hoverState.requestId;

  renderTooltipContent({
    professorName: context.professorName,
    baseData,
    hoverData: context.hoverData,
    courseInfo: context.courseInfo,
    loading: !context.hoverData
  });

  tooltip.classList.add('show');
  positionTooltip(badge);

  if (context.hoverData || context.loadingPromise) {
    return;
  }

  context.loadingPromise = chrome.runtime.sendMessage({
    action: 'getHoverData',
    professorName: context.professorName,
    teacherId: baseData?.rmpId,
    courseInfo: context.courseInfo
  }).then((response) => {
    context.hoverData = response || null;
  }).catch((error) => {
    context.hoverData = { error: error.message };
  }).finally(() => {
    context.loadingPromise = null;
    if (hoverState.activeBadge !== badge || requestId !== hoverState.requestId) {
      return;
    }
    renderTooltipContent({
      professorName: context.professorName,
      baseData,
      hoverData: context.hoverData,
      courseInfo: context.courseInfo,
      loading: false,
      error: context.hoverData?.error
    });
    positionTooltip(badge);
  });
}

/**
 * Check if element should be excluded
 */
function shouldExclude(element) {
  // Check if element or any parent matches exclude selectors
  for (const selector of SELECTORS.excludeElements) {
    if (element.closest(selector)) {
      return true;
    }
  }

  // Check if already processed
  if (processedElements.has(element)) {
    return true;
  }

  return false;
}

/**
 * Create loading badge
 */
function createLoadingBadge() {
  const badge = document.createElement('span');
  badge.className = 'coursemate-badge coursemate-loading';
  badge.textContent = '...';
  badge.title = 'Loading professor rating...';
  return badge;
}

/**
 * Create rating badge
 */
function createRatingBadge(data, context) {
  const badge = document.createElement('span');
  badge.className = 'coursemate-badge coursemate-found';

  const rating = data.overallRating.toFixed(1);
  const ratingClass = rating >= 4.0 ? 'rating-high' : rating >= 3.0 ? 'rating-medium' : 'rating-low';

  badge.innerHTML = `
    <span class="rating ${ratingClass}">${rating}</span>
    <span class="rating-count">(${data.numRatings})</span>
  `;

  // Build accessible label
  const tooltipParts = [
    `Overall: ${rating}/5.0`,
    `${data.numRatings} ratings`
  ];

  if (data.wouldTakeAgainPercent !== undefined) {
    tooltipParts.push(`Would take again: ${data.wouldTakeAgainPercent}%`);
  }

  if (data.difficulty !== undefined) {
    tooltipParts.push(`Difficulty: ${data.difficulty.toFixed(1)}/5.0`);
  }

  badge.setAttribute('aria-label', tooltipParts.join('. '));

  // Click handler to open RMP page
  badge.style.cursor = 'pointer';
  badge.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (data.rmpUrl) {
      window.open(data.rmpUrl, '_blank');
    }
  });

  const badgeContext = {
    professorName: context?.professorName,
    courseInfo: context?.courseInfo,
    hoverData: null,
    loadingPromise: null
  };

  activeBadges.set(badge, { baseData: data, context: badgeContext });
  badge.addEventListener('mouseenter', () => {
    const state = activeBadges.get(badge);
    if (state) {
      showTooltipForBadge(badge, state.baseData, state.context);
    }
  });
  badge.addEventListener('mouseleave', () => {
    scheduleHideTooltip();
  });

  return badge;
}

/**
 * Create "not found" badge
 */
function createNotFoundBadge() {
  const badge = document.createElement('span');
  badge.className = 'coursemate-badge coursemate-not-found';
  badge.textContent = '?';
  badge.title = 'No ratings found on RateMyProfessors';
  return badge;
}

/**
 * Create error badge
 */
function createErrorBadge(message) {
  const badge = document.createElement('span');
  badge.className = 'coursemate-badge coursemate-error';
  badge.textContent = '!';
  badge.title = `Error: ${message}`;
  return badge;
}

/**
 * Insert badge next to professor name
 */
function insertBadge(element, badge) {
  // Check if badge already exists
  const existingBadge = element.querySelector('.coursemate-badge');
  if (existingBadge) {
    activeBadges.delete(existingBadge);
    existingBadge.replaceWith(badge);
  } else {
    // Insert badge after the text content
    element.style.position = 'relative';
    element.appendChild(document.createTextNode(' '));
    element.appendChild(badge);
  }
}

/**
 * Process a single professor name element
 */
async function processProfessorElement(element) {
  // Skip if already processed or should be excluded
  if (shouldExclude(element)) {
    return;
  }

  const professorName = extractProfessorName(element);
  if (!professorName) {
    return;
  }

  if (isLabSection(element) || isDuplicateOptionRow(element, professorName) || !shouldShowForLectureOnly(element)) {
    return;
  }

  // Mark as processed
  processedElements.add(element);

  const courseInfo = findCourseInfo(element);
  console.log(`[CourseMate] Found professor: ${professorName}`);
  if (courseInfo) {
    console.log(`[CourseMate] Matched course: ${courseInfo.display}`);
  }

  // Insert loading badge
  const loadingBadge = createLoadingBadge();
  insertBadge(element, loadingBadge);

  try {
    // Request data from background script
    const response = await chrome.runtime.sendMessage({
      action: 'getProfessorData',
      professorName: professorName,
      school: window.location.hostname
    });

    let finalBadge;

    if (response.error) {
      finalBadge = createErrorBadge(response.error);
    } else if (response.found && response.data) {
      finalBadge = createRatingBadge(response.data, {
        professorName,
        courseInfo
      });
    } else {
      finalBadge = createNotFoundBadge();
    }

    // Replace loading badge with final badge
    insertBadge(element, finalBadge);

  } catch (error) {
    console.error('[CourseMate] Error processing professor:', error);
    const errorBadge = createErrorBadge(error.message);
    insertBadge(element, errorBadge);
  }
}

/**
 * Scan page for professor names
 */
function scanPage() {
  console.log('[CourseMate] Scanning page for professors...');

  for (const selector of SELECTORS.instructorElements) {
    try {
      const elements = document.querySelectorAll(selector);
      console.log(`[CourseMate] Found ${elements.length} elements matching "${selector}"`);

      elements.forEach(element => {
        processProfessorElement(element);
      });
    } catch (error) {
      console.error(`[CourseMate] Error with selector "${selector}":`, error);
    }
  }
}

/**
 * Initialize MutationObserver to watch for dynamic content
 */
function initMutationObserver() {
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;

    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        // Check if any added nodes might contain instructor info
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            shouldScan = true;
            break;
          }
        }
      }
    }

    if (shouldScan) {
      console.log('[CourseMate] DOM changed, re-scanning...');
      // Debounce scanning
      clearTimeout(window.courseMateScanTimeout);
      window.courseMateScanTimeout = setTimeout(scanPage, 500);
    }
  });

  // Observe the entire document body
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  console.log('[CourseMate] MutationObserver initialized');
}

/**
 * Initialize content script
 */
function init() {
  console.log('[CourseMate] Content script loaded');

  // Wait for DOM to be fully loaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
    return;
  }

  // Initial scan
  scanPage();

  // Watch for dynamic changes
  initMutationObserver();

  // Re-scan when page visibility changes (in case content loaded while tab was hidden)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      console.log('[CourseMate] Page became visible, re-scanning...');
      scanPage();
    }
  });

  window.addEventListener('scroll', () => {
    scheduleHideTooltip();
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (hoverState.activeBadge) {
      positionTooltip(hoverState.activeBadge);
    }
  });
}

// Start the extension
init();

/**
 * TESTING HELPER FUNCTIONS
 * These can be called from the browser console for debugging
 */
window.courseMateDebug = {
  // Force re-scan
  scan: scanPage,

  // Test name extraction
  testName: (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return extractProfessorName(div);
  },

  // Show current selectors
  showSelectors: () => {
    console.log('Current selectors:', SELECTORS);
  },

  // Add custom selector
  addSelector: (selector) => {
    SELECTORS.instructorElements.push(selector);
    console.log(`Added selector: ${selector}`);
    scanPage();
  },

  // Clear processed cache and re-scan
  reset: () => {
    processedElements.clear();
    activeBadges.clear();
    // Remove existing badges
    document.querySelectorAll('.coursemate-badge').forEach(b => b.remove());
    scanPage();
  }
};

console.log('[CourseMate] Debug helpers available: window.courseMateDebug');
