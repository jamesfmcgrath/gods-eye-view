#!/usr/bin/env node
// Download the National Monuments Service Sites and Monuments Record into
// .gev-cache/smr/snapshot.json. This is the only code that contacts the
// shared, quota-limited SMR service; the app reads the local file.
import {
  downloadSmrSnapshot,
  writeSmrSnapshot,
  SMR_SNAPSHOT_PATH,
} from '../server/providers/heritage/snapshot.js';
import { HERITAGE_TYPES } from '../src/data/heritageClasses.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const snapshot = await downloadSmrSnapshot({
  fetchImpl: (...args) => fetch(...args),
  sleep,
  log: (message) => console.log(message),
});
await writeSmrSnapshot(snapshot, SMR_SNAPSHOT_PATH);
console.log(
  `Wrote ${snapshot.rows.length} records (${snapshot.classes.length} classes) to ${SMR_SNAPSHOT_PATH}`,
);
const unmatched = Object.entries(HERITAGE_TYPES)
  .filter(([, type]) => !snapshot.classes.some((c) => type.match(c)))
  .map(([key]) => key);
if (unmatched.length)
  console.warn(`Voice types with no matching class: ${unmatched.join(', ')}`);
