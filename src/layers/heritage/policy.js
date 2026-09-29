export const LAYER_ID = 'heritage-smr';
export const LAYER_NAME = 'Monuments (SMR)';
export const API_BASE = '/api/heritage/smr';
export const REQUEST_DEBOUNCE_MS = 300;
export const QUERY_LIMIT = 1000;
/** Views wider than this show zoom-in guidance instead of a partial sample. */
export const MAX_VIEW_SPAN_DEG = 1.5;
/** Class labels appear only when the camera is this close, in metres. */
export const LABEL_MAX_DISTANCE_M = 6000;
export const SNAPSHOT_MISSING_MESSAGE =
  'SMR snapshot missing: run npm run smr:snapshot';
