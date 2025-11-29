---
title: When FileVault Went Missing & I Reported a Critical Jamf Pro API Bug
date: 2023-11-22
duration: 10min
---

## Intro - The Asset Management Automation Landscape

I had built an internal asset management automation that gave our Tier 1 and Tier 2 teams real control over the lifecycle of employee MacBooks. It became one of those quiet but critical systems that tied together Jamf, Jira, Slack, and some custom glue code into a single offboarding flow.

When an employee left the company, our automation would kick in and orchestrate a full shutdown of their device access. The goal was not to reinvent MDM. It was to make our existing processes scalable and repeatable.

The workflow looked like this:

- Trigger a Jamf "Device Lock" MDM command to secure the laptop.
- Create several Jira issues. one for hardware return, one for app and license deprovisioning, and separate tickets for Security and Compliance reviews routed to the right queues.
- Generate a PDF asset sheet for physical intake that IT would slap onto the laptop when it came back.
- Notify the right Slack channels via webhooks, based on job function and device ownership.

For a long time, it worked exactly as designed.

## The Jamf Pro API Surface

Under the hood, Jamf gives you two main API surfaces.

- The Classic API, which uses basic authentication against your Jamf server and typically speaks XML.
- The Jamf Pro API, which uses modern token based authentication and JSON payloads, backed by a client id and client secret with scoped permissions.

The Jamf Pro API is clearly the future. You get OAuth style tokens, better granularity for least privilege, and a more consistent JSON model. The plan was always to migrate older Classic API based scripts and workflows onto the Jamf Pro API when we had focused time to refactor.

This asset management tool was one of the first places where the newer API started to show up.

 ## The Mystery Begins

The bug surfaced in a pretty mundane way. A teammate noticed that some offboarded Macs in Jamf were suddenly showing up as not FileVault encrypted, or that FileVault appeared to have been removed entirely after offboarding.

That was a red flag. Our policy required data on offboarded Macs to remain protected until the device physically returned to IT and completed a 30 day procurement and triage process. Only after that could we wipe and redeploy, or mark it as e-waste. Having a device silently lose encryption in the middle of that window is not just annoying. It is a security problem.

My first instinct was to blame the Device Lock command. Maybe the MDM lock was somehow interacting with FileVault on certain OS versions. No luck. Then I checked whether unmanaging a computer from the Jamf UI could be the trigger. Also no.

After stripping away those variables and doing a lot of "stare at the ceiling and read logs" debugging, a pattern started to show up.

The FileVault state was changing not only during offboarding, but any time a Jamf computer record was renamed using the Jamf Pro API. The common denominator was a very simple inventory rename call behind the scenes.

The endpoint in question was:

```bash
PATCH /v1/computers-inventory-detail/{id}
```
The JSON payload was only updating the name field. Something like:

```json
{
  "general": {

    "name": "JANEDOE1234-pendingReturn"
  }
}
```

In other words, this was the most basic "rename a Mac" request you can make through the Jamf Pro API. No FileVault keys, no security payloads, nothing fancy. Yet when this call ran, the device would later show as not FileVault encrypted.

I reproduced this across multiple devices and configurations. Rename a Mac via that endpoint and payload, wait for inventory to update, and FileVault would either report as disabled or be removed. Same script, same effect.

At that point it was clear this was not a one off.

## Escalting To Jamf

Once I had solid repro steps, I opened a Jamf Support ticket with:

- The exact API endpoint.
- The minimal JSON body.
- Screenshot and logs showing FileVualt status before and after.
- Notes that this was being triggered by an automated workflow that renamed devices during offboarding.

Support escalated it to their API team almost immediately. Within a day they came back, thanked me for the detailed report, and confirmed they were treating it as a critical issue.

While Jamf triaged the bug, I could not afford to keep poking the endpoint in production, so I rolled back that part of the automation to use the Classic API:

```bash
PUT /JSSResource/computers/id/{id}
```
Same functional goal. update the computer name, but without touching the newer /v1/computers-inventory-detail/{id} path. After switching back, device renames stopped impacting FileVault status.

## What The Changelog Told Me

Jamf later confirmed this was a regression in their Jamf Pro API. If you look at the Jamf Pro API changelog around version 10.32.0, you can see a change called out for:

```bash
PATCH /v1/computers-inventory-detail/{id}
```
That version introduced updates to how computer inventory detail is processed through that endpoint. The unfortunate side effect. In some versions, a partial update that only touched the general section could unintentionally impact FileVault related state.

- A screenshot of the relevant changelog entry.

 <!-- Your image with zoom functionality -->
<img src="/jamf-bug-2.png" alt="" style="width:100%;"
     class="zoomable-image"
     onclick="zoomImage(this)">

## Why It Mattered

This bug had the potential to leave offboarded Macs unencrypted for a period of time during the return process without anyone noticing until a manual check. That is not just a workflow glitch. It is a gap in the control we are supposed to be enforcing.

The way it surfaced and got resolved also mattered.

A helpdesk teammate was the first to flag the FileVault anomaly. From there I partnered with InfoSec to:

- Confirm that this was reproducible, not a one off UI bug.
- Narrow the trigger to a very specific API call and payload.
- Validate that switching to the Classic API path eliminated the behavior.
- Package the findings in a way Jamf’s API team could consume quickly.

For me, this was one of the first times I had to treat an MDM vendor API like any other production dependency. That meant reading changelogs, pinning behavior to specific versions, maintaining a safe rollback path, and assuming that even "simple" endpoints can have side effects.

## Wrapping Up

This incident made a few things very real for me.

API hygiene matters. Partial updates and inventory endpoints are not harmless if the implementation behind them changes.
Compliance pipelines rely on a long chain of components, and MDM is just one of them.
And sometimes the most impactful security work you do is not a shiny new control, but catching a quiet regression early and closing the loop with your vendor.

It also made me a better engineer. It forced me to validate instead of assume, to treat Jamf as a versioned dependency rather than a black box, and to build automations with clear escape hatches when the underlying platform misbehaves.

On paper, it was "just" a device rename bug. In practice, it was a small but meaningful moment of owning our Apple fleet, strengthening our security posture, and shipping my first real Jamf API bug report into the world.

<!-- ---------- Image functionality --------- -->

<style>
.zoomable-image {
  cursor: zoom-in;
  transition: transform 0.2s;
  width: 100%;
}
.zoomable-image:hover {
  opacity: 0.9;
  transform: scale(1.02);
}

/* Modal styles */
.image-modal {
  display: none;
  position: fixed;
  z-index: 10000;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0,0,0,0.95);
  animation: fadeIn 0.3s ease;
}

.modal-content {
  margin: auto;
  display: block;
  max-width: 90%;
  max-height: 90%;
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%) scale(0.9);
  animation: zoomIn 0.3s ease forwards;
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.5);
  cursor: zoom-out;
}

.close {
  position: fixed;
  top: 25px;
  right: 35px;
  color: #fff;
  font-size: 36px;
  font-weight: bold;
  cursor: pointer;
  z-index: 10001;
  background: rgba(0,0,0,0.5);
  width: 50px;
  height: 50px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.3s ease;
}

.close:hover {
  background: rgba(255,255,255,0.2);
  transform: scale(1.1);
}

/* Animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes zoomIn {
  from {
    transform: translate(-50%, -50%) scale(0.7);
    opacity: 0;
  }
  to {
    transform: translate(-50%, -50%) scale(1);
    opacity: 1;
  }
}

/* Close on click outside image */
.modal-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  cursor: zoom-out;
}

/* Responsive adjustments */
@media (max-width: 768px) {
  .modal-content {
    max-width: 95%;
    max-height: 80%;
  }
  .close {
    top: 15px;
    right: 20px;
    font-size: 30px;
    width: 40px;
    height: 40px;
  }
}
</style>

<script>
function zoomImage(img) {
  const modal = document.getElementById('imageModal');
  const modalImg = document.getElementById('modalImage');

  modal.style.display = "block";
  modalImg.src = img.src;
  modalImg.alt = img.alt;

  // Prevent body scroll when modal is open
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const modal = document.getElementById('imageModal');
  modal.style.display = "none";
  // Restore body scroll
  document.body.style.overflow = 'auto';
}

// Close modal on ESC key
document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeModal();
});

// Close modal when clicking the backdrop (outside image)
document.getElementById('imageModal').addEventListener('click', function(e) {
  if (e.target.id === 'imageModal' || e.target.className === 'modal-backdrop') {
    closeModal();
  }
});
</script>

<!-- (add this once at bottom of your markdown) -->
<div id="imageModal" class="image-modal">
