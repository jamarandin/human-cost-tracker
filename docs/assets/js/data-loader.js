/**
 * data-loader.js
 * Fetches casualties.json and sources.json, then populates all
 * [data-metric], [data-bar], and [data-tree] elements in the page.
 *
 * Attribute conventions:
 *   data-metric="iran.reportedDeaths"   → populates element text with metrics[key].display
 *   data-metric-source="iran.reportedDeaths" → populates with "source · date"
 *   data-bar="iran.reportedDeaths"      → updates bar-fill width, label, meta
 *   data-tree="iran.total"              → updates .tree-number and .tree-desc inside element
 *   data-last-updated                   → populates with lastUpdated date string
 */

(function () {
  'use strict';

  // Path from docs/data/ (where GitHub Actions copies the JSON)
  // Falls back to ../data/ for local development from repo root
  const DATA_BASE = (() => {
    const scriptSrc = document.currentScript && document.currentScript.src;
    if (scriptSrc) {
      // Resolve relative to script location: assets/js/ → ../../data/
      return new URL('../../data/', scriptSrc).href;
    }
    return './data/';
  })();

  /**
   * Resolve a dot-separated key like "iran.reportedDeaths" into an object value.
   */
  function get(obj, dotPath) {
    return dotPath.split('.').reduce((acc, k) => acc && acc[k], obj);
  }

  /**
   * Format a number string with locale commas, preserving leading > or trailing +.
   */
  function formatDisplay(display) {
    return display; // already pre-formatted in JSON; extend here if needed
  }

  /**
   * Populate all [data-metric] elements.
   */
  function populateMetrics(casualties) {
    document.querySelectorAll('[data-metric]').forEach(function (el) {
      var key = el.dataset.metric;
      var entry = casualties.metrics && casualties.metrics[key];
      if (!entry) return;
      el.textContent = formatDisplay(entry.display);
      el.setAttribute('title', 'Source: ' + entry.source + ' \u00b7 ' + entry.date);
    });

    document.querySelectorAll('[data-metric-source]').forEach(function (el) {
      var key = el.dataset.metricSource;
      var entry = casualties.metrics && casualties.metrics[key];
      if (!entry) return;
      el.textContent = entry.source + ' \u00b7 ' + entry.date;
    });
  }

  /**
   * Populate all [data-bar] elements (expects a .bar-fill child structure).
   */
  function populateBars(casualties) {
    document.querySelectorAll('[data-bar]').forEach(function (el) {
      var key = el.dataset.bar;
      var bar = casualties.bars && casualties.bars[key];
      if (!bar) return;

      // el is the .bar-fill div
      el.style.setProperty('--fill-width', bar.fillPct + '%');

      // Color override
      if (bar.color === 'amber') {
        el.style.background = 'var(--amber)';
      }

      // Update the display number inside the bar
      var span = el.querySelector('span');
      if (span) {
        span.textContent = formatDisplay(bar.display);
      } else if (bar.fillPct > 5) {
        // Only show inline text if bar is wide enough
        el.textContent = formatDisplay(bar.display);
      }

      // Update the .bar-meta below the bar container
      var animatedBar = el.closest('.animated-bar');
      if (animatedBar) {
        var meta = animatedBar.querySelector('.bar-meta');
        if (meta) meta.textContent = bar.meta;

        // For tiny bars (US numbers), update the sibling display span
        var sibling = animatedBar.querySelector('[data-bar-label]');
        if (sibling) sibling.textContent = formatDisplay(bar.display);
      }
    });
  }

  /**
   * Populate all [data-tree] elements. Expects .tree-label, .tree-number,
   * and .tree-desc children.
   */
  function populateTree(casualties) {
    document.querySelectorAll('[data-tree]').forEach(function (el) {
      var key = el.dataset.tree;
      var entry = casualties.tree && casualties.tree[key];
      if (!entry) return;

      var label = el.querySelector('.tree-label');
      var number = el.querySelector('.tree-number');
      var desc = el.querySelector('.tree-desc');

      if (label && entry.label) label.textContent = entry.label;
      if (number) number.textContent = formatDisplay(entry.display);
      if (desc && entry.desc) desc.textContent = entry.desc;
    });
  }

  /**
   * Populate source cards from sources.json if [data-source-id] attributes exist.
   */
  function populateSources(sourcesData) {
    var index = {};
    (sourcesData.sources || []).forEach(function (s) { index[s.id] = s; });

    document.querySelectorAll('[data-source-id]').forEach(function (el) {
      var s = index[el.dataset.sourceId];
      if (!s) return;

      var role = el.querySelector('.source-role');
      var title = el.querySelector('.source-title');
      var date = el.querySelector('.source-date');
      var desc = el.querySelector('.source-desc');
      var link = el.querySelector('a');

      if (role) role.textContent = s.role;
      if (title) title.textContent = s.title;
      if (date) date.textContent = 'Last updated ' + s.date;
      if (desc) desc.textContent = s.description;
      if (link && s.url) link.href = s.url;
    });
  }

  /**
   * Update last-updated display.
   */
  function populateLastUpdated(casualties) {
    document.querySelectorAll('[data-last-updated]').forEach(function (el) {
      el.textContent = casualties.lastUpdated || '';
    });

    // Also update any conflict-days display
    document.querySelectorAll('[data-conflict-days]').forEach(function (el) {
      if (casualties.conflictDays) {
        el.textContent = casualties.conflictDays;
      }
    });
  }

  /**
   * Main loader — fetches both JSON files and runs all populators.
   */
  function loadData() {
    var casualtiesUrl = DATA_BASE + 'casualties.json';
    var sourcesUrl = DATA_BASE + 'sources.json';

    // Cache-bust with a daily query string so stale data is never served
    var cacheBust = '?v=' + new Date().toISOString().slice(0, 10).replace(/-/g, '');

    Promise.all([
      fetch(casualtiesUrl + cacheBust).then(function (r) {
        if (!r.ok) throw new Error('casualties.json: HTTP ' + r.status);
        return r.json();
      }),
      fetch(sourcesUrl + cacheBust).then(function (r) {
        if (!r.ok) throw new Error('sources.json: HTTP ' + r.status);
        return r.json();
      })
    ]).then(function (results) {
      var casualties = results[0];
      var sourcesData = results[1];

      populateMetrics(casualties);
      populateBars(casualties);
      populateTree(casualties);
      populateSources(sourcesData);
      populateLastUpdated(casualties);

      // Signal completion for any listeners
      document.dispatchEvent(new CustomEvent('dataLoaded', { detail: { casualties: casualties, sources: sourcesData } }));
    }).catch(function (err) {
      console.warn('[data-loader] Could not load JSON data — page will display static fallback values.', err);
    });
  }

  // Run after DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadData);
  } else {
    loadData();
  }
})();
