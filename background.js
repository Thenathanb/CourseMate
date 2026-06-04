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
  prefix: 'courseMate_'
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
  'utdallas.edu': { schoolId: 'U2Nob29sLTEyNzM=',  filter: 'university of texas at dallas' },
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
  async search(lastName, firstName, hostname) {
    const { schoolId, filter } = getSchoolConfig(hostname);
    const url = 'https://www.ratemyprofessors.com/graphql';

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Basic dGVzdDp0ZXN0'
    };

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
                school {
                  name
                }
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

    const variables = {
      query: {
        text: lastName,
        schoolID: schoolId
      },
      count: 10
    };

    try {
      if (!PRODUCTION_MODE) console.log(`[RMP API] Searching for: ${lastName}, ${firstName} at school ${schoolId}`);
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ query, variables })
      }, 8000);

      const data = await response.json();
      if (!PRODUCTION_MODE) console.log(`[RMP API] Raw response:`, data);
      const edges = data?.data?.newSearch?.teachers?.edges || [];
      if (!PRODUCTION_MODE) console.log(`[RMP API] Found ${edges.length} results`);

      if (edges.length === 0) {
        if (!PRODUCTION_MODE) console.log(`[RMP API] No results found for ${lastName}, ${firstName}`);
        return { found: false, message: 'No RMP results found' };
      }

      // Filter to professors at the detected school
      const uhProfessors = edges.filter(edge => {
        const schoolName = edge.node.school?.name || '';
        const isMatch = schoolName.toLowerCase().includes(filter);
        if (!PRODUCTION_MODE) console.log(`[RMP API] Checking: ${edge.node.firstName} ${edge.node.lastName} at ${schoolName} - Match: ${isMatch}`);
        return isMatch;
      });

      if (!PRODUCTION_MODE) console.log(`[RMP API] Found ${uhProfessors.length} professors out of ${edges.length} total results`);

      if (uhProfessors.length === 0) {
        return { found: false, message: 'No professors found at this school in results' };
      }

      // Try exact match first
      for (const edge of uhProfessors) {
        const prof = edge.node;
        if (prof.firstName.toLowerCase() === firstName.toLowerCase() &&
            prof.lastName.toLowerCase() === lastName.toLowerCase()) {
          if (!PRODUCTION_MODE) console.log(`[RMP API] Exact match found: ${prof.firstName} ${prof.lastName}`);
          return {
            found: true,
            data: {
              rmpId: prof.id,
              name: `${prof.firstName} ${prof.lastName}`,
              overallRating: prof.avgRating,
              numRatings: prof.numRatings,
              wouldTakeAgainPercent: prof.wouldTakeAgainPercentRounded,
              difficulty: prof.avgDifficulty,
              rmpUrl: `https://www.ratemyprofessors.com/professor/${prof.legacyId}`
            }
          };
        }
      }

      // Use best match if last name matches
      const bestMatch = uhProfessors[0].node;
      if (bestMatch.lastName.toLowerCase() === lastName.toLowerCase()) {
        if (!PRODUCTION_MODE) console.log(`[RMP API] Using best match: ${bestMatch.firstName} ${bestMatch.lastName}`);
        return {
          found: true,
          data: {
            rmpId: bestMatch.id,
            name: `${bestMatch.firstName} ${bestMatch.lastName}`,
            overallRating: bestMatch.avgRating,
            numRatings: bestMatch.numRatings,
            wouldTakeAgainPercent: bestMatch.wouldTakeAgainPercentRounded,
            difficulty: bestMatch.avgDifficulty,
            rmpUrl: `https://www.ratemyprofessors.com/professor/${bestMatch.legacyId}`
          }
        };
      }

      return { found: false, message: 'No good match found' };

    } catch (error) {
      console.error('RMP API error:', error);
      return { found: false, message: error.message };
    }
  }
};

// Active provider - switch between MockProvider and real provider
const DataProvider = RMPProvider; // Using real RMP API now!

const COUGARGRADES_CONFIG = {
  dataBaseUrl: 'https://unpkg.com/@cougargrades/publicdata@latest/bundle/edu.uh.grade_distribution',
  instructorsUrl: 'https://unpkg.com/@cougargrades/publicdata@latest/bundle/io.cougargrades.searchable/instructors.json',
  splitFiles: Array.from({ length: 13 }, (_, index) => `records_split_${index}.csv`),
  cachePrefix: 'courseMateGrades_',
  defaultTTL: 14 * 24 * 60 * 60 * 1000,
  requestTimeoutMs: 8000,
  maxDurationMs: 10000
};

let cougarGradesInstructorIndex = null;

function normalizeNamePart(value) {
  return (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

function namesMatch(recordFirst, recordLast, targetFirst, targetLast) {
  const recordLastNormalized = normalizeNamePart(recordLast);
  const targetLastNormalized = normalizeNamePart(targetLast);
  if (recordLastNormalized !== targetLastNormalized) {
    return false;
  }

  const recordFirstNormalized = normalizeNamePart(recordFirst);
  const targetFirstNormalized = normalizeNamePart(targetFirst);
  if (!recordFirstNormalized || !targetFirstNormalized) {
    return false;
  }

  return recordFirstNormalized.startsWith(targetFirstNormalized) ||
    targetFirstNormalized.startsWith(recordFirstNormalized);
}

function matchSubjectValue(value, subjectUpper) {
  if (!value || !subjectUpper) {
    return false;
  }

  const text = String(value).toUpperCase();
  if (text === subjectUpper) {
    return true;
  }
  if (text.startsWith(subjectUpper)) {
    return true;
  }
  return text.includes(` ${subjectUpper}`) || text.includes(`${subjectUpper} `) ||
    text.includes(`${subjectUpper}-`) || text.includes(`${subjectUpper}/`) ||
    text.includes(`${subjectUpper},`);
}

function entryMatchesSubject(entry, subject) {
  if (!entry || !subject) {
    return false;
  }

  const subjectUpper = subject.toUpperCase();
  const keysToCheck = [
    'subject',
    'subjects',
    'department',
    'departments',
    'dept',
    'deptCode',
    'deptAbbr',
    'abbreviation',
    'abbr',
    'code',
    'name'
  ];

  for (const key of keysToCheck) {
    const value = entry[key];
    if (Array.isArray(value)) {
      for (const item of value) {
        if (matchSubjectValue(item, subjectUpper)) {
          return true;
        }
        if (item && typeof item === 'object') {
          for (const innerValue of Object.values(item)) {
            if (matchSubjectValue(innerValue, subjectUpper)) {
              return true;
            }
          }
        }
      }
      continue;
    }

    if (value && typeof value === 'object') {
      for (const innerValue of Object.values(value)) {
        if (matchSubjectValue(innerValue, subjectUpper)) {
          return true;
        }
      }
      continue;
    }

    if (matchSubjectValue(value, subjectUpper)) {
      return true;
    }
  }

  if (matchSubjectValue(entry.href, subjectUpper)) {
    return true;
  }

  return false;
}

function pickCougarGradesMatch(candidates, firstKey, lastKey, courseInfo, middleInitial) {
  if (!candidates.length) {
    return null;
  }

  const middleKey = normalizeNamePart(middleInitial);
  const preferredFirstKey = middleKey ? `${firstKey}${middleKey}` : null;

  if (preferredFirstKey) {
    const preferredMatches = candidates.filter(entry => {
      const entryFirst = normalizeNamePart(entry.firstName);
      return entryFirst && entryFirst.startsWith(preferredFirstKey);
    });

    if (preferredMatches.length === 1) {
      return preferredMatches[0];
    }

    if (courseInfo?.subject && preferredMatches.length > 1) {
      const filtered = preferredMatches.filter(entry => entryMatchesSubject(entry, courseInfo.subject));
      if (filtered.length === 1) {
        return filtered[0];
      }
    }
  }

  const exactMatches = candidates.filter(entry => {
    const entryFirst = normalizeNamePart(entry.firstName);
    const entryLast = normalizeNamePart(entry.lastName);
    return entryFirst === firstKey && entryLast === lastKey;
  });

  if (exactMatches.length === 1) {
    return exactMatches[0];
  }

  if (courseInfo?.subject && exactMatches.length > 1) {
    const filtered = exactMatches.filter(entry => entryMatchesSubject(entry, courseInfo.subject));
    if (filtered.length === 1) {
      return filtered[0];
    }
  }

  const prefixMatches = candidates.filter(entry => {
    const entryFirst = normalizeNamePart(entry.firstName);
    if (!entryFirst) {
      return false;
    }
    return entryFirst.startsWith(firstKey) || firstKey.startsWith(entryFirst);
  });

  if (prefixMatches.length === 1) {
    return prefixMatches[0];
  }

  if (courseInfo?.subject && prefixMatches.length > 1) {
    const filtered = prefixMatches.filter(entry => entryMatchesSubject(entry, courseInfo.subject));
    if (filtered.length === 1) {
      return filtered[0];
    }
  }

  return null;
}

async function loadCougarGradesInstructorIndex() {
  if (cougarGradesInstructorIndex) {
    return cougarGradesInstructorIndex;
  }

  const response = await fetchWithTimeout(
    COUGARGRADES_CONFIG.instructorsUrl,
    {},
    COUGARGRADES_CONFIG.requestTimeoutMs
  );
  if (!response.ok) {
    throw new Error('CougarGrades instructor index unavailable');
  }

  const payload = await response.json();
  const index = new Map();
  for (const entry of payload?.data || []) {
    const lastKey = normalizeNamePart(entry.lastName);
    if (!index.has(lastKey)) {
      index.set(lastKey, []);
    }
    index.get(lastKey).push(entry);
  }

  cougarGradesInstructorIndex = index;
  return cougarGradesInstructorIndex;
}

async function getCougarGradesUrl(firstName, lastName, courseInfo, middleInitial) {
  try {
    if (!firstName || !lastName) {
      return null;
    }
    const index = await loadCougarGradesInstructorIndex();
    const lastKey = normalizeNamePart(lastName);
    const firstKey = normalizeNamePart(firstName);
    const candidates = index.get(lastKey) || [];
    const match = pickCougarGradesMatch(candidates, firstKey, lastKey, courseInfo, middleInitial);
    const fallback = !match && candidates.length === 1 ? candidates[0] : null;
    if (match?.href) {
      return `https://cougargrades.io${match.href}`;
    }
    if (fallback?.href) {
      return `https://cougargrades.io${fallback.href}`;
    }
  } catch (error) {
    console.warn('[CourseMate] CougarGrades instructor lookup failed:', error);
  }
  return null;
}

async function getCougarGradesFromCache(cacheKey) {
  try {
    const result = await chrome.storage.local.get([cacheKey, 'cacheTTL']);
    const cacheTTL = result.cacheTTL || COUGARGRADES_CONFIG.defaultTTL;

    if (result[cacheKey]) {
      const cached = result[cacheKey];
      const age = Date.now() - cached.timestamp;
      if (age < cacheTTL) {
        return cached.data;
      }
    }
  } catch (error) {
    console.warn('[CourseMate] CougarGrades cache read failed:', error);
  }
  return null;
}

async function saveCougarGradesToCache(cacheKey, data) {
  try {
    const cacheEntry = {
      timestamp: Date.now(),
      data: data
    };
    await chrome.storage.local.set({ [cacheKey]: cacheEntry });
  } catch (error) {
    console.warn('[CourseMate] CougarGrades cache write failed:', error);
  }
}

async function fetchCougarGradesDistribution({ firstName, lastName, courseInfo }) {
  if (!courseInfo?.subject || !courseInfo?.catalog) {
    return null;
  }

  const subject = courseInfo.subject.toUpperCase();
  const catalog = courseInfo.catalog;
  const cacheKey = `${COUGARGRADES_CONFIG.cachePrefix}${normalizeNamePart(lastName)}_${normalizeNamePart(firstName)}_${subject}_${catalog}`;
  const cached = await getCougarGradesFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  const totals = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  let weightedGpaTotal = 0;
  let weightedGpaCount = 0;
  const startTime = Date.now();

  for (const fileName of COUGARGRADES_CONFIG.splitFiles) {
    if (Date.now() - startTime > COUGARGRADES_CONFIG.maxDurationMs) {
      break;
    }

    const response = await fetchWithTimeout(
      `${COUGARGRADES_CONFIG.dataBaseUrl}/${fileName}`,
      {},
      COUGARGRADES_CONFIG.requestTimeoutMs
    );
    if (!response.ok) {
      continue;
    }

    const text = await response.text();
    const lines = text.split('\n').filter(Boolean);
    if (lines.length < 2) {
      continue;
    }

    const header = parseCsvLine(lines[0].replace(/\r$/, ''));
    const index = {
      subject: header.indexOf('SUBJECT'),
      catalog: header.indexOf('CATALOG NBR'),
      instructorLast: header.indexOf('INSTR LAST NAME'),
      instructorFirst: header.indexOf('INSTR FIRST NAME'),
      a: header.indexOf('A'),
      b: header.indexOf('B'),
      c: header.indexOf('C'),
      d: header.indexOf('D'),
      f: header.indexOf('F'),
      avgGpa: header.indexOf('AVG GPA')
    };

    for (let i = 1; i < lines.length; i++) {
      const row = parseCsvLine(lines[i].replace(/\r$/, ''));
      if (!row[index.subject] || !row[index.catalog]) {
        continue;
      }

      if (row[index.subject].toUpperCase() !== subject) {
        continue;
      }
      if (row[index.catalog] !== catalog) {
        continue;
      }

      if (!namesMatch(row[index.instructorFirst], row[index.instructorLast], firstName, lastName)) {
        continue;
      }

      const a = parseInt(row[index.a] || '0', 10);
      const b = parseInt(row[index.b] || '0', 10);
      const c = parseInt(row[index.c] || '0', 10);
      const d = parseInt(row[index.d] || '0', 10);
      const f = parseInt(row[index.f] || '0', 10);
      const rowTotal = a + b + c + d + f;

      totals.A += a;
      totals.B += b;
      totals.C += c;
      totals.D += d;
      totals.F += f;

      const gpa = parseFloat(row[index.avgGpa] || '0');
      if (!Number.isNaN(gpa) && rowTotal > 0) {
        weightedGpaTotal += gpa * rowTotal;
        weightedGpaCount += rowTotal;
      }
    }
  }

  const totalGrades = totals.A + totals.B + totals.C + totals.D + totals.F;
  if (!totalGrades) {
    const emptyDistribution = {
      course: `${subject} ${catalog}`,
      totals,
      percentages: null,
      gpa: undefined,
      notFound: true,
      partial: Date.now() - startTime > COUGARGRADES_CONFIG.maxDurationMs
    };
    await saveCougarGradesToCache(cacheKey, emptyDistribution);
    return emptyDistribution;
  }

  const percentages = {
    A: Math.round((totals.A / totalGrades) * 100),
    B: Math.round((totals.B / totalGrades) * 100),
    C: Math.round((totals.C / totalGrades) * 100),
    D: Math.round((totals.D / totalGrades) * 100),
    F: Math.round((totals.F / totalGrades) * 100)
  };

  const distribution = {
    course: `${subject} ${catalog}`,
    totals,
    percentages,
    gpa: weightedGpaCount ? weightedGpaTotal / weightedGpaCount : undefined,
    partial: Date.now() - startTime > COUGARGRADES_CONFIG.maxDurationMs
  };

  await saveCougarGradesToCache(cacheKey, distribution);
  return distribution;
}

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
async function fetchProfessorData(professorName, school = 'uh.edu') {
  try {
    const { firstName, lastName } = parseProfessorName(professorName);

    if (!firstName || !lastName) {
      return { error: 'Invalid professor name' };
    }

    const normalizedName = normalizeName(professorName, 'uh');
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
    const result = await DataProvider.search(lastName, firstName, school);

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
    fetchProfessorData(request.professorName, request.school)
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

        const results = await Promise.allSettled([
          fetchRMPReviewsById(teacherId, 3),
          fetchCougarGradesDistribution({ firstName, lastName, courseInfo }),
          getCougarGradesUrl(firstName, lastName, courseInfo, middleInitial)
        ]);

        const reviews = results[0].status === 'fulfilled' ? results[0].value : [];
        const gradeDistribution = results[1].status === 'fulfilled' ? results[1].value : null;
        const cougarGradesUrl = results[2].status === 'fulfilled' ? results[2].value : null;

        sendResponse({
          reviews,
          gradeDistribution,
          cougarGradesUrl
        });
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
