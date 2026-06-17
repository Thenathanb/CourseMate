/**
 * Background Service Worker (Manifest V3)
 * Handles professor data fetching, caching, and rate limiting
 */

console.log('[Background] Service worker started');

// Rate limiting configuration
const RATE_LIMIT = {
  requestsPerSecond: 1,
  lastRequestTime: 0
};

function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const mergedOptions = { ...options, signal: controller.signal };
  return fetch(url, mergedOptions).finally(() => clearTimeout(timeout));
}

// Cache configuration
const CACHE_CONFIG = {
  defaultTTL: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  prefix: 'courseMate_v6_'
};

/**
 * Mock Data Provider
 * Returns sample data for testing without external API calls
 */
const MockProvider = {
  professors: {
    // Normalized name format: "lastname_firstname_uh"
    'smith_john_uh': {
      name: 'John Smith',
      overallRating: 4.2,
      numRatings: 47,
      wouldTakeAgainPercent: 85,
      difficulty: 3.1,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/12345'
    },
    'johnson_sarah_uh': {
      name: 'Sarah Johnson',
      overallRating: 4.8,
      numRatings: 92,
      wouldTakeAgainPercent: 95,
      difficulty: 2.3,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/23456'
    },
    'williams_robert_uh': {
      name: 'Robert Williams',
      overallRating: 3.5,
      numRatings: 23,
      wouldTakeAgainPercent: 62,
      difficulty: 4.2,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/34567'
    },
    'davis_emily_uh': {
      name: 'Emily Davis',
      overallRating: 4.6,
      numRatings: 78,
      wouldTakeAgainPercent: 88,
      difficulty: 2.8,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/45678'
    },
    'su_wu-pei_uh': {
      name: 'Wu-Pei Su',
      overallRating: 4.7,
      numRatings: 35,
      wouldTakeAgainPercent: 90,
      difficulty: 3.5,
      rmpUrl: 'https://www.ratemyprofessors.com/professor/56789'
    }
  },

  async search(normalizedName) {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 100));

    const data = this.professors[normalizedName];
    if (data) {
      return {
        found: true,
        data: data
      };
    }

    return {
      found: false,
      message: 'Professor not found in mock data'
    };
  }
};

const SCHOOL_CONFIGS = {
  'uh.edu':       { schoolId: 'U2Nob29sLTExMDk=',  filter: 'university of houston' },
  'unt.edu':      { schoolId: 'U2Nob29sLTEyNTI=',  filter: 'university of north texas' },
  'utsa.edu':     { schoolId: 'U2Nob29sLTE1MTY=',  filter: 'university of texas at san antonio' },
  'utexas.edu':   { schoolId: 'U2Nob29sLTEyNTU=',  filter: 'university of texas at austin' },
  'utdallas.edu':              { schoolId: 'U2Nob29sLTEyNzM=', filter: 'university of texas at dallas' },
  'utdallas.collegescheduler.com': { schoolId: 'U2Nob29sLTEyNzM=', filter: 'university of texas at dallas' },
  'tsu.edu':           { schoolId: 'U2Nob29sLTEwMTA=', filter: 'texas southern' },
  'ec.tsu.edu':        { schoolId: 'U2Nob29sLTEwMTA=', filter: 'texas southern' },
  'txstate.edu':                    { schoolId: 'U2Nob29sLTkzOA==', filter: 'texas state university' },
  'ec.txstate.edu':                 { schoolId: 'U2Nob29sLTkzOA==', filter: 'texas state university' },
  'txstate.collegescheduler.com':   { schoolId: 'U2Nob29sLTkzOA==', filter: 'texas state university' },
  'tamu.collegescheduler.com':      { schoolId: 'U2Nob29sLTE5NDk2', filter: 'texas a&m' },
  'texastech.edu':                  { schoolId: 'U2Nob29sLTEwMTE=', filter: 'texas tech university' },
  'registration.texastech.edu':     { schoolId: 'U2Nob29sLTEwMTE=', filter: 'texas tech university' },
};

function getSchoolConfig(hostname) {
  for (const [domain, config] of Object.entries(SCHOOL_CONFIGS)) {
    if (hostname && hostname.endsWith(domain)) return config;
  }
  return SCHOOL_CONFIGS['uh.edu']; // fallback
}

/**
 * Real RMP Provider using GraphQL API
 */
const RMPProvider = {
  _buildData(prof) {
    return {
      rmpId: prof.id,
      name: `${prof.firstName} ${prof.lastName}`,
      overallRating: prof.avgRating,
      numRatings: prof.numRatings,
      wouldTakeAgainPercent: prof.wouldTakeAgainPercentRounded,
      difficulty: prof.avgDifficulty,
      rmpUrl: `https://www.ratemyprofessors.com/professor/${prof.legacyId}`
    };
  },

  async _queryRMP(searchText, schoolId, filter) {
    const url = 'https://www.ratemyprofessors.com/graphql';
    const query = `
      query NewSearchTeachersQuery($query: TeacherSearchQuery!, $count: Int) {
        newSearch {
          teachers(query: $query, first: $count) {
            edges {
              node {
                id
                legacyId
                firstName
                lastName
                school { name }
                department
                avgRating
                numRatings
                wouldTakeAgainPercentRounded
                avgDifficulty
              }
            }
          }
        }
      }
    `;
    const queryVars = schoolId
      ? { text: searchText, schoolID: schoolId }
      : { text: searchText };
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Basic dGVzdDp0ZXN0' },
      body: JSON.stringify({ query, variables: { query: queryVars, count: 10 } })
    }, 8000);
    const data = await response.json();
    const edges = data?.data?.newSearch?.teachers?.edges || [];
    if (!filter) return edges;
    return edges.filter(edge => (edge.node.school?.name || '').toLowerCase().includes(filter));
  },

  // Exact first+last name match only — used for cross-school fallback to avoid false positives
  _findExactMatch(professors, expectedFirst, expectedLast) {
    const expFirst = expectedFirst.toLowerCase();
    const expLast = expectedLast.toLowerCase();
    for (const edge of professors) {
      const prof = edge.node;
      if (prof.firstName.toLowerCase() === expFirst &&
          prof.lastName.toLowerCase() === expLast) {
        return { found: true, data: this._buildData(prof) };
      }
    }
    return null;
  },

  // Score how well a professor's RMP department matches the course subject code.
  _deptScore(department, subject) {
    if (!department || !subject) return 0;
    const dept = department.toLowerCase();
    const subj = subject.toLowerCase();
    if (dept.includes(subj)) return 3;
    const map = {
      math: ['math', 'calcul', 'algebra', 'statist', 'quantit'],
      cosc: ['computer', 'comput', 'software', 'inform tech', 'data sci'],
      csce: ['computer', 'comput', 'software'],
      hist: ['histor'],
      engl: ['english', 'literatur', 'writing', 'rhetoric', 'composition'],
      biol: ['biolog'],
      chem: ['chemi'],
      phys: ['physic'],
      psyc: ['psycholog'],
      econ: ['econom'],
      acct: ['account'],
      mgmt: ['manag', 'business admin'],
      mktg: ['market'],
      phil: ['philosoph'],
      soci: ['sociolog'],
      pols: ['politic', 'government', 'public admin'],
      comm: ['communicat', 'journalism', 'media'],
      arts: ['fine art', 'studio art', 'visual art'],
      musc: ['music'],
      kine: ['kinesiol', 'physical edu', 'exercise sci', 'sport'],
      hlth: ['health sci', 'health edu', 'public health', 'community health'],
      educ: ['educat'],
      nurs: ['nurs'],
      mece: ['mechanical eng', 'mechanic'],
      cive: ['civil eng'],
      geog: ['geograph'],
      anth: ['anthropolog'],
      fina: ['financ'],
      span: ['spanish', 'hispanic'],
      fren: ['french'],
      germ: ['german'],
      crij: ['criminal justice', 'criminolog'],
      // Alternate 3-letter subject codes (used by some TX schools)
      psy:  ['psycholog'],
      bio:  ['biolog'],
      che:  ['chemi'],
      phy:  ['physic'],
      eng:  ['english', 'literatur', 'writing', 'rhetoric', 'composition'],
      soc:  ['sociolog'],
      his:  ['histor'],
      gov:  ['politic', 'government'],
      eco:  ['econom'],
    };
    const keywords = map[subj] || [];
    if (keywords.some(k => dept.includes(k))) return 2;
    return 0;
  },

  _findMatch(professors, expectedFirst, expectedLast, courseInfo) {
    const expFirst = expectedFirst.toLowerCase();
    const expLast = expectedLast.toLowerCase();
    const subject = courseInfo?.subject;

    // 1. Exact first + last name match
    for (const edge of professors) {
      const prof = edge.node;
      if (prof.firstName.toLowerCase() === expFirst &&
          prof.lastName.toLowerCase() === expLast) {
        return { found: true, data: this._buildData(prof) };
      }
    }

    // Narrow to professors whose last name matches exactly OR whose hyphenated
    // last name starts with the searched last name (e.g. "Douglas" matches "Douglas-Butler").
    const lastMatches = professors.filter(edge => {
      const rmpLast = edge.node.lastName.toLowerCase().trim();
      return rmpLast === expLast ||
             rmpLast.startsWith(expLast + '-') ||
             rmpLast.startsWith(expLast + ' ');
    });

    if (lastMatches.length === 0) return null;

    // Score every last-name candidate.
    // evidenceScore: first-name and/or department match — MUST be > 0 to return any result.
    // rankScore: exact-last-name tie-breaker used only to sort among valid candidates.
    // This prevents Stephen Garcia (Health Science) from matching Victoria Garcia (English):
    // shared last name alone is never enough evidence.
    const scored = lastMatches.map(edge => {
      const prof = edge.node;
      const profFirst = prof.firstName.toLowerCase();
      const profLast = prof.lastName.toLowerCase().trim();
      let evidenceScore = 0;
      let rankScore = 0;

      // First-name prefix match — both names must be at least 2 chars to count as evidence.
      // This blocks "S" (initial) from matching "Stephen" or "" from matching anything.
      const firstNameMatch =
        expFirst.length >= 2 && profFirst.length >= 2 &&
        (profFirst.startsWith(expFirst) || expFirst.startsWith(profFirst));
      if (firstNameMatch) evidenceScore += 4;

      if (profLast === expLast) rankScore += 2; // tie-breaker only, not evidence
      evidenceScore += this._deptScore(prof.department, subject);

      return { prof, evidenceScore, rankScore };
    });

    // Only consider candidates with real evidence (first name or department match).
    const valid = scored.filter(c => c.evidenceScore > 0);
    if (valid.length === 0) return null;

    valid.sort((a, b) =>
      (b.evidenceScore + b.rankScore) - (a.evidenceScore + a.rankScore)
    );

    return { found: true, data: this._buildData(valid[0].prof) };
  },

  async search(lastName, firstName, hostname, courseInfo) {
    const { schoolId, filter } = getSchoolConfig(hostname);
    try {
      if (!PRODUCTION_MODE) console.log(`[RMP API] Attempt 1 — searching by lastName: "${lastName}"`);
      const byLast = await this._queryRMP(lastName, schoolId, filter);
      if (byLast.length > 0) {
        const match = this._findMatch(byLast, firstName, lastName, courseInfo);
        if (match) return match;
      }

      // Retry with firstName as the search key.
      // PeopleSoft sometimes shows "Last First" without a comma (e.g. "Chanana Poonam"),
      // so our parser assigns firstName/lastName backwards. Swapping fixes this.
      if (firstName && firstName.toLowerCase() !== lastName.toLowerCase()) {
        if (!PRODUCTION_MODE) console.log(`[RMP API] Attempt 2 — retrying with firstName as search: "${firstName}"`);
        const byFirst = await this._queryRMP(firstName, schoolId, filter);
        if (byFirst.length > 0) {
          const match = this._findMatch(byFirst, lastName, firstName, courseInfo);
          if (match) return match;
        }
      }

      // Fallback: search without school ID for professors whose RMP profile
      // is still listed under a previous school (e.g. transferred from Collin College to UNT).
      // Requires exact name match AND department must align with the course subject —
      // prevents a Biology "Victoria Garcia" from showing on an English course.
      if (!PRODUCTION_MODE) console.log(`[RMP API] Attempt 3 — cross-school fallback for: "${lastName}"`);
      const subject = courseInfo?.subject;
      const fallbackByLast = await this._queryRMP(lastName, null, null);

      // Helper: exact name match with required dept alignment when subject is known.
      const exactWithDept = (pool, expFirst, expLast) => {
        const expFirstLc = expFirst.toLowerCase();
        const expLastLc = expLast.toLowerCase();
        return pool.find(e => {
          const prof = e.node;
          if (prof.firstName.toLowerCase() !== expFirstLc) return false;
          if (prof.lastName.toLowerCase() !== expLastLc) return false;
          // If we know the subject, the professor's dept must align — no dept info = skip.
          if (subject && this._deptScore(prof.department, subject) === 0) return false;
          return true;
        }) || null;
      };

      // 1. Exact name + dept match at the correct school
      const sameSchoolPool = filter
        ? fallbackByLast.filter(e => (e.node.school?.name || '').toLowerCase().includes(filter))
        : fallbackByLast;
      const byLastSameSchool = exactWithDept(sameSchoolPool, firstName, lastName);
      if (byLastSameSchool) return { found: true, data: this._buildData(byLastSameSchool.node) };

      // 2. Exact name + dept match at any school (professor on RMP under a prior institution)
      const byLastAnySchool = exactWithDept(fallbackByLast, firstName, lastName);
      if (byLastAnySchool) return { found: true, data: this._buildData(byLastAnySchool.node) };

      if (firstName && firstName.toLowerCase() !== lastName.toLowerCase()) {
        const fallbackByFirst = await this._queryRMP(firstName, null, null);
        const sameSchoolPoolFirst = filter
          ? fallbackByFirst.filter(e => (e.node.school?.name || '').toLowerCase().includes(filter))
          : fallbackByFirst;
        const byFirstSameSchool = exactWithDept(sameSchoolPoolFirst, lastName, firstName);
        if (byFirstSameSchool) return { found: true, data: this._buildData(byFirstSameSchool.node) };
        const byFirstAnySchool = exactWithDept(fallbackByFirst, lastName, firstName);
        if (byFirstAnySchool) return { found: true, data: this._buildData(byFirstAnySchool.node) };
      }

      return { found: false, message: 'Professor not found on RMP' };
    } catch (error) {
      console.error('RMP API error:', error);
      return { found: false, message: error.message };
    }
  }
};

// Active provider - switch between MockProvider and real provider
const DataProvider = RMPProvider; // Using real RMP API now!

/**
 * Normalize professor name for cache keys and searches
 * Handles: "Last, First", "First Last", middle initials, suffixes
 */
function normalizeName(name, school = 'uh') {
  if (!name) return null;

  // Remove common suffixes
  let cleaned = name.replace(/\b(Jr\.?|Sr\.?|III?|IV|Ph\.?D\.?|M\.?D\.?)\b/gi, '').trim();

  // Remove extra whitespace
  cleaned = cleaned.replace(/\s+/g, ' ');

  let firstName = '';
  let lastName = '';

  // Handle "Last, First" format
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map(p => p.trim());
    lastName = parts[0];
    firstName = parts[1] ? parts[1].split(' ')[0] : ''; // Take first word after comma
  } else {
    // Handle "First Last" or "First Middle Last"
    const parts = cleaned.split(' ');
    if (parts.length >= 2) {
      firstName = parts[0];
      lastName = parts[parts.length - 1];
    } else {
      lastName = parts[0];
    }
  }

  // Convert to lowercase and create key
  const key = `${lastName.toLowerCase()}_${firstName.toLowerCase()}_${school.toLowerCase()}`;
  return key;
}

/**
 * Get cached professor data
 */
async function getFromCache(cacheKey) {
  try {
    const result = await chrome.storage.local.get([cacheKey, 'cacheTTL']);
    const cacheTTL = result.cacheTTL || CACHE_CONFIG.defaultTTL;

    if (result[cacheKey]) {
      const cached = result[cacheKey];
      const age = Date.now() - cached.timestamp;

      if (age < cacheTTL) {
        await logDebug(`Cache HIT for ${cacheKey} (age: ${Math.round(age / 1000 / 60)} minutes)`);
        return cached.data;
      } else {
        await logDebug(`Cache EXPIRED for ${cacheKey}`);
      }
    }
  } catch (error) {
    console.error('Cache read error:', error);
  }

  return null;
}

/**
 * Save professor data to cache
 */
async function saveToCache(cacheKey, data) {
  try {
    const cacheEntry = {
      timestamp: Date.now(),
      data: data
    };

    await chrome.storage.local.set({ [cacheKey]: cacheEntry });
    await logDebug(`Cached data for ${cacheKey}`);
  } catch (error) {
    console.error('Cache write error:', error);
  }
}

/**
 * Rate limiting check
 */
async function checkRateLimit() {
  const now = Date.now();
  const timeSinceLastRequest = now - RATE_LIMIT.lastRequestTime;
  const minInterval = 1000 / RATE_LIMIT.requestsPerSecond;

  if (timeSinceLastRequest < minInterval) {
    const waitTime = minInterval - timeSinceLastRequest;
    await logDebug(`Rate limit: waiting ${waitTime}ms`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }

  RATE_LIMIT.lastRequestTime = Date.now();
}

/**
 * Debug logging (only if debug mode enabled)
 */
async function logDebug(message) {
  try {
    const { debugMode } = await chrome.storage.local.get(['debugMode']);
    if (debugMode) {
      console.log(`[CourseMate] ${message}`);
    }
  } catch (error) {
    // Silently fail for logging
  }
}

// Disable verbose logging in production
const PRODUCTION_MODE = true;

/**
 * Parse professor name into first and last
 */
function parseProfessorName(fullName) {
  const cleaned = fullName.trim().replace(/\b(Jr\.?|Sr\.?|III?|IV|Ph\.?D\.?|M\.?D\.?)\b/gi, '').trim();

  let firstName = '';
  let lastName = '';
  let middleInitial = '';

  // Handle "Last, First" format
  if (cleaned.includes(',')) {
    const parts = cleaned.split(',').map(p => p.trim());
    lastName = parts[0];
    if (parts[1]) {
      const nameParts = parts[1].split(' ').filter(Boolean);
      firstName = nameParts[0] || '';
      if (nameParts.length > 1 && nameParts[1].length <= 2) {
        middleInitial = nameParts[1].replace('.', '');
      }
    }
  } else {
    // Handle "First Last" format
    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length >= 2) {
      firstName = parts[0];
      if (parts.length >= 3 && parts[1].length <= 2) {
        middleInitial = parts[1].replace('.', '');
      }
      lastName = parts[parts.length - 1];
    } else {
      lastName = parts[0];
    }
  }

  return { firstName, lastName, middleInitial };
}

/**
 * Fetch professor data (with caching and rate limiting)
 */
async function fetchProfessorData(professorName, school = 'uh.edu', courseInfo = null) {
  try {
    const { firstName, lastName } = parseProfessorName(professorName);

    if (!firstName || !lastName) {
      return { error: 'Invalid professor name' };
    }

    const normalizedName = normalizeName(professorName, school);
    await logDebug(`Fetching data for: ${professorName} (${firstName} ${lastName})`);

    // Check cache first
    const cacheKey = CACHE_CONFIG.prefix + normalizedName;
    const cached = await getFromCache(cacheKey);

    if (cached) {
      return cached;
    }

    // Check if extension is enabled
    const { extensionEnabled } = await chrome.storage.local.get(['extensionEnabled']);
    if (extensionEnabled === false) {
      return { error: 'Extension is disabled' };
    }

    // Apply rate limiting
    await checkRateLimit();

    // Fetch from provider (pass firstName and lastName)
    await logDebug(`Fetching from RMP API: ${lastName}, ${firstName}`);
    const result = await DataProvider.search(lastName, firstName, school, courseInfo);

    // Cache the result (even if not found, to prevent repeated lookups)
    await saveToCache(cacheKey, result);

    return result;

  } catch (error) {
    console.error('Error fetching professor data:', error);
    return { error: error.message };
  }
}

async function fetchRMPReviewsById(teacherId, count = 3) {
  if (!teacherId) {
    return [];
  }

  const url = 'https://www.ratemyprofessors.com/graphql';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Basic dGVzdDp0ZXN0'
  };

  const query = `
    query TeacherRatingsQuery($id: ID!, $count: Int) {
      node(id: $id) {
        ... on Teacher {
          ratings(first: $count) {
            edges {
              node {
                id
                class
                comment
                date
                qualityRating
                difficultyRating
                grade
                thumbsUpTotal
                thumbsDownTotal
                wouldTakeAgain
              }
            }
          }
        }
      }
    }
  `;

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ query, variables: { id: teacherId, count } })
    }, 8000);

    const data = await response.json();
    const edges = data?.data?.node?.ratings?.edges || [];
    return edges.map(edge => ({
      id: edge.node.id,
      course: edge.node.class,
      comment: edge.node.comment,
      date: edge.node.date,
      qualityRating: edge.node.qualityRating,
      difficultyRating: edge.node.difficultyRating,
      grade: edge.node.grade,
      thumbsUpTotal: edge.node.thumbsUpTotal,
      thumbsDownTotal: edge.node.thumbsDownTotal,
      wouldTakeAgain: edge.node.wouldTakeAgain
    }));
  } catch (error) {
    console.error('[CourseMate] RMP reviews fetch error:', error);
    return [];
  }
}

/**
 * Message listener for content script requests
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!PRODUCTION_MODE) console.log('[Background] Received message:', request.action);

  if (request.action === 'getProfessorData') {
    if (!PRODUCTION_MODE) console.log('[Background] Fetching professor data for:', request.professorName);
    fetchProfessorData(request.professorName, request.school, request.courseInfo)
      .then(data => {
        if (!PRODUCTION_MODE) console.log('[Background] Sending response:', data);
        sendResponse(data);
      })
      .catch(error => {
        console.error('[Background] Error:', error);
        sendResponse({ error: error.message });
      });

    return true; // Will respond asynchronously
  }

  if (request.action === 'getHoverData') {
    (async () => {
      try {
        const { professorName, teacherId, courseInfo } = request || {};
        const { firstName, lastName, middleInitial } = parseProfessorName(professorName || '');

        const reviews = await fetchRMPReviewsById(teacherId, 3).catch(() => []);

        sendResponse({ reviews });
      } catch (error) {
        console.error('[Background] Hover data error:', error);
        sendResponse({ error: error.message });
      }
    })();

    return true;
  }

  if (request.action === 'clearCache') {
    chrome.storage.local.clear()
      .then(() => {
        console.log('Cache cleared');
        sendResponse({ success: true });
      })
      .catch(error => sendResponse({ error: error.message }));

    return true;
  }

  if (request.action === 'logDebug') {
    logDebug(request.message);
    return false;
  }

  if (request.action === 'ping') {
    console.log('[Background] Ping received');
    sendResponse({ status: 'alive' });
    return false;
  }
});

/**
 * Initialize default settings on install
 */
chrome.runtime.onInstalled.addListener(async () => {
  const defaults = {
    extensionEnabled: true,
    defaultSchool: 'University of Houston',
    cacheTTL: CACHE_CONFIG.defaultTTL,
    debugMode: false
  };

  const existing = await chrome.storage.local.get(Object.keys(defaults));

  // Only set defaults for keys that don't exist
  const toSet = {};
  for (const [key, value] of Object.entries(defaults)) {
    if (existing[key] === undefined) {
      toSet[key] = value;
    }
  }

  if (Object.keys(toSet).length > 0) {
    await chrome.storage.local.set(toSet);
    console.log('CourseMate: Initialized with default settings');
  }
});
