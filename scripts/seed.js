#!/usr/bin/env node
/**
 * Creates a location WITHOUT touching Telegram, so the customer form can be
 * built and tested before the bot exists.
 *
 * Usage: node scripts/seed.js "Test Shop" test 0
 *        (name, slug, topic_id — topic 0 posts to the group's General thread)
 */
import { insertLocation, getLocation } from '../src/db.js';
import { slugify } from '../src/commands.js';
import { formUrl } from '../src/qr.js';

const [name = 'Test Shop', rawSlug = 'test', topicId = '0'] = process.argv.slice(2);

// Same normalisation as /add, so a seeded slug can never be something the
// router or the inline <script> block would choke on.
const slug = slugify(rawSlug);

if (getLocation(slug)) {
  console.log(`Location "${slug}" already exists — nothing to do.`);
  console.log(formUrl(slug));
  process.exit(0);
}

const location = insertLocation({ name, slug, topicId: Number(topicId) });
console.log(`Seeded "${location.name}"`);
console.log(formUrl(location.slug));
