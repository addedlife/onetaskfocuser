/**
 * Yeshivish phonetic-correction map (Pro 4 `YC`) + `cleanYeshivish` (Pro 4 `cleanYT`). Generic speech
 * recognizers mangle yeshivish/loshon-kodesh terms; this maps common mis-hearings to the right spelling.
 * Ported verbatim — domain-critical for transcription fidelity. Longest keys are applied first so
 * multi-word phrases win over their substrings.
 */
export const YC: Record<string, string> = {
  shyla: 'shaila', shayla: 'shaila', 'shy la': 'shaila', 'shy los': 'shailos', shaylas: 'shailos',
  'holla ka': 'halacha', 'hello ka': 'halacha', gomorrah: 'gemara', 'go mara': 'gemara',
  'toe raw': 'Torah', 'tore uh': 'Torah', 'shall con': 'Shulchan', 'school con': 'Shulchan',
  'rob a': 'Rava', 'a buy': 'Abaye', rash: 'Rashi', 'raw she': 'Rashi',
  'toss a fist': 'Tosafos', 'rome bomb': 'Rambam', 'rome ban': 'Ramban',
  'chew va': 'teshuvah', 'pee sock': 'pesak', 'moot sir': 'mutar', 'moo tar': 'mutar',
  'ah sir': 'assur', 'a sir': 'assur', 'shah bus': 'Shabbos', shabbat: 'Shabbos',
  'shot boss': 'Shabbos', 'cash root': 'kashrus', 'sue car': 'sukkah', 'make va': 'mikvah',
  'ned ah': 'niddah', 'to fill in': 'tefillin', 'ma zoozah': 'mezuzah',
  'shoe or': 'shiur', 'she or': 'shiur', 'call ale': 'kollel', 'bait din': 'beis din',
  'bra ha': 'bracha', 'brock ah': 'bracha', 'safe ache': 'safeik', 'tar use': 'treif',
  'tray of': 'treif', 'flay shick': 'fleishig', 'milk a': 'milchig', 'par of': 'pareve',
  'she do': 'shidduch', 'see mon': 'simcha',
  'dav in': 'daven', 'dove in': 'daven', dobbin: 'daven', dovening: 'davening', 'dove an ing': 'davening',
  minka: 'mincha', 'mint ha': 'mincha', 'mean ha': 'mincha',
  'my rev': 'maariv', 'mar iv': 'maariv', 'my reef': 'maariv',
  'shock wrist': 'shacharis', 'shock harris': 'shacharis', 'shack wrist': 'shacharis',
  'ha sham': 'Hashem', 'hosh em': 'Hashem', 'hash em': 'Hashem',
  'bar rock ha sham': 'Baruch Hashem', 'borrow hashem': 'Baruch Hashem',
  'brok hashem': 'Baruch Hashem', 'bark hashem': 'Baruch Hashem', 'barack hashem': 'Baruch Hashem',
  'kid dish': 'kiddush', 'key douche': 'kiddush',
  'yum tuff': 'Yom Tov', 'yum tove': 'Yom Tov', 'yom tove': 'Yom Tov',
  'yum kipper': 'Yom Kippur', 'young kipper': 'Yom Kippur',
  'pay sock': 'Pesach', 'pays hot': 'Pesach', 'pay suck': 'Pesach',
  'sue coasts': 'Sukkos', 'suck us': 'Sukkos',
  'shavoo us': 'Shavuos', 'shove oh is': 'Shavuos',
  'motsy shabbos': 'Motzei Shabbos', 'nazi shabbos': 'Motzei Shabbos', 'moth see shabbos': 'Motzei Shabbos',
  'half roaster': 'chavrusa', 'have rooster': 'chavrusa', 'have roosa': 'chavrusa', 'hover oosa': 'chavrusa',
  'base mad rash': 'beis medrash', 'bites med rash': 'beis medrash', 'base mid rash': 'beis medrash', 'bass medrash': 'beis medrash',
  'who mash': 'chumash', 'hoo mash': 'chumash', 'shoe mash': 'chumash',
  'mish no': 'mishnah', 'miss no': 'mishnah', 'mission a': 'mishnah',
  sheer: 'shiur', 'she ear': 'shiur', sure: 'shiur',
  'mack lockets': 'machlokes', 'mock locusts': 'machlokes', 'my cloaks': 'machlokes',
  'safar ah': 'svara', 'so far ah': 'svara', savara: 'svara',
  'push out': 'pshat', 'p shot': 'pshat', 'pee shot': 'pshat', 'pea shot': 'pshat',
  'rosh uh shiva': 'rosh yeshiva', 'rush yeshiva': 'rosh yeshiva', 'rush you shiva': 'rosh yeshiva',
  'block her': 'bochur', bocker: 'bochur', boxer: 'bochur', botcher: 'bochur',
  'you she va': 'yeshiva', 'ya shiva': 'yeshiva',
  'call ill': 'kollel', 'coal l': 'kollel',
  'cash rust': 'kashrus', 'cash rules': 'kashrus',
  'ha lock ah': 'halacha', 'hollow ha': 'halacha',
  'tack less': 'tachlis', 'talk less': 'tachlis', 'tock list': 'tachlis',
  'sod it': 'tzaddik', 'sod ick': 'tzaddik', 'zah dick': 'tzaddik',
  'give all dig': 'gevaldig', 'give all dick': 'gevaldig',
  'said duck uh': 'tzedakah', 'suh dock uh': 'tzedakah', 'zuh doc ah': 'tzedakah',
  'ha soona': 'chasuna', 'hoss in a': 'chasuna', hossana: 'chasuna',
  'hoss in': 'chassan', 'ha son': 'chassan',
  'call uh': 'kallah', collar: 'kallah',
  mosseltov: 'mazel tov', 'muzzle tough': 'mazel tov',
};

/** Apply the corrections (longest keys first, word-insensitive) — Pro 4 `cleanYT`. */
export function cleanYeshivish(raw: string): string {
  let t = raw;
  for (const [from, to] of Object.entries(YC).sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), to);
  }
  return t;
}
