import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createHeritageLayer, viewBox } from './index.js';

// ScreenSpaceEventHandler registers DOM listeners on construction; Node has no DOM.
const originals = {};
before(() => {
  for (const name of ['document', 'window']) originals[name] = globalThis[name];
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.window = new EventTarget();
});
after(() => {
  for (const name of ['document', 'window']) {
    if (originals[name] === undefined) delete globalThis[name];
    else globalThis[name] = originals[name];
  }
});

function fakeViewer(box) {
  let dataSource;
  return {
    camera: {
      moveEnd: new Cesium.Event(),
      computeViewRectangle: () => (box ? Cesium.Rectangle.fromDegrees(box.west, box.south, box.east, box.north) : undefined),
    },
    scene: { canvas: { addEventListener() {}, removeEventListener() {} }, globe: { ellipsoid: Cesium.Ellipsoid.WGS84 }, pick: () => undefined },
    dataSources: { add: (v) => { dataSource = v; }, remove() {} },
    get dataSource() { return dataSource; },
  };
}

function fakeServices() {
  const registered = [];
  return {
    registered,
    render: { governorRequestRender() {} },
    picking: { registerPickOwner() {}, unregisterPickOwner() {} },
    context: {
      registerEntityContext: (entity, meta) => registered.push(meta),
      selectEntityContext() {},
      clearSelectedEntityContextForLayer() {},
      removeEntityContextsForLayer() {},
    },
  };
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
