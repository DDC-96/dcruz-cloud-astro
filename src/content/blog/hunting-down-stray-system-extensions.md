---
title: Hunting Down Stray System Extensions After Our EDR Post Migration
date: 2024-03-01
duration: 10min
---
## When "Uninstalled" Was Not Actually Uninstalled

In Jamf Pro, you would expect to see a reliable view of installed system extensions for each macOS device. In practice, that inventory can be incomplete or missing, especially if you rely only on the built-in UI and default inventory fields.

That gap became very real during our migration from Trellix Endpoint Security to CrowdStrike Falcon. On paper, the migration went fine. Agents deployed, policies flipped, and the majority of devices behaved as expected.

Then a handful of Macs started to drag.

CPU usage was higher than normal, fans were constantly spinning, apps took too long to launch, and the general operation just felt sluggish. At first it was easy to blame the usual suspects. old hardware, too many Chrome tabs, Netflix quietly running in the background. But the pattern repeated on several machines that should have been more than capable.

After a round of basic troubleshooting, I found the real culprit. on some devices, the Trellix system extension was still present and enabled, even though the endpoint agent had already been removed during the sunset phase days earlier.

The uninstall was only doing half the job.

I needed a way to answer two questions for any Mac in Jamf Pro.

1. Which system extensions are installed
2. For each one, is it active or disabled

That is what led to a dedicated Extension Attribute and a Smart Group specifically built to hunt down stray Trellix extensions at scale.

## Designing The Jamf Extension Attribute

The first step was to get accurate, machine level data. macOS provides `systemextensionsctl list`, which shows loaded system extensions, their bundle IDs, and their state. Jamf just needed a way to pull that into inventory in a structured way.

So I created a Computer Extension Attribute in Jamf Pro with the following configuration.

- **Name**. `System Extensions (List + Status)`
- **Data Type**. `String`
- **Inventory Display**. `General`
- **Input Type**. `Script`

The script runs on the client during inventory and parses the output of `systemextensionsctl list` into a simple, human readable form that still works well for `like` matching in Jamf criteria.

<div class="code-block">
  <div class="code-header">
    <span class="title">bash</span>
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
#           Tested on : macOS 15.5
#             Version : 1.x
#
# Main Script
SE=$(systemextensionsctl list | while read -r line; do
  # Skip headers and empty lines
  if echo "$line" | grep -qE '^\s*\*?\s*\S+\s+\S+\s+com\.'; then
    bundleID=$(echo "$line" | awk '{for(i=1;i<=NF;i++) if($i ~ /^com\./){print $i; break}}')
    status=$(echo "$line" | grep -o '\[[^]]*\]$')
    echo "$bundleID · $status"
  fi
done
)

echo "<result>$SE</result>"
```
</div>

On a system running CrowdStrike and Trelix side by side, this might return something like:

```bash
com.crowdstrike.falcon.Agent · [activated enabled]
com.trellix.endpoint.sysext    · [activated enabled]
```
Each line becomes part of the Extension Attribute value. Jamf stores this as a string, and you can search it with **like** operators.

## Smart Group: Find Stray Trelix Extensions

Once the EA was in place and inventory had run, the next step was to target machines where Trellix was still present.

The goal was to find any Mac where:

- The EA includes a Trelix or McAfee bundle ID
- The status shows the extension as activated, regardless of enabled or disabled substate

In Jamf Pro, the Smart Group looked like this.

- **Group Name**: SE – Trellix Detected (Activated)
- **Criteria**:
  1. **Extension Attribute**: System Extensions (List + Status) like com.trellix
  2. **Extension Attribute**: System Extensions (List + Status) like [activated

For older naming schemas, you could optionally add:

- **Extension Attribute**: System Extensions (List + Status) like com.mcafee

Logically, you want something equivalent to:

```bash
( EA like "com.trellix" OR EA like "com.mcafee" ) AND EA like "[activated"
```

The reason for matching on [activated is that the EA captures the trailing bracketed state directly from **systemextensionsctl** output, for example [activated enabled] or [activated disabled]. Matching that token is a simple way to filter for system extensions that are still wired into the system, not just installed and idle.

## Remediation and Removing the Extension at Scale

I reccommend using the vendor's official uninstaller first as that's what I did. System extensions are managed within an entitlement sandbox and often require vendor tooling to fully detach drivers, daemons, and launch services from a device.

In this case, I used the official Trelix uninstaller.

- If you still have the Trellix uninstall pkg or script, create a Jamf Policy scoped to the **SE – Trellix Detected (Activated)** Smart Group and configure it to run that uninstaller.

- If you must remove the extension surgically, **systemextensionsctl** uninstall **teamID**/**bundleID** is available, but this route often has more user interaction, entitlement prompts, or edge cases. Prefer the vendor path when possible.

A typical Jamf Policy for cleanup looked like this.

- **Trigger**: Recurring check in, or a custom trigger if you want more control

- **Scope**: SE – Trellix Detected (Activated) Smart Group

- **Payload**:
  - Files & Processes - Execute the Trellix uninstaller command or pkg
  - Maintenance - Update Inventory so the EA reruns and the Smart Group shrinks as devices clean up

After the first run, the Smart Group size dropped steadily as machines checked in, removed the extension, and refreshed their inventory.

## The Before And After

On affected Macs, the difference was immediately noticeable, even without formal benchmarking.

- Idle CPU load dropped from roughly 18–25 percent to around 5–8 percent.
- Cold start times for apps like Slack, Zoom, and Chrome during calls went from six to eight seconds down to about two to three seconds, with no obvious lag or stutter.
- Fan noise basically disappeared. machines that used to sound like they were about to lift off went back to quiet.
- There was no longer any overlapping EDR logic running on the same box.

These are not lab grade metrics, but they matter in real life. They are the difference between a user quietly suffering on a “slow” Mac and a user who never has to think about the EDR migration again.

The EA plus Smart Group combination grew from a one off Trellix cleanup tool into something I now treat as standard kit. any time we do an EDR migration, audit system extensions, or troubleshoot weird performance after a security change, it is there.

## Takeaways

The main lesson here is simple.

Do not assume that uninstall means “fully gone”. Especially for security products that hook deeply into the OS. Validate. Inspect system extensions, kernel extensions, launch daemons, and anything else that can survive a lazy uninstall.

Jamf Pro gives you a good control plane, but you often have to build your own visibility into what the OS is actually doing. A small EA and a Smart Group can give you that signal, and once you have it, you can reuse it for more than one vendor or migration.

And when it doubt, assume the raccoon is still in the trash can until you have evidence that it is actually gone.

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
