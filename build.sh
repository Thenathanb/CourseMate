#!/bin/bash

# CourseMate Build Script
# Creates separate packages for Chrome and Firefox

echo "Building CourseMate extensions..."

# Clean up old builds
rm -f CourseMate-Chrome.zip CourseMate-Firefox.zip

# Common files for both browsers
COMMON_FILES="background.js contentScript.js options.html options.js ui.css icons/"

# Build Chrome version (Manifest V3)
echo "Building Chrome version..."
zip -r CourseMate-Chrome.zip manifest.json browser-polyfill.js $COMMON_FILES -x "*.DS_Store"
echo "Created CourseMate-Chrome.zip"

# Build Firefox version (Manifest V2)
echo "Building Firefox version..."
# Temporarily rename manifest files
cp manifest.json manifest.chrome.json.bak
cp manifest.firefox.json manifest.json

zip -r CourseMate-Firefox.zip manifest.json browser-polyfill.js $COMMON_FILES -x "*.DS_Store"

# Restore Chrome manifest
mv manifest.chrome.json.bak manifest.json

echo "Created CourseMate-Firefox.zip"

echo ""
echo "Build complete!"
echo "- Chrome: CourseMate-Chrome.zip (upload to Chrome Web Store)"
echo "- Firefox: CourseMate-Firefox.zip (upload to Firefox Add-ons)"
