import { loadCountries, seedPrograms } from './catalog/loader';
import { LiveCatalog } from './catalog/live';
import { Engine } from './conversation/engine';
import { Store } from './store/db';
import { createUnderstand } from './understand/intent';

/** Wires the pieces together. Shared by the server and the simulator. */
export function createApp(opts: { dbPath?: string; operator: string; env?: NodeJS.ProcessEnv }) {
  const env = opts.env ?? process.env;
  const countries = loadCountries();
  const store = new Store(opts.dbPath ?? env.DB_PATH ?? 'data/app.db');
  const catalog = new LiveCatalog(countries, store);
  // Program files are proposals. New or edited files join the review queue; they do not go live here.
  const proposed = catalog.importSeeds(seedPrograms());
  const engine = new Engine({
    countries,
    catalog,
    store,
    understand: createUnderstand(env),
    operator: opts.operator,
    defaultCountry: env.DEFAULT_COUNTRY,
  });
  return { countries, store, catalog, engine, proposed };
}
