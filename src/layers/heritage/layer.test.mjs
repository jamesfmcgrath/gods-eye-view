import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createHeritageLayer, excerptLines, viewBox } from './index.js';
import { HERITAGE_FAMILY_COLORS } from '../../data/heritageClasses.js';
import { createTrackedOverlayEntry } from '../../data/trackedReadout.js';
import { claimPointer, resetPointerOwnership } from '../../data/inputOwnership.js';

// ScreenSpaceEventHandler registers DOM listeners on construction; Node has no DOM.
// Its LEFT_CLICK action is captured so tests can click without a canvas.
const originals = {};
let clickAction = null;
const originalSetInputAction = Cesium.ScreenSpaceEventHandler.prototype.setInputAction;
before(() => {
  for (const name of ['document', 'window']) originals[name] = globalThis[name];
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = new EventTarget();
  Cesium.ScreenSpaceEventHandler.prototype.setInputAction = function (action, type) {
    if (type === Cesium.ScreenSpaceEventType.LEFT_CLICK) clickAction = action;
    return originalSetInputAction.call(this, action, type);
  };
});
after(() => {
  for (const name of ['document', 'window']) {
    if (originals[name] === undefined) delete globalThis[name];
    else globalThis[name] = originals[name];
  }
  Cesium.ScreenSpaceEventHandler.prototype.setInputAction = originalSetInputAction;
});

function fakeViewer(box, { groundHeight } = {}) {
  let dataSource;
  const viewer = {
    picked: undefined,
    camera: {
      moveEnd: new Cesium.Event(),
      computeViewRectangle: () => (box ? Cesium.Rectangle.fromDegrees(box.west, box.south, box.east, box.north) : undefined),
    },
    scene: {
      canvas: { addEventListener() {}, removeEventListener() {} },
      globe: { ellipsoid: Cesium.Ellipsoid.WGS84, show: true, getHeight: () => groundHeight },
      pick: () => viewer.picked,
    },
    dataSources: { add: (v) => { dataSource = v; }, remove() {} },
    get dataSource() { return dataSource; },
  };
  return viewer;
}

function fakeServices({ siblingIds = [] } = {}) {
  const registered = [];
  const selected = [];
  const cleared = [];
  const refreshed = [];
  return {
    registered,
    selected,
    cleared,
    refreshed,
    overlays: { refreshReadout: (entity) => refreshed.push(entity) },
    render: { governorRequestRender() {} },
    picking: {
      registerPickOwner() {},
      unregisterPickOwner() {},
      resolvePickId: (picked) => picked?.id?.id ?? null,
      isOwnedByOtherLayer: (layerId, id) => siblingIds.includes(id),
    },
    context: {
      registerEntityContext: (entity, meta) => registered.push(meta),
      selectEntityContext: (entity) => selected.push(entity.id),
      clearSelectedEntityContextForLayer: (layerId) => cleared.push(layerId),
      removeEntityContextsForLayer() {},
    },
  };
}

const inView = { south: 53.85, west: -9.65, north: 53.92, east: -9.5 };

async function loadedLayer(records, { services = fakeServices(), groundHeight, describe = async () => ({ description: null }) } = {}) {
  const viewer = fakeViewer(inView, { groundHeight });
  const layer = createHeritageLayer({ source: { fetch: async () => ({ records, total: records.length, saturated: false }), describe }, services });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  return { viewer, layer, services };
}

function click(viewer, entityId) {
  viewer.picked = entityId ? { id: { id: entityId } } : undefined;
  clickAction({ position: new Cesium.Cartesian2(10, 10) });
}

const rath = { id: 'smr:MA1', smrs: 'MA1', monumentClass: 'Ringfort - rath', townland: 'Ardkeen', county: 'Mayo', latitude: 53.88, longitude: -9.55, link: null };

test('viewBox rejects the sky and views wider than 1.5 degrees', () => {
  assert.equal(viewBox(fakeViewer(null)), null);
  assert.equal(viewBox(fakeViewer({ south: 51, west: -10, north: 55, east: -6 })), null);
  const box = viewBox(fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 }));
  assert.ok(Math.abs(box.south - 53.85) < 1e-9);
});

test('update loads the view, draws entities and registers context', async () => {
  const services = fakeServices();
  const viewer = fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 });
  const layer = createHeritageLayer({ source: { fetch: async () => ({ records: [rath], total: 1, saturated: false }) }, services });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.equal(viewer.dataSource.entities.values.length, 1);
  assert.equal(services.registered[0].layerId, 'heritage-smr');
  assert.equal(services.registered[0].properties.name, 'Ringfort - rath, Ardkeen');
  assert.equal(layer.getStats().count, 1);
});

test('a wide view shows the zoom-in guidance and draws nothing', async () => {
  let fetched = false;
  const viewer = fakeViewer({ south: 51, west: -10, north: 55, east: -6 });
  const layer = createHeritageLayer({ source: { fetch: async () => { fetched = true; return { records: [] }; } }, services: fakeServices() });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.equal(fetched, false);
  assert.equal(layer.getStats().status, 'zoom-in');
  assert.equal(layer.getStats().countLabel, 'Zoom in to see monuments');
});

test('a missing snapshot is reported as unavailable with the fix', async () => {
  const viewer = fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 });
  const source = { fetch: async () => { throw Object.assign(new Error('x'), { code: 'smr_snapshot_missing' }); } };
  const layer = createHeritageLayer({ source, services: fakeServices() });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.equal(layer.getStats().status, 'unavailable');
  assert.match(layer.getStats().error, /npm run smr:snapshot/);
});

test('disable clears entities and ignores a late response', async () => {
  let resolve;
  const viewer = fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 });
  const layer = createHeritageLayer({ source: { fetch: () => new Promise((r) => { resolve = r; }) }, services: fakeServices() });
  layer.init(viewer);
  layer.enable(viewer);
  const pending = layer.update(viewer);
  layer.disable(viewer);
  resolve({ records: [rath], total: 1, saturated: false });
  await pending;
  assert.equal(viewer.dataSource.entities.values.length, 0);
  assert.equal(layer.getStats().status, 'idle');
});

test('a duplicate id in one response renders once and events stay resumed', async () => {
  const viewer = fakeViewer({ south: 53.85, west: -9.65, north: 53.92, east: -9.5 });
  const other = { ...rath, id: 'smr:MA2', smrs: 'MA2' };
  const responses = [[rath, rath], [other]];
  const layer = createHeritageLayer({ source: { fetch: async () => ({ records: responses.shift(), total: 1, saturated: false }) }, services: fakeServices() });
  layer.init(viewer);
  layer.enable(viewer);
  await layer.update(viewer);
  assert.equal(viewer.dataSource.entities.values.length, 1);
  await layer.update(viewer);
  assert.deepEqual(viewer.dataSource.entities.values.map((e) => e.id), ['smr:MA2']);
});

test('a selected monument publishes a readout anchored at ground height', async () => {
  const { viewer, services } = await loadedLayer([rath], { groundHeight: 312 });
  click(viewer, 'smr:MA1');
  assert.deepEqual(services.selected, ['smr:MA1']);
  const entry = createTrackedOverlayEntry(viewer.dataSource.entities.getById('smr:MA1'));
  assert.ok(entry, 'heritage entity yields a readout entry');
  assert.equal(entry.id, 'smr:MA1');
  assert.equal(entry.title, 'RINGFORT - RATH');
  const anchor = Cesium.Cartographic.fromCartesian(entry.position());
  assert.ok(Math.abs(anchor.height - 312) < 0.01, `anchor height ${anchor.height}`);
});

test('a monument click is ignored while a tool owns the pointer', async () => {
  const { viewer, services } = await loadedLayer([rath]);
  const lease = claimPointer('draw');
  try {
    click(viewer, 'smr:MA1');
    click(viewer, null);
  } finally {
    resetPointerOwnership();
  }
  assert.ok(lease);
  assert.deepEqual(services.selected, []);
  assert.deepEqual(services.cleared, []);
});

test('an empty click clears the selection; a sibling-owned pick does not', async () => {
  const services = fakeServices({ siblingIds: ['flight:abc'] });
  const { viewer } = await loadedLayer([rath], { services });
  click(viewer, 'smr:MA1');
  click(viewer, 'flight:abc');
  assert.deepEqual(services.cleared, [], 'sibling pick leaves the selection alone');
  click(viewer, null);
  assert.deepEqual(services.cleared, ['heritage-smr']);
});

test('the row legend names each colour family with its shown count', async () => {
  const castle = { ...rath, id: 'smr:MA3', smrs: 'MA3', monumentClass: 'Castle - tower house' };
  const well = { ...rath, id: 'smr:MA4', smrs: 'MA4', monumentClass: 'Ritual site - holy well' };
  const { layer } = await loadedLayer([rath, castle, well]);
  assert.deepEqual(
    layer.getRowControls().legend.map(({ label, color, count }) => ({ label, color, count })),
    [
      { label: 'Ringforts and forts', color: HERITAGE_FAMILY_COLORS.ringfort, count: 1 },
      { label: 'Castles', color: HERITAGE_FAMILY_COLORS.castle, count: 1 },
      { label: 'Church sites', color: HERITAGE_FAMILY_COLORS.ecclesiastical, count: 1 },
      { label: 'Tombs and stones', color: HERITAGE_FAMILY_COLORS.ritual, count: 0 },
      { label: 'Other', color: HERITAGE_FAMILY_COLORS.other, count: 0 },
    ],
  );
});

// Deferred describe calls, so each test controls when a description arrives.
function deferredDescribe() {
  const calls = [];
  const describe = (smrs, signal) =>
    new Promise((resolve, reject) => calls.push({ smrs, signal, resolve, reject }));
  return { calls, describe };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

const castle = { id: 'smr:MA070-110----', smrs: 'MA070-110----', monumentClass: 'Castle - tower house', townland: 'Corraun', county: 'Mayo', latitude: 53.89, longitude: -9.56, link: 'https://heritagedata.maps.arcgis.com/r?smr=MA070-110----' };

test('excerptLines wraps at word boundaries, caps the lines and marks truncation', () => {
  assert.deepEqual(excerptLines('A short note.'), ['A short note.']);
  const long = 'The remains of a tower house stand on a low rise in pasture overlooking the bay, with a vaulted ground floor and a spiral stair in the north-east angle.';
  const lines = excerptLines(long);
  assert.equal(lines.length, 3);
  for (const line of lines) assert.ok(line.length <= 46, `${line.length}: ${line}`);
  assert.ok(lines[2].endsWith('…'));
  assert.ok(!lines[0].endsWith('…'));
  assert.equal(long.startsWith(lines.join(' ').replace(/…$/, '')), true, 'words are kept whole and in order');
  assert.deepEqual(excerptLines('x'.repeat(60), { width: 10, lines: 2 }), ['xxxxxxxxx…']);
  assert.deepEqual(excerptLines(''), []);
  assert.deepEqual(excerptLines(null), []);
});

test('selecting a monument loads its description into the row detail and readout', async () => {
  const { calls, describe } = deferredDescribe();
  const services = fakeServices();
  const { viewer, layer } = await loadedLayer([castle], { services, describe });
  let notified = 0;
  layer.setRowControlsListener(() => { notified += 1; });
  click(viewer, castle.id);
  const loading = layer.getRowControls().detail;
  assert.deepEqual(loading, {
    label: 'Selected monument',
    heading: 'Castle - tower house, Corraun',
    meta: 'Co. Mayo · SMR MA070-110----',
    text: 'Loading description…',
    link: { href: castle.link, label: 'View full record (Historic Environment Viewer)' },
  });
  assert.ok(notified >= 1, 'row listener fired on selection');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].smrs, 'MA070-110----');
  const description = 'The remains of a tower house stand on a low rise in pasture overlooking the bay, with a vaulted ground floor.';
  const before = notified;
  calls[0].resolve({ ...castle, description });
  await flush();
  assert.equal(layer.getRowControls().detail.text, description);
  const entity = viewer.dataSource.entities.getById(castle.id);
  assert.deepEqual(entity.gevLabelModel.details, [
    'CORRAUN, CO. MAYO',
    'SMR MA070-110----',
    'SOURCE: NATIONAL MONUMENTS SERVICE',
    ...excerptLines(description),
  ]);
  assert.deepEqual(services.refreshed, [entity]);
  assert.ok(notified > before, 'row listener fired when the description arrived');
  const context = services.registered.at(-1);
  assert.equal(context.id, castle.id);
  assert.equal(context.properties.description, description);
  assert.equal(context.properties.smrs, 'MA070-110----');
});

test('a record without a published description says so and adds no excerpt', async () => {
  const { calls, describe } = deferredDescribe();
  const services = fakeServices();
  const { viewer, layer } = await loadedLayer([castle], { services, describe });
  click(viewer, castle.id);
  calls[0].resolve({ ...castle, description: null });
  await flush();
  assert.equal(layer.getRowControls().detail.text, 'No description has been published for this record yet.');
  assert.equal(viewer.dataSource.entities.getById(castle.id).gevLabelModel.details.length, 3);
  assert.equal(services.registered.at(-1).properties.description, null);
});

test('a failed description keeps the record link and invites a retry', async () => {
  const { calls, describe } = deferredDescribe();
  const { viewer, layer } = await loadedLayer([castle], { describe });
  click(viewer, castle.id);
  calls[0].reject(Object.assign(new Error('busy'), { code: 'description_busy' }));
  await flush();
  const { detail } = layer.getRowControls();
  assert.equal(detail.text, 'Description unavailable right now. Try selecting it again shortly.');
  assert.equal(detail.link.href, castle.link);
});

test('a late description for a previous selection is ignored', async () => {
  const { calls, describe } = deferredDescribe();
  const { viewer, layer } = await loadedLayer([castle, rath], { describe });
  click(viewer, castle.id);
  click(viewer, rath.id);
  assert.equal(calls[0].signal.aborted, true, 'the superseded request is aborted');
  calls[0].resolve({ ...castle, description: 'Castle text.' });
  await flush();
  const { detail } = layer.getRowControls();
  assert.equal(detail.heading, 'Ringfort - rath, Ardkeen');
  assert.equal(detail.text, 'Loading description…');
  assert.equal(viewer.dataSource.entities.getById(castle.id).gevLabelModel.details.length, 3);
});

test('an empty click clears the detail and aborts the pending description', async () => {
  const { calls, describe } = deferredDescribe();
  const { viewer, layer } = await loadedLayer([castle], { describe });
  click(viewer, castle.id);
  click(viewer, null);
  assert.equal(layer.getRowControls().detail, undefined);
  assert.equal(calls[0].signal.aborted, true);
});
