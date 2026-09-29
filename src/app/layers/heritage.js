import * as credits from '../../data/dataCredits.js';
import * as render from '../../renderGovernor.js';
import * as context from '../../data/contextStore.js';
import * as picking from '../../data/pickRegistry.js';
import { createHeritageLayer } from '../../layers/heritage/index.js';

/** Construct the Monuments (SMR) layer with the application scene owners. */
export function createApplicationHeritage({ surface, source }) {
  return createHeritageLayer({
    source,
    services: {
      credits,
      render,
      context,
      picking,
      groundFloor: surface?.groundFloor,
    },
  });
}
