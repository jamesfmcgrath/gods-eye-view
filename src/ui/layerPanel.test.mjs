import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('panel presentation places Transit between Street Traffic and Bike Share in Movement', () => {
  const source = readFileSync(
    new URL('./layerPanel.js', import.meta.url),
    'utf8',
  );
  const declarations = source.slice(
    source.indexOf('const PANEL_GROUPS ='),
    source.indexOf('const PANEL_POSITIONS ='),
  );
  const order = JSON.parse(
    runInNewContext(`${declarations}\nJSON.stringify(PANEL_ORDER)`),
  );
  assert.deepEqual(
    order.filter(({ label }) => label === 'Movement').map(({ id }) => id),
    [
      'satellites',
      'flights',
      'military',
      'local-adsb',
      'ais-live-vessels',
      'traffic',
      'transit',
      'bikeshare',
    ],
  );
  assert.equal(order.filter(({ id }) => id === 'transit').length, 1);
});

test('partial feed controls distinguish incomplete records from stale data and outages', async () => {
  const { LayerPanel, layerFeedState } = await import('./layerPanel.js');
  const classes = new Map();
  const attrs = new Map();
  const button = {
    classList: { toggle: (key, value) => classes.set(key, value) },
    dataset: {},
    setAttribute: (key, value) => attrs.set(key, value),
  };
  const layer = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    source: 'AISStream',
    enabled: true,
    stats: {
      partial: true,
      stale: false,
      count: 2,
      acceptedRowCount: 2,
      rawRowCount: 3,
      lastUpdate: Date.now(),
    },
  };
  const panel = LayerPanel.prototype;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'PARTIAL');
  assert.equal(button.dataset.feedState, 'partial');
  assert.equal(classes.get('feed-partial'), true);
  assert.equal(classes.get('feed-stale'), false);
  assert.match(attrs.get('aria-label'), /PARTIAL/);
  assert.match(
    panel._buildMetaText(layer),
    /^PARTIAL · AISStream · 2 of 3 records accepted · /,
  );
  assert.match(
    panel._buildMetaText({
      ...layer,
      stats: { ...layer.stats, rawRowCount: 2 },
    }),
    /incomplete snapshot/,
  );
  assert.equal(layerFeedState({ ...layer.stats, stale: true }), 'stale');
  assert.equal(
    layerFeedState({ ...layer.stats, error: 'Connection lost' }),
    'degraded',
  );
  assert.equal(
    layerFeedState({ ...layer.stats, status: 'unavailable' }),
    'unavailable',
  );
  assert.equal(layerFeedState({ ...layer.stats, loading: true }), 'loading');
  layer.stats = { ...layer.stats, partial: false };
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'ON');
  assert.equal(classes.get('feed-partial'), false);
  layer.enabled = false;
  panel._syncToggleButton(button, layer);
  assert.equal(button.textContent, 'OFF');
});

test('readout rows contain only toggles and metadata; ordinary rows retain controls', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const ids = [
    'wind',
    'weather-radar',
    'weather-satellite',
    'weather-lightning',
    'weather-cyclones',
    'other',
  ];
  let refresh;
  const layers = ids.map((id) => ({
    id,
    name: id,
    icon: '*',
    source: 'Source',
    enabled: true,
    showInTogglePanel: true,
    stats: {},
  }));
  const calls = [];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: () => true,
    setEnabled: (...args) => calls.push(args),
    setLayerParams: (...args) => calls.push(args),
    hasRowControls: () => true,
    subscribeRowControls: (_id, callback) => {
      refresh = callback;
    },
    getRowControls: (id) => ({
      readout: id !== 'other',
      summary: { status: 'Loading' },
      info: 'Detailed time',
      chips: [{ id: 'config', label: 'Soft', params: { opacity: 'light' } }],
      legend: [{ label: 'Rain', color: '#abcdef' }],
      list: {
        items: [{ id: 'storm', text: 'Storm', params: { focus: true } }],
      },
    }),
  });
  try {
    panel.mount(f.container);
    for (const id of ids.slice(0, -1)) {
      const row = f.find((n) => n.dataset.layerId === id);
      assert.equal(row.children.length, 2);
      assert.ok(row.querySelector('.data-name'));
      assert.ok(row.querySelector('.data-toggle-meta'));
      for (const cls of [
        'data-toggle-chip',
        'data-count',
        'data-toggle-controls',
        'data-toggle-controls-status',
        'data-row-list',
      ])
        assert.equal(row.querySelector(`.${cls}`), null);
      row.querySelector('.data-toggle-btn').click();
    }
    assert.deepEqual(
      calls.map(([id]) => id),
      ids.slice(0, -1),
    );
    const ordinary = f.find((n) => n.dataset.layerId === 'other');
    assert.equal(
      ordinary.querySelector('.data-toggle-controls-info').textContent,
      'Detailed time',
    );
    assert.ok(ordinary.querySelector('.data-toggle-legend-item'));
    ordinary.querySelector('.data-toggle-chip').click();
    assert.deepEqual(calls.at(-1), [
      'other',
      { opacity: 'light' },
      { origin: 'user' },
    ]);
    assert.equal(typeof refresh, 'function');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('the Recent Imagery readout mounts in its rail body like the weather readout and is rebuilt or released with the panel', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const body = f.document.createElement('div');
  f.document.getElementById = (id) =>
    id === 'recent-imagery-panel-body' ? body : null;
  const previousDocument = globalThis.document;
  globalThis.document = f.document;
  const mounted = [];
  const factory = (container) => {
    const readout = {
      container,
      destroyed: false,
      destroy() {
        this.destroyed = true;
      },
    };
    mounted.push(readout);
    return readout;
  };
  const panel = new LayerPanel({
    getLayers: () => [],
    isEnabled: () => false,
    setEnabled() {},
    setLayerParams() {},
    hasRowControls: () => false,
    subscribeRowControls() {},
    getRowControls: () => null,
  });
  try {
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 0, 'no body before the panel mounts');
    panel.mount(f.container);
    assert.equal(mounted.length, 1);
    assert.equal(mounted[0].container, body);
    panel.mount(f.container);
    assert.equal(mounted[0].destroyed, true, 'a remount rebuilds it');
    assert.equal(mounted.length, 2);
    panel.attachRecentImagery(null);
    assert.equal(mounted[1].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3);
    panel.destroy();
    assert.equal(mounted[2].destroyed, true);
    panel.attachRecentImagery(factory);
    assert.equal(mounted.length, 3, 'a destroyed panel mounts nothing');
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('row detail renders accessible reused nodes and only https links', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  // The shared fixture has no removeAttribute; add it for this test only.
  const createElement = f.document.createElement;
  f.document.createElement = (tag) => {
    const node = createElement(tag);
    node.removeAttribute = (key) => node.attributes.delete(key);
    return node;
  };
  globalThis.document = f.document;
  let detail = {
    heading: 'Castle - tower house, Corraun',
    meta: 'Co. Mayo · SMR MA070-110----',
    text: 'In pasture…',
    link: { href: 'https://example.org/r', label: 'View full record' },
  };
  const layers = [
    {
      id: 'other',
      name: 'other',
      icon: '*',
      source: 'Source',
      enabled: true,
      showInTogglePanel: true,
      stats: {},
    },
  ];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: () => true,
    setEnabled() {},
    setLayerParams() {},
    hasRowControls: () => true,
    subscribeRowControls() {},
    getRowControls: () => ({ detail }),
  });
  try {
    panel.mount(f.container);
    const row = f.find((n) => n.dataset.layerId === 'other');
    // The fixture cannot resolve attribute selectors, so sync the row directly.
    const sync = () =>
      panel._syncRowControls(
        row.querySelector('.data-toggle-controls'),
        layers[0],
      );
    const section = row.querySelector('.data-toggle-detail');
    assert.equal(section.getAttribute('aria-label'), 'Selected item');
    assert.equal(section.getAttribute('aria-live'), 'polite');
    assert.equal(
      row.querySelector('.data-toggle-detail-heading').textContent,
      'Castle - tower house, Corraun',
    );
    assert.equal(
      row.querySelector('.data-toggle-detail-meta').textContent,
      'Co. Mayo · SMR MA070-110----',
    );
    const text = row.querySelector('.data-toggle-detail-text');
    assert.equal(text.textContent, 'In pasture…');
    assert.equal(text.tabIndex, 0);
    const link = row.querySelector('.data-toggle-detail-link');
    assert.equal(link.getAttribute('href'), 'https://example.org/r');
    assert.equal(link.target, '_blank');
    assert.equal(link.rel, 'noopener noreferrer');
    assert.equal(link.textContent, 'View full record (opens in a new tab)');

    detail = { ...detail, text: 'Changed' };
    sync();
    assert.equal(row.querySelector('.data-toggle-detail'), section);
    assert.equal(text.textContent, 'Changed');

    detail = { ...detail, link: { href: 'javascript:alert(1)' } };
    sync();
    assert.equal(link.hidden, true);

    detail = null;
    sync();
    assert.equal(section.hidden, true);
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});

test('legend, chips and info rebuilt after the detail still render before it', async () => {
  const { LayerPanel } = await import('./layerPanel.js');
  const { railFixture } = await import('./railTestFixture.mjs');
  const f = railFixture();
  const previousDocument = globalThis.document;
  const createElement = f.document.createElement;
  f.document.createElement = (tag) => {
    const node = createElement(tag);
    node.removeAttribute = (key) => node.attributes.delete(key);
    return node;
  };
  globalThis.document = f.document;
  let controls = {
    detail: { heading: 'Castle - tower house, Corraun', text: 'In pasture…' },
  };
  const layers = [
    {
      id: 'other',
      name: 'other',
      icon: '*',
      source: 'Source',
      enabled: true,
      showInTogglePanel: true,
      stats: {},
    },
  ];
  const panel = new LayerPanel({
    getLayers: () => layers,
    isEnabled: () => true,
    setEnabled() {},
    setLayerParams() {},
    hasRowControls: () => true,
    subscribeRowControls() {},
    getRowControls: () => controls,
  });
  try {
    panel.mount(f.container);
    const row = f.find((n) => n.dataset.layerId === 'other');
    const container = row.querySelector('.data-toggle-controls');
    const sync = () => panel._syncRowControls(container, layers[0]);
    const section = row.querySelector('.data-toggle-detail');
    assert.ok(section, 'detail rendered first');
    assert.equal(container.children.at(-1), section);

    controls = {
      ...controls,
      legend: [{ label: 'Castles', color: '#fff', count: 1 }],
    };
    sync();
    controls = {
      ...controls,
      legend: [{ label: 'Castles', color: '#fff', count: 2 }],
    };
    sync();
    assert.equal(
      container.children.at(-1),
      section,
      'legend rebuilt before detail',
    );
    controls = {
      ...controls,
      chips: [{ id: 'a', label: 'A' }],
      info: 'Some info',
    };
    sync();
    const classes = container.children.map((node) => node.className);
    assert.equal(container.children.at(-1), section, classes.join(', '));
    assert.ok(classes.includes('data-toggle-legend-item'));
    assert.ok(classes.includes('data-toggle-controls-info'));
    assert.ok(classes.some((name) => name.startsWith('data-toggle-chip')));
  } finally {
    panel.destroy();
    globalThis.document = previousDocument;
  }
});
