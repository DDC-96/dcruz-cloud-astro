---
title: Swift Dialog Inventory UI for Jamf Recon
duration: 2min
date: 2025-06-05
---

This script wraps `jamf recon` in a small SwiftDialog UI so users can trigger an inventory update from Self Service and see clear progress feedback instead of a silent background action. When launched, it:

- Verifies SwiftDialog is installed and at or above the required version, installing it via a Jamf policy trigger if needed.
- Displays a lightweight "Update Inventory" window with your org branding, overlay icon, and a progress indicator.
- Runs `jamf recon` in the background, streams the latest log line into the dialog as progress text, then closes the window when inventory is complete.

It is intended to be deployed as a Jamf Self Service policy for macOS devices that already have Jamf enrolled. You can customize the window title, icons, and policy triggers at the top of the script to match your environment.

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
#!/bin/zsh
#
# DialogInventory
#
# Written: 06/03/2024
# Last updated: 06/05/2024
#
# Script Purpose: Perform the JAMF Recon command with Swift Dialog feedback
#
# 1.0v

SUPPORT_DIR="/Library/Application Support/XYZ"
SD_BANNER_IMAGE="${SUPPORT_DIR}/SupportFiles/XYZ.png"

SW_DIALOG="/usr/local/bin/dialog"
[[ -e "${SW_DIALOG}" ]] && SD_VERSION=$( ${SW_DIALOG} --version) || SD_VERSION="0.0.0"
MIN_SD_REQUIRED_VERSION="2.3.3"
DIALOG_INSTALL_POLICY="install_SwiftDialog"
SUPPORT_FILE_INSTALL_POLICY="install_SymFiles"
ICON_FILES="/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/"

###################################################
#
# App Specfic variables (Feel free to change these)
#
###################################################

SD_WINDOW_TITLE="Update Inventory"
SD_ICON_FILE=$ICON_FILES"ToolbarCustomizeIcon.icns"
OVERLAY_ICON="/Applications/Self Service.app"
TMP_LOG_FILE=$(mktemp /var/tmp/DialogInventory.XXXXX)
DIALOG_CMD_FILE=$(mktemp /var/tmp/DialogInventory.XXXXX)
JSON_DIALOG_BLOB=$(mktemp /var/tmp/DialogInventory.XXXXX)
chmod 655 $DIALOG_CMD_FILE
chmod 655 $JSON_DIALOG_BLOB

####################################################################################################
#
# Functions
#
####################################################################################################

function check_swift_dialog_install ()
{
    # Check to make sure that Swift Dialog is installed and functioning correctly
    # Will install process if missing or corrupted
    #
    # RETURN: None

    if [[ ! -x "${SW_DIALOG}" ]]; then
        install_swift_dialog
        SD_VERSION=$( ${SW_DIALOG} --version)
    fi

    if ! is-at-least "${MIN_SD_REQUIRED_VERSION}" "${SD_VERSION}"; then
        install_swift_dialog
    fi
}

function install_swift_dialog ()
{
    # Install Swift dialog From JAMF
    # PARMS Expected: DIALOG_INSTALL_POLICY - policy trigger from JAMF
    #
    # RETURN: None

	/usr/local/bin/jamf policy -trigger ${DIALOG_INSTALL_POLICY}
}

function update_display_list ()
{
    # setopt -s nocasematch
    # This function updates the Swift Dialog list display with easy to implement parameter passing...
    # The Swift Dialog native structure is very strict with the command structure...this routine makes
    # it easier to implement
    #
    # Param list
    #
    # $1 - Action to be done ("Create", "Add", "Change", "Clear", "Info", "Show", "Done", "Update")
    # ${2} - Affected item (2nd field in JSON Blob listitem entry)
    # ${3} - Icon status "wait, success, fail, error, pending or progress"
    # ${4} - Status Text
    # $5 - Progress Text (shown below progress bar)
    # $6 - Progress amount
            # increment - increments the progress by one
            # reset - resets the progress bar to 0
            # complete - maxes out the progress bar
            # If an integer value is sent, this will move the progress bar to that value of steps
    # the GLOB :l converts any inconing parameter into lowercase

    case "${1:l}" in

        "create" | "show" )

            # Display the Dialog prompt
            eval "${JSON_DIALOG_BLOB}"
            ;;

        "destroy" )

            # Kill the progress bar and clean up
            /bin/echo "quit:" >> "${DIALOG_CMD_FILE}"
            ;;

        "progress" )

            # Increment the progress bar by static amount ($6)
            /bin/echo "progresstext: ${2}" >> "${DIALOG_CMD_FILE}"
            ;;

    esac
}

function cleanup_and_exit ()
{
	[[ -f ${TMP_LOG_FILE} ]] && /bin/rm -rf ${TMP_LOG_FILE}
	[[ -f ${JSON_DIALOG_BLOB} ]] && /bin/rm -rf ${JSON_DIALOG_BLOB}
    [[ -f ${DIALOG_CMD_FILE} ]] && /bin/rm -rf ${DIALOG_CMD_FILE}
	exit 0
}

function welcomemsg ()
{
    echo '{
        "icon" : "'${SD_ICON_FILE}'",
        "overlayicon" : "'${OVERLAY_ICON}'",
        "iconsize" : "100",
        "message" : "Performing the JAMF inventory update process...",
        "bannertitle" : "'${SD_WINDOW_TITLE}'",
        "messageposition" : "true",
        "progress" : "true",
        "moveable" : "true",
        "mini" : "true",
        "position" : "topright",
        "button1text" : "none",
        "commandfile" : "'${DIALOG_CMD_FILE}'"
        }' > "${JSON_DIALOG_BLOB}"

    ${SW_DIALOG} --jsonfile ${JSON_DIALOG_BLOB} &
}

function update_inventory ()
{
    sudo jamf recon
    wait
} >> "${TMP_LOG_FILE}" 2>&1

####################################################################################################
#
# Main Script
#
####################################################################################################
autoload 'is-at-least'

check_swift_dialog_install
welcomemsg

# Start update inventory
update_inventory &
update_pid=$!

# While the process is still running, display the log entries
while kill -0 "$update_pid" 2> /dev/null; do
    lastLogEntry=$(tail -n 1 "${TMP_LOG_FILE}")
    update_display_list "progress" $lastLogEntry
    sleep 0.5
done

update_display_list "progress" "Inventory Updated, exiting ..."
sleep 2
update_display_list "destroy"
cleanup_and_exit
```
</div>

## How to present this in Jamf Self Service

This script works best as a small, targeted Self Service action that users can run when IT asks them to “update inventory” or when you need fresh data before troubleshooting.

### Recommended Self Service configuration

Use something clear and user friendly, for example:

- `Update Device Inventory`
- `Refresh Mac Inventory`
- `Send Inventory to IT`

Avoid anything too Jamf centric like “Run jamf recon”. Most users do not know what that means.

**Description**

Something in this tone usually lands well:

- This tool updates your Mac inventory so IT has the latest info about your device for support and compliance reporting.
- When you run it, a small window will appear showing the inventory progress. You can keep working while it runs. The window will close when the update is complete.

You can also add a short note for support:

- You might be asked to run this before a support session so we can see up to date information about your Mac.

**Icon**

Pick an icon that visually reads as “update” or “info”, for example:

- A refresh style icon.
- A computer with a small checkmark.
- Your company logo if you already use that for IT tooling.

If you want to match the script, reuse the same icon file you configured in `SD_ICON_FILE` so the SwiftDialog window and Self Service tile feel consistent.

### Policy options and scope

- **Trigger**: None or `Self Service Only`. The main user entry point is Self Service, not an automatic schedule.
- **Execution Frequency**: Ongoing. Users should be able to run this more than once.
- **Scope**: All macOS devices where SwiftDialog and Jamf recon are supported. Usually your standard managed Mac smart group.
- **Privileges**: Run as root, using the Jamf agent. The dialog will show in the user session, the recon will run with admin rights behind the scenes.

If you want to be extra nice to your help desk, add a note in the internal policy name, for example:

- `UTIL – Self Service – Update Inventory (SwiftDialog)`

That way when someone asks “What did the user run” you can see it in logs without guessing.

### User experience to expect

From the user perspective, the flow looks like this:

1. They open Self Service and click `Update Device Inventory`.
2. A small SwiftDialog window pops up in the top right with your title and icon.
3. The message shows that an inventory update is in progress, and the text updates while `jamf recon` runs.
4. When recon finishes, the dialog shows a short final message like “Inventory Updated, exiting ...” then closes on its own.

If the script ever fails, the Jamf policy log will contain the recon output and the last line shown in the dialog, which gives you a starting point for debugging.

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
