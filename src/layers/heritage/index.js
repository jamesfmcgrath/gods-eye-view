import * as Cesium from 'cesium';
import {
  HERITAGE_FAMILY_COLORS,
  heritageFamily,
} from '../../data/heritageClasses.js';
import {
  LAYER_ID,
  LAYER_NAME,
  REQUEST_DEBOUNCE_MS,
  MAX_VIEW_SPAN_DEG,
  SNAPSHOT_MISSING_MESSAGE,
} from './policy.js';

const toDeg = Cesium.Math.toDegrees;

/** Current view as a degree box, or null for the sky or a view too wide to sample. */
export function viewBox(viewer) {
  const rect = viewer.camera.computeViewRectangle(viewer.scene.globe.ellipsoid);
  if (!rect) return null;
  const box = {
    south: toDeg(rect.south),
    west: toDeg(rect.west),
    north: toDeg(rect.north),
    east: toDeg(rect.east),
  };
  if (!Object.values(box).every(Number.isFinite)) return null;
  if (box.north <= box.south || box.east <= box.west) return null;
  if (
    box.north - box.south > MAX_VIEW_SPAN_DEG ||
    box.east - box.west > MAX_VIEW_SPAN_DEG
  )
    return null;
  return box;
}

function heritageDetails(record) {
  return [
    `${record.townland}, CO. ${record.county}`.toUpperCase(),
    `SMR ${record.smrs}`,
    'SOURCE: NATIONAL MONUMENTS SERVICE',
  ];
}

/** Viewport-driven Sites and Monuments Record points from the local snapshot route. */
export function createHeritageLayer({ source, services } = {}) {
  if (typeof source?.fetch !== 'function')
    throw new TypeError('Heritage requires a monument source');
  const { governorRequestRender } = services.render;
  const { registerPickOwner, unregisterPickOwner } = services.picking;
  const {
    registerEntityContext,
    selectEntityContext,
    clearSelectedEntityContextForLayer,
    removeEntityContextsForLayer,
  } = services.context;

  const state = {
    viewer: null,
    dataSource: null,
    enabled: false,
    recordById: new Map(),
    abort: null,
    timer: null,
    removeMoveEnd: null,
    clickHandler: null,
    status: 'idle',
    error: null,
    lastUpdate: null,
    total: 0,
    saturated: false,
    loading: false,
  };

  function setStatus(status, error = null) {
    state.status = status;
    state.error = error;
    governorRequestRender('heritage-status');
  }

  function schedule() {
    if (!state.enabled) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(load, REQUEST_DEBOUNCE_MS);
  }

  function addEntity(record) {
    const color = Cesium.Color.fromCssColorString(
      HERITAGE_FAMILY_COLORS[heritageFamily(record.monumentClass)],
    );
    const entity = state.dataSource.entities.add({
      id: record.id,
      position: Cesium.Cartesian3.fromDegrees(
        record.longitude,
        record.latitude,
      ),
      point: {
        pixelSize: 8,
        color,
        outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
        outlineWidth: 1,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    entity.gevTrackedId = record.id;
    entity.gevLabelModel = {
      title: record.monumentClass.toUpperCase(),
      details: heritageDetails(record),
      accent: color.toCssColorString(),
    };
    registerEntityContext(entity, {
      id: record.id,
      layerId: LAYER_ID,
      dataSource: state.dataSource,
      layerName: LAYER_NAME,
      source: 'National Monuments Service SMR',
      label: record.monumentClass,
      latitude: record.latitude,
      longitude: record.longitude,
      properties: {
        name: `${record.monumentClass}, ${record.townland}`,
        monumentClass: record.monumentClass,
        townland: record.townland,
        county: record.county,
        smrs: record.smrs,
        link: record.link,
      },
    });
  }

  function render(records) {
    if (!state.dataSource) return;
    const next = new Map(records.map((record) => [record.id, record]));
    const entities = state.dataSource.entities;
    entities.suspendEvents();
    try {
      for (const id of state.recordById.keys())
        if (!next.has(id)) entities.removeById(id);
      for (const record of next.values())
        if (!state.recordById.has(record.id)) addEntity(record);
    } finally {
      entities.resumeEvents();
    }
    state.recordById = next;
    removeEntityContextsForLayer(LAYER_ID, { retainIds: new Set(next.keys()) });
    governorRequestRender('heritage-render');
  }

  async function load() {
    if (!state.enabled || !state.viewer) return;
    const box = viewBox(state.viewer);
    if (!box) {
      state.abort?.abort();
      render([]);
      state.total = 0;
      state.saturated = false;
      setStatus('zoom-in');
      return;
    }
    state.abort?.abort();
    const request = new AbortController();
    state.abort = request;
    state.loading = true;
    try {
      const result = await source.fetch(box, request.signal);
      if (request.signal.aborted || state.abort !== request || !state.enabled)
        return;
      render(result.records);
      state.total = result.total;
      state.saturated = result.saturated;
      state.lastUpdate = Date.now();
      setStatus('idle');
    } catch (error) {
      if (request.signal.aborted || error?.name === 'AbortError') return;
      setStatus(
        'unavailable',
        error?.code === 'smr_snapshot_missing'
          ? SNAPSHOT_MISSING_MESSAGE
          : 'Heritage data unavailable',
      );
    } finally {
      if (state.abort === request) {
        state.abort = null;
        state.loading = false;
      }
    }
  }

  function onClick({ position }) {
    if (!state.enabled) return;
    const picked = state.viewer.scene.pick(position);
    const id = picked?.id?.id;
    if (!state.recordById.has(id)) return;
    selectEntityContext(state.dataSource.entities.getById(id));
    governorRequestRender('heritage-selection');
  }

  return {
    id: LAYER_ID,
    name: LAYER_NAME,
    icon: '⌂',
    source: 'NMS',
    updateInterval: 0,
    statsRefreshInterval: 1000,
    init(viewer) {
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource(LAYER_ID);
      state.dataSource.show = false;
      viewer.dataSources.add(state.dataSource);
      state.removeMoveEnd = viewer.camera.moveEnd.addEventListener(schedule);
      state.clickHandler = new Cesium.ScreenSpaceEventHandler(
        viewer.scene.canvas,
      );
      state.clickHandler.setInputAction(
        onClick,
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );
    },
    enable() {
      state.enabled = true;
      registerPickOwner(LAYER_ID, (id) => state.recordById.has(id));
      if (state.dataSource) state.dataSource.show = true;
      setStatus('loading');
    },
    disable() {
      state.enabled = false;
      clearTimeout(state.timer);
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      unregisterPickOwner(LAYER_ID);
      clearSelectedEntityContextForLayer(LAYER_ID);
      render([]);
      if (state.dataSource) state.dataSource.show = false;
      setStatus('idle');
    },
    // DataLayerManager calls update() right after enable(); it owns the first fetch.
    update() {
      return load();
    },
    destroy(viewer) {
      this.disable();
      state.removeMoveEnd?.();
      state.clickHandler?.destroy();
      if (state.dataSource) viewer?.dataSources.remove(state.dataSource, true);
      state.dataSource = null;
      state.viewer = null;
    },
    getStats() {
      const shown = state.recordById.size;
      let countLabel = '';
      if (state.enabled && state.status === 'zoom-in')
        countLabel = 'Zoom in to see monuments';
      else if (state.enabled && state.lastUpdate)
        countLabel = state.saturated
          ? `${shown} of ${state.total} in view`
          : `${shown} in view`;
      return {
        count: shown,
        shown,
        countLabel,
        status: state.status,
        error: state.error,
        loading: state.loading,
        lastUpdate: state.lastUpdate,
        saturated: state.saturated,
        stale: false,
      };
    },
  };
}
