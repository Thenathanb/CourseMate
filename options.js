/**
 * Options page script - Handles settings UI and storage
 */

// DOM elements (initialized after DOM loads)
let extensionEnabledToggle;
let defaultSchoolSelect;
let cacheTTLSelect;
let debugModeToggle;
let saveBtn;
let clearCacheBtn;
let statusMessage;

/**
 * Load settings from storage and populate UI
 */
async function loadSettings() {
  try {
    const settings = await chrome.storage.local.get([
      'extensionEnabled',
      'defaultSchool',
      'cacheTTL',
      'debugMode'
    ]);

    // Set toggle states (default to true if not set)
    extensionEnabledToggle.checked = settings.extensionEnabled !== false;
    debugModeToggle.checked = settings.debugMode === true;

    // Set select values
    if (settings.defaultSchool) {
      defaultSchoolSelect.value = settings.defaultSchool;
    }

    if (settings.cacheTTL) {
      cacheTTLSelect.value = settings.cacheTTL.toString();
    }
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings', 'error');
  }
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  try {
    const settings = {
      extensionEnabled: extensionEnabledToggle.checked,
      defaultSchool: defaultSchoolSelect.value,
      cacheTTL: parseInt(cacheTTLSelect.value, 10),
      debugMode: debugModeToggle.checked
    };

    await chrome.storage.local.set(settings);
    showStatus('Settings saved successfully!', 'success');
  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings', 'error');
  }
}

/**
 * Clear all cached data
 */
async function clearCache() {
  try {
    // Get current settings to preserve them
    const settings = await chrome.storage.local.get([
      'extensionEnabled',
      'defaultSchool',
      'cacheTTL',
      'debugMode'
    ]);

    // Clear all storage
    await chrome.storage.local.clear();

    // Restore settings
    await chrome.storage.local.set(settings);

    showStatus('Cache cleared successfully!', 'success');
  } catch (error) {
    console.error('Error clearing cache:', error);
    showStatus('Error clearing cache', 'error');
  }
}

/**
 * Show status message
 */
function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.className = `status-message ${type} show`;

  // Hide after 3 seconds
  setTimeout(() => {
    statusMessage.classList.remove('show');
  }, 3000);
}

/**
 * Initialize the options page
 */
function initOptionsPage() {
  // Get DOM elements
  extensionEnabledToggle = document.getElementById('extensionEnabled');
  defaultSchoolSelect = document.getElementById('defaultSchool');
  cacheTTLSelect = document.getElementById('cacheTTL');
  debugModeToggle = document.getElementById('debugMode');
  saveBtn = document.getElementById('saveBtn');
  clearCacheBtn = document.getElementById('clearCacheBtn');
  statusMessage = document.getElementById('statusMessage');

  // Event listeners
  saveBtn.addEventListener('click', saveSettings);
  clearCacheBtn.addEventListener('click', clearCache);

  // Auto-save on toggle changes for better UX
  extensionEnabledToggle.addEventListener('change', saveSettings);
  debugModeToggle.addEventListener('change', saveSettings);

  // Load current settings
  loadSettings();
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', initOptionsPage);
