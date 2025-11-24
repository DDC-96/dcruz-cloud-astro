---
title: CrowdStrike Falcon Sensor Removal/Configuration with Jamf Pro
duration: 5min
date: 2025-04-22

---

This runs through steps to automate, configure, and remove the CrowdStrike Falcon Sensor on macOS devices using Jamf Pro. This process will help you set up Smart Groups based on CPU architecture, config payload deployment with custom configuration profiles, optinal notification settings, and lastly some detailed uninstall instructions.

## Step 1: Create Smart Groups

Create the following two smart groups to differentiate between Apple Silicon and Intel-based Macs. These groups will query the devices and will be used to scope the Falcon configuration profile based on CPU type.

Navigate to:
Jamf pro -> Computers -> Smart Computer Groups -> New

## Smart Group: Apple Silicon Macs

- Display Name: CPU - Apple Silicon
- Criteria:
    - Architecture Type -> is -> arm64

## Smart Group: Intel Macs
- Display Name: CPU - Intel
- Criteria:
    - Architecture Type -> is -> 86x64

# Step 2: Upload Falcon Configuration Profiles

With these profiles, they will configure system extensions and permisions for CrowdStrike Falcon on each endpoint.

Navigate to:
Jamf Pro -> Computers -> Configuration Profiles -> Upload

Upload the appropriate Falcon .mobileconfig file for each architecture type:

## Configuration Profile: Apple Silicon

- File Name: Falcon Profile ARM.mobile.config
- Scope: CPU - Apple Silicon

## Configuration Profile: Intel

- File Name: Falcon Profile Intel.mobileconfig
- Scope: CPU - Intel

# Step 3: Deploy Falcon Sensor PKG and Installation Script

1. Download the latest Falcon Sensor installer ==.pkg== from the CrowdStrike portal.

2. Upload the pkg to Jamf Pro.

3. Upload the following installation script also into Jamf Pro.

``` py title="Shell"
#!/bin/bash

# Replace with your valid Falcon license
/Applications/Falcon.app/Contents/Resources/falconctl license XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Optional: Assign grouping tag (e.g., environment, team, etc.)
/Applications/Falcon.app/Contents/Resources/falconctl grouping-tags set "your-tag-here"

# Restart the Falcon Sensor
/Applications/Falcon.app/Contents/Resources/falconctl unload
/Applications/Falcon.app/Contents/Resources/falconctl load
```

Next, Navigate to:

Jamf Pro -> Computers -> New

Create a policy and add the .pkg file and select install script you uploaded.

- Set the scope to CPU - Apple Silicon OR CPU - Intel, depending on the targeted architecture.

- Set the policy to run once per computer or during enrollment as needed.

# Step 4: Enable Managed Notifications (Optional)

To ensure Falcon can display system notifications:

Navigate to:

Jamf Pro -> Computers -> Configuration Profiles -> New

- Payload: Notifications

- Bundle ID: com.crowdstrike.falcon.UserAgent

Enable the following options:

- Notifications

- Banner Alert Type: temporary

- Notifications on Lock Screen

- Notifications in Notification Center

- Badge app icon

Scope this to Intel - Macs or Silicon - Macs

# Step 5: Uninstalling CrowdStrike Falcon Sensor

Depending on whether the Falcon install is protected (requires a token) or unprotected, use the appropriate scripts to help with removing the application from your endpoints.

Option A: for unprotected endpoints, deploy the following script:

``` py title="Shell"
#!/bin/bash

/Applications/Falcon.app/Contents/Resources/falconctl uninstall
```
Option B: Protected Installation (Maintenance Token Required)

``` py title="Shell"
#!/bin/bash

token="xxxxxxxxxxxxxxxxxxxxxxxxxxxx"

/Applications/Falcon.app/Contents/Resources/falconctl uninstall --maintenance-token <<< "${token}"
```

In good practice, verify the scope and test with a pilot group before deploying company wide!
