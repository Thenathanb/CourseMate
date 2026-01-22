/**
 * Browser API Polyfill
 * Makes Chrome extension APIs work in Firefox and vice versa
 */

(function() {
  'use strict';

  // If browser is already defined (Firefox), create chrome alias
  if (typeof browser !== 'undefined' && typeof chrome === 'undefined') {
    window.chrome = browser;
  }

  // If chrome is defined but browser isn't (Chrome), create browser alias
  if (typeof chrome !== 'undefined' && typeof browser === 'undefined') {
    window.browser = chrome;
  }

  // Promisify Chrome callback-based APIs for Firefox compatibility
  if (typeof chrome !== 'undefined' && chrome.runtime) {
    // Check if we need to wrap callbacks (Chrome) or if promises are native (Firefox)
    const isChrome = !chrome.runtime.getBrowserInfo;

    if (isChrome) {
      // Wrap chrome.storage.local methods to support both callbacks and promises
      const originalStorageGet = chrome.storage.local.get.bind(chrome.storage.local);
      const originalStorageSet = chrome.storage.local.set.bind(chrome.storage.local);
      const originalStorageClear = chrome.storage.local.clear.bind(chrome.storage.local);

      // These already return promises in modern Chrome, but ensure compatibility
      if (!chrome.storage.local.get.toString().includes('native code')) {
        chrome.storage.local.get = function(keys) {
          return new Promise((resolve, reject) => {
            originalStorageGet(keys, (result) => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve(result);
              }
            });
          });
        };

        chrome.storage.local.set = function(items) {
          return new Promise((resolve, reject) => {
            originalStorageSet(items, () => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          });
        };

        chrome.storage.local.clear = function() {
          return new Promise((resolve, reject) => {
            originalStorageClear(() => {
              if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
              } else {
                resolve();
              }
            });
          });
        };
      }
    }
  }
})();
