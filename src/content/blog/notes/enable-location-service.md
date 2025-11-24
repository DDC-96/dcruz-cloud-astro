---
title: Enable Location Services With A Bash Script
duration: 5min
date: 2025-03-14
---

This script is intended for workflows where macOS devices need Location Services turned on as part of a managed flow, for example during onboarding or before running location dependent tooling in IT or security. Instead of walking users through System Settings by hand, the script enables Location Services at the system level and restarts the locationd service so the change takes effect immediately.

It is designed to be run as root on a managed device, for example through Jamf Pro or another MDM agent, and has been tested on macOS 15.3.1. On some older macOS versions you may also need to kickstart the locationd launch daemon after updating the preference, which is noted in the comments.

<div class="code-block">
  <div class="code-header">
    <span class="title">main.tf</span>
    <button class="copy-btn" onclick="copyCode(this)">
      <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      Copy
    </button>
  </div>

```bash
#!/bin/sh

###
#
#
#               Created : 2025-02-02
#               Version : 1.0
#           Tested with : macOS 15.3.1
#
###

defaults write /var/db/locationd/Library/Preferences/ByHost/com.apple.locationd LocationServicesEnabled -int 1
killall locationd

# For older macOS, can't remember which version, add this.
# launchctl kickstart -k system/com.apple.locationd
```
</div>

<!-- ---------- Code Block Functionality --------- -->

<style>
.code-block {
  border: 1px solid #374151;
  border-radius: 10px;
  margin: 1.5rem 0;
  overflow: hidden;
  background: #1f2937;
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.3),
    0 2px 4px -1px rgba(0, 0, 0, 0.2),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  transition: all 0.2s ease;
}

.code-block:hover {
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.4),
    0 4px 6px -2px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(255, 255, 255, 0.08);
}

.code-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.25rem;
  background: linear-gradient(135deg, #374151 0%, #4b5563 100%);
  border-bottom: 1px solid #4b5563;
  font-family: system-ui, sans-serif;
}

.code-header .title {
  font-weight: 600;
  font-size: 0.875rem;
  color: #f9fafb;
  letter-spacing: 0.025em;
}

.copy-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #1f2937;
  border: 1px solid #6b7280;
  border-radius: 8px;
  padding: 0.5rem 1rem;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  color: #e5e7eb;
  transition: all 0.2s ease;
  min-width: 80px;
  justify-content: center;
}

.copy-btn:hover {
  background: #4b5563;
  border-color: #9ca3af;
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.copy-btn.copied {
  background: #065f46;
  border-color: #10b981;
  color: #ecfdf5;
  box-shadow: 0 0 0 1px #10b981;
}

.copy-btn svg {
  flex-shrink: 0;
}

/* EXPANDABLE CODE BLOCK STYLES */
.code-block.expandable {
  position: relative;
  padding-bottom: 60px; /* Add space for the bottom button */
}

.code-block.expandable .code-full {
  display: none; /* Hide full code by default */
}

.code-block.expandable .code-preview {
  display: block; /* Show preview by default */
}

/* When expanded, show full code and hide preview */
.code-block.expandable.expanded .code-full {
  display: block;
}

.code-block.expandable.expanded .code-preview {
  display: none;
}

.code-preview {
  position: relative;
  max-height: 400px; /* Limit preview height */
  overflow: hidden;
}

.code-preview::after {
  content: "";
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 80px;
  background: linear-gradient(transparent, #1f2937);
  pointer-events: none;
}

.code-block.expandable.expanded .code-preview::after {
  display: none;
}

/* Bottom center button */
.expand-btn-container {
  position: absolute;
  bottom: 15px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
}

.expand-btn-bottom {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: rgba(31, 41, 55, 0.95);
  border: 1px solid #6b7280;
  border-radius: 8px;
  padding: 0.5rem 1.5rem;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  color: #e5e7eb;
  transition: all 0.2s ease;
  backdrop-filter: blur(4px);
}

.expand-btn-bottom:hover {
  background: rgba(55, 65, 81, 0.95);
  border-color: #9ca3af;
  transform: translateY(-1px);
}

.expand-btn-bottom .expand-icon {
  transition: transform 0.3s ease;
}

.code-block.expandable.expanded .expand-btn-bottom .expand-icon {
  transform: rotate(180deg);
}

/* Ensure code content is styled properly */
.code-content pre {
  margin: 0;
  padding: 1rem;
  background: #1f2937 !important;
  border-radius: 0;
  overflow-x: auto;
}

.code-content code {
  background: transparent !important;
  padding: 0;
}
</style>

<script>
function copyCode(button) {
  const codeBlock = button.closest('.code-block');

  // Determine which code is currently visible (preview or full)
  let codeElement;
  if (codeBlock.classList.contains('expandable')) {
    const isExpanded = codeBlock.classList.contains('expanded');
    codeElement = isExpanded ?
      codeBlock.querySelector('.code-full pre code') :
      codeBlock.querySelector('.code-preview pre code');
  } else {
    // Regular code block (non-expandable)
    codeElement = codeBlock.querySelector('pre code');
  }

  const code = codeElement.textContent;

  navigator.clipboard.writeText(code).then(() => {
    const originalHTML = button.innerHTML;
    button.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2"/>
      </svg>
      Copied!
    `;
    button.classList.add('copied');

    setTimeout(() => {
      button.innerHTML = originalHTML;
      button.classList.remove('copied');
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy: ', err);
    const originalHTML = button.innerHTML;
    button.textContent = 'Failed!';
    setTimeout(() => {
      button.innerHTML = originalHTML;
    }, 2000);
  });
}

function toggleExpand(button) {
  const codeBlock = button.closest('.code-block');
  const isExpanded = codeBlock.classList.contains('expanded');

  if (isExpanded) {
    // Currently expanded, so collapse it (show preview, hide full)
    codeBlock.classList.remove('expanded');
    button.innerHTML = `
      <svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
      Show More
    `;
  } else {
    // Currently collapsed, so expand it (show full, hide preview)
    codeBlock.classList.add('expanded');
    button.innerHTML = `
      <svg class="expand-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
      Show Less
    `;
  }
}
</script>
