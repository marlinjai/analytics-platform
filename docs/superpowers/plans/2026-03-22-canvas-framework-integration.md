---
title: "Canvas Framework Analytics Integration Research"
summary: "Exploration of click tracking for Flutter CanvasKit, Unity WebGL, and Three.js"
type: plan
status: proposed
date: 2026-03-22
tags: [extension, heatmap, flutter, unity, webgl, canvas]
projects: [analytics-platform]
---

# Canvas Framework Analytics Integration Research

## Context

The element-based heatmap plan (see `2026-03-22-element-based-heatmaps.md`) explicitly acknowledges that canvas-only pages fall back to x/y coordinate rendering. This document explores whether we can do better for the three major canvas-based web frameworks: Flutter Web (CanvasKit/Skwasm), Unity WebGL, and Three.js / Babylon.js / raw WebGL. The goal is to determine whether framework-specific SDKs or integration strategies could provide semantic click tracking rather than raw coordinate tracking.

## TL;DR

| Framework | Semantic Tracking Possible? | Effort | Recommended Approach |
|-----------|---------------------------|--------|---------------------|
| Flutter Web (CanvasKit) | Yes, via semantics tree | Medium | Parse `flt-semantics` DOM overlay |
| Unity WebGL | Partially, via JS interop | High | C# plugin + `SendMessage` bridge |
| Three.js / Babylon.js | Yes, via raycaster | Medium | Provide a helper library that hooks scene picking |
| Raw WebGL / custom engines | No | N/A | x/y fallback only |

---

## 1. Flutter Web (CanvasKit / Skwasm Renderers)

### How Click Events Work

Flutter Web with the CanvasKit (or newer Skwasm) renderer draws the entire UI onto a single `<canvas>` element. The DOM structure looks roughly like:

```
<body>
  <flt-glass-pane>
    <flt-scene-host>
      <flt-scene>
        <flt-canvas-container>
          <canvas />   <!-- The actual rendered UI -->
        </flt-canvas-container>
      </flt-scene>
    </flt-scene-host>
    <flt-semantics-host>
      <flt-semantics ... role="button" aria-label="Submit">
      <flt-semantics ... role="textbox">
      ...
    </flt-semantics-host>
  </flt-glass-pane>
</body>
```

Click events land on the `<flt-glass-pane>` element. Flutter's Dart engine captures pointer events from the glass pane and routes them through its own hit-testing system internally. From JavaScript's perspective, the click target is always the glass pane or the canvas -- never a "button" or "link."

### Mapping Clicks to Semantic UI Elements

This is where Flutter actually gives us something to work with. Flutter generates a **parallel semantics DOM tree** under `<flt-semantics-host>` for accessibility. Each interactive widget that has semantic annotations gets a corresponding `<flt-semantics>` element with:

- ARIA roles (`role="button"`, `role="textbox"`, etc.)
- ARIA labels (`aria-label="Submit Order"`)
- Position and size matching the rendered widget (absolute positioning within the glass pane)
- Tab indices and event listeners for screen readers

**Important caveat:** The semantics tree is **not enabled by default** for performance reasons. The user must either:
1. Press the invisible "Enable accessibility" button, or
2. The app can programmatically enable it via `SemanticsBinding.instance.ensureSemantics()`

If the app developer has not explicitly enabled semantics, the `<flt-semantics-host>` will be empty or absent, and we have no DOM nodes to work with.

### What Existing Analytics Solutions Do

- **Hotjar / Microsoft Clarity:** Do not work with Flutter CanvasKit. Session replays show a black or blank canvas. Clarity explicitly documents that they cannot render inside `<canvas>` elements. Hotjar has an open Flutter issue (flutter/flutter#136426) with no resolution.
- **UXCam, Smartlook, Contentsquare:** Offer Flutter SDKs, but these work at the **native mobile** layer (wrapping iOS/Android SDKs). They do not support Flutter Web.
- **Heatlens (`pub.dev/packages/heatlens`):** A Flutter-native package that captures gesture coordinates within the Flutter render tree. Works on mobile and web, but requires the developer to integrate it into their app. It is not injectable from outside.

### Proposed Integration Strategy

**Approach: Semantics Tree Scraping (external, no app changes needed)**

1. When our tracker detects a Flutter CanvasKit page (heuristic: `document.querySelector('flt-glass-pane')` exists and body has only canvas/flutter elements), check if `<flt-semantics-host>` has children.

2. If semantics nodes exist:
   - On click, get the click coordinates relative to the glass pane
   - Use `document.elementsFromPoint(x, y)` to find any `<flt-semantics>` nodes at that position
   - Extract a pseudo-selector: `flt-semantics[aria-label="Submit"][role="button"]`
   - This gives us semantic meaning for the click without needing framework cooperation

3. If semantics nodes do not exist:
   - Fall back to x/y coordinate tracking
   - Optionally, attempt to trigger semantics by programmatically clicking the accessibility enable button (risky, may have side effects)

**Approach: Flutter Plugin (requires app developer integration)**

A Dart package (`lumitra_analytics`) that:
- Wraps the existing tracker JS via `dart:js_interop`
- Hooks into Flutter's `GestureBinding` to capture taps with full widget tree context
- Emits events with widget type, key, and semantic label instead of CSS selectors
- Auto-enables semantics tree on web builds

This is higher effort but would provide the richest data. It requires the Flutter developer to add the package to their app.

### Feasibility Assessment

- **Semantics scraping (external):** Practical today, but data quality depends on the app having semantics enabled and widgets having proper labels. Many Flutter apps do have this for accessibility compliance. Medium confidence.
- **Flutter plugin:** High-quality data, but requires developer buy-in. Good as a v2 offering.
- **Timeline:** Semantics scraping could ship as a tracker enhancement in 1-2 weeks. Flutter plugin would be a separate 3-4 week project.

---

## 2. Unity WebGL

### How Click Events Work

Unity WebGL builds compile the game engine to WebAssembly and render into a single `<canvas>` element. The typical page structure is:

```html
<div id="unity-container">
  <canvas id="unity-canvas"></canvas>
</div>
<div id="unity-loading-bar">...</div>
```

Unity captures input events (mouse, touch, keyboard) from the canvas using JavaScript event listeners registered during initialization. The browser events are forwarded into the Unity engine, which processes them through its own Input System (legacy `Input` class or the newer `InputSystem` package).

Click detection within the game world uses **Physics.Raycast** or **EventSystem.RaycastAll** (for UI elements). The engine projects a ray from the camera through the click point and determines which `GameObject` was hit based on collider components.

From JavaScript's perspective, all clicks target the same `<canvas>` element. There is no DOM representation of Unity UI elements whatsoever -- no semantics tree, no ARIA annotations, nothing.

### Mapping Clicks to Semantic UI Elements

Unity provides two paths for click-to-element mapping, but both require **cooperation from the Unity developer**:

**1. Unity UI EventSystem + Raycasting:**
Unity UI (both the legacy Canvas-based UI and the newer UI Toolkit) uses `GraphicRaycaster` to determine which UI element was clicked. The game code can query `EventSystem.current.currentSelectedGameObject` to get the clicked element. This information exists inside the C# runtime but is not exposed to JavaScript by default.

**2. JavaScript Interop via `SendMessage` / `ccall`:**
Unity provides a bridge between JavaScript and C# code:
- `unityInstance.SendMessage('GameObjectName', 'MethodName', 'param')` -- call C# from JS
- `.jslib` plugins -- call JS from C#

A Unity C# script could listen for click events, determine what was clicked via raycasting, and send that information to JavaScript via a `.jslib` callback. From there, our tracker could pick it up.

### What Existing Analytics Solutions Do

- **Unity Analytics:** Unity's built-in analytics service works in WebGL builds (supported since Unity 5.3). It tracks custom events dispatched from C# code. It does not provide heatmaps or click tracking -- it is event-based (e.g., "level completed", "item purchased").
- **GameAnalytics SDK:** Supports Unity WebGL. Similar to Unity Analytics -- tracks custom events, not clicks or UI interactions.
- **Hotjar / Clarity:** Show a black canvas. No useful data captured.
- **No existing solution** provides automatic click-to-element mapping for Unity WebGL without developer integration.

### Proposed Integration Strategy

**Approach: Unity Plugin Package (requires developer integration)**

A Unity C# package (`LumitraAnalytics.unitypackage`) that:

1. Attaches a `MonoBehaviour` to the EventSystem
2. On each pointer click, performs a raycast to identify the hit GameObject
3. Extracts a semantic identifier: `{SceneName}/{CanvasName}/{ElementName}` or the GameObject's path in the hierarchy
4. Calls into a `.jslib` plugin that forwards the event to the Lumitra tracker JS (already loaded on the page)
5. The tracker receives `{ selector: "unity://MainMenu/PlayButton", x, y }` and sends it normally

**Approach: External Coordinate-Only Tracking (no developer integration)**

- Listen for click events on the Unity canvas from JavaScript
- Capture x/y coordinates relative to the canvas
- Optionally capture the canvas resolution for normalization
- This gives us coordinate heatmaps but no semantic information

**Approach: Hybrid with Optional Config**

The tracker could detect a Unity canvas and expose a global `window.__lumitra_unity_click` callback. If the developer adds our lightweight C# script, it calls this callback with semantic data. If not, we still capture coordinates.

### Feasibility Assessment

- **External x/y tracking:** Works today, trivial. Already covered by the element-based heatmap plan's fallback.
- **Unity plugin:** Feasible but requires significant effort (C# package, .jslib bridge, testing across Unity versions). The market for Unity WebGL analytics is niche. Low priority unless we target game analytics.
- **Hybrid callback:** Clever middle ground. The JS side is trivial; the C# side is a ~50-line script that developers can drop in. Could be documented as a "recipe" rather than a maintained package.
- **Timeline:** Hybrid callback recipe could ship in 1 week. Full Unity package would be 4-6 weeks.

---

## 3. Three.js / Babylon.js / WebGL

### How Click Events Work

Three.js and Babylon.js are JavaScript 3D libraries that render into a `<canvas>` element. Unlike Flutter and Unity, **the application code itself is JavaScript** running directly in the browser, which makes integration significantly more tractable.

**Three.js:**
Click detection uses the `Raycaster` class:
1. Capture mouse coordinates from a DOM click event on the canvas
2. Convert to normalized device coordinates (NDC): `(-1 to +1)` range
3. Create a `Raycaster` from the camera through the NDC point
4. Call `raycaster.intersectObjects(scene.children, true)` to get hit objects
5. The first intersection contains the `object` (a `Mesh`, `Group`, etc.) and the `point` (3D world coordinates)

**Babylon.js:**
Uses `ActionManager` with triggers like `OnPickTrigger`, `OnLeftPickTrigger`, etc.:
1. Attach an `ActionManager` to a mesh
2. Register actions: `mesh.actionManager.registerAction(new ExecuteCodeAction(OnPickTrigger, callback))`
3. Alternatively, use `scene.pick(x, y)` for manual picking
4. Returns a `PickingInfo` object with the mesh name, face, and 3D coordinates

Both frameworks expose their picking results in JavaScript, which means we can hook into them without leaving the browser environment.

### Mapping Clicks to Semantic Elements

3D scenes have a natural hierarchy that can serve as a semantic identifier:

- **Three.js:** Every `Object3D` has a `.name` property, a `.uuid`, and a parent chain. You can build a path like `Scene/Environment/Door/HandleMesh`. Objects can also have `.userData` with arbitrary metadata.
- **Babylon.js:** Every mesh has a `.name`, `.id`, and a parent hierarchy. Metadata can be attached via `.metadata`.

The quality of these identifiers depends entirely on whether the developer has named their objects meaningfully. A scene exported from Blender might have names like `Cube.003` (useless) or `MainMenu_PlayButton` (useful).

### What Existing Analytics Solutions Do

- There is essentially **no established analytics solution** for Three.js/Babylon.js scenes. These are typically used for 3D product configurators, architectural walkthroughs, games, and data visualizations -- domains where traditional web analytics tools do not apply.
- Some teams build custom analytics by hooking into the raycaster and sending events to Mixpanel, Amplitude, or Google Analytics as custom events. This is always bespoke.
- Clarity and Hotjar show the canvas as a black rectangle.

### Proposed Integration Strategy

**Approach: Helper Library (lightweight, requires minimal integration)**

A small JS library (`@lumitra/three-analytics` or `@lumitra/babylon-analytics`) that:

**For Three.js:**
```javascript
import { enableLumitraTracking } from '@lumitra/three-analytics';

// One-line integration
enableLumitraTracking(renderer, scene, camera, {
  nameResolver: (object) => object.userData.analyticsId || object.name,
  trackHover: false,
});
```

Under the hood:
1. Patches or wraps the renderer's DOM element click listener
2. On click, performs a raycast using the scene and camera
3. Extracts the object name/path as a semantic identifier
4. Emits to the Lumitra tracker: `{ selector: "three://Scene/Door/Handle", x, y }`

**For Babylon.js:**
```javascript
import { enableLumitraTracking } from '@lumitra/babylon-analytics';

enableLumitraTracking(scene, {
  nameResolver: (mesh) => mesh.metadata?.analyticsId || mesh.name,
});
```

Under the hood:
1. Hooks into `scene.onPointerObservable`
2. On pick events, extracts mesh name/path
3. Emits to the tracker

**Approach: Auto-Detection (no integration needed)**

For pages using Three.js or Babylon.js, the tracker could:
1. Detect `window.THREE` or `window.BABYLON` globals (common in non-bundled setups)
2. Attempt to find the scene and camera from known patterns
3. Perform raycasting on click

This is fragile and unlikely to work reliably with modern bundled applications where these globals are not exposed. Not recommended as a primary strategy.

### Feasibility Assessment

- **Helper libraries:** The most practical approach. Three.js and Babylon.js developers are used to adding small libraries. The raycaster integration is straightforward JavaScript. **High confidence.**
- **Auto-detection:** Too fragile for production. Could work as a "bonus" for simple demos.
- **Timeline:** Three.js helper could ship in 1-2 weeks. Babylon.js helper in another week. Both share the same tracker event format.

---

## Cross-Cutting Concerns

### Event Format

For canvas framework clicks, we need to extend the event format to accommodate framework-specific identifiers. Proposed approach:

- Reuse the existing `selector` field with a URI-style prefix:
  - `flt://button[aria-label="Submit"]` -- Flutter semantics node
  - `unity://MainMenu/PlayButton` -- Unity GameObject path
  - `three://Scene/ProductModel/Door` -- Three.js object path
- The extension rendering code checks for these prefixes and renders appropriately
- If the prefix is unknown or empty, fall back to x/y coordinate rendering

### Canvas Resolution Normalization

Canvas-based apps often render at different resolutions than their CSS pixel dimensions (e.g., `devicePixelRatio` scaling). For x/y fallback to be useful:
- Capture coordinates relative to the canvas CSS dimensions, not the canvas pixel buffer
- Store `canvasWidth` and `canvasHeight` alongside coordinates
- On replay, scale coordinates to the viewport's current canvas size

### Heatmap Rendering on Canvas Pages

Even with semantic identifiers from framework plugins, we cannot overlay DOM elements on a canvas. Options:

1. **Canvas overlay:** Draw a semi-transparent canvas on top of the app canvas with heat regions. This works for coordinate heatmaps but not element highlighting.
2. **Side panel / list view:** Show a ranked list of clicked elements with counts, rather than a spatial overlay. This works for semantic identifiers from framework plugins.
3. **Hybrid:** For Flutter with semantics enabled, we can overlay highlights on the `<flt-semantics>` elements since they have position and size. This is the most promising approach for Flutter specifically.

---

## Priority Recommendation

Given the analytics platform's current stage and target market (standard web apps, SaaS products, marketing sites):

| Priority | Framework | Approach | Effort | Impact |
|----------|-----------|----------|--------|--------|
| 1 (Now) | All canvas | x/y coordinate fallback | Done (in element heatmap plan) | Baseline coverage |
| 2 (Q2) | Flutter Web | Semantics tree scraping | 1-2 weeks | Covers growing Flutter Web segment |
| 3 (Q2-Q3) | Three.js | Helper library | 1-2 weeks | Covers 3D product configurators |
| 4 (Q3) | Babylon.js | Helper library | 1 week (after Three.js) | Extends 3D coverage |
| 5 (Q4+) | Unity WebGL | Hybrid callback recipe | 1 week docs + example | Niche but differentiating |
| 6 (Backlog) | Flutter Web | Dart plugin | 3-4 weeks | Premium Flutter integration |
| 7 (Backlog) | Unity WebGL | Full C# package | 4-6 weeks | Only if game analytics demand |

The Flutter semantics scraping (Priority 2) is the highest-value next step because it requires zero developer integration and Flutter Web adoption is growing steadily. The Three.js helper (Priority 3) is a close second because 3D product configurators are a natural fit for click analytics.

---

## Open Questions

1. **Flutter semantics opt-in:** Should we document a recommendation for Flutter developers to enable semantics programmatically for better analytics? This has accessibility benefits too, but it comes with a performance cost.

2. **Custom event format:** Should framework-specific identifiers use the `selector` field with URI prefixes, or should we add a new `frameworkElement` field to the event schema? The URI prefix approach avoids schema changes but overloads the selector field.

3. **Three.js version compatibility:** Three.js has frequent breaking changes to its API. How far back should the helper library support? The raycaster API has been stable since r100+, so this may not be a real concern.

4. **Market validation:** Before building framework-specific integrations, should we survey existing users to gauge demand? If nobody is tracking Flutter Web or Three.js apps, this is academic.

## References

- [Flutter Web Accessibility](https://docs.flutter.dev/ui/accessibility/web-accessibility)
- [Flutter Web Renderers](https://docs.flutter.dev/platform-integration/web/renderers)
- [Accessibility in Flutter on the Web](https://blog.flutter.dev/accessibility-in-flutter-on-the-web-51bfc558b7d3)
- [Flutter Issue #136426: Hotjar capabilities](https://github.com/flutter/flutter/issues/136426)
- [Unity Manual: Input in Web](https://docs.unity3d.com/Manual/webgl-input.html)
- [Unity Manual: Interacting with browser scripting](https://docs.unity3d.com/Manual/webgl-interactingwithbrowserscripting.html)
- [React Unity WebGL: SendMessage](https://react-unity-webgl.dev/docs/api/send-message)
- [Three.js Raycasting Tutorial](https://ryanschiang.com/threejs-clickable-vertices-tutorial)
- [Babylon.js Actions Documentation](https://doc.babylonjs.com/features/featuresDeepDive/events/actions)
- [Microsoft Clarity: Canvas not rendered (Issue #647)](https://github.com/microsoft/clarity/issues/647)
- [Microsoft Clarity: Canvas recording feature request (Issue #299)](https://github.com/microsoft/clarity/issues/299)
- [Heatlens Flutter Package](https://pub.dev/packages/heatlens)
- [GameAnalytics Unity SDK](https://github.com/GameAnalytics/GA-SDK-UNITY)
