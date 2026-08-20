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
  // Khmer wording reviewed by a native speaker. Notes worth keeping:
  //   បណ្តឹង alone reads as a legal lawsuit; ពាក្យបណ្តឹង is the customer-service word.
  //   សំណើ is for formal business proposals; សំណូមពរ is what a customer makes.
  { id: 'complaint',  en: 'Complaint',  km: 'ពាក្យបណ្តឹង' },
  { id: 'suggestion', en: 'Suggestion', km: 'សំណូមពរ' },
  { id: 'compliment', en: 'Compliment', km: 'ការកោតសរសើរ' },
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
    // Reviewed by a native speaker. The originals read as direct translations
    // of the English: "Tell us what you think", and a rating label that landed
    // closer to "How was your coming to play?". These are the phrasings a
    // Cambodian business would actually print.
    heading: 'សូមផ្តល់មតិយោបល់របស់អ្នក',
    subheading: 'អនាមិក — យើងមិនសួររកឈ្មោះរបស់អ្នកឡើយ។',
    categoryLabel: 'តើមតិយោបល់នេះទាក់ទងនឹងអ្វី?',
    ratingLabel: 'តើលោកអ្នកពេញចិត្តនឹងបទពិសោធន៍នៅទីនេះកម្រិតណា?',
    ratingOptional: 'ជាជម្រើស',
    messageLabel: 'មតិយោបល់របស់អ្នក',
    messagePlaceholder:
      'សូមរៀបរាប់បន្ថែមនៅទីនេះ។ ព័ត៌មានលម្អិតរបស់លោកអ្នកនឹងជួយឱ្យយើងបម្រើសេវាកម្មបានកាន់តែប្រសើរ។',
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

/*
 * Poster text. Deliberately short.
 *
 * This is read from a metre away by someone deciding in about a second whether
 * to take their phone out. Every line that is not the question or the shop
 * name competes with the two that are, and the printed URL in particular was
 * dead weight: nobody types a URL off a poster that has a QR code on it.
 */
export const POSTER = {
  headingKm: 'តើលោកអ្នកមានបញ្ហា ឬមតិយោបល់មែនទេ?',
  headingEn: 'Something to tell us?',
  locationLabel: 'ទីតាំង · LOCATION',
  contactLabel: 'ទំនាក់ទំនង · CONTACT',
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
