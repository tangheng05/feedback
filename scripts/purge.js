#!/usr/bin/env node
/** Manual run of the rate-limit / update-id purge. The server also does this hourly. */
import { purgeOld } from '../src/ratelimit.js';

const removed = purgeOld();
console.log(`purged ${removed} rows`);
