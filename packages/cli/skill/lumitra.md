---
name: lumitra
description: Create and manage A/B tests, feature flags, and experiments via Lumitra Analytics API
---

# Lumitra Analytics -- A/B Testing & Feature Flags

This skill enables you to create and manage A/B tests and feature flags
on the Lumitra analytics platform directly from your development environment.

## Setup

Credentials are read from environment variables:
- `LUMITRA_API_KEY` or `NEXT_PUBLIC_ANALYTICS_API_KEY` -- Project-level API key (`ap_live_` prefix)
- `LUMITRA_ACCOUNT_KEY` -- Account-level API key (`ap_account_` prefix) for cross-project operations
- `LUMITRA_PROJECT_ID` or `NEXT_PUBLIC_ANALYTICS_PROJECT_ID` -- Project UUID
- `LUMITRA_ENDPOINT` -- API base URL (default: https://analytics.lumitra.co)

## Authentication

All API calls use the `X-API-Key` header:
```
X-API-Key: ap_live_xxxxx      # project-level (single project access)
X-API-Key: ap_account_xxxxx   # account-level (all projects + can create projects)
```

### Key types
- **Project keys** (`ap_live_`, `ap_test_`): Scoped to a single project. Can manage experiments, flags, and ingest events for that project.
- **Account keys** (`ap_account_`): Scoped to the user's account. Can access all projects the user owns, create new projects, and manage account settings. Use for CI/CD, agent automation, and Claude Code integrations.

## API Reference

### List projects (account key required)
```
GET {endpoint}/api/projects
```
Returns all projects the authenticated user is a member of.

### Create project (account key required)
```
POST {endpoint}/api/projects
```
Body:
```json
{
  "name": "My App",
  "domain": "myapp.com"
}
```
The authenticated user becomes the project owner. Returns the created project with its UUID.

### List experiments
```
GET {endpoint}/api/projects/{projectId}/experiments
```
Optional query parameter: `?status=running|draft|completed|paused`

Response:
```json
{
  "experiments": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "key": "hero-cta-test",
      "name": "Hero CTA Test",
      "description": "...",
      "hypothesis": "...",
      "status": "draft|running|paused|completed",
      "variants": [...],
      "targeting": {},
      "created_at": "...",
      "started_at": null,
      "ended_at": null,
      "winner_variant": null
    }
  ]
}
```

### Create experiment
```
POST {endpoint}/api/projects/{projectId}/experiments
```
Body:
```json
{
  "key": "hero-cta-test",
  "name": "Hero CTA Test",
  "description": "Testing green CTA vs default",
  "hypothesis": "Green CTA will increase signups by 20%",
  "variants": [
    { "key": "control", "weight": 50, "description": "Default button" },
    { "key": "green-cta", "weight": 50, "description": "Green button with 'Start Free'" }
  ],
  "targeting": {}
}
```

Validation rules:
- `key`: 1-128 chars, lowercase alphanumeric with hyphens or underscores (`^[a-z0-9_-]+$`)
- `name`: 1-128 chars
- `variants`: 2-5 variants required, each with `key` (string), `weight` (0-100), optional `description`
- Returns 409 if an experiment with the same key already exists in the project

### Add conversion goal
```
POST {endpoint}/api/projects/{projectId}/experiments/{experimentId}/goals
```
Body:
```json
{
  "name": "CTA Click",
  "goal_type": "click",
  "target": "a[href='/signup']",
  "is_primary": true
}
```

Goal types:
- `click` -- target is a CSS selector (e.g., `button.cta`, `a[href='/signup']`)
- `pageview` -- target is a URL pattern (e.g., `/thank-you%`)
- `custom_event` -- target is an event name (e.g., `signup_completed`)

Setting `is_primary: true` will unset any existing primary goal on that experiment.

### List goals
```
GET {endpoint}/api/projects/{projectId}/experiments/{experimentId}/goals
```

### Start experiment
```
POST {endpoint}/api/projects/{projectId}/experiments/{experimentId}/start
```
No body required.

Prerequisites (returns 400 if not met):
- Experiment must be in `draft` or `paused` status
- Must have at least 2 variants
- Must have at least 1 goal

### Get results
```
GET {endpoint}/api/projects/{projectId}/experiments/{experimentId}/results
```

Returns Bayesian analysis with:
- Per-variant: sessions, conversions, conversion rate
- Probability to be best for each variant
- Lift relative to control
- Recommendation (continue, stop with winner, etc.)

Response includes the primary goal used for analysis:
```json
{
  "results": {
    "experimentId": "...",
    "variants": [
      {
        "key": "control",
        "sessions": 1500,
        "conversions": 120,
        "conversionRate": 0.08,
        "probabilityToBeBest": 0.15
      },
      {
        "key": "green-cta",
        "sessions": 1480,
        "conversions": 178,
        "conversionRate": 0.1203,
        "probabilityToBeBest": 0.85,
        "lift": 0.503
      }
    ]
  },
  "goal": {
    "id": "uuid",
    "name": "CTA Click",
    "goal_type": "click",
    "target": "a[href='/signup']"
  }
}
```

### Stop experiment
```
POST {endpoint}/api/projects/{projectId}/experiments/{experimentId}/stop
```
Optional body:
```json
{ "winnerVariant": "green-cta" }
```

Experiment must be in `running` or `paused` status.

### Feature flags -- List
```
GET {endpoint}/api/projects/{projectId}/flags
```

### Feature flags -- Create
```
POST {endpoint}/api/projects/{projectId}/flags
```
Body:
```json
{
  "key": "new-checkout",
  "name": "New Checkout Flow",
  "enabled": false,
  "rollout_percentage": 25,
  "variants": null,
  "targeting": {}
}
```

Validation rules:
- `key`: 1-128 chars, lowercase alphanumeric with hyphens or underscores
- `name`: 1-128 chars
- `enabled`: boolean (default: false)
- `rollout_percentage`: integer 0-100 (default: 100)
- `variants`: optional array of `{ key, weight }` or null
- Returns 409 if a flag with the same key already exists

### Feature flags -- Update
```
PATCH {endpoint}/api/projects/{projectId}/flags/{flagId}
```
Body (all fields optional):
```json
{
  "name": "Updated Name",
  "enabled": true,
  "rollout_percentage": 50,
  "variants": [{ "key": "a", "weight": 50 }, { "key": "b", "weight": 50 }],
  "targeting": {}
}
```

### Feature flags -- Delete
```
DELETE {endpoint}/api/projects/{projectId}/flags/{flagId}
```

## Integration Code Templates

### React / Next.js (with @marlinjai/analytics-react)
```jsx
import { useLumitraVariant } from '@marlinjai/analytics-react';

function HeroCTA() {
  const variant = useLumitraVariant('hero-cta-test');

  switch (variant) {
    case 'green-cta':
      return <Button color="green">Start Free</Button>;
    default:
      return <Button>Join Waitlist</Button>;
  }
}
```

### Vanilla JavaScript (with @marlinjai/analytics-tracker)
```js
import { getTracker } from '@marlinjai/analytics-tracker';

const tracker = getTracker();
await tracker.ready();
const variant = tracker.getVariant('hero-cta-test');

if (variant === 'green-cta') {
  document.querySelector('.cta').textContent = 'Start Free';
  document.querySelector('.cta').style.backgroundColor = '#22c55e';
}
```

### Feature Flag Check
```js
import { getTracker } from '@marlinjai/analytics-tracker';

const tracker = getTracker();
await tracker.ready();
const enabled = tracker.getFlag('new-checkout');

if (enabled) {
  // render new checkout flow
}
```

### Tracker Initialization (for reference)
```js
import { createTracker } from '@marlinjai/analytics-tracker';

const tracker = createTracker({
  projectId: process.env.NEXT_PUBLIC_ANALYTICS_PROJECT_ID,
  apiKey: process.env.NEXT_PUBLIC_ANALYTICS_API_KEY,
  endpoint: process.env.NEXT_PUBLIC_ANALYTICS_ENDPOINT,
});
```

## Workflow

### Creating a new project

When asked to set up analytics for a new app (requires account key):

1. Read `LUMITRA_ACCOUNT_KEY` and `LUMITRA_ENDPOINT` env vars
2. Create the project via POST to `/api/projects`
3. Save the returned project ID to `.env.local` as `NEXT_PUBLIC_ANALYTICS_PROJECT_ID` / `LUMITRA_PROJECT_ID`
4. Create a project-level API key via POST to `/api/projects/{projectId}/keys` (using account key auth)
5. Save the returned key to `.env.local` as `NEXT_PUBLIC_ANALYTICS_API_KEY` / `LUMITRA_API_KEY`

```bash
# Step 1: Create project
PROJECT=$(curl -s -X POST \
  "${LUMITRA_ENDPOINT}/api/projects" \
  -H "X-API-Key: ${LUMITRA_ACCOUNT_KEY}" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My App", "domain": "myapp.com" }')

PROJECT_ID=$(echo "$PROJECT" | jq -r '.project.id')
echo "Project ID: $PROJECT_ID"

# Step 2: Create a project API key
KEY=$(curl -s -X POST \
  "${LUMITRA_ENDPOINT}/api/projects/${PROJECT_ID}/keys" \
  -H "X-API-Key: ${LUMITRA_ACCOUNT_KEY}" \
  -H "Content-Type: application/json" \
  -d '{ "label": "Production", "environment": "live" }')

API_KEY=$(echo "$KEY" | jq -r '.key.fullKey')
echo "API Key: $API_KEY"
```

### Creating an A/B test

When asked to create an A/B test:

1. Read env vars for credentials (`LUMITRA_API_KEY` / `NEXT_PUBLIC_ANALYTICS_API_KEY` and `LUMITRA_PROJECT_ID` / `NEXT_PUBLIC_ANALYTICS_PROJECT_ID`)
2. Create the experiment via POST to `/api/projects/{projectId}/experiments`
3. Add one or more conversion goals via POST to `.../experiments/{experimentId}/goals`
4. Generate integration code for the project's framework (React, Vanilla JS, etc.)
5. Edit the relevant component to add variant logic
6. Start the experiment via POST to `.../experiments/{experimentId}/start`

Example using curl:
```bash
# Step 1: Create experiment
EXPERIMENT=$(curl -s -X POST \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/experiments" \
  -H "X-API-Key: ${LUMITRA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "hero-cta-test",
    "name": "Hero CTA Test",
    "description": "Testing green CTA vs default blue",
    "hypothesis": "Green CTA will increase signups by 20%",
    "variants": [
      { "key": "control", "weight": 50, "description": "Default blue button" },
      { "key": "green-cta", "weight": 50, "description": "Green button" }
    ]
  }')

EXPERIMENT_ID=$(echo "$EXPERIMENT" | jq -r '.experiment.id')

# Step 2: Add goal
curl -s -X POST \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/experiments/${EXPERIMENT_ID}/goals" \
  -H "X-API-Key: ${LUMITRA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Signup Click",
    "goal_type": "click",
    "target": "button.cta-signup",
    "is_primary": true
  }'

# Step 3: Start experiment
curl -s -X POST \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/experiments/${EXPERIMENT_ID}/start" \
  -H "X-API-Key: ${LUMITRA_API_KEY}"
```

### Checking experiment results

When asked to check results:

1. Call GET `.../experiments/{experimentId}/results`
2. Report: winning variant, probability to be best, conversion rates, lift, recommendation
3. If probability to be best exceeds 95%, suggest stopping the experiment and implementing the winner

```bash
curl -s \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/experiments/${EXPERIMENT_ID}/results" \
  -H "X-API-Key: ${LUMITRA_API_KEY}" | jq .
```

### Stopping an experiment

```bash
curl -s -X POST \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/experiments/${EXPERIMENT_ID}/stop" \
  -H "X-API-Key: ${LUMITRA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{ "winnerVariant": "green-cta" }'
```

### Creating a feature flag

When asked to create a feature flag:

1. Create the flag via POST to `/api/projects/{projectId}/flags`
2. Generate integration code using the tracker or React hooks
3. Add flag check to the relevant code

```bash
curl -s -X POST \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/flags" \
  -H "X-API-Key: ${LUMITRA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "new-checkout",
    "name": "New Checkout Flow",
    "enabled": false,
    "rollout_percentage": 25
  }'
```

### Toggling a feature flag

```bash
# Enable the flag
curl -s -X PATCH \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/flags/${FLAG_ID}" \
  -H "X-API-Key: ${LUMITRA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{ "enabled": true }'

# Update rollout percentage
curl -s -X PATCH \
  "${LUMITRA_ENDPOINT}/api/projects/${LUMITRA_PROJECT_ID}/flags/${FLAG_ID}" \
  -H "X-API-Key: ${LUMITRA_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{ "rollout_percentage": 50 }'
```
