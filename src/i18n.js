/**
 * English + Khmer strings for every customer-facing surface.
 *
 * ⚠ The Khmer here is a first draft written by the developer, not a native
 * speaker. Have a Khmer-speaking colleague read it before anything is printed
 * and hung in a shop — especially CATEGORIES and POSTER, which end up on paper
 * where a mistake is expensive to fix.
 */

export const LANGS = ['km', 'en'];
export const DEFAULT_LANG = 'km';

export const CATEGORIES = [
  { id: 'complaint',  en: 'Complaint',  km: 'បណ្តឹង' },
  { id: 'suggestion', en: 'Suggestion', km: 'សំណើ' },
  { id: 'compliment', en: 'Compliment', km: 'ការសរសើរ' },
  { id: 'product',    en: 'Product',    km: 'ផលិតផល' },
  { id: 'staff',      en: 'Staff',      km: 'បុគ្គលិក' },
  { id: 'other',      en: 'Other',      km: 'ផ្សេងៗ' },
];

export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);

export const STRINGS = {
  en: {
    htmlLang: 'en',
    title: 'Send feedback',
    heading: 'Tell us what you think',
    subheading: 'Anonymous — we never ask for your name.',
    categoryLabel: 'What is this about?',
    ratingLabel: 'How was your visit?',
    ratingOptional: 'optional',
    messageLabel: 'Your message',
    messagePlaceholder: 'Tell us what happened. The more detail, the better we can fix it.',
    send: 'Send',
    sending: 'Sending…',
    thanksHeading: 'Thank you',
    thanksBody: 'Your feedback has gone straight to the management team.',
    refLabel: 'Reference',
    refHelp: 'Note this down if you want to follow up in store.',
    closeTab: 'You can close this page.',
    errCategory: 'Please choose what this is about.',
    errShort: 'Please write at least 10 characters.',
    errLong: 'That message is too long.',
    errRate: 'You have sent several messages already. Please try again later.',
    errGeneric: 'Something went wrong. Please try again in a moment.',
    closedHeading: 'Not available',
    closedBody: 'This location is not accepting feedback at the moment.',
    notFoundHeading: 'Code not recognised',
    notFoundBody: 'This QR code is not active. Please ask a staff member for help.',
    charsLeft: 'characters left',
    langLabel: 'Language',
    starN: '{n} stars',
    starsSet: 'Rated {n} out of 5',
    starsCleared: 'Rating cleared',
    verifying: 'Checking… one moment.',
    needJs: 'JavaScript is required to send feedback.',
    errNetwork: 'Could not reach us. Check your connection and tap Send again.',
  },
  km: {
    htmlLang: 'km',
    title: 'ផ្ញើមតិយោបល់',
    heading: 'ប្រាប់យើងពីអ្វីដែលអ្នកគិត',
    subheading: 'អនាមិក — យើងមិនសួររកឈ្មោះរបស់អ្នកឡើយ។',
    categoryLabel: 'តើនេះទាក់ទងនឹងអ្វី?',
    ratingLabel: 'តើការមកលេងរបស់អ្នកយ៉ាងណា?',
    ratingOptional: 'ជាជម្រើស',
    messageLabel: 'សាររបស់អ្នក',
    messagePlaceholder: 'សូមប្រាប់យើងពីអ្វីដែលបានកើតឡើង។ កាន់តែលម្អិត យើងកាន់តែអាចដោះស្រាយបាន។',
    send: 'ផ្ញើ',
    sending: 'កំពុងផ្ញើ…',
    thanksHeading: 'សូមអរគុណ',
    thanksBody: 'មតិយោបល់របស់អ្នកត្រូវបានផ្ញើទៅក្រុមគ្រប់គ្រងរួចរាល់។',
    refLabel: 'លេខយោង',
    refHelp: 'សូមកត់ទុក ប្រសិនបើអ្នកចង់តាមដានបន្ថែមនៅក្នុងហាង។',
    closeTab: 'អ្នកអាចបិទទំព័រនេះបាន។',
    errCategory: 'សូមជ្រើសរើសប្រភេទ។',
    errShort: 'សូមសរសេរយ៉ាងតិច ១០ តួអក្សរ។',
    errLong: 'សារវែងពេក។',
    errRate: 'អ្នកបានផ្ញើសារច្រើនហើយ។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។',
    errGeneric: 'មានបញ្ហាកើតឡើង។ សូមព្យាយាមម្តងទៀត។',
    closedHeading: 'មិនអាចប្រើបាន',
    closedBody: 'ទីតាំងនេះមិនទទួលមតិយោបល់ទេនៅពេលនេះ។',
    notFoundHeading: 'មិនស្គាល់លេខកូដ',
    notFoundBody: 'កូដ QR នេះមិនដំណើរការទេ។ សូមសួរបុគ្គលិកសម្រាប់ជំនួយ។',
    charsLeft: 'តួអក្សរនៅសល់',
    langLabel: 'ភាសា',
    starN: '{n} ផ្កាយ',
    starsSet: 'បានវាយតម្លៃ {n} លើ ៥',
    starsCleared: 'បានលុបការវាយតម្លៃ',
    verifying: 'កំពុងពិនិត្យ… សូមរង់ចាំ។',
    needJs: 'ត្រូវការ JavaScript ដើម្បីផ្ញើមតិយោបល់។',
    errNetwork: 'មិនអាចភ្ជាប់បានទេ។ សូមពិនិត្យអ៊ីនធឺណិត ហើយចុចផ្ញើម្តងទៀត។',
  },
};

export const POSTER = {
  headingKm: 'មានបញ្ហា ឬ មតិយោបល់?',
  headingEn: 'Something to tell us?',
  subKm: 'ស្កេនដើម្បីផ្ញើមតិយោបល់ដោយអនាមិក',
  subEn: 'Scan to send anonymous feedback',
  footKm: 'គ្មានឈ្មោះ · គ្មានលេខទូរស័ព្ទ · ផ្ទាល់ទៅអ្នកគ្រប់គ្រង',
  footEn: 'No name · No phone number · Straight to management',

  // Small caps labels on the poster. Khmer first, English under it, matching
  // how the rest of the sheet reads.
  locationLabel: 'LOCATION · ទីតាំង',
  linkLabel: 'LINK · តំណ',
  contactLabel: 'CONTACT · ទំនាក់ទំនង',
};

export const pickLang = (raw) => (LANGS.includes(raw) ? raw : DEFAULT_LANG);

/**
 * Choose a starting language from the browser's Accept-Language header.
 *
 * Scans the whole list, not just the first entry: plenty of cheap Android
 * handsets in Cambodia ship with English as the system default while their
 * owner reads Khmer, and those send `en-US,en;q=0.9,km;q=0.8`. If Khmer
 * appears anywhere in the list, prefer it.
 */
export function langFromHeader(header = '') {
  const tags = String(header)
    .toLowerCase()
    .split(',')
    .map((part) => part.split(';')[0].trim())
    .filter(Boolean);

  if (tags.some((tag) => tag.startsWith('km'))) return 'km';
  if (tags.some((tag) => tag.startsWith('en'))) return 'en';
  return DEFAULT_LANG;
}

export const categoryLabel = (id, lang) => {
  const c = CATEGORIES.find((x) => x.id === id);
  if (!c) return id;
  return lang === 'km' ? c.km : c.en;
};
