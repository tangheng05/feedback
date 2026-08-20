#!/usr/bin/env node
/**
 * Creates a location WITHOUT touching Telegram, so the customer form can be
 * built and tested before the bot exists.
 *
 * Usage: node scripts/seed.js "Test Shop" test 0
 *        (name, slug, topic_id — topic 0 posts to the group's General thread)
 */
import { reserveLocation, setLocationTopic, getLocation } from '../src/db.js';
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

// reserveLocation claims the slug with a placeholder topic and setLocationTopic
// fills it in — the same two steps /add uses, so a seeded row is
// indistinguishable from one the bot created.
const location = reserveLocation({ slug, name });
if (!location) {
  console.error(`Could not reserve "${slug}".`);
  process.exit(1);
}
setLocationTopic(slug, Number(topicId) || 0);

console.log(`Seeded "${location.name}" as /f/${slug}`);
console.log(formUrl(slug));
