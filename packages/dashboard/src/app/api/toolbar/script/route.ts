import { NextRequest } from 'next/server';
import { verifyToolbarToken } from '@/lib/toolbar-token';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get('projectId');
  const token = searchParams.get('token');

  const jsHeaders = {
    'Content-Type': 'application/javascript',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  };

  if (!projectId) {
    return new Response('// Missing projectId', {
      status: 400,
      headers: jsHeaders,
    });
  }

  // If a token was provided, validate it up-front
  if (token) {
    const payload = await verifyToolbarToken(token);
    if (!payload || payload.pid !== projectId) {
      return new Response('// Invalid or expired token', {
        status: 401,
        headers: jsHeaders,
      });
    }
  }

  const origin = new URL(request.url).origin;

  const script = `
(function() {
  if (document.getElementById('__analytics-toolbar')) return;

  // Create shadow DOM container
  var host = document.createElement('div');
  host.id = '__analytics-toolbar';
  host.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;';
  document.body.appendChild(host);
  var shadow = host.attachShadow({ mode: 'closed' });

  // Toolbar HTML
  shadow.innerHTML = \`
    <style>
      .toolbar { display:flex; align-items:center; gap:8px; padding:8px 16px; background:#111827; border-top:1px solid #374151; font-family:system-ui,sans-serif; font-size:13px; color:#f3f4f6; }
      button { background:#1f2937; border:1px solid #374151; color:#f3f4f6; padding:4px 12px; border-radius:6px; cursor:pointer; font-size:12px; }
      button:hover { background:#374151; }
      button.active { background:#2563eb; border-color:#2563eb; }
      .close { margin-left:auto; background:none; border:none; color:#9ca3af; font-size:16px; cursor:pointer; }
      .close:hover { color:#f3f4f6; }
      .status { color:#9ca3af; font-size:12px; }
    </style>
    <div class="toolbar">
      <span style="font-weight:600;">Heatmap</span>
      <button id="load-btn">Load Heatmap</button>
      <button class="active" data-range="7">7d</button>
      <button data-range="30">30d</button>
      <button data-range="90">90d</button>
      <span class="status" id="status"></span>
      <button class="close" id="close-btn">&times;</button>
    </div>
  \`;

  var days = 7;
  var heatmapInstance = null;
  var heatmapContainer = null;

  // Date range buttons
  shadow.querySelectorAll('[data-range]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      shadow.querySelectorAll('[data-range]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      days = parseInt(btn.dataset.range);
    });
  });

  // Close button
  shadow.getElementById('close-btn').addEventListener('click', function() {
    if (heatmapContainer) heatmapContainer.remove();
    host.remove();
  });

  // Load heatmap
  shadow.getElementById('load-btn').addEventListener('click', function() {
    var status = shadow.getElementById('status');
    status.textContent = 'Loading...';

    var now = new Date();
    var from = new Date(now.getTime() - days * 86400000).toISOString();
    var to = now.toISOString();
    var url = encodeURIComponent(location.href.split('?')[0]);

    var apiUrl = '${origin}/api/heatmap/by-selector/clicks?projectId=${projectId}&url=' + url + '&from=' + from + '&to=' + to;
    ${token ? `apiUrl += '&token=${token}';` : ''}

    fetch(apiUrl, { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.clicks || data.clicks.length === 0) {
          status.textContent = 'No click data for this page';
          return;
        }
        var result = resolveClicks(data.clicks);
        if (result.resolved.length === 0) {
          status.textContent = 'No elements matched (' + result.dropped + ' unresolved)';
          return;
        }
        status.textContent = result.resolved.length + ' clicks mapped' + (result.dropped > 0 ? ' (' + result.dropped + ' unresolved)' : '');
        renderHeatmap(result.resolved);
      })
      .catch(function(err) {
        status.textContent = 'Error: ' + err.message;
      });
  });

  function resolveClicks(clicks) {
    var resolved = [];
    var dropped = 0;
    for (var i = 0; i < clicks.length; i++) {
      var c = clicks[i];
      var el = document.querySelector(c.selector);
      if (!el) { dropped++; continue; }
      var rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) { dropped++; continue; }
      resolved.push({
        x: Math.round(rect.left + window.scrollX + (c.ox / c.ew) * rect.width),
        y: Math.round(rect.top + window.scrollY + (c.oy / c.eh) * rect.height),
        value: 1
      });
    }
    return { resolved: resolved, dropped: dropped };
  }

  function renderHeatmap(points) {
    // Remove previous overlay
    if (heatmapContainer) heatmapContainer.remove();

    heatmapContainer = document.createElement('div');
    heatmapContainer.id = '__analytics-heatmap-overlay';
    heatmapContainer.style.cssText = 'position:absolute;top:0;left:0;width:' + document.documentElement.scrollWidth + 'px;height:' + document.documentElement.scrollHeight + 'px;pointer-events:none;z-index:2147483646;';
    document.body.appendChild(heatmapContainer);

    // Load heatmap.js from CDN
    if (typeof h337 !== 'undefined') {
      createHeatmap(points);
    } else {
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/heatmap.js@2.0.5/build/heatmap.min.js';
      s.onload = function() { createHeatmap(points); };
      document.head.appendChild(s);
    }
  }

  function createHeatmap(points) {
    heatmapInstance = h337.create({
      container: heatmapContainer,
      radius: 30,
      maxOpacity: 0.6,
      minOpacity: 0.05,
      blur: 0.85,
    });

    var max = Math.max.apply(null, points.map(function(p) { return p.value; }));
    heatmapInstance.setData({
      max: max || 1,
      data: points,
    });
  }
})();
`;

  return new Response(script, { headers: jsHeaders });
}
