// Preloaded with `node --import` so Sentry is initialized before the app loads
// any module it instruments (pg, redis, http). Calling initSentry() from
// index.ts is too late: ES modules evaluate every static import first.
import 'dotenv/config';
import { initSentry } from './config/sentry.js';

initSentry();
