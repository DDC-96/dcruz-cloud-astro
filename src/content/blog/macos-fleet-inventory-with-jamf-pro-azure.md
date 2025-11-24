---
title: macOS Fleet Inventory with Jamf Pro and Azure Log Analytics
date: 2025-11-20
duration: 10min
---

## Introduction

When I joined the team at my current employer, this project arrived as a pretty harmless sounding backlog ticket:

"Existing macOS script posts device data posture to Azure. Needs a bit of polish before we use it for SOC 2 reporting."

In my head, that meant a quick cleanup. Fix a path, rename a few variables, write it into a Jamf policy, re-trigger it, and move on.

What I actually inherited was a dev script that only worked on part of the fleet, silently broke on the rest, and sat in the middle of a pipeline that security and auditors already expected to trust.

This write up walks through how I turned that script into a production ready, architecture aware reporting workflow that keeps our Jamf managed macOS devices visible inside Azure alongside our subset of Windows devices.

## Problem Statement and Constraints

The business requirement was straightforward. Security and auditors needed a unified device inventory view in Azure that included both Windows and macOS. For each endpoint, they cared about attributes like OS version, hardware model, serial number, and a set of compliance related fields.

At this point in the project, tools like Workbrew were very much on the table. Workbrew sits on top of Homebrew and turns it into a secure software delivery platform, with an agent and console that let you standardize, audit, and remotely manage brew packages across a fleet. It is basically a control plane for Homebrew at enterprise scale, with policy enforcement, inventory, and remote execution built in. A no brainer when it comes to dealing with Homebrew. We spun up a sandbox instance and tested it in a dev environment, and it fit nicely with how we were already thinking about developer tooling and MDM. From a management perspective, using something like Workbrew to keep Homebrew and Homebrew packages in line would have been the cleanest option.

Budget constraints took that path off the table for the moment, though. Instead of buying a managed Homebrew control plane, I had to treat this as an engineering problem. The constraint became the design: build a reporting focused automation that we fully own, that runs from Jamf Pro, and that gives Azure the same quality of device inventory signal without adding a new platform to the bill.

Windows was already covered. Agents on that side of the house sent structured data into Azure using an existing schema. macOS was the missing half. The inherited script was supposed to close that gap by running from Jamf Pro and POSTing JSON into an Azure Logic App that wrote to Log Analytics.

When I picked it up, the script had some clear issues. It effectively supported a single architecture, so part of the fleet never reported in at all. It assumed Homebrew and jo were installed in specific paths. It produced JSON that mostly matched the schema, but types and null handling were inconsistent. It also never surfaced the final payload anywhere operators actually look when debugging, which made it hard to trust.

All of this was happening while we were already in SOC 2 conversations. That meant this pipeline was not a side project. It was part of our compliance story, and it had to behave like one.

## Requirements and Design Goals

Before changing anything, I reframed the work into explicit goals.

Functionally, we needed:

- A single script that runs on both Intel and Apple Silicon macOS devices.

- A consistent JSON payload that matches an existing Azure Log Analytics schema.

- A way to treat each execution as a device inventory event that can be queried and exported.

From an engineering side, I wanted:

- Clear handling of architecture. No hidden assumptions about paths or CPU details.

- Dependency behavior that is predictable. Fail loudly when something is fundamentally wrong. Self heal when it is reasonable, for example installing jo if Homebrew is present.

- Strong typing and fallbacks for nullable fields so the ingest pipeline does not break on edge cases.

- Enough logging that an operator can reconstruct what was sent to Azure from Jamf Pro alone.

Non goals for this first iteration were equally important. I was not trying to build a full telemetry pipeline, a real time health monitor, or a remediation engine. The scope was inventory and compliance relevant attributes, delivered reliably.

## High Level Architecture
The final design is simple about responsibilities.

Jamf Pro is the orchestrator. A policy runs on a schedule that roughly aligns with inventory check in. That policy executes the reporting script locally on each scoped macOS device.

On the device, the script:

1. Detects hardware architecture and chooses the correct tool paths.

2. Verifies that Homebrew exists in that path, and verifies or installs jo.

3. Collects a defined set of system attributes.

4. Normalizes those attributes into predictable types and formats.

5. Builds a JSON object that matches the Azure schema.

6. Logs the JSON payload into the Jamf policy output.

7. Sends the payload via HTTP POST to an Azure Logic App endpoint.

In Azure, the Logic App:

- Accepts the HTTP request.
- Validates and forwards the JSON into a Log Analytics workspace.
- Writes into a specific table that already holds Windows device records.

For consumers, there is one source of truth. A Log Analytics table where both Windows and macOS devices show up with the same core shape, ready to be queried with KQL or exported to CSV during audits to share with the right team members.

## Key Implementation Details

The schema already existed on the Azure side, so part of this project was matching it cleanly instead of inventing a new one.

The bash script focuses on a small but intentional set of fields, including:

- Endpoint and user identity. Hostname, current-logged in username, real name, corporate email.
- OS information. OS name and OS version, represented as a string, not a number.
- Hardware identity. Model identifier, manufacturer, serial number, basic BIOS or firmware version where applicable.
- CPU profile. Vendor, model name, physical cores, logical processors.
- Memory and storage. Total system RAM, total disk size, free disk space.
- Lifecycle metadata. Uptime, last boot time, and a last contact timestamp for when the script ran.

Timestamps use a consistent representation. **ISO 8601 in UTC.** This applies to both **LastBoot** and **LastContact**. If boot time cannot be determined, the script send an explicit fallback string instead of an empty value.

The rule of thumb is that every field that Azure expects has a stable type and a defined behavior for edge cases. That makes KQL queries and dashboards far more reliable, especially under audit conditions.

**Here's an example:**
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
Data=$($JO_PATH \
  Endpoint="$(hostname)" \
  UserName="$realname" \
  Email="${loggedInUser}@COMPANY.com" \
  ManagedBy="Jamf Pro" \
  JoinType="Jamf Connect" \
  Model="$Model" \
  Manufacturer="$Manufacturer" \
  UpTime="$UpTime" \
  LastBoot="$boot_time_date" \
  LastContact="$LastContact" \
  InstallDate="-" \
  Serial="$Serial" \
  BiosVersion="$BiosVersion" \
  BiosDate="$BiosDate" \
  RAM="$RAM" \
  OSVersion="$OSVersion" \
  OSName="macOS" \
  CPUManufacturer="$CPUManu" \
  CPUName="$CPUName" \
  CPUCores="$CPUCore" \
  CPULogical="$CPULogical" \
  StorageTotal="$StorageTotal" \
  StorageFree="$StorageFree")
```
</div>

If you have not used jo before, it is a small utility that builds JSON over the command line:

**Examples:**

```bash
jo name="MacBook Pro" serial="C02XXXXXXX" OSVersion="14.5"
```
**Outputs:**
```bash
{
  "name": "MacBook Pro",
  "serial": "C02XXXXXXX",
  "OSVersion": "14.5"
}
```
**API Payloads:**
```bash
jo endpoint="/api/v1/users" method="POST" body=$(jo user=$(jo name=Alice role=admin))
```

**Outputs:**
```bash
{"endpoint":"/api/v1/users","method":"POST","body":{"user":{"name":"Alice","role":"admin"}}}
```

**Configuration Files:**
```bash
jo logging=$(jo level=info file="/var/log/app.log") database=$(jo host=localhost port=5432) > config.json
```
**Terraform External Data Sources:**
```bash
jo compute_instances=$(jo -a $(jo name=web size=t3.medium) $(jo name=db size=r5.large))
```
You get the idea. The consistency and reliability of jo makes it superior to manual JSON construction, especially when you need to use the utility in shell scripts where string escaping errors can be common.

## Behavior on the Endpoint

Most of the interesting technical work happens on the device, inside the script. Even without dropping code here, it is useful to think of it as a small agent with a clear lifecycle.

### Architecture detection

The first step is to detect whether the machine is Intel or Apple Silicon. This drives two things. The path to Homebrew and jo, and the commands used to retrieve CPU details.

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
ARCHITECTURE=$(uname -m)

if [[ "$ARCHITECTURE" == "arm64" ]]; then
    BREW_PATH="/opt/homebrew/bin/brew"
    JO_PATH="/opt/homebrew/bin/jo"
elif [[ "$ARCHITECTURE" == "x86_64" ]]; then
    BREW_PATH="/usr/local/bin/brew"
    JO_PATH="/usr/local/bin/jo"
else
    echo "Unsupported architecture found. Exiting script.."
    exit 1
fi
```
</div>

The script uses a single architecture flag to choose the correct paths and later to choose the right system commands for CPU fields. Any unknown architecture results in an explicit exit, not a best effort guess.

### Dependency handling

Once the architecture is known, the script checks for Homebrew at the expected path. If it is missing, that is treated as a provisioning issue and the script exits. This avoids silently trying to install or alter the system in ways that are out of scope.

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
if [[ ! -x "$BREW_PATH" ]]; then
    echo "Exiting.. Homebrew was not found at $BREW_PATH"
    exit 1
fi

if [[ ! -x "$JO_PATH" ]]; then
    echo "jo is not found at $JO_PATH. Installing jo..."
    "$BREW_PATH" install jo
else
    echo "jo is already installed on the device. Continuing with the script..."
fi
```
</div>

If Homebrew exists but jo is missing, the script installs jo and continues. That gives the system a useful self healing behavior for a small, safe dependency. New machines do not require manual prep work to join the reporting pipeline.

### Data collection and normalization

With tools in place, the script collects the data model described earlier. It uses standard macOS utilities to read things like OS version, model identifier, serial number, memory, storage, uptime, and boot time.

The architecture flag is used again when extracting CPU information, because Apple Silicon and Intel expose some details differently. The end result is a consistent set of CPU fields regardless of which platform produced them.

After values are collected, the script normalizes them. That incldues:

- Converting boot time into ISO 8601 UTC.
- Generating a LastContact timestamp at runtime.
- Ensuring OSVersion is treated as a string.
- Applying fallbacks for fields that might be missing in edge cases.

### Logging and HTTP POST

Before sending anything to Azure, the script logs the final JSON payload into the Jamf policy output. This is intentional. It allows operators to reconstruct exactly what was sent from the Jamf console alone, without instrumenting the script further.

After logging, the script performs an HTTP POST to the Azure Logic App endpoint with the JSON as the body. Any non zero exit status can be surfaced in Jamf so the policy shows up as failed rather than silently passing.

## Deployment with Jamf Pro

From a deployment point of view, the script is just another Jamf policy payload. The important pieces are scope, timing, and rollout strategy.

The policy is configured to run on a regular cadence, aligned with inventory check in. That keeps the device inventory view in Azure reasonably fresh without hammering the Logic App unnecessarily.

For rollout, I used a phased approach:

- First, scope to a smart group of Intel Macs and validate in both Jamf logs and Azure that records were flowing as expected.
- Next, switch the scope to a smart group of Apple Silicon Macs and verify architecture specific behavior like jo installation and CPU data.
- Finally, move to a combined scope that includes all Jamf managed macOS devices once both groups show stable behavior.

This gave a safe path to production without surprising the fleet or the audit team.

## Security and Compliance Considerations

All communication from devices to Azure uses HTTPS. The payload focuses on device inventory and identity level attributes, not secrets or highly sensitive user content.

The Log Analytics table schema is treated as a contract. Changes to the field set or types are versioned and reviewed before being rolled out. The script does not attempt to dynamically shape its payload based on environment conditions.

Access to the resulting data is controlled in Azure. The script assumes that the Logic App endpoint and Log Analytics workspace are configured with proper IAM and least privilege on the cloud side.

In a future iteration, endpoint configuration such as the Logic App URL will come from a secret management solution instead of being hard coded into the script, which would further tighten the story around credentials and configuration.

## Observability and Operations

To operate this in production, I treat it like a small distributed service.

On the macOS side, Jamf policy logs act as the primary local observability surface. Every execution logs the JSON payload that was about to be sent. If something looks off in Azure, I can go back to the policy logs on a specific machine and see exactly what it attempted to send.

In Azure, the Logic App provides an execution history. Failures, throttling, or schema errors show up there. The Log Analytics workspace itself is the ultimate signal for success, because it is where device records actually land.

Operationally, I pay attention to:

- The volume of macOS records ingested into the table over time.
- The fail over rate of the Logic App.
- The success and failure counts of the Jamf policy across the fleet.

When something breaks, the usual debugging path is:

1. Check Jamf logs for the payload and any error messages from the script.
2. Check the Logic App run history for failed or malformed requests.
3. Use KQL in Log Analytics to search for specific devices by serial, hostname, or email.

This keeps troubleshooting grounded in actual signals instead of guesswork.

**Full Script:**

<div class="code-block expandable">
  <div class="code-header">
    <span class="title">bash</span>
    <div class="code-actions">
      <button class="copy-btn" onclick="copyCode(this)">
        <svg width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
        </svg>
        Copy
      </button>
    </div>
  </div>

  <div class="code-content">
    <!-- PREVIEW SECTION -->
    <div class="code-preview">

```bash
#!/bin/sh
# Production script to report macOS data to Azure, supporting Apple Silicon and Intel Macs.
# Checks architecture, verifies Homebrew and JSON Objects for Shell, and then invokes a POST request to the specified Azure endpoint.

# Determine Architecture
ARCHITECTURE=$(uname -m)

# Set paths for Homebrew and `jo` based on architecture
if [[ "$ARCHITECTURE" == "arm64" ]]; then
    BREW_PATH="/opt/homebrew/bin/brew"
    JO_PATH="/opt/homebrew/bin/jo"
elif [[ "$ARCHITECTURE" == "x86_64" ]]; then
    BREW_PATH="/usr/local/bin/brew"
    JO_PATH="/usr/local/bin/jo"
else
    echo "Unsupported architecture found. Exiting script.."
    exit 1
fi
```

</div>

<!-- FULL SECTION -->
<div class="code-full">

```bash
#!/bin/sh
# Production script to report macOS data to Azure, supporting Apple Silicon and Intel Macs.
# Checks architecture, verifies Homebrew and JSON Objects for Shell, and then invokes a POST request to the specified Azure endpoint.

# Determine Architecture
ARCHITECTURE=$(uname -m)

# Set paths for Homebrew and `jo` based on architecture
if [[ "$ARCHITECTURE" == "arm64" ]]; then
    BREW_PATH="/opt/homebrew/bin/brew"
    JO_PATH="/opt/homebrew/bin/jo"
elif [[ "$ARCHITECTURE" == "x86_64" ]]; then
    BREW_PATH="/usr/local/bin/brew"
    JO_PATH="/usr/local/bin/jo"
else
    echo "Unsupported architecture found. Exiting script.."
    exit 1
fi

# Check if Homebrew is installed at the expected path
if [[ ! -x "$BREW_PATH" ]]; then
    echo "Exiting.. Homebrew was not found at $BREW_PATH"
    exit 1
fi

echo "Homebrew detected at $BREW_PATH. Continuing with the script.."

# Check if `jo` is installed at the expected path; install if missing
if [[ ! -x "$JO_PATH" ]]; then
    echo "jo is not found at $JO_PATH. Installing jo..."
    "$BREW_PATH" install jo
else
    echo "jo is already installed on the device. Continuing with the script..."
fi

# Define common variables for both architectures
UpTime=$(awk '{print int($3)}' <(uptime))
loggedInUser="$(stat -f%Su /dev/console)"
realname="$(dscl . -read /Users/$loggedInUser RealName | cut -d: -f2 | sed -e 's/^[ \t]*//' | grep -v "^$")"
boot_time_date=$(sysctl -n kern.boottime | awk -F'[^0-9]*' '{print $2}' | xargs -I{} date -u -jf "%s" "{}" +"%Y-%m-%dT%H:%M:%SZ" || echo "Unknown")
OSVersion="$(sw_vers | awk '/ProductVersion/ {print $2}')"
OSVersion="${OSVersion}"" "
LastContact=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
Model=$(system_profiler SPHardwareDataType | awk '/Model Identifier/ {print $3}')
Manufacturer="Apple"
Serial=$(system_profiler SPHardwareDataType | awk '/Serial/ {print $4}')
BiosVersion=$(system_profiler SPHardwareDataType | awk '/System Firmware Version/ {print $4}')
BiosDate="-"
RAM=$(system_profiler SPHardwareDataType | awk '/Memory/ {print $2}')
StorageTotal="$(df -k . | awk 'NR==2 {print $2}')"
StorageFree="$(df -k . | awk 'NR==2 {print $4}')"

# Generate data specific to architecture type
if [[ "$ARCHITECTURE" == "arm64" ]]; then
    # Apple Silicon
    echo "Detected Apple Silicon architecture."
    CPUManu="$(sysctl -n machdep.cpu.brand_string)"
    CPUCore="$(sysctl -n machdep.cpu.core_count)"
    CPUName="$(system_profiler SPHardwareDataType | awk '/Chip/ {print $2,$3,$4}')"
    CPULogical="$(system_profiler SPHardwareDataType | awk '/Total Number of Cores/ {print $6}' | sed 's/(//')"

elif [[ "$ARCHITECTURE" == "x86_64" ]]; then
    # Intel
    echo "Detected Intel architecture."
    CPUManu="$(sysctl -n machdep.cpu.vendor)"
    CPUCore="$(sysctl -n machdep.cpu.core_count)"
    CPUName="$(sysctl -n machdep.cpu.brand_string)"
    CPULogical="$(sysctl -n machdep.cpu.thread_count)"
else
    echo "Unsupported architecture detected. Exiting..."
    exit 1
fi

# Generate JSON using jo
Data=$($JO_PATH \
  Endpoint="$(hostname)" \
  UserName="$realname" \
  Email="${loggedInUser}@COMPANY.com" \
  ManagedBy="Jamf Pro" \
  JoinType="Jamf Connect" \
  Model="$Model" \
  Manufacturer="$Manufacturer" \
  UpTime="$UpTime" \
  LastBoot="$boot_time_date" \
  LastContact="$LastContact" \
  InstallDate="-" \
  Serial="$Serial" \
  BiosVersion="$BiosVersion" \
  BiosDate="$BiosDate" \
  RAM="$RAM" \
  OSVersion="$OSVersion" \
  OSName="macOS" \
  CPUManufacturer="$CPUManu" \
  CPUName="$CPUName" \
  CPUCores="$CPUCore" \
  CPULogical="$CPULogical" \
  StorageTotal="$StorageTotal" \
  StorageFree="$StorageFree")

# Send logs to the Jamf Policy before sending to Azure
echo "Data being sent to Azure Log Analytics: $Data"

# Post to Azure Log Analytics
curl -H "Content-Type: application/json" -d "$Data" \
  "https://prod-23.eastus.logic.azure.com/workflows/API-ENDPOINT-XYZ"

```

</div>
  </div>

  <!-- Bottom centered button -->
  <div class="expand-btn-container">
    <button class="expand-btn-bottom" onclick="toggleExpand(this)">
      <svg class="expand-icon" width="9" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6"/>
      </svg>
      Show More
    </button>
  </div>
</div>

## Future Iterations & Closing out

One direction is to enrich the payload with hardware health metrics. GPU details, battery cycles, and battery health are all easy candidates that feed into capacity planning, refresh strategy, and device lifecycle decisions.

Another direction is to fold in Apple Business Manager data. With the newer Apple School & Business Manager API endpoints, you can pull ABM attributes (enrollment status, device assignment, ownership details) and join them to this telemetry. That would give you a unified view that spans both the physical device state on macOS and its record of truth in ABM.

Simillarly, incorporate more security posture signals. Fields such as FileVault status, secure boot configuration, or EDR agent presence could be added to the same schema and surfaced in the same Log Analytics workspace, which would give security a more complete view without new tools. With that, could also be a Slack alerting channel to ingest alerts for fail over visibility.

There is also room to improve configuration management of the endpoint itself by pulling URLs and shared secrets from a secret store rather than embedding them in the script.

None of these require a rewrite. They all reuse the same pattern. Each macOS device emits a small, well defined JSON event, and the cloud treats that event as a first class signal for reporting and automation.

What started as a fragile, one off script became a small, dependable piece of the compliance pipeline. The biggest shift was treating it less like a utility and more like a service that happens to run on endpoints. Once architecture, dependencies, schema, and observability were treated as first class concerns, the rest of the work fell into place.
The end result is simple from the outside. Security and auditors query a single Log Analytics table and see Windows and macOS devices side by side.

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
