# Privacy Policy — Lumitra Analytics Browser Extension

**Last updated:** March 22, 2026

## Overview

The Lumitra Analytics browser extension ("Extension") is a companion tool for the Lumitra Analytics dashboard. It overlays heatmap visualizations on websites that you are analyzing through your Lumitra account.

## Data Collection

**The Extension does not collect, store, or transmit any user browsing data.**

Specifically, the Extension:
- Does NOT track your browsing history
- Does NOT collect personally identifiable information
- Does NOT inject tracking scripts into websites
- Does NOT send any data to third parties
- Does NOT use cookies for tracking purposes
- Does NOT contain advertisements

## Data the Extension Accesses

The Extension communicates exclusively with the Lumitra Analytics API (`analytics.lumitra.co`) to:

1. **Authenticate your session** — The Extension uses an authentication token stored in `chrome.storage.local` to verify your Lumitra account. This token is only sent to `analytics.lumitra.co`.

2. **Fetch heatmap data** — When you activate the heatmap overlay, the Extension requests click, scroll, and interaction data from the Lumitra API for the specific website and date range you selected. This data was previously collected by the Lumitra tracker script installed on that website by its owner.

3. **Fetch project information** — The Extension retrieves your project list to populate the project selector.

## Local Storage

The Extension stores the following in `chrome.storage.local`:
- Authentication token (for API access)
- User preferences (selected date range, device filter, heatmap visual settings)

This data remains on your device and is never transmitted to any party other than the Lumitra API.

## Permissions

The Extension requests the following browser permissions:

| Permission | Purpose |
|---|---|
| `activeTab` | To overlay heatmaps on the currently active tab |
| `storage` | To persist authentication tokens and user preferences |
| `alarms` | To refresh authentication tokens periodically |
| `scripting` | To inject heatmap visualization code into web pages |
| `sidePanel` | To provide a persistent analytics panel |
| `host_permissions: <all_urls>` | To overlay heatmaps on any website the user is analyzing |
| `host_permissions: analytics.lumitra.co` | To communicate with the Lumitra API |

## Third-Party Services

The Extension communicates only with `analytics.lumitra.co`. No other third-party services are contacted.

## Data Retention

Authentication tokens are stored locally until the user disconnects or the token expires (1 hour, auto-refreshed). User preferences are stored indefinitely until the extension is uninstalled.

## Children's Privacy

The Extension is not directed at children under 13 and does not knowingly collect any information from children.

## Changes to This Policy

We may update this privacy policy from time to time. Changes will be posted at this URL with an updated "Last updated" date.

## Contact

For privacy-related questions, contact: privacy@lumitra.co

Lumitra is operated by Marlin Jaison, based in Germany. All data processing complies with the EU General Data Protection Regulation (GDPR).
