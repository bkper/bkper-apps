/**
 * The languages Bkper supports, as listed by `https://bkper.app/translations/api/languages`:
 * each code with its native name, and its English name for readers and models that need one.
 */
export interface Language {
    /** BCP 47 code, as Bkper uses it. */
    code: string;
    /** The name in the language itself. */
    name: string;
    english: string;
}

export const LANGUAGES: readonly Language[] = [
    { code: 'af', name: 'Afrikaans', english: 'Afrikaans' },
    { code: 'ak', name: 'Akan', english: 'Akan' },
    { code: 'am', name: 'አማርኛ', english: 'Amharic' },
    { code: 'ar', name: 'العربية', english: 'Arabic' },
    { code: 'as', name: 'অসমীয়া', english: 'Assamese' },
    { code: 'ay', name: 'Aymara', english: 'Aymara' },
    { code: 'az', name: 'Azərbaycan', english: 'Azerbaijani' },
    { code: 'be', name: 'Беларуская', english: 'Belarusian' },
    { code: 'bg', name: 'Български', english: 'Bulgarian' },
    { code: 'bho', name: 'भोजपुरी', english: 'Bhojpuri' },
    { code: 'bm', name: 'Bamanakan', english: 'Bambara' },
    { code: 'bn', name: 'বাংলা', english: 'Bengali' },
    { code: 'bs', name: 'Bosanski', english: 'Bosnian' },
    { code: 'ca', name: 'Català', english: 'Catalan' },
    { code: 'ceb', name: 'Cebuano', english: 'Cebuano' },
    { code: 'ckb', name: 'کوردیی ناوەندی', english: 'Central Kurdish' },
    { code: 'co', name: 'Corsican', english: 'Corsican' },
    { code: 'cs', name: 'Čeština', english: 'Czech' },
    { code: 'cy', name: 'Cymraeg', english: 'Welsh' },
    { code: 'da', name: 'Dansk', english: 'Danish' },
    { code: 'de', name: 'Deutsch', english: 'German' },
    { code: 'doi', name: 'डोगरी', english: 'Dogri' },
    { code: 'dv', name: 'Divehi', english: 'Divehi' },
    { code: 'ee', name: 'Eʋegbe', english: 'Ewe' },
    { code: 'el', name: 'Ελληνικά', english: 'Greek' },
    { code: 'en', name: 'English', english: 'English' },
    { code: 'eo', name: 'Esperanto', english: 'Esperanto' },
    { code: 'es', name: 'Español', english: 'Spanish' },
    { code: 'et', name: 'Eesti', english: 'Estonian' },
    { code: 'eu', name: 'Euskara', english: 'Basque' },
    { code: 'fa', name: 'فارسی', english: 'Persian' },
    { code: 'fi', name: 'Suomi', english: 'Finnish' },
    { code: 'fr', name: 'Français', english: 'French' },
    { code: 'fy', name: 'Frysk', english: 'Western Frisian' },
    { code: 'ga', name: 'Gaeilge', english: 'Irish' },
    { code: 'gd', name: 'Gàidhlig', english: 'Scottish Gaelic' },
    { code: 'gl', name: 'Galego', english: 'Galician' },
    { code: 'gn', name: 'Guarani', english: 'Guarani' },
    { code: 'gom', name: 'Konkani', english: 'Konkani' },
    { code: 'gu', name: 'ગુજરાતી', english: 'Gujarati' },
    { code: 'ha', name: 'Hausa', english: 'Hausa' },
    { code: 'haw', name: 'ʻŌlelo Hawaiʻi', english: 'Hawaiian' },
    { code: 'he', name: 'עברית', english: 'Hebrew' },
    { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
    { code: 'hmn', name: 'Hmong', english: 'Hmong' },
    { code: 'hr', name: 'Hrvatski', english: 'Croatian' },
    { code: 'ht', name: 'Haitian Creole', english: 'Haitian Creole' },
    { code: 'hu', name: 'Magyar', english: 'Hungarian' },
    { code: 'hy', name: 'Հայերեն', english: 'Armenian' },
    { code: 'id', name: 'Indonesia', english: 'Indonesian' },
    { code: 'ig', name: 'Igbo', english: 'Igbo' },
    { code: 'ilo', name: 'Iloko', english: 'Iloko' },
    { code: 'is', name: 'Íslenska', english: 'Icelandic' },
    { code: 'it', name: 'Italiano', english: 'Italian' },
    { code: 'ja', name: '日本語', english: 'Japanese' },
    { code: 'jv', name: 'Jawa', english: 'Javanese' },
    { code: 'ka', name: 'Ქართული', english: 'Georgian' },
    { code: 'kk', name: 'Қазақ тілі', english: 'Kazakh' },
    { code: 'km', name: 'ខ្មែរ', english: 'Khmer' },
    { code: 'kn', name: 'ಕನ್ನಡ', english: 'Kannada' },
    { code: 'ko', name: '한국어', english: 'Korean' },
    { code: 'kri', name: 'Krio', english: 'Krio' },
    { code: 'ku', name: 'Kurdî (kurmancî)', english: 'Kurdish' },
    { code: 'ky', name: 'Кыргызча', english: 'Kyrgyz' },
    { code: 'la', name: 'Latin', english: 'Latin' },
    { code: 'lb', name: 'Lëtzebuergesch', english: 'Luxembourgish' },
    { code: 'lg', name: 'Luganda', english: 'Ganda' },
    { code: 'ln', name: 'Lingála', english: 'Lingala' },
    { code: 'lo', name: 'ລາວ', english: 'Lao' },
    { code: 'lt', name: 'Lietuvių', english: 'Lithuanian' },
    { code: 'lus', name: 'Mizo', english: 'Mizo' },
    { code: 'lv', name: 'Latviešu', english: 'Latvian' },
    { code: 'mai', name: 'मैथिली', english: 'Maithili' },
    { code: 'mg', name: 'Malagasy', english: 'Malagasy' },
    { code: 'mi', name: 'Māori', english: 'Māori' },
    { code: 'mk', name: 'Македонски', english: 'Macedonian' },
    { code: 'ml', name: 'മലയാളം', english: 'Malayalam' },
    { code: 'mn', name: 'Монгол', english: 'Mongolian' },
    { code: 'mni-Mtei', name: 'মৈতৈলোন্ (মীতৈ ময়েক)', english: 'Manipuri (Meitei)' },
    { code: 'mr', name: 'मराठी', english: 'Marathi' },
    { code: 'ms', name: 'Melayu', english: 'Malay' },
    { code: 'mt', name: 'Malti', english: 'Maltese' },
    { code: 'my', name: 'မြန်မာ', english: 'Burmese' },
    { code: 'ne', name: 'नेपाली', english: 'Nepali' },
    { code: 'nl', name: 'Nederlands', english: 'Dutch' },
    { code: 'no', name: 'Norsk', english: 'Norwegian' },
    { code: 'nso', name: 'Sesotho sa Leboa', english: 'Northern Sotho' },
    { code: 'ny', name: 'Nyanja', english: 'Nyanja' },
    { code: 'om', name: 'Oromoo', english: 'Oromo' },
    { code: 'or', name: 'ଓଡ଼ିଆ', english: 'Odia' },
    { code: 'pa', name: 'ਪੰਜਾਬੀ', english: 'Punjabi' },
    { code: 'pl', name: 'Polski', english: 'Polish' },
    { code: 'ps', name: 'پښتو', english: 'Pashto' },
    { code: 'pt', name: 'Português', english: 'Portuguese' },
    { code: 'qu', name: 'Runasimi', english: 'Quechua' },
    { code: 'ro', name: 'Română', english: 'Romanian' },
    { code: 'ru', name: 'Русский', english: 'Russian' },
    { code: 'rw', name: 'Ikinyarwanda', english: 'Kinyarwanda' },
    { code: 'sa', name: 'संस्कृत भाषा', english: 'Sanskrit' },
    { code: 'sd', name: 'سنڌي', english: 'Sindhi' },
    { code: 'si', name: 'සිංහල', english: 'Sinhala' },
    { code: 'sk', name: 'Slovenčina', english: 'Slovak' },
    { code: 'sl', name: 'Slovenščina', english: 'Slovenian' },
    { code: 'sm', name: 'Samoan', english: 'Samoan' },
    { code: 'sn', name: 'ChiShona', english: 'Shona' },
    { code: 'so', name: 'Soomaali', english: 'Somali' },
    { code: 'sq', name: 'Shqip', english: 'Albanian' },
    { code: 'sr', name: 'Српски', english: 'Serbian' },
    { code: 'st', name: 'Sesotho', english: 'Southern Sotho' },
    { code: 'su', name: 'Basa Sunda', english: 'Sundanese' },
    { code: 'sv', name: 'Svenska', english: 'Swedish' },
    { code: 'sw', name: 'Kiswahili', english: 'Swahili' },
    { code: 'ta', name: 'தமிழ்', english: 'Tamil' },
    { code: 'te', name: 'తెలుగు', english: 'Telugu' },
    { code: 'tg', name: 'Тоҷикӣ', english: 'Tajik' },
    { code: 'th', name: 'ไทย', english: 'Thai' },
    { code: 'ti', name: 'ትግርኛ', english: 'Tigrinya' },
    { code: 'tk', name: 'Türkmen dili', english: 'Turkmen' },
    { code: 'tl', name: 'Tagalog', english: 'Filipino (Tagalog)' },
    { code: 'tr', name: 'Türkçe', english: 'Turkish' },
    { code: 'ts', name: 'Tsonga', english: 'Tsonga' },
    { code: 'tt', name: 'Татар', english: 'Tatar' },
    { code: 'ug', name: 'ئۇيغۇرچە', english: 'Uyghur' },
    { code: 'uk', name: 'Українська', english: 'Ukrainian' },
    { code: 'ur', name: 'اردو', english: 'Urdu' },
    { code: 'uz', name: 'O‘zbek', english: 'Uzbek' },
    { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
    { code: 'xh', name: 'IsiXhosa', english: 'Xhosa' },
    { code: 'yi', name: 'ייִדיש', english: 'Yiddish' },
    { code: 'yo', name: 'Èdè Yorùbá', english: 'Yoruba' },
    { code: 'zh-CN', name: '简体中文', english: 'Chinese (Simplified)' },
    { code: 'zh-TW', name: '繁體中文', english: 'Chinese (Traditional)' },
    { code: 'zu', name: 'IsiZulu', english: 'Zulu' },
];

const CODES = new Map(LANGUAGES.map(language => [language.code.toLowerCase(), language.code]));

/** Other codes of a Bkper language. */
const ALIASES: Record<string, string> = { fil: 'tl', nb: 'no', nn: 'no' };

const TRADITIONAL_CHINESE_REGIONS = ['TW', 'HK', 'MO'];

/**
 * The Bkper language a BCP 47 tag is written in, such as `pt` for `pt-BR`, or `undefined`
 * when the tag is malformed or its language is not one of {@link LANGUAGES}.
 */
export function supportedLanguage(tag: string): string | undefined {
    let locale: Intl.Locale;
    try {
        locale = new Intl.Locale(tag);
    } catch {
        return undefined;
    }
    const exact = CODES.get(tag.toLowerCase()) ?? CODES.get(locale.baseName.toLowerCase());
    if (exact) {
        return exact;
    }
    const language = ALIASES[locale.language] ?? locale.language;
    if (language === 'zh') {
        const traditional =
            locale.script === 'Hant' ||
            (locale.script === undefined &&
                TRADITIONAL_CHINESE_REGIONS.includes(locale.region ?? ''));
        return traditional ? 'zh-TW' : 'zh-CN';
    }
    const byBase = LANGUAGES.filter(entry => entry.code.split('-')[0] === language);
    return byBase.length === 1 ? byBase[0].code : undefined;
}
