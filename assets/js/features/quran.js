/* ============================================================
   QUR'AN SECTION
   ============================================================ */
(function(){

/* ============================================================
   DATA :: static reference data (surah list, juz boundaries)
   These are structural facts about the Qur'an's standard mushaf
   layout — safe to hardcode, independent of any text source.
   ============================================================ */
const SURAHS = [
[1,"Al-Fatihah","الفاتحة","The Opening",7,"Meccan"],
[2,"Al-Baqarah","البقرة","The Cow",286,"Medinan"],
[3,"Aal-e-Imran","آل عمران","The Family of Imran",200,"Medinan"],
[4,"An-Nisa","النساء","The Women",176,"Medinan"],
[5,"Al-Ma'idah","المائدة","The Table Spread",120,"Medinan"],
[6,"Al-An'am","الأنعام","The Cattle",165,"Meccan"],
[7,"Al-A'raf","الأعراف","The Heights",206,"Meccan"],
[8,"Al-Anfal","الأنفال","The Spoils of War",75,"Medinan"],
[9,"At-Tawbah","التوبة","The Repentance",129,"Medinan"],
[10,"Yunus","يونس","Jonah",109,"Meccan"],
[11,"Hud","هود","Hud",123,"Meccan"],
[12,"Yusuf","يوسف","Joseph",111,"Meccan"],
[13,"Ar-Ra'd","الرعد","The Thunder",43,"Medinan"],
[14,"Ibrahim","إبراهيم","Abraham",52,"Meccan"],
[15,"Al-Hijr","الحجر","The Rocky Tract",99,"Meccan"],
[16,"An-Nahl","النحل","The Bee",128,"Meccan"],
[17,"Al-Isra","الإسراء","The Night Journey",111,"Meccan"],
[18,"Al-Kahf","الكهف","The Cave",110,"Meccan"],
[19,"Maryam","مريم","Mary",98,"Meccan"],
[20,"Ta-Ha","طه","Ta-Ha",135,"Meccan"],
[21,"Al-Anbiya","الأنبياء","The Prophets",112,"Meccan"],
[22,"Al-Hajj","الحج","The Pilgrimage",78,"Medinan"],
[23,"Al-Mu'minun","المؤمنون","The Believers",118,"Meccan"],
[24,"An-Nur","النور","The Light",64,"Medinan"],
[25,"Al-Furqan","الفرقان","The Criterion",77,"Meccan"],
[26,"Ash-Shu'ara","الشعراء","The Poets",227,"Meccan"],
[27,"An-Naml","النمل","The Ant",93,"Meccan"],
[28,"Al-Qasas","القصص","The Narrations",88,"Meccan"],
[29,"Al-Ankabut","العنكبوت","The Spider",69,"Meccan"],
[30,"Ar-Rum","الروم","The Romans",60,"Meccan"],
[31,"Luqman","لقمان","Luqman",34,"Meccan"],
[32,"As-Sajdah","السجدة","The Prostration",30,"Meccan"],
[33,"Al-Ahzab","الأحزاب","The Combined Forces",73,"Medinan"],
[34,"Saba","سبأ","Sheba",54,"Meccan"],
[35,"Fatir","فاطر","Originator",45,"Meccan"],
[36,"Ya-Sin","يس","Ya-Sin",83,"Meccan"],
[37,"As-Saffat","الصافات","Those who set the Ranks",182,"Meccan"],
[38,"Sad","ص","The Letter Sad",88,"Meccan"],
[39,"Az-Zumar","الزمر","The Troops",75,"Meccan"],
[40,"Ghafir","غافر","The Forgiver",85,"Meccan"],
[41,"Fussilat","فصلت","Explained in Detail",54,"Meccan"],
[42,"Ash-Shura","الشورى","The Consultation",53,"Meccan"],
[43,"Az-Zukhruf","الزخرف","The Ornaments of Gold",89,"Meccan"],
[44,"Ad-Dukhan","الدخان","The Smoke",59,"Meccan"],
[45,"Al-Jathiyah","الجاثية","The Crouching",37,"Meccan"],
[46,"Al-Ahqaf","الأحقاف","The Wind-Curved Sandhills",35,"Meccan"],
[47,"Muhammad","محمد","Muhammad",38,"Medinan"],
[48,"Al-Fath","الفتح","The Victory",29,"Medinan"],
[49,"Al-Hujurat","الحجرات","The Rooms",18,"Medinan"],
[50,"Qaf","ق","The Letter Qaf",45,"Meccan"],
[51,"Adh-Dhariyat","الذاريات","The Winnowing Winds",60,"Meccan"],
[52,"At-Tur","الطور","The Mount",49,"Meccan"],
[53,"An-Najm","النجم","The Star",62,"Meccan"],
[54,"Al-Qamar","القمر","The Moon",55,"Meccan"],
[55,"Ar-Rahman","الرحمن","The Most Merciful",78,"Medinan"],
[56,"Al-Waqi'ah","الواقعة","The Inevitable",96,"Meccan"],
[57,"Al-Hadid","الحديد","The Iron",29,"Medinan"],
[58,"Al-Mujadilah","المجادلة","The Pleading Woman",22,"Medinan"],
[59,"Al-Hashr","الحشر","The Exile",24,"Medinan"],
[60,"Al-Mumtahanah","الممتحنة","She that is Examined",13,"Medinan"],
[61,"As-Saff","الصف","The Ranks",14,"Medinan"],
[62,"Al-Jumu'ah","الجمعة","Friday",11,"Medinan"],
[63,"Al-Munafiqun","المنافقون","The Hypocrites",11,"Medinan"],
[64,"At-Taghabun","التغابن","Mutual Disillusion",18,"Medinan"],
[65,"At-Talaq","الطلاق","Divorce",12,"Medinan"],
[66,"At-Tahrim","التحريم","The Prohibition",12,"Medinan"],
[67,"Al-Mulk","الملك","The Sovereignty",30,"Meccan"],
[68,"Al-Qalam","القلم","The Pen",52,"Meccan"],
[69,"Al-Haqqah","الحاقة","The Reality",52,"Meccan"],
[70,"Al-Ma'arij","المعارج","The Ascending Stairways",44,"Meccan"],
[71,"Nuh","نوح","Noah",28,"Meccan"],
[72,"Al-Jinn","الجن","The Jinn",28,"Meccan"],
[73,"Al-Muzzammil","المزمل","The Enshrouded One",20,"Meccan"],
[74,"Al-Muddaththir","المدثر","The Cloaked One",56,"Meccan"],
[75,"Al-Qiyamah","القيامة","The Resurrection",40,"Meccan"],
[76,"Al-Insan","الإنسان","Man",31,"Medinan"],
[77,"Al-Mursalat","المرسلات","Those Sent Forth",50,"Meccan"],
[78,"An-Naba","النبأ","The Tidings",40,"Meccan"],
[79,"An-Nazi'at","النازعات","Those who drag forth",46,"Meccan"],
[80,"Abasa","عبس","He Frowned",42,"Meccan"],
[81,"At-Takwir","التكوير","The Overthrowing",29,"Meccan"],
[82,"Al-Infitar","الإنفطار","The Cleaving",19,"Meccan"],
[83,"Al-Mutaffifin","المطففين","The Defrauding",36,"Meccan"],
[84,"Al-Inshiqaq","الإنشقاق","The Sundering",25,"Meccan"],
[85,"Al-Buruj","البروج","The Mansions of the Stars",22,"Meccan"],
[86,"At-Tariq","الطارق","The Nightcomer",17,"Meccan"],
[87,"Al-A'la","الأعلى","The Most High",19,"Meccan"],
[88,"Al-Ghashiyah","الغاشية","The Overwhelming",26,"Meccan"],
[89,"Al-Fajr","الفجر","The Dawn",30,"Meccan"],
[90,"Al-Balad","البلد","The City",20,"Meccan"],
[91,"Ash-Shams","الشمس","The Sun",15,"Meccan"],
[92,"Al-Layl","الليل","The Night",21,"Meccan"],
[93,"Ad-Duha","الضحى","The Morning Hours",11,"Meccan"],
[94,"Ash-Sharh","الشرح","The Relief",8,"Meccan"],
[95,"At-Tin","التين","The Fig",8,"Meccan"],
[96,"Al-Alaq","العلق","The Clot",19,"Meccan"],
[97,"Al-Qadr","القدر","The Power",5,"Meccan"],
[98,"Al-Bayyinah","البينة","The Clear Proof",8,"Medinan"],
[99,"Az-Zalzalah","الزلزلة","The Earthquake",8,"Medinan"],
[100,"Al-Adiyat","العاديات","The Courser",11,"Meccan"],
[101,"Al-Qari'ah","القارعة","The Calamity",11,"Meccan"],
[102,"At-Takathur","التكاثر","Rivalry in World Increase",8,"Meccan"],
[103,"Al-Asr","العصر","The Declining Day",3,"Meccan"],
[104,"Al-Humazah","الهمزة","The Traducer",9,"Meccan"],
[105,"Al-Fil","الفيل","The Elephant",5,"Meccan"],
[106,"Quraysh","قريش","Quraysh",4,"Meccan"],
[107,"Al-Ma'un","الماعون","Small Kindnesses",7,"Meccan"],
[108,"Al-Kawthar","الكوثر","Abundance",3,"Meccan"],
[109,"Al-Kafirun","الكافرون","The Disbelievers",6,"Meccan"],
[110,"An-Nasr","النصر","Divine Support",3,"Medinan"],
[111,"Al-Masad","المسد","The Palm Fibre",5,"Meccan"],
[112,"Al-Ikhlas","الإخلاص","Sincerity",4,"Meccan"],
[113,"Al-Falaq","الفلق","The Daybreak",5,"Meccan"],
[114,"An-Nas","الناس","Mankind",6,"Meccan"]
].map(function(r){return {num:r[0],en:r[1],ar:r[2],meaning:r[3],ayahs:r[4],type:r[5]};});

// Standard 30-Juz starting boundaries [juz, surah, ayah]
const JUZ_BOUNDS = [
[1,1,1],[2,2,142],[3,2,253],[4,3,93],[5,4,24],[6,4,148],[7,5,82],[8,6,111],
[9,7,88],[10,8,41],[11,9,93],[12,11,6],[13,12,53],[14,15,1],[15,17,1],[16,18,75],
[17,21,1],[18,23,1],[19,25,21],[20,27,56],[21,29,46],[22,33,31],[23,36,28],[24,39,32],
[25,41,47],[26,46,1],[27,51,31],[28,58,1],[29,67,1],[30,78,1]
];

// Seed text — original plain-English renderings (not quoted from any
// published translation) used only to demonstrate the reading layout.
// ==> CONNECT: replace with licensed Qur'an text + translation API
const SEED = {
  "1:1":{ar:"بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ",tr:"In the name of Allah, the Most Gracious, the Most Merciful.",tl:"Bismillāhi r-raḥmāni r-raḥīm"},
  "1:2":{ar:"الْحَمْدُ لِلَّهِ رَبِّ الْعَالَمِينَ",tr:"All praise belongs to Allah, Lord of all the worlds.",tl:"Al-ḥamdu lillāhi rabbi l-ʿālamīn"},
  "1:3":{ar:"الرَّحْمَٰنِ الرَّحِيمِ",tr:"The Most Gracious, the Most Merciful.",tl:"Ar-raḥmāni r-raḥīm"},
  "1:4":{ar:"مَالِكِ يَوْمِ الدِّينِ",tr:"Master of the Day of Judgment.",tl:"Māliki yawmi d-dīn"},
  "1:5":{ar:"إِيَّاكَ نَعْبُدُ وَإِيَّاكَ نَسْتَعِينُ",tr:"You alone we worship, and You alone we ask for help.",tl:"Iyyāka naʿbudu wa iyyāka nastaʿīn"},
  "1:6":{ar:"اهْدِنَا الصِّرَاطَ الْمُسْتَقِيمَ",tr:"Guide us along the straight path —",tl:"Ihdinā ṣ-ṣirāṭa l-mustaqīm"},
  "1:7":{ar:"صِرَاطَ الَّذِينَ أَنْعَمْتَ عَلَيْهِمْ غَيْرِ الْمَغْضُوبِ عَلَيْهِمْ وَلَا الضَّالِّينَ",tr:"the path of those You have blessed, not of those who have earned Your anger, nor of those who have gone astray.",tl:"Ṣirāṭa lladhīna anʿamta ʿalayhim ghayri l-maghḍūbi ʿalayhim wa lā ḍ-ḍāllīn"},
  "2:1":{ar:"الم",tr:"Alif. Lam. Meem.",tl:"Alif-Lām-Mīm"},
  "2:2":{ar:"ذَٰلِكَ الْكِتَابُ لَا رَيْبَ ۛ فِيهِ ۛ هُدًى لِّلْمُتَّقِينَ",tr:"This is the Book — there is no doubt in it — a guide for those mindful of Allah,",tl:"Dhālika l-kitābu lā rayba fīh, hudan lil-muttaqīn"},
  "2:3":{ar:"الَّذِينَ يُؤْمِنُونَ بِالْغَيْبِ وَيُقِيمُونَ الصَّلَاةَ وَمِمَّا رَزَقْنَاهُمْ يُنفِقُونَ",tr:"who believe in the unseen, establish prayer, and give from what We have provided for them,",tl:"Alladhīna yuʾminūna bi-l-ghaybi wa yuqīmūna ṣ-ṣalāta wa mimmā razaqnāhum yunfiqūn"},
  "2:255":{ar:"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ",
    tr:"Allah — there is no god but Him, the Ever-Living, the Sustainer of all existence. Neither drowsiness nor sleep overtakes Him. To Him belongs everything in the heavens and everything on the earth. Who could intercede with Him without His permission? He knows what lies before His creation and what lies behind them, and they grasp none of His knowledge except what He wills. His throne extends over the heavens and the earth, and preserving them tires Him not. He is the Most High, the Most Great.",
    tl:"Allāhu lā ilāha illā huwa l-ḥayyu l-qayyūm, lā taʾkhudhuhū sinatun wa lā nawm, lahū mā fī s-samāwāti wa mā fī l-arḍ, man dhā lladhī yashfaʿu ʿindahū illā bi-idhnih, yaʿlamu mā bayna aydīhim wa mā khalfahum, wa lā yuḥīṭūna bi-shayʾin min ʿilmihī illā bi-mā shāʾ, wasiʿa kursiyyuhu s-samāwāti wa l-arḍ, wa lā yaʾūduhū ḥifẓuhumā, wa huwa l-ʿaliyyu l-ʿaẓīm."}
};

/* ============================================================
   LIVE QUR'AN SOURCE
   Primary: api.alquran.cloud (free, no key, CORS-open) — Arabic
   (quran-uthmani) + Saheeh International translation + Latin
   transliteration, one request per edition.
   Fallback: fawazahmed0/quran-api, served as static JSON off the
   jsDelivr CDN (free, no key, CORS-open, and — being a CDN-cached
   static file rather than a live API server — far less likely to
   have an off moment). Used automatically if the primary fails,
   so a single provider hiccup doesn't take the whole reader down.
   Whichever source succeeds gets cached in localStorage so re-
   opening a surah — or using the app offline afterwards — is instant.
   ============================================================ */
const QURAN_API_BASE = 'https://api.alquran.cloud/v1';
const QURAN_CDN_BASE = 'https://cdn.jsdelivr.net/gh/fawazahmed0/quran-api@1/editions';
const QURAN_CACHE_VERSION = 'v3';
const surahCache = {};        // in-memory: surahNum -> {ayahs:{n:{ar,tr,tl}}, source}
const surahLoadPromises = {}; // in-flight fetches, keyed by surahNum

function quranStorageKey(num){ return 'wwp:quran:'+QURAN_CACHE_VERSION+':surah:'+num; }

function seedFallbackForSurah(num){
  const ayahs = {};
  Object.keys(SEED).forEach(k=>{
    const [s,a] = k.split(':').map(Number);
    if(s===num) ayahs[a] = SEED[k];
  });
  return {ayahs, source:'seed'};
}

async function fetchEdition(num, edition){
  const res = await fetch(`${QURAN_API_BASE}/surah/${num}/${edition}`);
  if(!res.ok) throw new Error(`Qur'an API request failed for ${edition}: ${res.status}`);
  const json = await res.json();
  if(!json || !json.data || !Array.isArray(json.data.ayahs)){
    throw new Error(`Unexpected Qur'an API response shape for ${edition}`);
  }
  return json.data;
}

// Fetches all three editions from the primary source, retrying each
// once on failure before giving up — most "Failed to fetch" errors
// are transient network blips, not the API being genuinely down.
async function fetchSurahPrimary(num){
  const withRetry = (edition)=> fetchEdition(num, edition).catch(()=> fetchEdition(num, edition));
  const [arabicEd, transEd, translitEd] = await Promise.all([
    withRetry('quran-uthmani'),
    withRetry('en.sahih'),
    withRetry('en.transliteration')
  ]);
  const ayahs = {};
  arabicEd.ayahs.forEach((a, i)=>{
    ayahs[a.numberInSurah] = {
      ar: a.text,
      tr: (transEd.ayahs[i]) ? transEd.ayahs[i].text : '',
      tl: (translitEd.ayahs[i]) ? translitEd.ayahs[i].text : ''
    };
  });
  return ayahs;
}

async function fetchCdnEdition(num, slug){
  const res = await fetch(`${QURAN_CDN_BASE}/${slug}/${num}.min.json`);
  if(!res.ok) throw new Error(`Qur'an CDN request failed for ${slug}: ${res.status}`);
  const json = await res.json();
  if(!json || !Array.isArray(json.chapter)){
    throw new Error(`Unexpected Qur'an CDN response shape for ${slug}`);
  }
  return json.chapter; // [{chapter, verse, text}, ...]
}

// Fallback source — same three pieces (Arabic Uthmani script, Sahih
// International / "Umm Muhammad" translation, transliteration), from
// the jsDelivr-hosted mirror instead of the live API.
async function fetchSurahFallback(num){
  const [arabicVerses, transVerses, translitVerses] = await Promise.all([
    fetchCdnEdition(num, 'ara-quranacademy'),
    fetchCdnEdition(num, 'eng-ummmuhammad'),
    fetchCdnEdition(num, 'ara-quran-la')
  ]);
  const ayahs = {};
  arabicVerses.forEach((a, i)=>{
    ayahs[a.verse] = {
      ar: a.text,
      tr: (transVerses[i]) ? transVerses[i].text : '',
      tl: (translitVerses[i]) ? translitVerses[i].text : ''
    };
  });
  return ayahs;
}

/* ============================================================
   ALTERNATE TRANSLATIONS
   Saheeh International loads automatically as part of the base
   surah fetch above. Dr. Mustafa Khattab (The Clear Qur'an) and
   Pickthall are fetched lazily, only once selected in the toolbar,
   from the same jsDelivr-hosted CDN mirror used as the fallback
   source — its response shape is already verified elsewhere in
   this file (see fetchCdnEdition).
   ============================================================ */
const TRANSLATION_EDITIONS = {
  sahih: null,                        // uses the base ayahs.tr already fetched
  khattab: 'eng-mustafakhattaba',     // Dr. Mustafa Khattab — The Clear Qur'an
  pickthall: 'eng-mohammedmarmadu'    // Mohammed Marmaduke William Pickthall
};
const translationCache = {};        // `${key}:${surah}` -> {verseNum: text}
const translationLoadPromises = {};

function translationStorageKey(key, num){ return 'wwp:quran:'+QURAN_CACHE_VERSION+':translation:'+key+':'+num; }

async function loadTranslation(surahNum, key){
  const slug = TRANSLATION_EDITIONS[key];
  if(!slug) return null; // 'sahih' — nothing extra to fetch
  const cacheKey = key+':'+surahNum;
  if(translationCache[cacheKey]) return translationCache[cacheKey];
  if(translationLoadPromises[cacheKey]) return translationLoadPromises[cacheKey];

  translationLoadPromises[cacheKey] = (async ()=>{
    if(window.LocalCache){
      const cached = window.LocalCache.get(translationStorageKey(key, surahNum), null);
      if(cached){
        translationCache[cacheKey] = cached;
        return cached;
      }
    }

    try{
      const verses = await fetchCdnEdition(surahNum, slug).catch(()=> fetchCdnEdition(surahNum, slug));
      const map = {};
      verses.forEach(v=> map[v.verse] = v.text);
      translationCache[cacheKey] = map;
      if(window.LocalCache) window.LocalCache.set(translationStorageKey(key, surahNum), map);
      return map;
    } catch(err){
      console.error('Translation fetch failed for', key, 'surah', surahNum, err);
      translationCache[cacheKey] = {}; // empty map — render falls back to Saheeh International text
      return {};
    }
  })();

  return translationLoadPromises[cacheKey];
}

/* ============================================================
   EXPLANATORY NOTES (Tafsir) — Tafsir Ibn Kathir (abridged, English),
   fetched lazily per-ayah only when the person opens/auto-loads the
   note panel.

   // ==> CONNECT: source #1 below is this site's own backend endpoint
   // (/api/tafsir/:surah/:ayah — see functions/api/tafsir/[surah]/[ayah].js).
   // Until that's deployed with a KV binding, it 404s harmlessly and the
   // code falls through to the public sources below. Once deployed, it's
   // same-origin (no CORS exposure at all) and serves from cache after
   // the first request, so every visitor after the first gets an
   // instant, reliable note with zero dependency on third-party CDNs.
   ============================================================ */
const TAFSIR_SOURCES = [
  {
    url: (s,a)=> `/api/tafsir/${s}/${a}`,
    extract: json => json && json.text
  },
  {
    url: (s,a)=> `https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir/en-tafisr-ibn-kathir/${s}/${a}.json`,
    extract: json => json && (json.text || json.tafsir || json.content)
  },
  {
    url: (s,a)=> `https://cdn.jsdelivr.net/gh/fauwadwali-oss/nwv-islamic-data@main/tafsir/en-tafisr-ibn-kathir/${s}/${a}.json`,
    extract: json => json && (json.text || json.tafsir || json.content)
  },
  {
    url: (s,a)=> `https://ummahapi.com/api/tafsir/ibn_kathir/surah/${s}/ayah/${a}`,
    extract: json => json && json.data && json.data.tafsir
  }
];
const tafsirCache = {};        // `${surah}:${ayah}` -> paragraph array (or null if failed)
const tafsirLoadPromises = {};
const tafsirLastError = {};    // `${surah}:${ayah}` -> human-readable error, for the retry panel

function tafsirStorageKey(surah, ayah){ return 'wwp:quran:'+QURAN_CACHE_VERSION+':tafsir:ibnkathir:v3:'+surah+':'+ayah; }

// Tafsir text comes back as plain text with single line breaks between
// sections/hadith (occasionally with light HTML in some editions) —
// strip any tags, then split on line breaks for readable paragraphs.
function tafsirHtmlToParagraphs(raw){
  if(!raw) return [];
  const withBreaks = String(raw).replace(/<\/p>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  const div = document.createElement('div');
  div.innerHTML = withBreaks;
  return div.textContent.split(/\n+/).map(p=> p.trim()).filter(Boolean);
}

async function fetchTafsirFromSources(surah, ayah){
  const errors = [];
  for(const source of TAFSIR_SOURCES){
    try{
      const res = await fetch(source.url(surah, ayah));
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rawText = source.extract(json) || '';
      const paragraphs = tafsirHtmlToParagraphs(rawText);
      if(paragraphs.length) return paragraphs;
      throw new Error('empty response');
    } catch(err){
      errors.push(err.message || String(err));
      // try the next source
    }
  }
  throw new Error(errors.join(' · ') || 'All tafsir sources failed');
}

async function loadTafsir(surah, ayah){
  const cacheKey = surah+':'+ayah;
  if(tafsirCache[cacheKey]) return tafsirCache[cacheKey];
  if(tafsirLoadPromises[cacheKey]) return tafsirLoadPromises[cacheKey];

  tafsirLoadPromises[cacheKey] = (async ()=>{
    if(window.LocalCache){
      const cached = window.LocalCache.get(tafsirStorageKey(surah, ayah), null);
      if(cached){
        tafsirCache[cacheKey] = cached;
        return cached;
      }
    }

    try{
      const paragraphs = await fetchTafsirFromSources(surah, ayah);
      tafsirCache[cacheKey] = paragraphs;
      if(window.LocalCache) window.LocalCache.set(tafsirStorageKey(surah, ayah), paragraphs);
      return paragraphs;
    } catch(err){
      console.error('Tafsir fetch failed for', surah, ayah, err);
      tafsirLastError[cacheKey] = err.message || String(err);
      tafsirCache[cacheKey] = null; // null (not []) signals "failed", so it isn't cached as "no note"
      return null;
    }
  })();

  return tafsirLoadPromises[cacheKey];
}

async function loadSurahData(num){
  if(surahCache[num]) return surahCache[num];
  if(surahLoadPromises[num]) return surahLoadPromises[num];

  surahLoadPromises[num] = (async ()=>{
    // 1) localStorage cache — the Qur'an text never changes, so once fetched
    //    we never need to hit the network for this surah again.
    if(window.LocalCache){
      const cached = window.LocalCache.get(quranStorageKey(num), null);
      if(cached){
        surahCache[num] = cached;
        return cached;
      }
    }

    // 1b) IndexedDB fallback — persistent offline cache
    try{
      const cached = await OfflineData.get('quran_cache', num);
      if(cached){
        surahCache[num] = cached;
        return cached;
      }
    }catch(e){ /* IndexedDB unavailable */ }

    // 2) primary source, with 3) CDN fallback if it fails outright
    let ayahs, source;
    try{
      ayahs = await fetchSurahPrimary(num);
      source = 'live';
    } catch(primaryErr){
      console.error('Primary Qur\'an source failed for surah', num, primaryErr);
      try{
        ayahs = await fetchSurahFallback(num);
        source = 'live-fallback';
      } catch(fallbackErr){
        console.error('Fallback Qur\'an source also failed for surah', num, fallbackErr);
        // 4) offline / both sources down — seed text where we have it
        const fallback = seedFallbackForSurah(num);
        fallback.error = true;
        surahCache[num] = fallback;
        return fallback;
      }
    }

    const result = {ayahs, source};
    surahCache[num] = result;
    if(window.LocalCache) window.LocalCache.set(quranStorageKey(num), result); // storage full/unavailable is handled inside LocalCache.set — still usable in-memory
    // Also cache in IndexedDB for offline access
    try{ await OfflineData.set('quran_cache', { surah: num, ...result }); }catch(e){ /* IndexedDB unavailable */ }
    return result;
  })();

  return surahLoadPromises[num];
}

/* ============================================================
   UTIL
   ============================================================ */
const TOTAL_AYAHS = SURAHS.reduce((s,x)=>s+x.ayahs,0); // 6236
const TOTAL_PAGES = 604;
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));

function getSurah(num){ return SURAHS.find(s=>s.num===num); }

function toArabicIndicDigits(n){
  const map = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  return String(n).split('').map(d=> map[+d] ?? d).join('');
}

function cumulativeAyahsBefore(surahNum){
  let c=0;
  for(const s of SURAHS){ if(s.num===surahNum) break; c+=s.ayahs; }
  return c;
}

function getJuz(surahNum, ayahNum){
  let juz=1;
  for(const [j,s,a] of JUZ_BOUNDS){
    if(surahNum>s || (surahNum===s && ayahNum>=a)) juz=j; else break;
  }
  return juz;
}

function approxPage(surahNum, ayahNum){
  const globalIdx = cumulativeAyahsBefore(surahNum)+ayahNum;
  return Math.max(1, Math.min(TOTAL_PAGES, Math.round((globalIdx/TOTAL_AYAHS)*TOTAL_PAGES)));
}

// showToast: shared, defined once in wwp-core.js (loads first) — no local copy needed.

// dkey: shared, defined once in wwp-core.js — no local copy needed.

/* ============================================================
   STATE :: fresh-device defaults — a brand new device gets a
   genuinely empty state (no fake demo streak/progress). Real
   values load in from the backend in Services.loadFromBackend()
   if this device has saved data already.
   ============================================================ */
const state = {
  theme:'light',
  arabicSize:30,
  transSize:15,
  showTranslit:true,
  showNotes:false,
  arabicFont:"'Amiri',serif",
  currentSurah:1,
  currentAyah:1,
  translation:'sahih',            // 'sahih' | 'khattab' | 'pickthall'
  sidebarTab:'surah',            // 'surah' | 'juz' | 'bookmarks'
  bookmarks:new Set(),           // "surah:ayah"
  history:[],                    // {surah,ayah,ts}
  lastRead:{surah:1,ayah:1,ts:Date.now()},
  physicalBookmark:null,          // {surah, ayah, ts} | null — where the person is in their paper mushaf; optional, manual, unrelated to streak
  readDates:{},                   // dateKey -> true; drives the real streak below
  streak:{days:0, week:[false,false,false,false,false,false,false]}, // Mon..Sun
  streakFreezeMonth:null,         // 'YYYY-MM' of the last month a freeze was used, or null
  todayIdx:(new Date().getDay()+6)%7,
  dailyGoal:{amount:1,unit:'page(s)',freq:'Every day'},
  todayProgress:0,
  progress:{juzDone:0,pagesRead:0,ayatRead:0,timeSpent:'0m'}
};


/* ============================================================
   SERVICES :: live Qur'an data fetch/cache, local logic, and
   backend sync via WWP (anonymous device-id-first — see shared
   WWP module at top of file).
   ============================================================ */
const Services = {
  fetchAyahText(surah, ayah){
    // Live/cached data first (whole-surah cache from loadSurahData),
    // falling back to the small offline seed set if nothing has loaded yet.
    const cached = surahCache[surah];
    if(cached && cached.ayahs[ayah]) return cached.ayahs[ayah];
    return SEED[surah+':'+ayah] || null;
  },
  surahStatus(surah){
    if(surahCache[surah]) return surahCache[surah].error ? 'error' : 'ready';
    return surahLoadPromises[surah] ? 'loading' : 'idle';
  },
  logHistory(surah, ayah){
    state.history.unshift({surah,ayah,ts:Date.now()});
    state.history = state.history.slice(0,30);
  },
  toggleBookmark(surah, ayah){
    const key = surah+':'+ayah;
    if(state.bookmarks.has(key)) state.bookmarks.delete(key); else state.bookmarks.add(key);
    return state.bookmarks.has(key);
  },
  saveLastRead(surah, ayah){
    state.lastRead = {surah, ayah, ts:Date.now()};
  },
  // Marks today as a reading day and recomputes the streak from real
  // activity (not a mock number) — mirrors the Journal section's
  // reflection-based streak logic.
  markReadToday(){
    state.readDates[dkey(new Date())] = true;
    Services.recomputeStreak();
  },
  recomputeStreak(){
    const today = new Date(); today.setHours(0,0,0,0);
    let cursor = new Date(today);
    if(!state.readDates[dkey(today)]) cursor.setDate(cursor.getDate()-1); // today not logged yet — don't zero the streak early
    // One gap day per calendar month can pass through without breaking
    // the chain (a streak freeze, Duolingo-style) — mirrors the
    // Journal section's freeze logic.
    const monthKey = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
    const freezeAvailable = state.streakFreezeMonth !== monthKey;
    let days = 0, freezeUsedThisPass = false;
    while(true){
      if(state.readDates[dkey(cursor)]){
        days++;
        cursor.setDate(cursor.getDate()-1);
        continue;
      }
      if(days>0 && freezeAvailable && !freezeUsedThisPass){
        freezeUsedThisPass = true;
        cursor.setDate(cursor.getDate()-1);
        continue;
      }
      break;
    }
    state.streak.days = days;
    if(freezeUsedThisPass) state.streakFreezeMonth = monthKey;
    const dow = (today.getDay()+6)%7; // Mon=0..Sun=6
    const monday = new Date(today); monday.setDate(monday.getDate()-dow);
    const week = [];
    for(let i=0;i<7;i++){ const d=new Date(monday); d.setDate(d.getDate()+i); week.push(!!state.readDates[dkey(d)]); }
    state.streak.week = week;
    state.todayIdx = dow;
  },
  streakFreezeStatus(){
    const today = new Date();
    const monthKey = today.getFullYear()+'-'+String(today.getMonth()+1).padStart(2,'0');
    return state.streakFreezeMonth === monthKey ? 'used' : 'available';
  },
  // Debounced write of everything worth persisting for this device.
  persist(){
    WWP.save('quran', {
      currentSurah: state.currentSurah,
      currentAyah: state.currentAyah,
      translation: state.translation,
      bookmarks: Array.from(state.bookmarks),
      history: state.history,
      lastRead: state.lastRead,
      physicalBookmark: state.physicalBookmark,
      readDates: state.readDates,
      streakFreezeMonth: state.streakFreezeMonth,
      dailyGoal: state.dailyGoal,
      todayProgress: state.todayProgress,
      progress: state.progress
    });
  },
  // Pulls this device's saved Qur'an state, if any, and merges it in.
  // ==> CONNECT (resolved): this is the real backend load — no auth
  // needed, the device ID from WWP does the scoping.
  async loadFromBackend(){
    const saved = await WWP.get('quran');
    if(!saved) return;
    if(typeof saved.currentSurah==='number') state.currentSurah = saved.currentSurah;
    if(typeof saved.currentAyah==='number') state.currentAyah = saved.currentAyah;
    if(typeof saved.translation==='string') state.translation = saved.translation;
    if(Array.isArray(saved.bookmarks)) state.bookmarks = new Set(saved.bookmarks);
    if(Array.isArray(saved.history)) state.history = saved.history;
    if(saved.lastRead) state.lastRead = saved.lastRead;
    if(saved.physicalBookmark) state.physicalBookmark = saved.physicalBookmark;
    if(saved.readDates) state.readDates = saved.readDates;
    if(saved.streakFreezeMonth !== undefined) state.streakFreezeMonth = saved.streakFreezeMonth;
    if(saved.dailyGoal) state.dailyGoal = saved.dailyGoal;
    if(typeof saved.todayProgress==='number') state.todayProgress = saved.todayProgress;
    if(saved.progress) state.progress = saved.progress;
    Services.recomputeStreak();
  }
};

/* ============================================================
   UI :: render functions
   ============================================================ */
function renderSurahList(filter){
  const list = $('#surahList');
  list.innerHTML='';
  const f = (filter||'').trim().toLowerCase();
  SURAHS.forEach(s=>{
    if(f && !(s.en.toLowerCase().includes(f) || s.meaning.toLowerCase().includes(f) || String(s.num)===f)) return;
    const li = document.createElement('li');
    li.className='surah-row'+(s.num===state.currentSurah?' active':'');
    li.innerHTML = `
      <span class="s-num">${s.num}</span>
      <div class="s-info">
        <div class="s-en">${s.en}</div>
        <div class="s-meaning">${s.meaning}</div>
      </div>
      <div class="s-right">
        <div class="s-ar">${s.ar}</div>
        <div class="s-ayahs">${s.ayahs} Ayahs</div>
      </div>`;
    li.addEventListener('click', ()=> selectSurah(s.num, 1));
    list.appendChild(li);
  });
  if(f && list.children.length===0){
    list.innerHTML = '<div class="popover-empty">No surahs match "'+filter+'"</div>';
  }
}

function renderJuzList(){
  const list = $('#surahList');
  list.innerHTML='';
  JUZ_BOUNDS.forEach(([j, surahNum, ayahNum])=>{
    const s = getSurah(surahNum);
    const isActive = getJuz(state.currentSurah, state.currentAyah)===j;
    const li = document.createElement('li');
    li.className='surah-row'+(isActive?' active':'');
    li.innerHTML = `
      <span class="s-num">${j}</span>
      <div class="s-info">
        <div class="s-en">Juz ${j}</div>
        <div class="s-meaning">Starts at ${s.en} ${ayahNum}</div>
      </div>`;
    li.addEventListener('click', ()=> selectSurah(surahNum, ayahNum));
    list.appendChild(li);
  });
}

function renderBookmarksList(){
  const list = $('#surahList');
  list.innerHTML='';
  const keys = Array.from(state.bookmarks).sort((a,b)=>{
    const [as,aa] = a.split(':').map(Number), [bs,ba] = b.split(':').map(Number);
    return as-bs || aa-ba;
  });
  if(keys.length===0){
    list.innerHTML = '<div class="popover-empty">No bookmarks yet — tap the bookmark icon on any ayah while reading.</div>';
    return;
  }
  keys.forEach(key=>{
    const [su,ay] = key.split(':').map(Number);
    const s = getSurah(su);
    const isActive = su===state.currentSurah && ay===state.currentAyah;
    const li = document.createElement('li');
    li.className='surah-row'+(isActive?' active':'');
    li.innerHTML = `
      <span class="s-num">${su}</span>
      <div class="s-info">
        <div class="s-en">${s.en}</div>
        <div class="s-meaning">Ayah ${ay}</div>
      </div>
      <div class="s-right"><div class="s-ar">${s.ar}</div></div>`;
    li.addEventListener('click', ()=> selectSurah(su, ay));
    list.appendChild(li);
  });
}

function renderSidebarContent(){
  $('#sidebarCount').style.display = state.sidebarTab==='surah' ? '' : 'none';
  if(state.sidebarTab==='surah') renderSurahList($('#globalSearch').value);
  else if(state.sidebarTab==='juz') renderJuzList();
  else renderBookmarksList();
}

function renderBookmarksPopover(){
  const wrap = $('#bookmarksPopoverList');
  const keys = Array.from(state.bookmarks).sort((a,b)=>{
    const [as,aa] = a.split(':').map(Number), [bs,ba] = b.split(':').map(Number);
    return as-bs || aa-ba;
  });
  if(keys.length===0){
    wrap.innerHTML = '<div class="popover-empty">No bookmarks yet — tap the bookmark icon on any ayah.</div>';
    return;
  }
  wrap.innerHTML = keys.map(key=>{
    const [su,ay] = key.split(':').map(Number);
    const s = getSurah(su);
    return `<div class="popover-row" data-surah="${su}" data-ayah="${ay}"><span>${s.en} ${ay}</span><span class="s-ar" style="font-size:15px;">${s.ar}</span></div>`;
  }).join('');
  $$('.popover-row', wrap).forEach(row=>{
    row.addEventListener('click', ()=>{
      selectSurah(+row.dataset.surah, +row.dataset.ayah);
      $('#bookmarksPopover').classList.remove('open');
    });
  });
}

function renderReaderHeader(){
  const s = getSurah(state.currentSurah);
  $('#rHeaderEn').textContent = s.en;
  $('#rHeaderAr').textContent = s.ar;
  const juz = getJuz(state.currentSurah, state.currentAyah);
  const page = approxPage(state.currentSurah, state.currentAyah);
  $('#rHeaderMeta').textContent = `Juz ${juz} · Page ${page} · ${s.type} · ${s.ayahs} Ayahs`;
  renderSurahQuickJumps();
}

// Direct-jump pills for a small set of notable ayah ranges, shown
// right under the surah title — Al-Kahf's first/last 10 (the Jummah
// recommendation) and Al-Baqarah's last 10 + Ayat al-Kursi. Empty for
// every other surah.
function renderSurahQuickJumps(){
  const wrap = $('#surahQuickJumps');
  if(!wrap) return;
  const num = state.currentSurah;
  let pills = [];
  if(num === 18){ // Al-Kahf, 110 ayahs
    pills = [
      {cls:'sqj-kahf', ayah:1, label:'First 10 Ayah'},
      {cls:'sqj-kahf', ayah:101, label:'Last 10 Ayah'}
    ];
  }else if(num === 2){ // Al-Baqarah, 286 ayahs
    pills = [
      {cls:'sqj-baqarah', ayah:255, label:'Ayat al-Kursi'},
      {cls:'sqj-baqarah', ayah:277, label:'Last 10 Ayah'}
    ];
  }
  if(!pills.length){ wrap.innerHTML=''; return; }
  wrap.innerHTML = pills.map(p=>
    `<button type="button" class="sqj-pill ${p.cls}" data-jump-ayah="${p.ayah}">${p.label}</button>`
  ).join('');
  $$('.sqj-pill', wrap).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const ayah = parseInt(btn.dataset.jumpAyah, 10);
      state.currentAyah = ayah;
      Services.saveLastRead(num, ayah);
      Services.persist();
      if(!scrollToAyahCard(num, ayah)){
        ensureSurahLoaded(num, ayah);
      }
    });
  });
}

// Builds the markup for one ayah — used when rendering the full,
// continuously-scrollable surah (see renderReader below).
function ayahCardHTML(surahNum, ayahNum, data, isBm){
  const endMark = `<span class="ayah-end-mark">﴾${toArabicIndicDigits(ayahNum)}﴿</span>`;
  // Surah Al-Kahf (18): first 10 and last 10 ayahs get a subtle,
  // theme-matched tint — sage green in Jummah, light peach normally,
  // light lilac in Ramadan. Styling lives entirely in CSS (see
  // .ayah-kahf-highlight rules), keyed off body[data-event-theme] so
  // it stays correct if the active theme changes without a re-render.
  let kahfClass = '';
  if(surahNum === 18){
    if(ayahNum <= 10) kahfClass = ' ayah-kahf-highlight ayah-kahf-first10';
    else if(ayahNum >= 101) kahfClass = ' ayah-kahf-highlight ayah-kahf-last10';
  }
  return `
    <div class="ayah-card${kahfClass}" id="ayah-${surahNum}-${ayahNum}" data-surah="${surahNum}" data-ayah="${ayahNum}">
      <div class="ayah-top">
        <span class="ayah-num">${ayahNum}</span>
        <div class="ayah-mini-actions">
          <button class="mini-btn ${isBm?'bookmarked':''}" data-action="bookmark" title="Bookmark this ayah">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>
          </button>
          <button class="mini-btn" data-action="copy" title="Copy">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>
          </button>
          <button class="mini-btn" data-action="share" title="Share">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6 15.4 6.4M8.6 13.4l6.8 4.2"/></svg>
          </button>
          <button class="mini-btn${state.showNotes?' active-state':''}" data-action="note" title="Explanatory note">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
          </button>
        </div>
      </div>
      <div class="ayah-ar">${data.ar} ${endMark}</div>
      ${state.showTranslit ? `<div class="ayah-translit">${data.tl}</div>` : ''}
      <div class="ayah-trans">${data.tr}</div>
      <div class="ayah-note${state.showNotes?' open':''}" id="note-${surahNum}-${ayahNum}"></div>
    </div>`;
}

function loadingBlockHTML(){
  return `<div class="ayah-placeholder">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none" class="spin"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>
      Loading this surah…
    </div>`;
}

function errorBlockHTML(){
  return `<div class="ayah-placeholder">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex:none"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>
      Couldn't load this surah — check your connection.
      <button id="ayahRetryBtn" class="mini-btn" style="margin-left:8px;width:auto;padding:0 10px;">Retry</button>
    </div>`;
}

// Renders the ENTIRE current surah, ayah 1 through the end, as one
// continuous scrollable pane — no "next ayah" paging needed.
function renderReader(){
  const s = getSurah(state.currentSurah);
  const list = $('#ayahList');
  const cached = surahCache[state.currentSurah];
  const status = Services.surahStatus(state.currentSurah);

  if(!cached){
    list.innerHTML = status==='error' ? errorBlockHTML() : loadingBlockHTML();
    const retryBtn = $('#ayahRetryBtn');
    if(retryBtn) retryBtn.addEventListener('click', ()=>{
      delete surahCache[state.currentSurah];
      delete surahLoadPromises[state.currentSurah];
      ensureSurahLoaded(state.currentSurah);
    });
  } else {
    // Alternate translation (Khattab/Pickthall) — lazy-loaded per surah.
    // Falls back to Saheeh International text for this render if not
    // loaded yet; loadTranslation's own promise triggers a re-render
    // once it resolves.
    const transKey = state.translation;
    let transMap = null;
    if(TRANSLATION_EDITIONS[transKey]){
      transMap = translationCache[transKey+':'+state.currentSurah];
      if(!transMap){
        const requestedSurah = state.currentSurah;
        loadTranslation(requestedSurah, transKey).then(()=>{
          if(state.currentSurah===requestedSurah && state.translation===transKey) renderReader();
        });
      }
    }

    let html='';
    for(let a=1; a<=s.ayahs; a++){
      const data = cached.ayahs[a] || SEED[state.currentSurah+':'+a];
      if(!data) continue; // shouldn't happen once cached, but guards against gaps
      const isBm = state.bookmarks.has(state.currentSurah+':'+a);
      const tr = (transMap && transMap[a]) ? transMap[a] : data.tr;
      html += ayahCardHTML(state.currentSurah, a, {...data, tr}, isBm);
    }
    list.innerHTML = html || loadingBlockHTML();
  }

  // Prev/next surah nav labels
  const prevS = getSurah(state.currentSurah-1);
  const nextS = getSurah(state.currentSurah+1);
  $('#prevSurahLbl').textContent = prevS ? prevS.en : 'Start of Qur\'an';
  $('#nextSurahLbl').textContent = nextS ? nextS.en : 'End of Qur\'an';
  $('#prevSurahBtn').style.opacity = prevS ? 1 : .45;
  $('#nextSurahBtn').style.opacity = nextS ? 1 : .45;
  initNotesAutoLoad();
  if(playingAyah) highlightPlayingAyah(state.currentSurah, playingAyah); // survive re-renders mid-playback
  activeReadAyah = null;
  computeActiveReadAyah();
}

// Reading-position tracking: as the user scrolls through a surah, the
// ayah whose midpoint is nearest the vertical center of the viewport
// becomes the "active" one — a subtle border glow (see
// .ayah-card.active-read), and after a short settle it's saved as the
// real Continue Reading position and counts toward today's reading
// streak.
//
// This deliberately measures directly (getBoundingClientRect on every
// scroll tick, rAF-throttled) rather than using IntersectionObserver.
// A narrow-band IntersectionObserver only fires when an element's edge
// crosses the band boundary between two browser-computed frames — with
// fast or discrete scrolling (mouse-wheel ticks, arrow keys, a finger
// flick), a short ayah card can move from below the band to above it
// without ever registering as "intersecting", so the highlight skips
// it entirely. Directly measuring the closest card on every tick always
// finds the true nearest ayah regardless of how the scroll happened.
let activeReadAyah = null;
let activeReadSaveTimer = null;
let activeReadTicking = false;

function computeActiveReadAyah(){
  const list = document.getElementById('ayahList');
  if(!list) return;
  const cards = list.querySelectorAll('.ayah-card');
  if(!cards.length) return;
  const centerY = window.innerHeight/2;
  let best = null, bestDist = Infinity;
  cards.forEach(card=>{
    const rect = card.getBoundingClientRect();
    if(rect.bottom < -200 || rect.top > window.innerHeight+200) return; // cheap reject, well off-screen
    const mid = rect.top + rect.height/2;
    const dist = Math.abs(mid - centerY);
    if(dist < bestDist){ bestDist = dist; best = card; }
  });
  if(best) setActiveReadAyah(parseInt(best.dataset.surah,10), parseInt(best.dataset.ayah,10));
}

function onActiveReadScroll(){
  if(activeReadTicking) return;
  activeReadTicking = true;
  requestAnimationFrame(()=>{
    activeReadTicking = false;
    const page = document.getElementById('page-quran');
    if(!page || page.classList.contains('hidden')) return;
    computeActiveReadAyah();
  });
}
window.addEventListener('scroll', onActiveReadScroll, {passive:true});

function setActiveReadAyah(surah, ayah){
  if(ayah===activeReadAyah) return;
  activeReadAyah = ayah;

  $$('.ayah-card.active-read').forEach(el=> el.classList.remove('active-read'));
  const card = document.getElementById(`ayah-${surah}-${ayah}`);
  if(card) card.classList.add('active-read');

  state.currentAyah = ayah;
  clearTimeout(activeReadSaveTimer);
  activeReadSaveTimer = setTimeout(()=>{
    Services.logHistory(surah, ayah);
    Services.saveLastRead(surah, ayah);
    Services.markReadToday();
    Services.persist();
    renderContinueCard();
    renderProgressRing();
    renderStreak();
  }, 900);
}

function renderProgressRing(){
  const s = getSurah(state.currentSurah);
  const pct = Math.round((state.currentAyah/s.ayahs)*100);
  const r=33, c=2*Math.PI*r;
  const fg = $('#ringFg');
  fg.setAttribute('stroke-dasharray', c.toFixed(1));
  fg.setAttribute('stroke-dashoffset', (c*(1-pct/100)).toFixed(1));
  $('#ringPctLbl').textContent = pct+'%';
}

function renderStreak(){
  $('#streakNum').textContent = state.streak.days;
  const freezeNote = $('#streakFreezeNote');
  if(freezeNote){
    freezeNote.textContent = Services.streakFreezeStatus()==='available' ? '❄️ freeze available' : '❄️ freeze used this month';
  }
  const days = ['M','T','W','T','F','S','S'];
  const row = $('#weekRow');
  row.innerHTML='';
  days.forEach((d,i)=>{
    const done = state.streak.week[i];
    const isToday = i===state.todayIdx;
    row.innerHTML += `<div class="week-day"><span>${d}</span><div class="day-dot ${done?'done':''} ${isToday && !done?'today':''}">${done?'✓':''}</div></div>`;
  });
  submitQuranStreak(state.streak.days);
  loadQuranPokePanel();
}

// Debounced, fire-and-forget — mirrors the Journal leaderboard-score
// submission pattern. Only signed-in users have a row here at all.
let quranStreakSubmitTimer = null;
function submitQuranStreak(days){
  clearTimeout(quranStreakSubmitTimer);
  quranStreakSubmitTimer = setTimeout(async ()=>{
    try{
      await fetch('/api/quran-streak', {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'X-Device-Id': window.WWP?.deviceId || '' },
        credentials: 'include',
        body: JSON.stringify({ streakDays: days })
      });
    }catch(e){ /* silent — nice-to-have, not critical */ }
  }, 1500);
}

// Friends' Qur'an reading streaks + poke panel. Self-contained here
// (not sharing helpers with the auth/friends IIFE — top-level consts
// there are invisible from this script) — keeps its own tiny renderer.
let pokePanelLastLoad = 0;
// escapeHtml: shared, defined once in wwp-core.js — no local copy needed.
async function loadQuranPokePanel(force){
  if(!force && Date.now()-pokePanelLastLoad<30000) return;
  pokePanelLastLoad = Date.now();
  const msgEl = $('#pokePanelMsg');
  const listEl = $('#pokeFriendsList');
  if(!msgEl || !listEl) return;
  try{
    const res = await fetch('/api/quran-streak', {
      credentials:'include',
      headers:{ 'X-Device-Id': window.WWP?.deviceId || '' }
    });
    if(res.status===401){
      msgEl.style.display='block';
      msgEl.innerHTML = 'Sign in to see friends\' streaks.';
      listEl.innerHTML='';
      return;
    }
    if(!res.ok){
      console.warn('loadQuranPokePanel: request failed', res.status, await res.text().catch(()=>''));
      msgEl.style.display='block';
      msgEl.textContent = 'Couldn\'t load friends\' streaks — try again shortly.';
      listEl.innerHTML='';
      return;
    }
    const data = await res.json();
    listEl.innerHTML='';
    if(!data.entries || !data.entries.length){
      msgEl.style.display='block';
      msgEl.textContent = 'Add friends to see their streaks here.';
      return;
    }
    msgEl.style.display='none';
    data.entries.forEach(entry=>{
      const item = document.createElement('div');
      item.className='poke-friend-item';
      item.innerHTML = `
        <span class="poke-friend-name">${escapeHtml(entry.username)} <span class="poke-friend-streak">${entry.streakDays}d</span></span>
        <button class="poke-btn" ${entry.pokedToday?'disabled':''} data-friend="${entry.userId}">
          ${entry.pokedToday ? 'Poked ✓' : 'Poke'}
        </button>`;
      const btn = item.querySelector('.poke-btn');
      btn.addEventListener('click', ()=> sendQuranPoke(entry.userId, btn));
      listEl.appendChild(item);
    });
  }catch(e){
    console.warn('loadQuranPokePanel failed', e);
    msgEl.style.display='block';
    msgEl.textContent = 'Couldn\'t load friends\' streaks — try again shortly.';
    listEl.innerHTML='';
  }
}
async function sendQuranPoke(friendUserId, btn){
  btn.disabled = true;
  const original = btn.textContent;
  try{
    const res = await fetch('/api/push/poke', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'X-Device-Id': window.WWP?.deviceId || '' },
      credentials:'include',
      body: JSON.stringify({ friendUserId })
    });
    const data = await res.json();
    if(res.ok && data.success){
      btn.textContent = 'Poked ✓';
      showToast(data.delivered ? 'Poke sent!' : 'Poked — they haven\'t enabled notifications');
    } else if(res.status===409){
      btn.textContent = 'Poked ✓';
      showToast('Already poked them today');
    } else {
      btn.textContent = original;
      btn.disabled = false;
      showToast('Could not send poke');
    }
  }catch(e){
    btn.textContent = original;
    btn.disabled = false;
    showToast('Could not send poke');
  }
}

function renderPlan(){
  $('#planGoalVal').textContent = `${state.dailyGoal.amount} ${state.dailyGoal.unit.replace('(s)','')}${state.dailyGoal.amount>1?'s':''} a day`;
  const pct = Math.min(100, Math.round((state.todayProgress/state.dailyGoal.amount)*100));
  $('#planBarFill').style.width = pct+'%';
  $('#planCaption').textContent = `${state.todayProgress} / ${state.dailyGoal.amount} ${state.dailyGoal.unit.replace('(s)','')}${state.dailyGoal.amount>1?'s':''} today`;
}

function renderContinueCard(){
  const s = getSurah(state.lastRead.surah);
  $('#continueSurah').textContent = s.en;
  $('#continueLoc').textContent = `Page ~${approxPage(state.lastRead.surah,state.lastRead.ayah)} · Ayah ${state.lastRead.ayah}`;
  const mins = Math.round((Date.now()-state.lastRead.ts)/60000);
  $('#continueTime').textContent = mins<1 ? 'Last read just now' : `Last read ${mins}m ago`;
}

// Physical copy bookmark: a single, optional, manually-updated marker for
// where the person is in their own paper mushaf. Deliberately separate
// from the app's Bookmarks (multi-save) and Last Read (auto-tracked) —
// and never touches the reading streak.
function populatePhysicalBmSurahSelect(){
  const sel = $('#physicalBmSurah');
  if(!sel || sel.options.length) return; // populate once
  sel.innerHTML = SURAHS.map(s=>`<option value="${s.num}">${s.num}. ${s.en}</option>`).join('');
}

function renderPhysicalBookmark(){
  const loc = $('#physicalBmLoc');
  if(!loc) return;
  const pb = state.physicalBookmark;
  if(pb){
    const s = getSurah(pb.surah);
    loc.textContent = s ? `${s.en}, Ayah ${pb.ayah}` : 'Not set';
  } else {
    loc.textContent = 'Not set';
  }
}

function renderProgressStats(){
  $('#statJuz').textContent = `${state.progress.juzDone}/30`;
  $('#statPages').textContent = `${state.progress.pagesRead}/604`;
  $('#statAyat').textContent = state.progress.ayatRead.toLocaleString();
  $('#statTime').textContent = state.progress.timeSpent;
}

// Estimated Completion card (audio-tools pane): projects a finish date
// from the person's daily reading goal and current progress, converting
// whatever unit/frequency they picked into an average pages-per-day pace.
const QURAN_TOTAL_PAGES = 604;
const QURAN_TOTAL_AYAHS = 6236;
const QURAN_TOTAL_SURAHS = 114;
function renderEstimatedCompletion(){
  const dateEl = $('#estDate'), subEl = $('#estSub');
  if(!dateEl || !subEl) return;
  const pagesRemaining = QURAN_TOTAL_PAGES - state.progress.pagesRead;
  if(pagesRemaining<=0){
    dateEl.textContent = "Complete!";
    subEl.textContent = "You've finished the whole Qur'an";
    return;
  }
  const goal = state.dailyGoal;
  let pagesPerOccurrence;
  if(goal.unit==='page(s)') pagesPerOccurrence = goal.amount;
  else if(goal.unit==='ayah(s)') pagesPerOccurrence = goal.amount * (QURAN_TOTAL_PAGES/QURAN_TOTAL_AYAHS);
  else pagesPerOccurrence = goal.amount * (QURAN_TOTAL_PAGES/QURAN_TOTAL_SURAHS); // surah(s)

  const occurrencesPerWeek = goal.freq==='Weekdays only' ? 5 : goal.freq==='Weekly' ? 1 : 7;
  const pagesPerDay = (pagesPerOccurrence * occurrencesPerWeek) / 7;

  if(!pagesPerDay || pagesPerDay<=0){
    dateEl.textContent = "—";
    subEl.textContent = "Set a reading plan to see this";
    return;
  }
  const daysLeft = Math.max(1, Math.ceil(pagesRemaining / pagesPerDay));
  const completion = new Date();
  completion.setDate(completion.getDate() + daysLeft);
  dateEl.textContent = completion.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'});
  subEl.textContent = `${daysLeft} day${daysLeft===1?'':'s'} left`;
}

function renderAll(){
  renderSidebarContent();
  renderReaderHeader();
  renderReader();
  renderProgressRing();
  renderStreak();
  renderPlan();
  renderContinueCard();
  renderPhysicalBookmark();
  renderProgressStats();
  renderSidebarCurrentToggle();
  renderEstimatedCompletion();
  if($('#bookmarksPopover').classList.contains('open')) renderBookmarksPopover();
}

// Mobile-only compact "currently reading" row shown while the surah
// list is collapsed (see .sidebar-current-toggle CSS, scoped to
// max-width:760px). Content adapts to whichever tab is active.
// Harmless no-op visually on larger screens.
function renderSidebarCurrentToggle(){
  const s = getSurah(state.currentSurah);
  if(!s) return;
  if(state.sidebarTab==='juz'){
    const j = getJuz(state.currentSurah, state.currentAyah);
    $('#sctNum').textContent = j;
    $('#sctLabel').textContent = 'Currently in';
    $('#sctName').textContent = `Juz ${j}`;
  } else if(state.sidebarTab==='bookmarks'){
    const count = state.bookmarks.size;
    $('#sctNum').textContent = count;
    $('#sctLabel').textContent = 'Bookmarks saved';
    $('#sctName').textContent = count===1 ? '1 ayah bookmarked' : `${count} ayahs bookmarked`;
  } else {
    $('#sctNum').textContent = s.num;
    $('#sctLabel').textContent = 'Currently reading';
    $('#sctName').textContent = s.en;
  }
}

/* ============================================================
   Actions
   ============================================================ */
function scrollToAyahCard(surah, ayah){
  const card = document.getElementById(`ayah-${surah}-${ayah}`);
  if(!card) return false;
  card.scrollIntoView({behavior:'smooth', block:'center'});
  // Brief flash so it's obvious which ayah was jumped to, distinct from
  // the persistent highlight used during audio playback.
  card.classList.add('jump-highlight');
  setTimeout(()=> card.classList.remove('jump-highlight'), 1800);
  return true;
}

function ensureSurahLoaded(num, scrollToAyah){
  loadSurahData(num).then(()=>{
    // Only re-render if the user hasn't navigated away from this surah
    // while the fetch was in flight.
    if(state.currentSurah===num){
      renderReader();
      if(scrollToAyah) scrollToAyahCard(num, scrollToAyah);
    }
  });
}

function selectSurah(num, ayah){
  state.currentSurah = num;
  state.currentAyah = ayah || 1;
  Services.logHistory(num, state.currentAyah);
  Services.saveLastRead(num, state.currentAyah);
  Services.markReadToday();
  Services.persist();
  renderAll();
  ensureSurahLoaded(num, state.currentAyah);
  updateAudioForSurah();
  // Mobile: once a surah is picked, collapse the list back down to the
  // compact "currently reading" row (no-op on desktop).
  $('#sidebar')?.classList.remove('expanded');
  // Jump straight to the exact ayah (e.g. from a bookmark) rather than
  // always landing at the top of the surah. If the surah's content
  // hasn't loaded yet, ensureSurahLoaded's callback above will scroll
  // to it the moment it's rendered — meanwhile just get the reader
  // pane into view so the loading state is visible.
  if(!scrollToAyahCard(num, state.currentAyah)){
    $('.reader-pane') && $('.reader-pane').scrollIntoView({behavior:'smooth', block:'start'});
  }
}

/* ============================================================
   Surah audio player — per-ayah recitation from everyayah.com (free,
   no key, CORS-open, one MP3 per ayah: SSSAAA.mp3). Using per-ayah
   files instead of one continuous surah file lets us know exactly
   which ayah is playing at any moment — no timestamp/segment data
   needed — so the currently-recited ayah can be highlighted and
   auto-scrolled into view as playback moves through the surah.
   Default reciter is Mishary Rashid Alafasy. Avatars are initials,
   not real photos — we don't have licensed photos of the reciters.
   ============================================================ */
const RECITERS = [
  {code:'Alafasy_128kbps', name:'Mishary Rashid Alafasy', initials:'MA'},
  {code:'Husary_128kbps', name:'Mahmoud Al-Husary', initials:'MH'},
  {code:'Abdul_Basit_Murattal_192kbps', name:'Abdul Basit (Murattal)', initials:'AB'},
  {code:'Minshawy_Murattal_128kbps', name:'Mohamed Al-Minshawi', initials:'MM'},
];
// Two independent mirrors hosting the same per-ayah file structure —
// if the primary is unreachable (hotlink protection, transient CDN
// issues, a browser-specific block), the player automatically retries
// on the second before giving up.
const AUDIO_MIRRORS = [
  'https://everyayah.com/data',
  'https://www.versebyversequran.com/data',
];
let currentReciter = RECITERS[0].code;
let playingAyah = null;   // ayah number currently loaded/playing, or null when stopped
let audioReady = false;   // true once #surahAudio.src matches playingAyah (avoids reload-on-resume)
let audioMirrorIndex = 0; // which AUDIO_MIRRORS entry is currently in use
let audioWantsPlay = false; // remembers autoplay intent across a mirror fallback retry

function ayahAudioSrc(surahNum, ayahNum, reciter, mirrorIndex){
  const s = String(surahNum).padStart(3,'0');
  const a = String(ayahNum).padStart(3,'0');
  return `${AUDIO_MIRRORS[mirrorIndex]}/${reciter}/${s}${a}.mp3`;
}
function formatAudioTime(sec){
  if(!isFinite(sec) || sec<0) sec = 0;
  const m = Math.floor(sec/60), s = Math.floor(sec%60);
  return `${m}:${String(s).padStart(2,'0')}`;
}
// Highlights the ayah currently being recited and scrolls it gently
// into view; clears the highlight entirely when ayah is null.
function highlightPlayingAyah(surah, ayah){
  $$('#ayahList .ayah-card.playing').forEach(el=> el.classList.remove('playing'));
  if(ayah==null) return;
  const card = $(`#ayah-${surah}-${ayah}`);
  if(!card) return;
  card.classList.add('playing');
  card.scrollIntoView({behavior:'smooth', block:'center'});
}
function updateAyahAudioLabel(){
  const label = $('#audioAyahLabel');
  if(!label) return;
  label.textContent = playingAyah ? `Ayah ${playingAyah} of ${getSurah(state.currentSurah).ayahs}` : 'Ready to play';
}
// Loads and (optionally) plays a specific ayah's clip. Always starts
// from the first mirror; the audio element's own 'error' event (wired
// in init()) handles falling back to the next mirror automatically.
function loadAndPlayAyah(surah, ayah, autoplay){
  const audio = $('#surahAudio');
  playingAyah = ayah;
  audioMirrorIndex = 0;
  audioWantsPlay = !!autoplay;
  audio.src = ayahAudioSrc(surah, ayah, currentReciter, audioMirrorIndex);
  audioReady = true;
  updateAyahAudioLabel();
  highlightPlayingAyah(surah, ayah);
  if(autoplay) audio.play().catch(()=> showToast("Couldn't play audio — check your connection"));
}
// Called whenever the current surah changes: stop playback, clear the
// highlight, and reset the transport UI. Does not autoplay.
function updateAudioForSurah(){
  const audio = $('#surahAudio');
  if(!audio) return;
  audio.pause();
  audio.removeAttribute('src');
  audioReady = false;
  playingAyah = null;
  setAudioPlayingUI(false);
  updateAyahAudioLabel();
  highlightPlayingAyah(state.currentSurah, null);
  $('#audioSeek').value = 0;
  $('#audioCurTime').textContent = '00:00';
  $('#audioDurTime').textContent = '00:00';
}
// Renders the reciter dropdown options and the current-selection button.
function renderReciterPicker(){
  const dd = $('#reciterDropdown');
  if(!dd) return;
  dd.innerHTML = RECITERS.map(r=>`
    <button class="reciter-option${r.code===currentReciter?' active':''}" data-reciter="${r.code}" type="button">
      <span class="reciter-avatar">${r.initials}</span>${r.name}
    </button>`).join('');
  $$('.reciter-option', dd).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      setReciter(btn.dataset.reciter);
      $('#reciterPicker').classList.remove('open');
    });
  });
  const cur = RECITERS.find(r=>r.code===currentReciter);
  $('#reciterCurrentAvatar').textContent = cur.initials;
  $('#reciterCurrentName').textContent = cur.name;
}
// Switches reciter, keeping the current ayah position and play state.
function setReciter(code){
  const audio = $('#surahAudio');
  const wasPlaying = !audio.paused;
  currentReciter = code;
  if(playingAyah){
    loadAndPlayAyah(state.currentSurah, playingAyah, wasPlaying);
  }
  renderReciterPicker();
  showToast(`Reciter set to ${RECITERS.find(r=>r.code===code).name}`);
}
function setAudioPlayingUI(isPlaying){
  const icon = $('#audioPlayIcon');
  const btn = $('#audioPlayBtn');
  if(!icon || !btn) return;
  btn.title = isPlaying ? 'Pause' : 'Play';
  icon.innerHTML = isPlaying
    ? '<rect x="6" y="5" width="4" height="14"/><rect x="14" y="5" width="4" height="14"/>'
    : '<path d="M8 5v14l11-7z"/>';
}

function goPrevSurah(){
  const prevS = getSurah(state.currentSurah-1);
  if(prevS) selectSurah(prevS.num, 1);
}
function goNextSurah(){
  const nextS = getSurah(state.currentSurah+1);
  if(nextS) selectSurah(nextS.num, 1);
}
function scrollToTop(){
  $('.reader-pane') && $('.reader-pane').scrollIntoView({behavior:'smooth', block:'start'});
}

function toggleAyahBookmark(surah, ayah){
  const isNowBm = Services.toggleBookmark(surah, ayah);
  showToast(isNowBm ? 'Ayah bookmarked' : 'Bookmark removed');
  Services.persist();
  const btn = $(`#ayah-${surah}-${ayah} [data-action="bookmark"]`);
  if(btn) btn.classList.toggle('bookmarked', isNowBm);
  if(state.sidebarTab==='bookmarks') renderSidebarContent();
  renderSidebarCurrentToggle();
  if($('#bookmarksPopover').classList.contains('open')) renderBookmarksPopover();
}

function copyAyah(surah, ayah){
  const s = getSurah(surah);
  const data = Services.fetchAyahText(surah, ayah);
  const transMap = TRANSLATION_EDITIONS[state.translation] ? translationCache[state.translation+':'+surah] : null;
  const tr = (transMap && transMap[ayah]) ? transMap[ayah] : (data ? data.tr : null);
  const text = data
    ? `${data.ar}\n${tr}\n— ${s.en} ${ayah}`
    : `${s.en} ${ayah} — WhereWePraying?`;
  Platform.copyToClipboard(text, {onSuccess:()=>showToast('Copied to clipboard'), onFail:()=>showToast('Could not copy — try selecting the text manually')});
}

function shareAyah(surah, ayah){
  const s = getSurah(surah);
  const text = `${s.en} ${ayah} — read on WhereWePraying?`;
  Platform.share({title:'WhereWePraying? — Qur\'an', text}, ()=>{
    Platform.copyToClipboard(text, {onSuccess:()=>showToast('Link copied — share it with others'), onFail:()=>showToast('Sharing is not available on this device')});
  });
}

// Fetches and renders the tafsir into a given note-wrap element. Shared
// by the manual toggle click and the auto-load IntersectionObserver
// (see initNotesAutoLoad) so both paths render identically.
async function loadNoteInto(wrap, surah, ayah){
  if(wrap.dataset.loaded) return;

  wrap.innerHTML = `<div class="ayah-note-inner">
    <div class="ayah-note-loading">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="9" stroke-opacity=".25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>
      Loading explanation…
    </div>
  </div>`;

  const paragraphs = await loadTafsir(surah, ayah);
  // Bail out quietly if this note panel was closed or removed while the
  // fetch was in flight (surah scroll, next-surah, toggled off, etc.).
  if(!document.body.contains(wrap) || !wrap.classList.contains('open')) return;

  if(paragraphs === null){
    const cacheKey = surah+':'+ayah;
    const detail = tafsirLastError[cacheKey] || '';
    const fileHint = location.protocol==='file:'
      ? `<div class="ayah-note-src" style="margin-top:8px;">This page is open as a local file — some browsers block this kind of request unless the site is hosted on a real web server (e.g. Cloudflare Pages) or a local dev server.</div>`
      : '';
    wrap.innerHTML = `<div class="ayah-note-inner">
      Couldn't load the explanatory note — check your connection.
      <button class="mini-btn" data-action="retry-note" style="margin-left:8px;width:auto;padding:0 10px;">Retry</button>
      ${detail ? `<div class="ayah-note-src" style="margin-top:8px;">Details: ${detail}</div>` : ''}
      ${fileHint}
    </div>`;
    $('[data-action="retry-note"]', wrap)?.addEventListener('click', ()=>{
      delete tafsirCache[cacheKey];
      delete tafsirLoadPromises[cacheKey];
      delete tafsirLastError[cacheKey];
      wrap.dataset.loaded = '';
      loadNoteInto(wrap, surah, ayah);
    });
    return;
  }
  if(paragraphs.length===0){
    wrap.innerHTML = `<div class="ayah-note-inner">No explanatory note available for this ayah yet.</div>`;
    wrap.dataset.loaded = '1';
    return;
  }
  wrap.innerHTML = `<div class="ayah-note-inner">
    <div class="ayah-note-label">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/></svg>
      Explanatory note
    </div>
    <div class="ayah-note-body">${paragraphs.map(p=>`<p>${p}</p>`).join('')}</div>
    <div class="ayah-note-src">Source: Tafsir Ibn Kathir (abridged)</div>
  </div>`;
  wrap.dataset.loaded = '1';
}

// Toggles the explanatory-note panel for one ayah open/closed, fetching
// the tafsir on first open only (subsequent toggles just show/hide it).
function toggleAyahNote(surah, ayah, btn){
  const wrap = $(`#note-${surah}-${ayah}`);
  if(!wrap) return;
  const willOpen = !wrap.classList.contains('open');
  wrap.classList.toggle('open', willOpen);
  btn.classList.toggle('active-state', willOpen);
  if(willOpen) loadNoteInto(wrap, surah, ayah);
}

// Auto-loads notes for every open-by-default panel as it scrolls into
// view (Explanatory Notes toggle) — one fetch per ayah, only when the
// person actually reaches it, rather than firing every request in a
// long surah at once. Called after every reader re-render.
let notesObserver = null;
function initNotesAutoLoad(){
  if(notesObserver){ notesObserver.disconnect(); notesObserver = null; }
  if(!state.showNotes) return;
  const list = $('#ayahList');
  if(!list) return;
  notesObserver = new IntersectionObserver((entries)=>{
    entries.forEach(entry=>{
      const wrap = entry.target;
      if(!entry.isIntersecting) return;
      notesObserver.unobserve(wrap);
      if(wrap.dataset.loaded) return;
      const card = wrap.closest('.ayah-card');
      if(!card) return;
      loadNoteInto(wrap, +card.dataset.surah, +card.dataset.ayah);
    });
  }, {rootMargin:'500px 0px', threshold:0.01});
  $$('.ayah-note.open', list).forEach(wrap=>{
    if(!wrap.dataset.loaded) notesObserver.observe(wrap);
  });
}

function shareSurah(){
  const s = getSurah(state.currentSurah);
  const text = `${s.en} (${s.meaning}) — read on WhereWePraying?`;
  Platform.share({title:'WhereWePraying? — Qur\'an', text}, ()=>{
    Platform.copyToClipboard(text, {onSuccess:()=>showToast('Link copied — share it with others'), onFail:()=>showToast('Sharing is not available on this device')});
  });
}

function setTheme(mode){
  state.theme = mode;
  document.body.setAttribute('data-theme', mode);
  $$('#modePills button').forEach(b=> b.classList.toggle('active', b.dataset.mode===mode));
}

function setFontSize(delta){
  state.arabicSize = Math.max(22, Math.min(44, state.arabicSize + delta));
  state.transSize = Math.max(12, Math.min(20, state.transSize + Math.round(delta*0.35)));
  document.documentElement.style.setProperty('--arabic-size', state.arabicSize+'px');
  document.documentElement.style.setProperty('--trans-size', state.transSize+'px');
  $('#fsVal').textContent = Math.round((state.arabicSize/30)*100)+'%';
}

/* ============================================================
   PAGE :: wire up events + init
   ============================================================ */
async function init(){
  document.documentElement.style.setProperty('--arabic-size', state.arabicSize+'px');
  document.documentElement.style.setProperty('--trans-size', state.transSize+'px');
  document.documentElement.style.setProperty('--arabic-font', state.arabicFont);

  // ==> CONNECT (resolved): load this device's saved reading position,
  // bookmarks and streak before the first render.
  await Services.loadFromBackend();

  Services.logHistory(state.currentSurah, state.currentAyah);
  populatePhysicalBmSurahSelect();
  renderAll();
  // Do not fetch Qur'an text while the Qur'an page is hidden. If the
  // user opened Qur'an directly, load the current surah after the shell
  // has painted; otherwise the first fetch waits until that page is opened.
  const quranPage = document.getElementById('page-quran');
  if(quranPage && !quranPage.classList.contains('hidden')){
    setTimeout(()=>ensureSurahLoaded(state.currentSurah), 0);
  }
  document.addEventListener('wwp-page-shown', function onQuranPageShown(e){
    // Fix: was {once:true}, which detached this listener after the very
    // first wwp-page-shown event of ANY page (e.g. Home, since that's
    // usually where the app lands on boot) — not specifically the first
    // time Qur'an itself was shown. That meant opening Qur'an later, after
    // visiting any other tab first, never triggered a load: the surah sat
    // on "Loading this surah…" forever until something else (like picking
    // a different ayah/surah) called ensureSurahLoaded directly. Now this
    // only detaches once it has actually fired for the Qur'an page.
    if(e.detail && e.detail.id === 'quran'){
      ensureSurahLoaded(state.currentSurah);
      document.removeEventListener('wwp-page-shown', onQuranPageShown);
    }
  });

  // Sidebar tabs (Surah / Juz / Bookmarks) — tapping the active tab
  // toggles the list open/closed; tapping a different tab switches
  // to it and expands the list.
  $$('#sidebarTabs .sidebar-tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      const wasActive = state.sidebarTab === tab.dataset.tab;
      state.sidebarTab = tab.dataset.tab;
      $$('#sidebarTabs .sidebar-tab').forEach(t=> t.classList.toggle('active', t===tab));
      renderSidebarContent();
      renderSidebarCurrentToggle();
      if(wasActive) $('#sidebar').classList.toggle('expanded');
      else $('#sidebar').classList.add('expanded');
    });
  });

  // Mobile-only: tapping the compact "currently reading" row expands
  // the full list; no effect on desktop where it's never shown.
  $('#sidebarCurrentToggle').addEventListener('click', ()=>{
    $('#sidebar').classList.toggle('expanded');
  });

  // Sidebar search — collapsed behind the search icon until tapped
  $('#sidebarSearchToggle').addEventListener('click', ()=>{
    const box = $('#sidebarSearch');
    const willOpen = !box.classList.contains('open');
    box.classList.toggle('open', willOpen);
    if(willOpen){ $('#globalSearch').focus(); $('#sidebar').classList.add('expanded'); }
    else { $('#globalSearch').value=''; renderSurahList(''); }
  });
  $('#globalSearch').addEventListener('input', e=>{
    if(state.sidebarTab!=='surah'){
      state.sidebarTab='surah';
      $$('#sidebarTabs .sidebar-tab').forEach(t=> t.classList.toggle('active', t.dataset.tab==='surah'));
    }
    renderSurahList(e.target.value);
  });

  // Surah header actions
  $('#toolbarToggle').addEventListener('click', function(){
    $('#readerToolbar').classList.toggle('closed');
    this.classList.toggle('active-state', !$('#readerToolbar').classList.contains('closed'));
  });
  $('#bookmarkBtn').addEventListener('click', ()=>{
    const pop = $('#bookmarksPopover');
    const willOpen = !pop.classList.contains('open');
    if(willOpen) renderBookmarksPopover();
    pop.classList.toggle('open', willOpen);
  });
  document.addEventListener('click', e=>{
    const pop = $('#bookmarksPopover');
    if(pop.classList.contains('open') && !pop.contains(e.target) && e.target!==$('#bookmarkBtn') && !$('#bookmarkBtn').contains(e.target)){
      pop.classList.remove('open');
    }
  });
  $('#shareBtn').addEventListener('click', shareSurah);

  // ---------- Audio player ----------
  const audioEl = $('#surahAudio');
  renderReciterPicker();
  updateAudioForSurah(); // set initial src for whatever surah loads first

  $('#reciterCurrentBtn').addEventListener('click', function(e){
    e.stopPropagation();
    const picker = $('#reciterPicker');
    const willOpen = !picker.classList.contains('open');
    picker.classList.toggle('open', willOpen);
    this.setAttribute('aria-expanded', willOpen);
  });
  document.addEventListener('click', e=>{
    const picker = $('#reciterPicker');
    if(picker.classList.contains('open') && !picker.contains(e.target)){
      picker.classList.remove('open');
      $('#reciterCurrentBtn').setAttribute('aria-expanded', 'false');
    }
  });

  // If the current mirror fails to load this ayah's clip (hotlink
  // protection, a transient CDN issue, a browser-specific block),
  // automatically retry on the next mirror before surfacing an error.
  audioEl.addEventListener('error', ()=>{
    if(!playingAyah) return; // no real source was ever set — ignore
    if(audioMirrorIndex < AUDIO_MIRRORS.length - 1){
      audioMirrorIndex += 1;
      audioEl.src = ayahAudioSrc(state.currentSurah, playingAyah, currentReciter, audioMirrorIndex);
      if(audioWantsPlay) audioEl.play().catch(()=>{});
    } else {
      showToast("Couldn't load this reciter's audio — check your connection");
    }
  });

  $('#audioPlayBtn').addEventListener('click', ()=>{
    if(!audioEl.paused){ audioEl.pause(); return; }
    if(audioReady && playingAyah){
      audioEl.play().catch(()=> showToast("Couldn't play audio — check your connection"));
    } else {
      loadAndPlayAyah(state.currentSurah, playingAyah || state.currentAyah || 1, true);
    }
  });
  audioEl.addEventListener('play', ()=> setAudioPlayingUI(true));
  audioEl.addEventListener('pause', ()=> setAudioPlayingUI(false));
  audioEl.addEventListener('ended', ()=>{
    const s = getSurah(state.currentSurah);
    if(playingAyah && playingAyah < s.ayahs){
      loadAndPlayAyah(state.currentSurah, playingAyah+1, true); // read-along: auto-advance
    } else {
      setAudioPlayingUI(false);
      audioReady = false;
      playingAyah = null;
      updateAyahAudioLabel();
      highlightPlayingAyah(state.currentSurah, null);
    }
  });
  audioEl.addEventListener('loadedmetadata', ()=>{
    $('#audioDurTime').textContent = formatAudioTime(audioEl.duration);
  });
  audioEl.addEventListener('timeupdate', ()=>{
    $('#audioCurTime').textContent = formatAudioTime(audioEl.currentTime);
    if(audioEl.duration){
      $('#audioSeek').value = (audioEl.currentTime/audioEl.duration)*100;
    }
  });
  $('#audioSeek').addEventListener('input', ()=>{
    if(audioEl.duration){
      audioEl.currentTime = (Number($('#audioSeek').value)/100)*audioEl.duration;
    }
  });
  $('#audioRestart').addEventListener('click', ()=>{
    if(playingAyah) audioEl.currentTime = 0;
  });
  $('#audioPrevAyah').addEventListener('click', ()=>{
    const target = Math.max(1, (playingAyah || state.currentAyah || 1) - 1);
    loadAndPlayAyah(state.currentSurah, target, true);
  });
  $('#audioNextAyah').addEventListener('click', ()=>{
    const s = getSurah(state.currentSurah);
    const target = Math.min(s.ayahs, (playingAyah || state.currentAyah || 1) + 1);
    loadAndPlayAyah(state.currentSurah, target, true);
  });
  $('#audioMuteBtn').addEventListener('click', function(){
    audioEl.muted = !audioEl.muted;
    this.classList.toggle('muted', audioEl.muted);
  });

  // ---------- Tools pane ----------
  $('#toolBookmarksPane').addEventListener('click', ()=> $('#bookmarkBtn').click());
  $('#toolTafsir').addEventListener('click', ()=> showToast('Tap the notes icon on any ayah to read its Tafsir Ibn Kathir explanation'));
  $('#toolWbw').addEventListener('click', ()=> showToast('Word by word is coming soon'));
  $('#toolNotes').addEventListener('click', ()=> showToast('Notes are coming soon'));
  $('#toolHighlights').addEventListener('click', ()=> showToast('Highlights are coming soon'));

  // ---------- Explore More (cross-links into Du'a & Guides) ----------
  $('#exploreDua1').addEventListener('click', ()=>{
    if(window.WWP_openDua) window.WWP_openDua('sleep','ayat-al-kursi');
  });
  $('#exploreDua2').addEventListener('click', ()=>{
    if(window.WWP_openDua) window.WWP_openDua('sleep','three-quls');
  });
  $('#exploreGuide1').addEventListener('click', ()=>{
    if(window.WWP_openGuide) window.WWP_openGuide('salah');
  });
  $('#exploreGuide2').addEventListener('click', ()=>{
    if(window.WWP_openGuide) window.WWP_openGuide('wudu');
  });

  // Toolbar (collapsed by default — see #toolbarToggle above)
  $('#arabicFontSelect').addEventListener('change', e=>{
    document.documentElement.style.setProperty('--arabic-font', e.target.value);
  });
  $('#fsMinus').addEventListener('click', ()=> setFontSize(-2));
  $('#fsPlus').addEventListener('click', ()=> setFontSize(2));
  $('#translitSwitch').addEventListener('click', function(){
    state.showTranslit = !state.showTranslit;
    this.classList.toggle('on', state.showTranslit);
    renderReader();
  });
  $('#notesSwitch').addEventListener('click', function(){
    state.showNotes = !state.showNotes;
    this.classList.toggle('on', state.showNotes);
    renderReader();
  });
  $$('#modePills button').forEach(b=> b.addEventListener('click', ()=> setTheme(b.dataset.mode)));
  $('#translationSelect').addEventListener('change', e=>{
    state.translation = e.target.value;
    Services.persist();
    renderReader();
  });

  // Per-ayah actions (bookmark/copy/share) — one delegated listener covers
  // every ayah in the continuously-scrolling surah, however many there are.
  $('#ayahList').addEventListener('click', e=>{
    const btn = e.target.closest('[data-action]');
    if(!btn) return;
    const card = e.target.closest('.ayah-card');
    if(!card) return;
    const surah = +card.dataset.surah, ayah = +card.dataset.ayah;
    if(btn.dataset.action==='bookmark') toggleAyahBookmark(surah, ayah);
    else if(btn.dataset.action==='copy') copyAyah(surah, ayah);
    else if(btn.dataset.action==='share') shareAyah(surah, ayah);
    else if(btn.dataset.action==='note') toggleAyahNote(surah, ayah, btn);
  });

  // Surah nav
  $('#prevSurahBtn').addEventListener('click', goPrevSurah);
  $('#nextSurahBtn').addEventListener('click', goNextSurah);
  $('#scrollTopBtn').addEventListener('click', scrollToTop);

  // Footer: plan
  $('#managePlanBtn').addEventListener('click', ()=>{
    $('#planEdit').classList.toggle('open');
    $('#planAmount').value = state.dailyGoal.amount;
  });
  $('#planSaveBtn').addEventListener('click', ()=>{
    const amt = Math.max(1, parseInt($('#planAmount').value)||1);
    state.dailyGoal = {amount:amt, unit:$('#planUnit').value, freq:$('#planFreq').value};
    state.todayProgress = 0;
    $('#planEdit').classList.remove('open');
    Services.persist();
    renderPlan();
    renderEstimatedCompletion();
    showToast('Reading plan updated');
  });

  // Footer: streak
  $('#viewHistoryBtn').addEventListener('click', ()=> showToast(`${state.streak.days}-day streak · full history view coming soon`));

  // Footer: continue
  $('#continueBtn').addEventListener('click', continueReading);

  // Footer: physical copy bookmark — manual, optional, separate from
  // both the app's Bookmarks list and Last Read/streak tracking.
  $('#physicalBmEditBtn').addEventListener('click', ()=>{
    const form = $('#physicalBmForm');
    const willOpen = !form.classList.contains('open');
    if(willOpen){
      const pb = state.physicalBookmark;
      $('#physicalBmSurah').value = pb ? pb.surah : state.currentSurah;
      $('#physicalBmAyah').value = pb ? pb.ayah : '';
    }
    form.classList.toggle('open', willOpen);
  });
  $('#physicalBmSaveBtn').addEventListener('click', ()=>{
    const surah = parseInt($('#physicalBmSurah').value, 10);
    const meta = getSurah(surah);
    let ayah = parseInt($('#physicalBmAyah').value, 10);
    if(!meta){ showToast('Pick a surah first'); return; }
    if(!ayah || ayah<1) ayah = 1;
    if(ayah > meta.ayahs) ayah = meta.ayahs;
    state.physicalBookmark = {surah, ayah, ts:Date.now()};
    $('#physicalBmForm').classList.remove('open');
    Services.persist();
    renderPhysicalBookmark();
    showToast('Physical copy position saved');
  });
}

function continueReading(){
  selectSurah(state.lastRead.surah, state.lastRead.ayah);
  showToast('Resumed where you left off');
}

// Exposed for cross-section navigation — e.g. the homepage's Jummah
// "Read Surah Al-Kahf today" reminder, or any other deep-link into a
// specific surah/ayah from outside this IIFE.
window.WWP_openSurah = function(surahNum, ayahNum){
  selectSurah(surahNum, ayahNum || 1);
};

init();

// Jummah-only: landing on the Qur'an tab (fresh navigation, not a
// specific bookmark/history restore) during Friday's event theme
// opens Surah Al-Kahf automatically, since it's the day's signature
// recommended reading. Only applies once per navigation — flagged by
// the router via window.__WWP_pendingJummahKahf so it doesn't fight
// a user who's mid-way through a different surah and just re-renders.
if(window.__WWP_pendingJummahKahf){
  window.__WWP_pendingJummahKahf = false;
  var __pendingAyah = window.__WWP_pendingJummahKahfAyah || 1;
  window.__WWP_pendingJummahKahfAyah = null;
  selectSurah(18, __pendingAyah);
}

})();

