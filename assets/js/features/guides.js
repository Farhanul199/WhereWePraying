/* ============================================================
   GUIDES SECTION
   ============================================================ */
(function(){
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
// showToast: shared, defined once in wwp-core.js (loads first) — no local copy needed.

const ICONS = {
  droplet:'<path d="M12 2s7 8 7 13a7 7 0 1 1-14 0c0-5 7-13 7-13Z"/>',
  pray:'<circle cx="12" cy="5" r="2.4"/><path d="M12 9v6M8 12l4-3 4 3M7 21l5-4 5 4M9 15l-3 3M15 15l3 3"/>',
  hand:'<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5M11 11V4a1.5 1.5 0 0 1 3 0v7M14 12V6a1.5 1.5 0 0 1 3 0v8"/><path d="M8 13c-1-1-3-1-3 1 0 4 3 8 8 8h1a6 6 0 0 0 6-6v-3"/>',
  shower:'<path d="M4 12a8 8 0 0 1 15.3-3.2"/><path d="M20 9h-3V6"/><path d="M8 16v2M12 16v3M16 16v2"/>',
  megaphone:'<path d="M3 11v2a2 2 0 0 0 2 2h1l3 5V9L6 9a2 2 0 0 0-2 2Z"/><path d="M9 9l10-5v16L9 15"/><path d="M19 10a3 3 0 0 1 0 4"/>',
  refresh:'<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  compass:'<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 6-6 2 2-6 6-2Z"/>',
  mosque:'<path d="M12 3c3.5 3 5 6 5 10H7c0-4 1.5-7 5-10Z"/><path d="M4 21v-6h4v6M16 21v-6h4v6"/><path d="M4 21h16"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  star:'<path d="M12 3l2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.2 1.4-6.3L3 7.6 9.4 7Z"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4V3Z"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  home:'<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  utensils:'<path d="M7 3v7a2 2 0 0 0 4 0V3"/><path d="M9 10v11"/><path d="M17 3c-2 0-3 2.5-3 5.5S15 14 17 14v7"/>'
};
function iconSvg(name, size){ size = size||14; return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name]||ICONS.star}</svg>`; }

/* ============================================================
   DATA :: original plain-English step descriptions. The overall
   sequence shown is the commonly taught one — exact order and a
   few details vary between schools of thought (madhabs), noted
   per guide where it matters.
   ==> CONNECT: replace with a scholar-reviewed content source.
   ============================================================ */
const GUIDES = [
  { id:'wudu', title:'Wudu (Ablution)', icon:'droplet', tag:'Essential', time:'5 min',
    related:['salah','tayammum','wudu-mistakes','wudu-limited-water'],
    summary:"The ritual washing performed before prayer and before handling the Qur'an. Wudu (ablution) is one of Islam's most frequent daily practices, honoring the body as a vessel for worship. Maintaining wudu throughout the day brings baraka (blessing) and mindfulness into routine.",
    note:"The sequence shown here is the commonly taught one — small details (like exact wiping order) vary between schools of thought. Ask a local teacher if you're unsure.",
    steps:[
      {title:'Make the intention (Niyyah)', body:"Silently intend in your heart to purify yourself for prayer. No specific words are required."},
      {title:'Say Bismillah', body:'Begin by mentioning the name of Allah.', arabic:'بِسْمِ اللَّهِ', translit:'Bismillah', translation:'In the name of Allah.'},
      {title:'Wash your hands', body:'Wash both hands up to the wrists three times, making sure water reaches between the fingers.'},
      {title:'Rinse your mouth and nose', body:'Rinse your mouth three times, then sniff water gently into your nose and blow it out, three times.'},
      {title:'Wash your face', body:'Wash your face three times, from the hairline to the chin, and ear to ear.'},
      {title:'Wash your arms', body:'Wash your right arm to the elbow three times, then your left arm to the elbow three times.'},
      {title:'Wipe your head and ears', body:'Wipe your head once with wet hands, front to back and back to front, then wipe the inside and outside of your ears.'},
      {title:'Wash your feet', body:'Wash your right foot to the ankle three times, then your left foot to the ankle three times.'},
      {title:'Close with the testimony', body:'Finish by reciting the shahada.', arabic:'أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ', translit:"Ashhadu an la ilaha illallah, wa ashhadu anna Muhammadan 'abduhu wa rasuluh", translation:'I bear witness that there is no god but Allah, and I bear witness that Muhammad is His servant and messenger.'}
    ],
    mistakes:[{wrong:'Washing limbs fewer than the required number of times or skipping a limb entirely', fix:'Wash each limb in the correct order at least once fully; three times is the fuller sunnah. If unsure a spot was covered, wash it again.', source:'Sahih al-Bukhari, Hadith on the description of Wudu'},{wrong:'Forgetting to wipe the ears after the head', fix:'After wiping the head, use wet fingers to wipe the inside and outside of both ears in the same motion.', source:'Sunan Abu Dawud, Hadith on wiping the ears'},{wrong:'Not letting water reach between the fingers and toes', fix:'Interlace fingers and toes briefly while washing hands and feet to ensure water reaches every gap.', source:'Jami\' at-Tirmidhi, Hadith on khilal (interlacing)'}]},

  { id:'salah', title:'Salah (How to Pray)', icon:'pray', tag:'Essential', time:'10 min',
    related:['wudu','sujoodsahw','salah-mistakes','five-prayers'],
    summary:"The core structure shared by every prayer, shown here as a simple two-rak'ah walkthrough. Salah (prayer) is the second pillar of Islam and the most direct conversation with Allah. Praying five times daily creates rhythm, discipline, and connection throughout your life, anchor points that transform ordinary moments into spiritual acts.",
    rakahInfo:[['Fajr','2'],['Dhuhr','4'],['Asr','4'],['Maghrib','3'],['Isha','4']],
    note:"For prayers with more than two rak'ahs, sit briefly for a short Tashahhud after the second rak'ah, then stand again for the rest before the final, longer Tashahhud. Hand position and a few other details vary between schools of thought.",
    steps:[
      {title:'Make the intention (Niyyah)', body:"Decide in your heart which prayer you're performing."},
      {title:'Face the Qibla and say the opening Takbir', body:'Raise your hands and say Allahu Akbar, then place your hands on your chest.', arabic:'اللَّهُ أَكْبَرُ', translit:'Allahu Akbar', translation:'Allah is the Greatest.'},
      {title:'Stand and recite (Qiyam)', body:"Recite Surah Al-Fatihah, then a short surah or a few verses of your choosing."},
      {title:'Bow (Ruku)', body:'Say Allahu Akbar and bow with your back straight and hands on your knees, repeating the tasbih three times.', arabic:'سُبْحَانَ رَبِّيَ الْعَظِيمِ', translit:"Subhana Rabbiyal 'Adheem", translation:'Glory be to my Lord, the Magnificent.'},
      {title:'Rise from Ruku', body:'Stand up straight again, saying the rising phrases.', arabic:'سَمِعَ اللَّهُ لِمَنْ حَمِدَهُ، رَبَّنَا لَكَ الْحَمْدُ', translit:'Sami Allahu liman hamidah, Rabbana lakal hamd', translation:'Allah hears whoever praises Him. Our Lord, praise be to You.'},
      {title:'Prostrate (Sujood)', body:'Say Allahu Akbar and lower into prostration — forehead, nose, palms, knees and toes touching the ground — repeating the tasbih three times.', arabic:'سُبْحَانَ رَبِّيَ الْأَعْلَى', translit:"Subhana Rabbiyal A'la", translation:'Glory be to my Lord, the Most High.'},
      {title:'Sit briefly, then prostrate again', body:'Say Allahu Akbar, sit up for a moment asking for forgiveness, then prostrate a second time, repeating the same tasbih.', arabic:'رَبِّ اغْفِرْ لِي', translit:'Rabbighfirli', translation:'My Lord, forgive me.'},
      {title:"Stand for the second rak'ah", body:'Repeat the recitation, bowing and prostration exactly as before.'},
      {title:'Sit for the Tashahhud', body:'After the final prostration, sit and recite the Tashahhud.', arabic:'التَّحِيَّاتُ لِلَّهِ وَالصَّلَوَاتُ وَالطَّيِّبَاتُ، السَّلَامُ عَلَيْكَ أَيُّهَا النَّبِيُّ وَرَحْمَةُ اللَّهِ وَبَرَكَاتُهُ، السَّلَامُ عَلَيْنَا وَعَلَىٰ عِبَادِ اللَّهِ الصَّالِحِينَ، أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا اللَّهُ وَأَشْهَدُ أَنَّ مُحَمَّدًا عَبْدُهُ وَرَسُولُهُ', translit:"At-tahiyyatu lillahi was-salawatu wat-tayyibat, as-salamu 'alayka ayyuhan-nabiyyu wa rahmatullahi wa barakatuh, as-salamu 'alayna wa 'ala 'ibadillahis-salihin, ashhadu an la ilaha illallah wa ashhadu anna Muhammadan 'abduhu wa rasuluh.", translation:"All greetings, prayers and good deeds belong to Allah. Peace be upon you, O Prophet, and the mercy of Allah and His blessings. Peace be upon us and upon the righteous servants of Allah. I bear witness that there is no god but Allah, and I bear witness that Muhammad is His servant and messenger."},
      {title:'End with the Salam', body:'Turn your head to the right and say the salam, then turn to the left and repeat it.', arabic:'السَّلَامُ عَلَيْكُمْ وَرَحْمَةُ اللَّهِ', translit:'Assalamu alaikum wa rahmatullah', translation:'Peace and the mercy of Allah be upon you.'}
    ],
    mistakes:[{wrong:'Rushing through ruku and sujood without settling', fix:'Pause briefly and settle into each position — the Prophet ﷺ told a man to repeat his prayer because he moved too quickly (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith of the poorly-praying man'},{wrong:'Praying without facing the Qibla correctly', fix:'Double-check direction using a reliable Qibla compass or app before starting, especially in unfamiliar locations.', source:'Fiqh us-Sunnah, Chapter on conditions of prayer'},{wrong:'Losing focus and thinking of unrelated matters throughout', fix:'Bring attention back gently each time it wanders; understanding the meaning of what you recite helps anchor focus (khushu).', source:'Riyad as-Salihin, Chapter on khushu in prayer'}]},

  { id:'tayammum', title:'Tayammum (Dry Ablution)', icon:'hand', tag:'When needed', time:'2 min',
    related:['wudu','wudu-limited-water','ghusl-or-wudu'],
    summary:'A substitute for Wudu using clean earth or dust, when water is unavailable or unsafe to use.',
    note:'Exactly how far up the arm to wipe varies between schools of thought — this shows the commonly taught general form.',
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend in your heart to purify yourself for prayer, in place of Wudu.'},
      {title:'Say Bismillah', body:'Begin by mentioning the name of Allah.', arabic:'بِسْمِ اللَّهِ', translit:'Bismillah', translation:'In the name of Allah.'},
      {title:'Strike the surface', body:'Gently strike both palms on clean earth, sand, or a dust-covered surface.'},
      {title:'Wipe your face', body:'Wipe your entire face once with both palms.'},
      {title:'Strike again', body:'Strike your palms on the surface a second time.'},
      {title:'Wipe your hands and arms', body:'Wipe your hands and arms, up to the wrists or further depending on your school of thought.'}
    ],
    mistakes:[{wrong:'Using tayammum when water is actually available and accessible', fix:'Tayammum is only for when water is absent, harmful to use, or too far to reasonably reach — check availability first.', source:'Qur\'an 5:6, verse on tayammum conditions'},{wrong:'Striking the ground more than once per wipe unnecessarily', fix:'One strike of clean earth or dust is sufficient for both the face and hands in the simplified method most scholars teach.', source:'Sahih al-Bukhari, Hadith on tayammum method'}]},

  { id:'ghusl', title:'Ghusl (Ritual Bath)', icon:'shower', tag:'Essential', time:'10 min',
    related:['wudu','ghusl-or-wudu','hygiene'],
    summary:'The full-body purification required after certain occasions, such as before Friday prayer or Eid. Ghusl is a complete physical and spiritual cleansing, restoring your readiness for prayer and worship. The practice intertwines bodily care with spiritual renewal, honoring both dimensions of human nature.',
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend in your heart to perform a complete purification.'},
      {title:'Say Bismillah and wash your hands', body:'Begin by mentioning the name of Allah, then wash both hands.', arabic:'بِسْمِ اللَّهِ', translit:'Bismillah', translation:'In the name of Allah.'},
      {title:'Wash away any impurity', body:'Clean any impurity from the body before continuing.'},
      {title:'Perform Wudu', body:'Perform Wudu as you would before prayer — you may leave washing your feet until the end.'},
      {title:'Pour water over your head', body:'Pour water over your head three times, making sure it reaches the roots of your hair.'},
      {title:'Pour water over your whole body', body:'Pour water over the right side of your body, then the left, making sure it covers you completely.'},
      {title:'Wash your feet', body:"Wash your feet now if you didn't already during Wudu."}
    ],
    mistakes:[{wrong:'Not ensuring water reaches the roots of the hair', fix:'Run fingers through the hair while pouring water to make sure water reaches the scalp, not just the surface.', source:'Sahih Muslim, Hadith on ghusl description'},{wrong:'Skipping the initial wudu before the full-body wash', fix:'Perform a complete wudu first, then pour water over the rest of the body — this is the sequence the Prophet ﷺ followed.', source:'Sahih al-Bukhari, Hadith on the Prophet\'s ghusl'}]},

  { id:'adhan', title:'Adhan & Iqamah', icon:'megaphone', tag:'Good to know', time:'2 min',
    related:['salah','jumuah','morning-routine'],
    summary:'The call to prayer, and the shorter call said just before the prayer begins.',
    crossLink:{label:"See the wording in Du'a & Dhikr", page:'dua'},
    steps:[
      {title:'Face the Qibla, if possible', body:'When prayer time begins, face the direction of the Qibla to give the call.'},
      {title:'Call the Adhan', body:'Recite the Adhan in a raised, clear voice — it announces that prayer time has begun and invites others to join.'},
      {title:'Call the Iqamah', body:'Just before standing to pray, say the Iqamah — a shorter, quicker version of the Adhan said right before the prayer starts.'},
      {title:'Respond if you hear someone else calling it', body:'When you hear the Adhan being called nearby, it\'s recommended to quietly repeat each phrase after the caller, then make the dua for the Prophet ﷺ once it finishes.'}
    ],
    mistakes:[{wrong:'Rushing the call to prayer without pausing between phrases', fix:'Recite each phrase clearly with a brief pause, allowing the call to be heard and understood distinctly.', source:'Sunan Abu Dawud, Hadith on the method of Adhan'},{wrong:'Treating the Adhan and Iqamah as interchangeable', fix:'The Adhan announces that prayer time has begun and may be called well before the prayer itself; the Iqamah is said moments before standing to pray and signals it\'s time to line up.', source:'Sahih al-Bukhari, Hadith distinguishing Adhan and Iqamah'}]},

  { id:'sujoodsahw', title:'Sujood as-Sahw', icon:'refresh', tag:'Good to know', time:'2 min',
    related:['salah','salah-mistakes','actions-during-prayer'],
    summary:'Two extra prostrations that correct a small, honest mistake during prayer — you never need to restart.',
    note:'Whether these go before or after the final Salam depends on the type of mistake, and differs slightly between schools of thought.',
    steps:[
      {title:'Notice the mistake', body:"If you add an extra rak'ah, miss a step, or become unsure how many rak'ahs you've prayed, there's no need to start over."},
      {title:'Prostrate twice', body:'Perform two extra prostrations, either just before or just after the final Salam.'},
      {title:'Repeat the usual tasbih', body:'Say the same phrase you say in ordinary Sujood, in each of the two prostrations.', arabic:'سُبْحَانَ رَبِّيَ الْأَعْلَى', translit:"Subhana Rabbiyal A'la", translation:'Glory be to my Lord, the Most High.'},
      {title:'Finish as normal', body:'Complete the prayer with the Salam, if you haven\u2019t already said it.'}
    ],
    mistakes:[{wrong:'Restarting the entire prayer over a minor, honest mistake', fix:"Sujood as-Sahw exists precisely so you don't have to start over — it applies to things like an extra rak'ah, a forgotten step, or uncertainty over the count, not deliberate errors.", source:"Sahih Muslim, Hadith on the Prophet's own Sujood as-Sahw"},{wrong:'Not knowing whether to prostrate before or after the Salam', fix:"As a simple default: if you added something extra, prostrate before the Salam; if you left something out, prostrate after it — schools of thought vary on the finer details.", source:'Fiqh us-Sunnah, Chapter on Sujood as-Sahw'}]},

  { id:'travel-combining', title:"Combining & Shortening Prayers While Traveling", icon:'plane', tag:'For travelers', time:'7 min',
    related:['travel','salah','qibla','finding-jamaah-away'],
    summary:"Islam eases the burden of travel through two related concessions: Qasr (shortening the four-rak'ah prayers to two) and Jam' (combining Dhuhr with Asr, or Maghrib with Isha, into one time slot). The two are separate rulings — you can shorten without combining, and in some schools of thought, combine without shortening — and the exact conditions differ noticeably between the four schools of thought.",
    note:"This guide summarizes the mainstream position of each school of thought. It is not a substitute for asking a knowledgeable local scholar about your specific journey, especially for edge cases like short layovers or unclear travel status.",
    steps:[
      {title:'Confirm you qualify as a traveler (musafir)', body:"The concessions only apply once you meet your school of thought's definition of 'travel' — both a minimum distance and, for combining specifically, genuine difficulty in praying each prayer at its own time. [Hanafi: roughly 77km / 48 miles as the minimum distance] [Shafi'i, Maliki, Hanbali: roughly 80-88km / 48-55 miles, historically described as a journey of two days by camel or foot]. You're generally considered a traveler once you leave the built-up limits of your home city or town, not merely once you leave your house."},
      {title:'Check how long you plan to stay', body:"Once you arrive and settle at your destination, the traveler concessions have a time limit before you're considered a resident again. [Hanafi: your traveler status continues for up to 15 days at the destination] [Shafi'i, Maliki, Hanbali: up to 4 days, not counting the day you arrive or the day you leave]. Staying longer than this at one location generally ends the concessions until you travel again."},
      {title:"Shorten the four-rak'ah prayers (Qasr)", body:"Dhuhr, Asr, and Isha are prayed as two rak'ahs instead of four. Fajr (already two rak'ahs) and Maghrib (three rak'ahs) are never shortened. [Hanafi: shortening is considered obligatory (wajib) for a traveler — praying four rak'ahs deliberately, without sitting for the first Tashahhud after the second, is said to invalidate the prayer] [Shafi'i, Maliki, Hanbali: shortening is a strongly emphasized Sunnah — praying the full four rak'ahs is valid but considered less complete than following the Prophet's ﷺ consistent practice while traveling]."},
      {title:"Understand the two ways to combine (Jam')", body:"Where combining applies, it can be done in one of two ways: Jam' Taqdim, praying the second prayer early, in the first prayer's time slot — for example praying Asr right after Dhuhr, both within Dhuhr's window; or Jam' Ta'khir, delaying the first prayer so it's prayed together with the second, in the second prayer's time slot — for example delaying Dhuhr until Asr time and praying both then."},
      {title:'Know your school of thought\'s position on combining', body:"This is where the schools of thought diverge most. [Shafi'i, Maliki, Hanbali: genuine combining (Jam' Haqiqi) of Dhuhr with Asr, and Maghrib with Isha, is permitted for ordinary travel, using either Taqdim or Ta'khir] [Hanafi: does not permit genuine combining for ordinary travel outside of Hajj — the two daily prayers at Arafah and Muzdalifah are treated as a specific exception. What can look like combining on an everyday journey is instead 'apparent' combining (Jam' Suri): praying the first prayer right at the very end of its own time window, then praying the second right at the very start of its own window, so each prayer technically still falls within its own time]. Fajr is never combined with any other prayer in any school of thought."},
      {title:'Consider the purpose of your journey', body:"[Shafi'i, Hanbali: the journey should be for a lawful purpose — these schools of thought withhold the traveler concessions from a journey undertaken specifically to commit sin] [Hanafi, Maliki: the concessions apply regardless of the purpose of the journey]."},
      {title:'Apply it practically on a flight or long journey', body:"In practice, many travelers combine Dhuhr and Asr before a flight departs or shortly after landing, and combine Maghrib and Isha similarly, rather than trying to pray precisely on a moving plane. Set an alarm for prayer times in your departure and arrival timezones so a short layover or overnight flight doesn't cause a prayer to be missed entirely."}
    ],
    mistakes:[{wrong:'Combining prayers as a default whenever traveling, regardless of genuine difficulty', fix:"Combining is a concession for hardship, not a routine convenience — where your school of thought permits it, use it when actually needed (during the flight, an overnight journey, or a packed itinerary), and pray on time separately when it's easy to do so.", source:"Fiqh us-Sunnah, Chapter on prayer while traveling"},{wrong:'Not knowing your own school of thought\'s distance and duration thresholds before a trip', fix:'Check the specific figures for your school of thought in advance, since they materially affect whether shortening and combining apply to a given journey.', source:'Kitab al-Fiqh ala al-Madhahib al-Arba\'ah, Chapter on the prayer of the traveler'},{wrong:'Assuming combining and shortening are the same ruling', fix:"They're separate concessions with separate conditions — a traveler may shorten without combining, and depending on the school of thought, the two don't always travel together.", source:'Fiqh us-Sunnah, Chapter on Qasr and Jam\''}]},

  { id:'qibla', title:'Facing the Qibla', icon:'compass', tag:'Good to know', time:'3 min',
    related:['salah','praying-in-car','finding-jamaah-away'],
    summary:'The direction of the Kaaba in Makkah, faced during every prayer.',
    steps:[
      {title:'Understand the Qibla', body:'The Qibla is the direction of the Kaaba in Makkah. Muslims around the world face this direction during every prayer.'},
      {title:'Find your direction', body:'Use a compass, a Qibla-finder app, or ask locally to work out the direction from where you are.'},
      {title:"If you can't be sure", body:'If you genuinely cannot determine the direction, such as while travelling, face your best estimate — your prayer is still valid.'},
      {title:'Mark it for next time', body:"Once you know your Qibla direction at home or another regular spot, a small mark or sticker saves you looking it up each time."},
      {title:'Understand congregational alignment', body:"In congregational prayer, only the Imam needs to face the exact Qibla direction — worshippers line up behind and beside them, forming rows that follow the Imam's orientation rather than each individually rechecking direction."}
    ],
    mistakes:[{wrong:'Assuming the Qibla is always due east or due south based on rough geography', fix:'The actual direction depends on great-circle distance to Makkah, which can feel counterintuitive — always check a reliable compass or app rather than guessing from a map.', source:'Fiqh us-Sunnah, Chapter on the direction of prayer'}]},

  { id:'jumuah', title:"Jumu'ah (Friday) Prayer", icon:'mosque', tag:'Weekly', time:'5 min',
    related:['mosque-etiquette','adhan','salah'],
    summary:'The congregational Friday prayer that replaces Dhuhr for those attending.',
    steps:[
      {title:'Know when it applies', body:"Jumu'ah replaces the Dhuhr prayer every Friday for adult Muslim men attending the mosque. Women may attend Jumu'ah or pray Dhuhr."},
      {title:'Prepare beforehand', body:"It's encouraged to perform Ghusl, wear clean clothes, and arrive early."},
      {title:'Listen to the Khutbah', body:'Listen attentively to the two-part sermon given by the Imam before the prayer begins.'},
      {title:'Pray in congregation', body:"Pray two rak'ahs led by the Imam, just as in a normal prayer."},
      {title:"If you can't attend", body:"If Jumu'ah isn't accessible — due to work, illness, or no mosque nearby — pray Dhuhr as usual instead; missing Jumu'ah without a valid reason is discouraged, but circumstances are taken into account."}
    ],
    mistakes:[{wrong:'Arriving after the khutbah has started and talking during it', fix:'Arrive early and remain silent once the khutbah begins — even saying \'be quiet\' to someone else during the khutbah is discouraged (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith on silence during khutbah'},{wrong:'Skipping the Sunnah prayers before or after Jumu\u2019ah', fix:'Praying voluntary rak\u2019ahs before the khutbah and after the fard prayer, when time allows, follows the Prophet\u2019s ﷺ regular practice on Fridays.', source:'Sahih Muslim, Hadith on Sunnah prayers around Jumu\u2019ah'}]},

  { id:'fasting', title:'A Simple Fasting Routine', icon:'moon', tag:'Occasional', time:'5 min',
    related:['ramadan','ramadan-fasting-guide','can-i-fast-today','breaking-fast-traveling'],
    summary:'The daily rhythm of fasting during Ramadan or a voluntary fast.',
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend to fast, ideally before dawn.'},
      {title:'Eat Suhoor', body:'Have a pre-dawn meal before the Fajr prayer begins — it\u2019s encouraged, even if light.'},
      {title:'Fast through the day', body:'Refrain from food, drink and other invalidators from dawn (Fajr) until sunset (Maghrib).'},
      {title:'Break your fast', body:'At Maghrib, break your fast promptly — traditionally with a few dates and water — saying the breaking-fast dua.'},
      {title:'Continue as normal', body:'Carry on with your prayers and daily life; extra Qur\u2019an reading and dua are especially encouraged while fasting.'},
      {title:'Know what genuinely breaks the fast', body:'Eating, drinking, and intimacy during fasting hours invalidate the fast, along with vomiting on purpose — but things like a headache, tasting food without swallowing, or an injection generally do not.'}
    ],
    mistakes:[{wrong:'Delaying the intention until after dawn', fix:'Make the intention (niyyah) for an obligatory fast before Fajr begins — even the night before is sufficient.', source:'Sunan Abu Dawud, Hadith on intention for fasting'},{wrong:'Believing minor things like an accidental sip of water break the fast', fix:'Genuinely forgetful eating or drinking does not invalidate the fast — only continue once you remember (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith on forgetfulness while fasting'}]},

  { id:'mosque-etiquette', title:'Mosque Etiquette (Adab of the Masjid)', icon:'mosque', tag:'Good to know', time:'4 min',
    summary:"The everyday manners that keep a mosque calm, clean and welcoming — from how you enter to how you leave.",
    note:"A few small details — like whether to pray Tahiyyat al-Masjid during times when voluntary prayer is normally discouraged, or how someone in a state of major ritual impurity may enter — vary between schools of thought. Ask a local imam if you're unsure.",
    steps:[
      {title:'Arrive in a state of purity', body:"Perform Wudu before you leave, if you can — arriving already purified is the recommended way to enter Allah's house. [Hanafi and Maliki: if you're in a state of major impurity and there's no water available, tayammum is enough to enter briefly.]"},
      {title:'Dress modestly and avoid strong smells', body:'Wear clean, modest clothing. The Prophet \ufdfa asked anyone who had eaten garlic or onion to stay away from the mosque until the smell had gone, so as not to disturb others.'},
      {title:'Enter with your right foot', body:'Step in right foot first, and say the dua for entering.', arabic:'\u0627\u0644\u0644\u0651\u0647\u0645\u0651 \u0627\u0641\u0652\u062a\u064e\u062d\u0652 \u0644\u064a \u0623\u064e\u0628\u0652\u0648\u064e\u0627\u0628\u064e \u0631\u064e\u062d\u0652\u0645\u064e\u062a\u0650\u0643\u064e', translit:'Allahumma-ftah li abwaba rahmatik', translation:'O Allah, open for me the doors of Your mercy.'},
      {title:"Pray two rak'ahs before you sit (Tahiyyat al-Masjid)", body:"It's recommended to greet the mosque with a short two-rak'ah prayer before sitting down, unless it's a time when voluntary prayer is discouraged. [Shafi'i and Hanbali: pray it any time you enter, citing the general hadith 'do not sit until you pray two rak'ahs.' Hanafi: skip it specifically during those discouraged times.]"},
      {title:'Keep your voice low, and silence your phone', body:'Conversation should be brief and gentle. A ringing phone or loud talking disturbs everyone around you.'},
      {title:"Don't walk in front of someone praying", body:'Pass behind them, or wait until they finish, rather than crossing directly in front.'},
      {title:'Help straighten the rows', body:'Standing shoulder to shoulder and closing gaps in the row is part of the prayer itself \u2014 a small habit that keeps the congregation orderly.'},
      {title:'Be patient and gentle with children', body:'Children are welcome in the mosque \u2014 the Prophet was famously gentle with them, even during prayer. Guide them calmly rather than treating their presence as a disruption.'},
      {title:'Keep the space clean', body:'Take any rubbish with you and leave the area as you found it.'},
      {title:'Leave with your left foot', body:'Step out left foot first, and say the dua for leaving.', arabic:'\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0651\u0647\u0650 \u0648\u064e\u0627\u0644\u0635\u0651\u064e\u0644\u0627\u0629\u064f \u0648\u064e\u0627\u0644\u0633\u0651\u064e\u0644\u0627\u0645\u064f \u0639\u064e\u0644\u064e\u0649 \u0631\u064e\u0633\u0648\u0644\u0650 \u0627\u0644\u0644\u0651\u0647\u0650\u060c \u0627\u0644\u0644\u0651\u0647\u0645\u0651 \u0625\u0650\u0646\u0651\u064a \u0623\u064e\u0633\u0652\u0623\u064e\u0644\u064f\u0643\u064e \u0645\u0650\u0646 \u0641\u064e\u0636\u0652\u0644\u0650\u0643\u064e', translit:"Bismillah, was-salatu was-salamu 'ala Rasulillah, Allahumma inni as'aluka min fadlik", translation:'In the name of Allah, and peace and blessings be upon the Messenger of Allah. O Allah, I ask You from Your favor.'}
    ],
    mistakes:[{wrong:'Walking in front of someone who is praying', fix:'Walk around or wait; passing directly in front of someone in prayer is strongly discouraged (Sahih al-Bukhari).', source:'Sahih al-Bukhari, Hadith on passing in front of a person praying'}]},

  { id:'home-etiquette', title:'Home Etiquette', icon:'home', tag:'Good to know', time:'4 min',
    summary:'The small daily habits — coming in, going out, and hosting others — that the Prophet \ufdfa taught around the home.',
    steps:[
      {title:'Say Bismillah as you enter', body:'Mentioning the name of Allah as you come home is more than a formality \u2014 the Prophet \ufdfa said it keeps the shaytan from settling in with you for the night.', arabic:'\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0647\u0650 \u0648\u064e\u0644\u064e\u062c\u0652\u0646\u0627 \u0648\u064e\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0647\u0650 \u062e\u064e\u0631\u064e\u062c\u0652\u0646\u0627 \u0648\u064e\u0639\u064e\u0644\u0649 \u0631\u064e\u0628\u0651\u0650\u0646\u0627 \u062a\u064e\u0648\u064e\u0643\u0651\u0644\u0652\u0646\u0627', translit:'Bismillahi walajna, wa bismillahi kharajna, wa \u2018ala Rabbina tawakkalna', translation:'In the Name of Allah we enter, in the Name of Allah we leave, and upon our Lord we depend.'},
      {title:'Greet those inside with Salam', body:"Even if you find no one home, it's still recommended to say the greeting \u2014 angels present in the house reply on their behalf."},
      {title:'Enter with your right foot', body:"It's customary to enter with your right foot first, the same as entering the mosque."},
      {title:'Close doors gently', body:'The Prophet \ufdfa said gentleness adorns everything it touches, and its absence leaves everything flawed (Sahih Muslim). Avoid slamming doors or letting them bang shut.'},
      {title:'Keep dhikr alive in your home', body:'Reciting Surah Al-Baqarah regularly in the house is encouraged \u2014 the Prophet \ufdfa said Satan flees a home in which it is recited (Sahih Muslim).'},
      {title:'Honor your guests, and mind your neighbors', body:'The Prophet \ufdfa said: "Whoever believes in Allah and the Last Day should serve his guest generously, should not harm his neighbor, and should speak what is good or remain silent." (Sahih al-Bukhari)'},
      {title:'Say the dua before you leave', body:'Step out with trust in Allah for whatever the day holds.', arabic:'\u0628\u0650\u0633\u0652\u0645\u0650 \u0627\u0644\u0644\u0647\u0650 \u062a\u064e\u0648\u064e\u0643\u064e\u0651\u0644\u0652\u062a\u064f \u0639\u064e\u0644\u0649 \u0627\u0644\u0644\u0647\u0650 \u0648\u064e\u0644\u0627 \u062d\u064e\u0648\u0652\u0644\u064e \u0648\u064e\u0644\u0627 \u0642\u064f\u0648\u064e\u0651\u0629\u064e \u0625\u0650\u0644\u0627\u0651 \u0628\u0650\u0627\u0644\u0644\u0647', translit:'Bismillahi, tawakkaltu \u2018alallahi, wa la hawla wa la quwwata illa billah', translation:'In the Name of Allah, I have placed my trust in Allah; there is no might and no power except by Allah.'},
      {title:'Ask for protection as you go', body:"There's a second dua the Prophet \ufdfa used to say when leaving home, asking Allah for protection from misguiding others or being misguided, and from wronging others or being wronged."}
    ],
    mistakes:[{wrong:'Forgetting to say Bismillah when entering, allowing distraction to take over', fix:'Make it a consistent habit tied to the physical act of opening the door, so it becomes automatic over time.', source:'Sahih Muslim, Hadith on entering the home'}]},

  { id:'food-etiquette', title:'Food & Eating Etiquette', icon:'utensils', tag:'Good to know', time:'4 min',
    summary:'Simple sunnah manners that turn an everyday meal into an act of gratitude.',
    steps:[
      {title:'Wash your hands before eating', body:"Washing your hands before and after a meal is recommended, and traditionally seen as part of what brings blessing to the food."},
      {title:'Sit down to eat', body:'Eating while sitting, rather than standing or walking around, is the fuller sunnah.'},
      {title:'Say Bismillah before you start', body:"If you forget and only remember partway through, say the fuller version covering the whole meal.", arabic:'\u0628\u0633\u0645\u0650 \u0627\u0644\u0644\u064e\u0651\u0647\u0650', translit:'Bismillah', translation:'In the Name of Allah.'},
      {title:'Eat and drink with your right hand', body:'The Prophet \ufdfa specifically taught this \u2014 it applies even if you\u2019re left-handed for other everyday tasks.'},
      {title:"Eat from what's nearest to you", body:'When sharing a dish with others, take from the part closest to you rather than reaching across.'},
      {title:"Don't waste, and don't overeat", body:'The Prophet \ufdfa advised filling a third of the stomach with food, a third with drink, and leaving a third for air \u2014 eating to satisfy hunger rather than to excess.'},
      {title:'Praise Allah when you finish', body:'A short dua of thanks for the meal.', arabic:'\u0627\u0644\u0652\u062d\u064e\u0645\u0652\u062f\u064f \u0644\u0644\u0647\u0650 \u0627\u0644\u064e\u0651\u0630\u064a \u0623\u064e\u0637\u0652\u0639\u064e\u0645\u064e\u0646\u064a \u0647\u0630\u0627 \u0648\u064e\u0631\u064e\u0632\u064e\u0642\u064e\u0646\u064a\u0647\u0650 \u0645\u0650\u0646\u0652 \u063a\u064e\u064a\u0652\u0631\u0650 \u062d\u064e\u0648\u0652\u0644\u064d \u0645\u0650\u0646\u0651\u064a \u0648\u064e\u0644\u0627 \u0642\u064f\u0648\u064e\u0651\u0629', translit:'Alhamdu lillahil-ladhi at\u2019amani hadha, wa razaqanihi min ghayri hawlin minni wa la quwwah', translation:'Praise be to Allah, who fed me this and provided it for me without any power or might on my part.'},
      {title:'Thank whoever fed you', body:"If someone gave you food or drink, it's recommended to make dua for them in return \u2014 a simple exchange of gratitude."}
    ],
    mistakes:[{wrong:'Eating with the left hand out of habit rather than intention', fix:'Consciously switch to the right hand for eating and drinking, even if it feels unfamiliar at first — it becomes natural with practice.', source:'Sahih Muslim, Hadith on eating with the right hand'}]},

  { id:'hygiene', title:'Personal Hygiene (Fitrah)', icon:'droplet', tag:'Good to know', time:'4 min',
    summary:'The everyday acts of cleanliness the Prophet ﷺ described as part of human nature (fitrah).',
    steps:[
      {title:'Trim your nails regularly', body:"Cutting the nails is one of the five acts of fitrah the Prophet ﷺ mentioned (Sahih Muslim). A common guideline is not to let 40 nights pass without doing so."},
      {title:'Keep underarm and pubic hair trimmed', body:'Also listed among the acts of fitrah — regular trimming is the recommended practice, again within roughly a 40-day window.'},
      {title:'Trim the moustache and let the beard grow', body:"The Prophet ﷺ instructed trimming the moustache short and leaving the beard (some schools of thought define a minimum length — a fist's length is a commonly cited measure — other schools of thought leave the exact trimming looser)."},
      {title:'Use the miswak', body:'A tooth-stick or brush used to clean the teeth, especially before prayer. The Prophet ﷺ said that were it not a hardship on his people, he would have made it obligatory before every prayer (Sahih al-Bukhari).'},
      {title:'Wash thoroughly before Jumuah', body:'A fuller wash (ghusl) before Friday prayer is strongly encouraged, alongside wearing clean clothes and using pleasant scent.'},
      {title:'Keep clean for the sake of others too', body:'Attention to breath, body odor and tidy appearance is part of respecting the people around you, especially in the mosque and in gatherings.'}
    ],
    mistakes:[{wrong:'Letting nail and hair trimming go far beyond 40 days', fix:'Set a recurring reminder every few weeks so it doesn\'t slip past the recommended window.', source:'Sahih Muslim, Hadith on the 40-night limit'}]},

  { id:'sleep', title:'Sleep Etiquette', icon:'moon', tag:'Good to know', time:'4 min',
    summary:'A short nightly routine the Prophet ﷺ followed before sleeping, and how to start the day that follows.',
    steps:[
      {title:'Make wudu before bed', body:'The Prophet ﷺ advised performing wudu as you would for prayer before lying down to sleep (Sahih al-Bukhari).'},
      {title:'Dust off your bed', body:'Shake out the bedding before lying down — a small precaution the Prophet ﷺ taught, since you never know what may have settled there while you were away (Sahih al-Bukhari).'},
      {title:'Lie on your right side', body:'The commonly taught sleeping position, following the Prophet\u2019s ﷺ own habit.'},
      {title:'Recite Ayat al-Kursi', body:'Reciting this verse (Qur\u2019an 2:255) before sleep is recommended as protection through the night.'},
      {title:'Recite the three Quls', body:'Recite Surah Al-Ikhlas, Al-Falaq and An-Nas, blow gently into your cupped hands, and wipe them over as much of your body as you can reach — a nightly habit of the Prophet ﷺ (Sahih al-Bukhari).'},
      {title:'Say the sleeping dua', body:'A short statement of trust before drifting off.', arabic:'\u0628ِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا', translit:'Bismika Allahumma amutu wa ahya', translation:'In Your name, O Allah, I die and I live.'},
      {title:'Say the waking dua', body:'The first words on opening your eyes, thanking Allah for another day.', arabic:'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ', translit:"Alhamdu lillahil-ladhi ahyana ba'da ma amatana wa ilayhin-nushur", translation:'Praise be to Allah who gave us life after having caused us to die, and to Him is the return.'}
    ]},

  { id:'family', title:'Family Etiquette', icon:'users', tag:'Good to know', time:'4 min',
    summary:'How the Prophet ﷺ taught treating parents, children and relatives — the closest circle first.',
    steps:[
      {title:'Honor your parents', body:'The Qur\u2019an pairs worshipping Allah alone with kindness to parents, going as far as forbidding even a sigh of impatience toward them in old age (Qur\u2019an 17:23\u201324).'},
      {title:'Make dua for them', body:'A short prayer asking mercy on parents, echoing the words taught in the Qur\u2019an.', arabic:'رَبِّ ارْحَمْهُمَا كَمَا رَبَّيَانِي صَغِيرًا', translit:'Rabbi irhamhuma kama rabbayani saghira', translation:'My Lord, have mercy upon them as they raised me when I was small.'},
      {title:'Maintain ties of kinship', body:"Staying in touch with relatives — visiting, calling, helping where needed — is described as something that lengthens one's provision and remembrance (Sahih al-Bukhari)."},
      {title:'Treat children with mercy', body:'The Prophet ﷺ was famously gentle and playful with children, and taught that kissing and showing affection to them is part of mercy, not indulgence.'},
      {title:'Be fair between your children', body:'Gifts and attention should be distributed evenly among children — the Prophet ﷺ refused to witness a gift given to only one child until it was made fair (Sahih al-Bukhari).'},
      {title:'Consult your family', body:'Involving a spouse or family in decisions that affect them, rather than deciding unilaterally, reflects the Qur\u2019anic principle of mutual consultation (shura).'},
      {title:'Spend generously on your household', body:'Money spent on one\u2019s family is described as among the most rewarded of all spending (Sahih Muslim).'}
    ]},

  { id:'manners', title:'Everyday Manners (Adab)', icon:'hand', tag:'Good to know', time:'4 min',
    summary:'Small social habits — greetings, speech, and the courtesies between people — drawn from the Prophet\u2019s ﷺ example.',
    steps:[
      {title:'Give salam first', body:'Initiating the greeting of peace, whether to someone you know or a stranger, is encouraged rather than waiting to be greeted.'},
      {title:'Lower your gaze', body:"A basic courtesy toward others' privacy and dignity, mentioned directly in the Qur\u2019an (24:30\u201331)."},
      {title:'Smile', body:'The Prophet ﷺ described smiling at another person as an act of charity (Jami\u2019 at-Tirmidhi).'},
      {title:'Speak well, or stay silent', body:"\"Whoever believes in Allah and the Last Day should speak what is good or remain silent\" (Sahih al-Bukhari) — a simple filter for everyday conversation."},
      {title:'Avoid backbiting and gossip', body:'The Qur\u2019an compares speaking ill of someone behind their back to eating the flesh of a dead sibling (Qur\u2019an 49:12) — a vivid warning against it.'},
      {title:'Ask permission before entering', body:"Whether it's a room, a home, or someone's personal space, asking first — and knocking or announcing yourself — is basic adab."},
      {title:'Respond to a sneeze', body:'The sneezer says Alhamdulillah; those nearby reply with a blessing, and the sneezer responds again in turn.', arabic:'يَرْحَمُكَ اللَّهُ \u2014 يَهْدِيكُمُ اللَّهُ وَيُصْلِحُ بَالَكُمْ', translit:'Yarhamuk Allah \u2014 Yahdikumullahu wa yuslihu balakum', translation:'May Allah have mercy on you \u2014 May Allah guide you and set your affairs right.'}
    ]},

  { id:'ramadan', title:'Ramadan Etiquette', icon:'moon', tag:'Good to know', time:'5 min',
    related:['fasting','ramadan-preparation','eid'],
    summary:"The rhythm of a fasting day, from before dawn to sunset, and the habits that shape the month.",
    steps:[
      {title:'Make the intention (Niyyah)', body:'Intend in your heart to fast for the sake of Allah before dawn — no specific words are required.'},
      {title:'Eat suhoor, and delay it', body:'The pre-dawn meal is encouraged, and pushing it close to the start of Fajr is the fuller sunnah — the Prophet ﷺ called it a blessed meal (Sahih al-Bukhari).'},
      {title:'Guard your tongue and behavior', body:'Fasting is more than avoiding food and drink — the Prophet ﷺ said whoever doesn\u2019t give up false speech and bad conduct, Allah has no need of them giving up their food and drink (Sahih al-Bukhari).'},
      {title:'Hasten to break the fast', body:'Break your fast as soon as the sun sets, traditionally with dates and water, rather than delaying.'},
      {title:'Say the breaking-fast dua', body:'A short statement of gratitude at iftar.', arabic:'ذَهَبَ الظَّمَأُ وَابْتَلَّتِ الْعُرُوقُ وَثَبَتَ الْأَجْرُ إِنْ شَاءَ اللَّهُ', translit:"Dhahaba adh-dhama'u wabtallatil-'uruqu wa thabatal-ajru in sha Allah", translation:'The thirst has gone, the veins are moistened, and the reward is confirmed, if Allah wills.'},
      {title:'Increase Qur\u2019an recitation and taraweeh', body:'Ramadan nights are commonly spent in extra night prayer (taraweeh) and more time with the Qur\u2019an than usual.'},
      {title:'Give charity', body:'Generosity is encouraged throughout the month, including Zakat al-Fitr — a set charity due from every Muslim before the Eid prayer.'},
      {title:'Seek Laylat al-Qadr', body:'The odd nights of the last ten days of Ramadan are when this night, described as better than a thousand months, is most likely to fall.'}
    ],
    mistakes:[{wrong:'Skipping suhoor entirely due to sleep or convenience', fix:'Even a few dates and water before dawn count as suhoor and carry real blessing — don\'t skip it for extra sleep.', source:'Sahih al-Bukhari, Hadith on the blessing of suhoor'}]},

  { id:'eid', title:'Eid Etiquette', icon:'gift', tag:'Good to know', time:'4 min',
    summary:'The small sunnahs around Eid morning — from getting ready to greeting others afterward.',
    steps:[
      {title:'Wash and wear your best clothes', body:'Ghusl and dressing well (not necessarily new clothes, just your best) is encouraged before heading out.'},
      {title:'Eat before Eid al-Fitr prayer', body:'It\u2019s sunnah to eat something, traditionally an odd number of dates, before leaving for the prayer.'},
      {title:'Delay eating for Eid al-Adha', body:"For Eid al-Adha, the opposite applies — it's recommended to wait until after the prayer, then eat from the sacrifice if one is offered."},
      {title:'Pay Zakat al-Fitr beforehand', body:'This charity is due before the Eid al-Fitr prayer, so it reaches those in need in time for the celebration.'},
      {title:'Say the Takbir on the way', body:'It\u2019s sunnah to recite the Takbir aloud on the way to the prayer ground.', arabic:'اللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ لَا إِلَٰهَ إِلَّا اللَّهُ وَاللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ وَلِلَّهِ الْحَمْدُ', translit:'Allahu akbar, Allahu akbar, la ilaha illallah, wallahu akbar, Allahu akbar, wa lillahil-hamd', translation:'Allah is the Greatest, Allah is the Greatest, there is no god but Allah, and Allah is the Greatest, Allah is the Greatest, and to Allah belongs all praise.'},
      {title:'Attend the Eid prayer', body:'Two rakahs with extra takbirs, followed by a khutbah — there is no adhan or iqamah beforehand.'},
      {title:'Take a different route home', body:'The Prophet ﷺ would return from Eid prayer by a different path than the one he took to get there (Sahih al-Bukhari).'},
      {title:'Greet others warmly', body:'A simple exchange wishing acceptance of the good deeds of the season.', arabic:'تَقَبَّلَ اللَّهُ مِنَّا وَمِنْكُمْ', translit:'Taqabbalallahu minna wa minkum', translation:'May Allah accept it from us and from you.'}
    ],
    mistakes:[{wrong:'Forgetting to pay Zakat al-Fitr before the Eid al-Fitr prayer', fix:'Set this aside a few days in advance so it\'s ready before you leave for prayer — paying it after invalidates the intended timing.', source:'Sunan Abu Dawud, Hadith on the timing of Zakat al-Fitr'}]},

  { id:'travel', title:'Travel Etiquette', icon:'plane', tag:'Good to know', time:'5 min',
    related:['travel-combining','finding-jamaah-away','breaking-fast-traveling','praying-in-car'],
    summary:'How the Prophet ﷺ prepared for journeys, and the concessions Islam gives travelers along the way.',
    steps:[
      {title:'Say the traveler\u2019s dua', body:'Recited on setting off, once you\u2019re seated or underway.', arabic:'سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَٰذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ وَإِنَّا إِلَىٰ رَبِّنَا لَمُنقَلِبُونَ', translit:'Subhanal-ladhi sakhkhara lana hadha wa ma kunna lahu muqrinin, wa inna ila Rabbina lamunqalibun', translation:'Glory be to Him who has subjected this to us, and we could never have accomplished it by ourselves. And indeed, to our Lord we will return.'},
      {title:'Shorten your prayers (Qasr)', body:'The four-rakah prayers (Dhuhr, Asr, Isha) are shortened to two while traveling (some schools of thought set a minimum distance and duration for this to apply, other schools of thought are more lenient) — check which applies to you.'},
      {title:'Combine prayers (Jama\u2019) when needed', body:"Dhuhr with Asr, and Maghrib with Isha, can be combined at one of their times if travel makes performing them separately difficult (the exact conditions for when this is permitted vary between schools of thought)."},
      {title:'Keep up your daily dhikr', body:'The remembrances for morning, evening, and entering a new place don\u2019t pause for travel — if anything, they\u2019re emphasized more.'},
      {title:'Seek out the local mosque', body:'Finding where and when Jama\u2019ah is held at your destination keeps you connected to prayer in community, even away from home.'},
      {title:'Make up missed Ramadan fasts', body:'If travel falls during Ramadan, fasting is not obligatory for the journey — those days are made up later, at a more convenient time.'},
      {title:'Say the dua on returning', body:'A fuller version of the traveler\u2019s dua, said on the way back, closing with words of repentance and praise.', arabic:'آيِبُونَ تَائِبُونَ عَابِدُونَ لِرَبِّنَا حَامِدُونَ', translit:"Ayibuna ta'ibuna 'abidun li Rabbina hamidun", translation:'We return, repentant, worshipping, and praising our Lord.'}
    ],
    mistakes:[{wrong:'Not knowing the distance threshold for shortening prayers', fix:'Check your school of thought\'s specific distance guideline in advance, or use a reliable app that calculates it for your location.', source:'Fiqh us-Sunnah, Chapter on prayer while traveling'}]},

  { id:'finance', title:'Wealth & Finance Etiquette', icon:'scale', tag:'Good to know', time:'4 min',
    summary:'How Islam frames earning, spending, and giving — the everyday principles behind money.',
    steps:[
      {title:'Earn from halal sources', body:'Income should come from permissible work, avoiding riba (interest-based transactions) and other forbidden dealings.'},
      {title:'Pay Zakat on eligible wealth', body:'A yearly obligation on savings and wealth above a set threshold (nisab), commonly calculated at 2.5% (some schools of thought base the nisab on the value of gold, other schools of thought use silver, which gives a lower threshold).'},
      {title:'Give sadaqah regularly', body:'Voluntary charity, even in small and consistent amounts, is encouraged well beyond the obligatory Zakat.'},
      {title:'Deal honestly in business', body:'Giving full measure and weight, and not concealing faults in what you sell, is a repeated Qur\u2019anic theme (Qur\u2019an 83:1\u20133).'},
      {title:'Pay debts without delay', body:'The Prophet ﷺ described delaying repayment when able to pay as a form of injustice (Sahih al-Bukhari).'},
      {title:'Balance spending', body:'Neither extravagance nor stinginess — the Qur\u2019an describes the balanced middle path between the two (Qur\u2019an 25:67).'},
      {title:'Spend on family before others', body:'Providing for your own household comes first, and is itself counted as charity when done with the right intention.'}
    ],
    mistakes:[{wrong:'Calculating Zakat incorrectly by including non-zakatable assets', fix:'Only wealth held for a full lunar year above the nisab threshold is zakatable — consult a knowledgeable source for your specific assets.', source:'Fiqh us-Sunnah, Chapter on Zakat calculation'}]},

  { id:'quran-etiquette', title:'Qur\u2019an Etiquette', icon:'book', tag:'Good to know', time:'4 min',
    summary:'How to approach, handle, and recite the Qur\u2019an with the respect it\u2019s given in the tradition.',
    steps:[
      {title:'Consider wudu before touching the mushaf', body:"Purity before touching the physical Qur'an is the majority position, based on Qur'an 56:79 (some schools of thought treat this as obligatory, other schools of thought as recommended) — reciting from memory or reading a translation doesn't require wudu."},
      {title:'Begin with the Isti\u2018adhah and Basmalah', body:'Seek refuge from Satan, then begin in the name of Allah, before starting recitation.', arabic:'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ', translit:"A'udhu billahi minash-shaytanir-rajim, Bismillahir-Rahmanir-Rahim", translation:'I seek refuge in Allah from Satan, the accursed. In the name of Allah, the Most Compassionate, the Most Merciful.'},
      {title:'Recite with tarteel', body:'Unhurried, clear recitation rather than rushing through — the Qur\u2019an itself instructs reciting it slowly and distinctly (Qur\u2019an 73:4).'},
      {title:'Reflect as you recite', body:'Pausing to think about the meaning (tadabbur), rather than treating recitation as a pace to get through, is encouraged throughout the tradition.'},
      {title:'Prostrate at verses of sajdah', body:'Certain verses call for a single prostration when recited or heard — a brief pause built into the reading.'},
      {title:'Handle the mushaf with care', body:"Keep it off the floor, store it somewhere elevated and clean, and avoid placing other items on top of it."},
      {title:'Listen quietly when it\u2019s recited', body:"\"When the Qur'an is recited, listen to it and pay attention\" (Qur'an 7:204) — a simple instruction for gatherings where it's being read aloud."}
    ],
    mistakes:[{wrong:'Reciting too fast to actually reflect on the meaning', fix:'Slow down deliberately, even if it means reading less — tarteel (unhurried recitation) is explicitly commanded in the Qur\'an (73:4).', source:'Qur\'an 73:4, verse on reciting the Qur\'an slowly'}]},

  { id:'life-events', title:'Life Events Etiquette', icon:'heart', tag:'Good to know', time:'5 min',
    summary:'The sunnahs marking birth, marriage, and death \u2014 the milestones a family moves through together.',
    steps:[
      {title:'Announce a birth with the adhan', body:"It's commonly practiced to say the call to prayer softly into a newborn's right ear shortly after birth (some scholars have questioned the strength of the specific hadith for this, while noting it remains a long-held and widespread practice)."},
      {title:'Choose a good name', body:'Naming the child, ideally within the first week, with a name that carries a good meaning is emphasized in the tradition.'},
      {title:'Perform the Aqiqah', body:'A sacrifice offered in gratitude for a child \u2014 traditionally two animals for a boy and one for a girl (some schools of thought treat this as strongly recommended, other schools of thought, such as the Hanafi school, treat it as optional rather than emphasized).'},
      {title:'Shave the baby\u2019s head', body:'Traditionally done on the seventh day, with the equivalent weight of the hair in silver given as charity.'},
      {title:'Announce a marriage publicly', body:'A nikah is encouraged to be announced openly rather than kept quiet, often marked with a walima (wedding feast).'},
      {title:'Give the mahr', body:'A mandatory gift from the groom to the bride as part of the marriage contract, amount agreed between them.'},
      {title:'Face the dying toward Qibla', body:'Where possible, a dying person is turned to face the Qibla, and those present gently remind them of the shahada.'},
      {title:'Perform ghusl, kafan, and Janazah prayer', body:'The deceased is washed, wrapped in a simple shroud, and prayed over collectively by the community before burial, which is typically not delayed.'}
    ]},

  { id:'morning-routine', title:'Morning Routine', icon:'sun', tag:'Daily', time:'3 min',
    related:['evening-routine','salah','gratitude'],
    summary:'Starting the day with intention — small habits that set the tone before anything else.',
    steps:[
      {title:'Wake with gratitude', body:'The moment you open your eyes, say the waking dua thanking Allah for another day.', arabic:'الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا وَإِلَيْهِ النُّشُورُ', translit:"Alhamdu lillahil-ladhi ahyana ba'da ma amatana wa ilayhin-nushur", translation:'Praise be to Allah who gave us life after having caused us to die, and to Him is the return.'},
      {title:'Use the siwak or brush your teeth', body:'Cleaning the mouth is encouraged first thing, before even drinking water or eating.'},
      {title:'Make wudu', body:'Start fresh with ablution, even before the morning prayer (Fajr), to be in a state of purity.'},
      {title:'Pray Fajr in congregation if possible', body:'The first prayer of the day, ideally prayed with others in the mosque.'},
      {title:'Read or listen to Qur\'an', body:'Spending time with the Qur\'an early settles the heart and anchors the day in remembrance.'},
      {title:'Make morning dhikr', body:'Short remembrances of Allah — tasbihat and tahlil — traditionally said after Fajr prayer before sunrise.'},
      {title:'Eat a light breakfast with intention', body:"Even a simple meal counts as worship when begun with Bismillah — the Prophet ﷺ encouraged not skipping breakfast where possible, as strength for the day's tasks."}
    ],
    mistakes:[{wrong:'Going back to sleep right after Fajr and missing the blessed early morning', fix:'The time between Fajr and sunrise is considered especially blessed for dhikr and productivity — try staying awake even briefly before resuming sleep if needed.', source:'Jami\' at-Tirmidhi, Hadith on the blessing of the early morning'}]},

  { id:'evening-routine', title:'Evening Routine', icon:'moon', tag:'Daily', time:'3 min',
    related:['morning-routine','sleep','family'],
    summary:'Winding down with reflection and intention — habits that close the day well.',
    steps:[
      {title:'Attend Maghrib prayer', body:'The sunset prayer, traditionally at the time the sun fully disappears — a natural marker for the evening.'},
      {title:'Review your day', body:'Quietly reflect on what went well and what could have been better, asking Allah for forgiveness and improvement.'},
      {title:'Make evening dhikr', body:'Tasbihat and remembrance said after Maghrib or Isha prayer, honoring the transition into night.'},
      {title:'Spend time with family', body:'The evening is traditionally a time to be present with those at home, sharing a meal or conversation.'},
      {title:'Read before bed', body:'Whether Qur\'an, Islamic knowledge, or something uplifting — settling the mind before sleep.'},
      {title:'Make wudu and say the night duas', body:'Final preparations: ablution, recitation of protective verses and the sleeping dua, before resting.'},
      {title:'Set tomorrow\'s intention before sleeping', body:'Briefly decide what you want to accomplish or improve the next day — a small habit that carries the day\'s momentum into the next.'}
    ],
    mistakes:[{wrong:'Skipping the night duas and protective verses out of tiredness', fix:'These take only a minute or two and were a consistent part of the Prophet\u2019s ﷺ nightly routine — try saying them even briefly before sleep overtakes you.', source:'Sahih al-Bukhari, Hadith on the Prophet\u2019s nightly recitations'}]},

  { id:'work-etiquette', title:'Work & Workplace Etiquette', icon:'hand', tag:'Daily', time:'4 min',
    summary:'How to carry Islamic values into your job — integrity, fairness, and good character with colleagues.',
    steps:[
      {title:'Do your work with excellence', body:'The Prophet ﷺ said Allah loves when any of you does a job that you do it excellently (Sunan Ibn Majah). This applies to whatever work you do.'},
      {title:'Be punctual', body:'Arriving on time and meeting deadlines is part of honoring agreements and respecting others\' time.'},
      {title:'Treat colleagues fairly', body:"Avoiding favoritism and dealing justly with everyone around you, regardless of rank or friendship — the Qur'an repeatedly emphasizes this (Qur'an 4:58)."},
      {title:'Honor confidentiality', body:"Don't spread workplace secrets or gossip, even in casual conversation. This is part of trustworthiness (amanah)."},
      {title:'Ask permission before leaving', body:'If your workplace has norms around breaks or leaving early, respect them — part of honoring the agreement with your employer.'},
      {title:'Say bismillah before eating at your desk', body:'If you eat during work, beginning with the name of Allah is a simple grounding moment, even in a busy environment.'},
      {title:'Guard your tongue', body:"Avoid complaints, backbiting, or spreading negativity — the Prophet ﷺ said whoever guards their tongue and their eyes, I guarantee them Paradise (Jami' at-Tirmidhi)."}
    ]},

  { id:'neighbors', title:'Neighbor Etiquette', icon:'home', tag:'Daily', time:'3 min',
    summary:'The people next door deserve some of your best character — simple ways to be a good neighbor.',
    steps:[
      {title:'Greet them warmly', body:'A simple hello or nod when you pass by sets a tone of peace and openness.'},
      {title:'Mind your noise', body:'Keeping sounds at reasonable levels, especially late at night, is basic respect for their rest and quiet.'},
      {title:'Keep your space neat', body:'A tidy yard, clean entrance, and orderly common areas shows you care about the shared surroundings.'},
      {title:'Help when you see need', body:'If a neighbor is moving, ill, or struggling with something, offering a hand is part of the faith — even small gestures matter.'},
      {title:"Don't pry or spy", body:'Avoiding looking into their windows or asking intrusive questions is part of respecting privacy and dignity (Qur\'an 24:27).'},
      {title:'Return borrowed items promptly', body:'If you borrow something, return it in good condition and within a reasonable time without being reminded.'},
      {title:'Bring them a small gift', body:'The Prophet ﷺ said the best charity is when your neighbor eats what you eat (Sunan Ibn Majah) — sharing food or small gifts builds bonds.'}
    ]},

  { id:'patience-hardship', title:'Patience During Hardship (Sabr)', icon:'shield', tag:'Spiritual', time:'4 min',
    summary:'How Islam frames difficulty — patience is not passivity, but an active trust in Allah through trials.',
    steps:[
      {title:'Recognize hardship as a test', body:'The Qur\'an says with hardship comes ease (Qur\'an 94:5) — trials are opportunities for growth, not punishments (unless one truly transgresses).'},
      {title:'Make dua immediately', body:'When something difficult happens, turning to Allah in supplication is the first response — asking for help, relief, and wisdom.'},
      {title:'Accept what you cannot control', body:'Some things are beyond your power. Accepting that and focusing energy on what you can influence is the essence of sabr.'},
      {title:'Seek counsel', body:'Talk to someone wise — a scholar, elder, or trusted friend — to gain perspective and explore options, rather than suffering in silence.'},
      {title:'Maintain your prayers and remembrance', body:'When times are hard, staying consistent with salah and dhikr actually steadies the heart more than ever (Qur\'an 2:45).'},
      {title:'Help others in their hardship', body:'Showing compassion to someone else in difficulty, even while struggling yourself, shifts your focus and builds resilience.'},
      {title:'Trust the outcome to Allah', body:'Sabr means doing what you can, then truly trusting Allah with the result — no anxiety over what is beyond your reach.'}
    ]},

  { id:'anger-management', title:'Managing Anger (Hilm)', icon:'hand', tag:'Spiritual', time:'4 min',
    summary:'Islam teaches gentleness and restraint — how to handle anger before it handles you.',
    steps:[
      {title:'Recognize anger arising', body:'The first step is noticing it without acting on impulse — a moment of awareness before the emotion takes over.'},
      {title:'Change your physical state', body:'The Prophet ﷺ gave practical advice: if you\'re standing, sit down; if sitting, lie down. Movement interrupts the anger cycle (Sunan Abu Dawud).'},
      {title:'Make wudu', body:'Washing with water is calming and resets the nervous system — the Prophet ﷺ connected it to managing anger.'},
      {title:'Stay silent', body:'Not speaking while angry protects you from saying things you\'ll regret. Silence is often the wisest response (Jami\' at-Tirmidhi).'},
      {title:'Seek refuge from Satan', body:'Say "I seek refuge in Allah from Satan the accursed" (A\'udhu billahi minash-shaytanir-rajim) — anger is often his whisper.', arabic:'أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ', translit:'A\'udhu billahi minash-shaytanir-rajim', translation:'I seek refuge in Allah from Satan, the accursed.'},
      {title:'Breathe deeply and make dhikr', body:'Slow breathing and remembrance of Allah calm the nervous system and bring clarity back.'},
      {title:'Apologize if you\'ve wronged', body:'If your anger led you to hurt someone, apologizing and making amends is essential — humility is strength in Islam.'}
    ]},

  { id:'gratitude', title:'Gratitude (Shukr)', icon:'star', tag:'Spiritual', time:'4 min',
    summary:'Recognizing blessings big and small — gratitude reshapes how you see the whole of life.',
    steps:[
      {title:'Notice small blessings', body:'A warm cup of tea, a good conversation, arriving safely — the practice starts with noticing what\'s already there.'},
      {title:'Say Alhamdulillah often', body:'Throughout the day, when good things happen or even when difficulty passes, praise Allah aloud. It trains the heart toward gratitude.'},
      {title:'Use blessings well', body:'Gratitude isn\'t just words — it\'s shown through using what Allah gave you responsibly and not wasting it (Qur\'an 7:10).'},
      {title:'Share what you have', body:'Giving sadaqah and sharing blessings with others is a form of gratitude — acknowledging that what you have came from Allah (Qur\'an 2:272).'},
      {title:'Thank those who help you', body:'Making dua for people who do you good, and expressing appreciation to them, mirrors gratitude to Allah.'},
      {title:'Reflect on what could have been worse', body:'In difficulty, remember that it could have been much harder — this perspective itself is a form of shukr.'},
      {title:'Make the gratitude dua', body:'Especially after a meal or blessing, a simple statement thanking Allah and asking for more.', arabic:'الْحَمْدُ لِلَّهِ حَمْدًا كَثِيرًا طَيِّبًا مُبَارَكًا فِيهِ', translit:'Alhamdu lillahi hamdan kathiran tayyiban mubarakan fih', translation:'Praise be to Allah — a plentiful, pure, and blessed praise.'}
    ]},

  { id:'intention', title:'Setting Intention (Niyyah)', icon:'star', tag:'Spiritual', time:'4 min',
    summary:'Islam is built on intention — how to align what you do with why you do it.',
    steps:[
      {title:'Understand that deeds are by intention', body:'The Prophet ﷺ opened his teaching with this principle: every act is judged by its intention (Sahih al-Bukhari). The outcome matters less than why you acted.'},
      {title:'Make your intention clear to yourself', body:'Before a big action or even a daily task, pause and clarify in your heart: why am I doing this? Is it for Allah or for something else?'},
      {title:'Purify your intention', body:'If you catch yourself doing something partly for show or partly for the wrong reason, pause and reset — ask Allah to purify your intention.'},
      {title:'Distinguish between niyyah and nafs', body:'The nafs (ego) whispers selfish reasons; niyyah is the conscious commitment to do something for Allah. Both can be present — work to let niyyah win.'},
      {title:'Make the same act count twice', body:"When you intend something for Allah's sake, a single act — helping a friend, earning money, going to work — becomes worship, not just routine."},
      {title:'Renew intentions regularly', body:'Intentions drift over time. Regularly asking yourself "Why am I still doing this?" keeps actions aligned with what matters.'},
      {title:'Know that Allah sees your intention', body:'Even if no one else knows why you acted, Allah knows your heart. This is both comfort (He rewards what no one sees) and accountability (He sees everything).'}
    ]},

  { id:'seeking-knowledge', title:'Seeking Knowledge (Talab al-Ilm)', icon:'book', tag:'Spiritual', time:'4 min',
    summary:'Islam places learning at the center — the first revelation commanded "Read." How to approach seeking knowledge.',
    steps:[
      {title:'Start with sincere intention', body:'Before learning anything, clarify that you\'re seeking knowledge for Allah\'s sake, to draw closer to Him and serve His creation better.'},
      {title:'Respect the teacher', body:'The tradition emphasizes respect for those who teach you — honor their time and wisdom, even if you don\'t agree on everything (some differences are legitimate).'},
      {title:'Seek authenticated sources', body:'Don\'t accept claims at face value, even from popular teachers. Verify against the Qur\'an, hadith collections like Sahih al-Bukhari, and scholarly consensus (ijmaa\').'},
      {title:'Learn foundational matters first', body:'Build upward: start with core beliefs, then fiqh essentials, then deeper specializations. Rushing to advanced topics without foundations leads to misunderstanding.'},
      {title:'Apply what you learn', body:'Knowledge that doesn\'t change how you act or think isn\'t really knowledge — the Prophet ﷺ said the most learned of people are those who fear Allah most (Sunan Ibn Majah).'},
      {title:'Teach others', body:'Teaching what you\'ve learned deepens it and spreads benefit. The Prophet ﷺ said the best of you are those who learn the Qur\'an and teach it (Sahih al-Bukhari).'},
      {title:'Continue learning your whole life', body:'The Prophet ﷺ said to seek knowledge from the cradle to the grave. No age is too late to start; no amount is ever complete.'}
    ]},

  { id:'dealing-with-loss', title:'Dealing with Loss & Grief', icon:'heart', tag:'Spiritual', time:'4 min',
    summary:'Islam acknowledges loss deeply and teaches a path through grief — not around it, but through it with Allah.',
    steps:[
      {title:'Allow yourself to grieve', body:'The Prophet ﷺ wept at the deaths of loved ones, showing that sadness is natural and human, not a lack of faith (Sahih Muslim).'},
      {title:'Say Inna lillahi wa inna ilayhi raji\'un', body:'Reciting this verse from the Qur\'an (2:156) centers you in the truth that all things belong to Allah and return to Him.', arabic:'إِنَّا لِلَّهِ وَإِنَّا إِلَيْهِ رَاجِعُونَ', translit:'Inna lillahi wa inna ilayhi raji\'un', translation:'Indeed we belong to Allah, and indeed to Him we will return.'},
      {title:'Make dua for those who have passed', body:'Asking Allah\'s mercy for the deceased is ongoing — a connection that persists through prayer.'},
      {title:'Share the grief with others', body:'Isolation in grief deepens it. Tell your story, cry with others, and allow support from your community.'},
      {title:'Remember them well', body:'Speak kindly of those who have died, recall their good qualities, and live out the values they taught you.'},
      {title:'Take care of dependents left behind', body:'If someone dies and leaves family, caring for them is a continuation of that person\'s legacy and a duty in Islam.'},
      {title:'Trust Allah\'s wisdom', body:'Grief is real, but beneath it is the belief that Allah\'s decision is just, even when we don\'t understand it now. Time and faith gradually reveal the wisdom.'}
    ]},


  { id:'five-prayers', title:'The Five Daily Prayers (Salah)', icon:'pray', tag:'Essential', time:'8 min',
    related:['salah','adhan','qibla'],
    summary:'A quick reference to the names, times, and number of rakahs for each obligatory prayer.',
    steps:[
      {title:'Fajr — Dawn prayer', body:'Two rakahs, performed after the first light of dawn and before sunrise. The community is encouraged to attend; many mosques hold Fajr in congregation daily.'},
      {title:'Dhuhr — Noon prayer', body:'Four rakahs, performed after the sun has passed its zenith and begins descending. The full name refers to the sun\u2019s decline toward afternoon.'},
      {title:'Asr — Afternoon prayer', body:'Four rakahs, performed when shadows lengthen in the afternoon. It falls between Dhuhr and Maghrib, and is listed in hadith as one of the most rewarded prayers when prayed in congregation.'},
      {title:'Maghrib — Sunset prayer', body:'Three rakahs, performed immediately after sunset. The time window for Maghrib is shorter than the others, typically lasting about 20 minutes.'},
      {title:'Isha — Night prayer', body:'Four rakahs, performed after the sun has completely set and darkness falls. The end time extends until just before dawn, but it is recommended to pray it earlier rather than later in the night.'},
      {title:'Make the intention for each', body:'Before each prayer, decide in your heart which prayer you are performing — no specific words are needed, just a clear intent (niyyah).'},
      {title:'Find the prayer times for your location', body:'Use the Al Adhan app or website, which calculates accurate times based on Islamic methods. Times vary slightly by location, season, and calculation method used.'}
    ]},

  { id:'wudu-mistakes', title:'Common Wudu Mistakes', icon:'droplet', tag:'Good to know', time:'4 min',
    summary:'Pitfalls to avoid when performing ablution — things that invalidate wudu or weaken it.',
    steps:[
      {title:'Not making the intention', body:'Even silently, there must be an intention to purify yourself for prayer. Simply washing without intent does not count as wudu.'},
      {title:'Washing too quickly', body:'Rushing through the motions defeats the purpose. Each limb should be washed at least once, but many schools of thought consider three washings more complete (some schools of thought consider this mandatory, other schools of thought recommend it).'},
      {title:'Leaving a dry spot', body:'Even a small area of the face, arms, or feet left unwashed means wudu is incomplete and invalidates the ablution for prayer.'},
      {title:'Using water that is not pure', body:'The water itself must be ritually pure — not contaminated or questionable in condition.'},
      {title:'Talking excessively while making wudu', body:'While silence is not mandatory, the spiritual focus can be lost with idle chatter. The Prophet ﷺ emphasized mindfulness during ablution.'},
      {title:'Wasting water', body:'The Prophet ﷺ taught moderation — even doing wudu by a river, never use excessive water beyond what cleanses.'},
      {title:'Touching private parts afterward', body:'After completing wudu, touching private parts without a barrier (like clothing) breaks wudu — one of the most commonly overlooked invalidators.'}
    ]},

  { id:'salah-mistakes', title:'Common Prayer Mistakes', icon:'pray', tag:'Good to know', time:'4 min',
    summary:'Errors in salah that weaken it or invalidate it — posture, timing, and focus.',
    steps:[
      {title:'Not facing the Qibla', body:'The direction must be toward the Kaaba in Mecca. Ignorance of direction is forgivable, but deliberately praying away from it invalidates the prayer (most schools of thought permit small angles off-direction for those genuinely confused).'},
      {title:'Rushing through the prayer', body:'Each movement should be unhurried and deliberate. The Prophet ﷺ criticized those who "pecked" their prayers like birds — quick, shallow movements without substance.'},
      {title:'Not completing a full ruku or sujood', body:'The bowing and prostration must be full and clear — bent low enough that it is visibly different from standing or sitting.'},
      {title:'Talking or laughing during prayer', body:'These invalidate the prayer entirely (some schools of thought permit necessary speech in emergencies, other schools of thought maintain strict silence rules).'},
      {title:'Praying with distracting thoughts or wandering mind', body:'While total focus is ideal, some distraction is human. However, deliberately allowing gross inattention weakens the salah (the exact threshold varies by school of thought).'},
      {title:'Praying in impure clothes or place', body:'The garment and ground should be clean. Uncertainty about impurity does not require repetition, but knowingly praying in filth invalidates it.'},
      {title:'Missing the congregation without reason', body:'While not invalidating the prayer itself, missing Jama\u2019ah without excuse is discouraged — the collective prayer carries greater reward.'}
    ]},

  { id:'ramadan-preparation', title:'Preparing for Ramadan', icon:'moon', tag:'Seasonal', time:'4 min',
    summary:'A month before Ramadan: physical, spiritual, and practical steps to enter the month ready.',
    steps:[
      {title:'Review your intention', body:'Clarify why you fast — is it out of habit, cultural practice, or genuine seeking of closeness to Allah? A clear niyyah transforms the month.'},
      {title:'Read about the month ahead', body:'Understanding what Ramadan is — a month of mercy, forgiveness, and Qur\u2019an — helps prepare your mindset.'},
      {title:'Gradually adjust your eating schedule', body:'If you typically eat breakfast, start eating it slightly later; if you eat late at night, shift backward. This eases the transition into fasting.'},
      {title:'Practice shorter fasts', body:'A few days before Ramadan, fast for part of a day to reacquaint your body with hunger and thirst.'},
      {title:'Plan your Qur\u2019an reading', body:'Decide how much you want to recite — a juz a day (one-thirtieth) completes the Qur\u2019an by month\u2019s end, or adjust to your pace.'},
      {title:'Arrange your work and social schedule', body:'Alert your employer if you need adjustment to prayer times; plan meal times with family; reduce non-essential commitments if possible.'},
      {title:'Settle debts and grudges', body:'Entering the month with a clear heart — forgiving those who wronged you, apologizing for your own wrongs — opens the door to receiving mercy.'}
    ]},

  { id:'ramadan-fasting-guide', title:'Ramadan Fasting: A Day-by-Day Guide', icon:'moon', tag:'Seasonal', time:'6 min',
    summary:'What a fasting day looks like — from suhoor to iftar to taraweeh — hour by hour.',
    steps:[
      {title:'Before dawn: Suhoor (pre-dawn meal)', body:'Eat a light but sustaining meal, preferably dates, and drink water. The Prophet ﷺ said suhoor is a blessed meal because it is timed just before fasting (Sahih al-Bukhari). Some schools of thought require eating suhoor, other schools of thought treat it as highly recommended.'},
      {title:'At dawn: Make your intention', body:'Before Fajr begins, intend in your heart to fast. If you intend after Fajr begins, that day does not count as a full fast.'},
      {title:'During the day: Avoid food, drink, and relations', body:'From the first light of dawn until sunset, abstain from eating, drinking, and marital relations. The fast is not merely physical — it is spiritual guard against anger, backbiting, and idle talk.'},
      {title:'Mid-morning: Recite Qur\u2019an and make dua', body:'Use the extra time from not preparing or eating meals to spend with the Qur\u2019an. Any duas made during fasting are said to be answered readily (Jami\u2019 at-Tirmidhi).'},
      {title:'Afternoon: Rest if able', body:'A short nap after Dhuhr prayer conserves energy. Many working adults find this difficult but aim for even 15 minutes of rest.'},
      {title:'At sunset: Break the fast (Iftar)', body:'Do not delay — break your fast immediately when the sun sets. The Prophet ﷺ emphasized haste in this. Traditionally dates and water are the first items eaten, mirroring his own practice.'},
      {title:'After Maghrib: Light meal and prayer', body:'After breaking the fast, eat a moderate meal (not excessive), then head to the mosque for Maghrib prayer.'},
      {title:'Evening: Taraweeh (night prayer)', body:'The special nightly prayer unique to Ramadan, typically 8 to 20 rakahs depending on mosque and school of thought. This is an optional but widely kept tradition.'},
      {title:'Late night: Recite Qur\u2019an and sleep', body:'Spend time with the Qur\u2019an, make duas, and rest well. The goal is balance — full participation without exhaustion.'}
    ]},

  { id:'laylat-qadr', title:'Laylat al-Qadr (Night of Power)', icon:'star', tag:'Seasonal', time:'4 min',
    summary:'The holiest night of the year — when to seek it, how to spend it, and its significance.',
    steps:[
      {title:'Understand its significance', body:'The Qur\u2019an was first revealed on this night, and the Qur\u2019an itself states that worship on this night is worth more than a thousand months (Qur\u2019an 97:3). It is the night most Muslims wait for during Ramadan.'},
      {title:'Know when to seek it', body:'The exact date is unknown by divine wisdom, but it falls in the last ten nights of Ramadan. Most scholars believe it falls on an odd night (21st, 23rd, 25th, etc.) — some point specifically to the 27th.'},
      {title:'Spend the last ten nights in I\u2019tikaf (seclusion)', body:'Many Muslims, especially those who can, retreat to the mosque for the last ten nights, dedicating themselves to worship. While not obligatory, it is a honored tradition (some schools of thought view it as strongly encouraged, other schools of thought as optional).'},
      {title:'Stay awake in prayer and recitation', body:'Stand in tahajjud (night prayer), recite Qur\u2019an slowly, and make lengthy duas. The benefit of this night depends on sincere effort, not mere presence.'},
      {title:'Make heartfelt duas', body:'Ask Allah for forgiveness, guidance, healing, and all that your heart desires. This night is marked as one when duas are especially heard and answered.'},
      {title:'Recite this dua', body:'The Prophet ﷺ taught Aisha a specific dua to recite on Laylat al-Qadr.', arabic:'اللَّهُمَّ إِنَّكَ عَفُوٌّ تُحِبُّ الْعَفْوَ فَاعْفُ عَنِّي', translit:"Allahumma innaka 'afuwwun tuhibbul-'afwa fa'fu 'anni", translation:'O Allah, You are Pardoning and love pardon, so pardon me.'},
      {title:'Share the blessing with others', body:'If you experience or believe you have found the night, keep the blessing humble and private — the spiritual reward is personal with Allah.'}
    ]},

  { id:'eid-prayer-detailed', title:'Eid Prayer (Salat al-Eid) Step by Step', icon:'gift', tag:'Seasonal', time:'5 min',
    summary:'The structure of the Eid prayer — different from the five daily prayers in its format and khutbah.',
    steps:[
      {title:'Arrive early', body:'The Eid prayer typically begins at sunrise (for Eid al-Fitr) or mid-morning (for Eid al-Adha). Arriving early lets you find a place and enjoy the gathering.'},
      {title:'Stand in rows', body:'Unlike other prayers, there is no iqamah called, and rows are simply organized without being perfectly straight (some schools of thought require straighter rows for all prayers, other schools of thought are more lenient for Eid).'},
      {title:'First takbir: Say Allahu Akbar seven times', body:'The imam begins, and the congregation follows, raising hands and saying the takbir seven times at the start. This sets the tone of celebration and remembrance.', arabic:'اللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ لَا إِلَٰهَ إِلَّا اللَّهُ، وَاللَّهُ أَكْبَرُ اللَّهُ أَكْبَرُ وَلِلَّهِ الْحَمْدُ', translit:'Allahu akbar, Allahu akbar, la ilaha illallah, wallahu akbar, Allahu akbar, wa lillahil-hamd', translation:'Allah is Greatest, Allah is Greatest, there is no god but Allah, and Allah is Greatest, Allah is Greatest, and to Allah belongs all praise.'},
      {title:'Lower your hands and begin silently', body:'After the seven takbirs, lower your hands, and the imam begins the prayer silently without an audible Qur\u2019an recitation (this is a key difference from daily prayers).'},
      {title:'Second takbir: Say Allahu Akbar five times', body:'After the first ruku, the imam rises and says takbir five times before bowing again.'},
      {title:'Two rakahs total', body:'Unlike daily four-rakah prayers, Eid prayer consists of only two rakahs, following a simpler structure.'},
      {title:'Khutbah (sermon) after prayer', body:'After the prayer ends with salam, the imam gives a khutbah (sermon) addressing the community. This is the main teaching moment of Eid.'},
      {title:'Greet and embrace others', body:'After prayer, it is customary and encouraged to greet fellow worshippers warmly, embrace close friends and family, and exchange wishes.'}
    ]},

  { id:'hajj-umrah-basics', title:'Hajj and Umrah Basics', icon:'mosque', tag:'Seasonal', time:'5 min',
    summary:'An introduction to the two pilgrimages to Mecca — their timing, intent, and essential steps.',
    steps:[
      {title:'Understand Hajj (the major pilgrimage)', body:'Hajj is one of the Five Pillars of Islam, obligatory once in a lifetime on those who are physically and financially able. It takes place in the Islamic month of Dhul-Hijjah, typically 4\u20136 days.'},
      {title:'Understand Umrah (the minor pilgrimage)', body:'Umrah is a voluntary pilgrimage to Mecca that can be performed at any time of year, taking only a few hours to complete.'},
      {title:'Enter ihram (sacred state)', body:'Before approaching Mecca or the pilgrim boundary (Miqat), don the ihram garments (two simple white sheets for men, or modest clothing for women) and make the niyyah (intention) to perform Hajj or Umrah.'},
      {title:'Recite the Talbiyah', body:'While in ihram, continuously recite the pilgrim\u2019s call.', arabic:'لَبَّيْكَ اللَّهُمَّ لَبَّيْكَ، لَبَّيْكَ لَا شَرِيكَ لَكَ لَبَّيْكَ، إِنَّ الْحَمْدَ وَالنِّعْمَةَ لَكَ وَالْمُلْكُ، لَا شَرِيكَ لَكَ', translit:'Labbayka Allahumma labbayk, labbayka la sharika laka labbayk, innal hamda wa ni\u2019mata laka wal-mulk, la sharika lak', translation:'Here I am, O Allah, here I am. Here I am, You have no partner, here I am. Surely all praise and favor is Yours, and dominion — You have no partner.'},
      {title:'Perform Tawaf (circumambulation)', body:'Circle the Kaaba seven times counterclockwise, starting from the Black Stone corner. This is done for both Hajj and Umrah.'},
      {title:'Perform Sa\u2019y (walking between Safa and Marwah)', body:'Walk back and forth between the two hills (Safa and Marwah) seven times. This commemorates Hagar\u2019s desperate search for water (both Hajj and Umrah include this).'},
      {title:'For Hajj only: Stand at Arafah', body:'On the 9th of Dhul-Hijjah, pilgrims gather on the plain of Arafah and spend the day in worship, prayer, and dua. This is the spiritual climax of Hajj.'},
      {title:'For Hajj only: Night at Muzdalifah and pebble-throwing', body:'Spend the night of the 10th at Muzdalifah, then proceed to Mina to throw pebbles at stone pillars (jamrah) — symbolic rejection of evil — over the course of two or three days.'},
      {title:'Sacrifice an animal (for Hajj)', body:'For Hajj, an animal (sheep, goat, cow, or camel) is sacrificed, with the meat distributed to family, friends, and the poor. This commemorates Abraham\u2019s willingness to sacrifice his son.'}
    ]},

  { id:'death-preparation', title:'Islamic Death and Dying Preparation', icon:'heart', tag:'Life Events', time:'5 min',
    summary:'How Islam approaches the end of life — both practical preparation and the care of the dying.',
    steps:[
      {title:'Know it is coming', body:'The Qur\u2019an reminds us repeatedly that every soul will taste death. Awareness of mortality is not morbid but clarifying — it focuses priorities and encourages repentance while able.'},
      {title:'Update your will and affairs', body:'Make clear who your beneficiaries are, what debts must be settled, and any final wishes. While not an Islamic mandate per se, good planning honors dependents left behind.'},
      {title:'Keep repentance current', body:'The Prophet ﷺ advised frequently seeking forgiveness (istighfar) — not waiting for a deathbed to make peace with Allah. This is a lifelong habit, not a last-minute gesture.'},
      {title:'When someone is dying: Recite Surah Yasin', body:'It is customary and encouraged to recite Surah Yasin (chapter 36) at the bedside of the dying — the Prophet ﷺ recommended this (Jami\u2019 at-Tirmidhi).'},
      {title:'Position the body toward Qibla', body:'If the dying person loses consciousness, gently position them facing Mecca. If not possible, the intention counts.'},
      {title:'Prompt them gently to recite the Shahada', body:'Softly remind them of the declaration of faith — "La ilaha illallah, Muhammad rasulullah" — without pressure or insistence (Sahih Muslim).'},
      {title:'After death: Perform Ghusl', body:'The body is ritually washed (ghusl) by family or designated community members of the same gender, in a specific sequence, with respect and gentleness (the exact order varies between schools of thought).'},
      {title:'Wrap in Kafan (shroud)', body:'The body is wrapped in simple white cloth — no expensive coffin or ornamentation. The focus is humility and equality before Allah.'},
      {title:'Pray Salat al-Janazah', body:'The funeral prayer is performed standing (not bowing or prostrating), making duas for the deceased\u2019s forgiveness and mercy.'},
      {title:'Bury within a day', body:'Burial should not be delayed — the Prophet ﷺ taught to avoid unnecessary waiting. The body is placed in the ground, and grief is expressed while avoiding excessive wailing.'}
    ]},

  { id:'mourning-etiquette', title:'Mourning Etiquette (Iddah and After)', icon:'moon', tag:'Life Events', time:'4 min',
    summary:'How to grieve Islamically — what is encouraged, what to avoid, and how to honor the deceased.',
    steps:[
      {title:'Know the mourning period (Iddah)', body:'For a spouse, the mourning period is 4 months and 10 days. For other close relatives, there is no fixed Islamic period, though cultural practices vary. What matters is the quality of grief, not its duration.'},
      {title:'Make dua for forgiveness for the deceased', body:'The most beneficial thing for the dead is the duas of the living. Regular duas of forgiveness are encouraged for all departed loved ones.', arabic:'رَبِّ اغْفِرْ لِي وَلِوَالِدَيَّ وَلِمَنْ دَخَلَ بَيْتِي مُؤْمِنًا', translit:'Rabbi ighfir li wa li walidayya wa liman dakhal bayti mu\u2019minan', translation:'My Lord, forgive me and my parents and whoever enters my house believing.'},
      {title:'Give charity on their behalf', body:'Sadaqah (voluntary charity) offered with the intention that its reward reaches the deceased is encouraged (Sahih Muslim). Waqf (endowed charity) is also a way to provide ongoing benefit.'},
      {title:'Avoid extravagant mourning displays', body:'The Prophet ﷺ taught against excessive wailing, tearing clothes, or public displays of grief that cross into despair of Allah\u2019s mercy. Expression is human; despair is discouraged.'},
      {title:'Continue their good deeds if able', body:'If the deceased had unfinished charitable work or prayer goals, completing them on their behalf is seen as a beautiful way to honor their memory and extend their legacy.'},
      {title:'Visit their grave', body:'Visiting the grave to make dua for them and remember them is permissible and encouraged (some schools of thought see it as strongly recommended, other schools of thought leave it optional). Avoid elaborate grave decorations or excessive visiting.'},
      {title:'Speak well of them', body:'The Prophet ﷺ advised speaking only good of the dead. Mentioning their virtues and positive impact is part of honoring them.'}
    ]},

  { id:'menstruation', title:'Menstruation (Haydh)', icon:'moon', tag:'Women', time:'4 min',
    summary:'Islamic guidance on menstruation — what changes in worship, what doesn\'t, and maintaining dignity.',
    steps:[
      {title:'Understand haydh (menstruation)', body:'In Islamic law, menstruation is a natural state, not impurity of character. A menstruating woman remains a full believer with all spiritual standing; only certain acts of worship are paused, not her value.'},
      {title:'Pause salah (prayer)', body:'During menstruation, the five daily prayers are not performed. This is not a punishment but a exemption — you are not required, and performing them during this time does not count. The missed prayers are not made up afterward (Sahih Muslim).'},
      {title:'Pause fasting during Ramadan', body:'Days missed due to menstruation are made up after Ramadan ends, at a time of your choosing (Sahih al-Bukhari). This is among the most well-known exemptions in Islamic law.'},
      {title:'Continue Qur\'an recitation and duas', body:'You can recite Qur\'an from memory, make duas, listen to recitation, and engage in all spiritual reflection. The exemption is specific to ritual prayer and fasting, not Islamic practice broadly (some scholars differ on physical contact with the Qur\'an mushaf itself during menstruation).'},
      {title:'Maintain intimacy boundaries with spouse', body:'Sexual intercourse is forbidden during menstruation (Qur\'an 2:222). Other forms of affection and closeness are permissible and encouraged — the relationship remains warm and present.'},
      {title:'Continue daily life normally', body:'Work, study, socializing, and all ordinary activities continue as usual. There is no requirement to isolate or treat yourself differently in public or family life.'},
      {title:'Make up the fasts, not the prayers', body:'The key difference: fasting days are made up later; prayer days are not. This reflects Islamic jurisprudence across all schools of thought.'},
      {title:'Know the duration', body:'Menstruation typically lasts 3-10 days (some schools of thought set the minimum at 3 days and maximum at 10, other schools of thought are more flexible with variations). Once bleeding stops, you resume all worship.'},
      {title:'Perform ghusl when it ends', body:'Once menstruation ends, perform a full ritual wash (ghusl) before resuming prayer and fasting. This marks the return to the full practice of worship.'}
    ]},

  { id:'postpartum', title:'Post-Partum Period (Nifas)', icon:'heart', tag:'Women', time:'4 min',
    summary:'The Islamic postpartum period — rest, recovery, and when worship resumes.',
    steps:[
      {title:'Understand nifas (postpartum bleeding)', body:'The bleeding and discharge after childbirth is called nifas. Like menstruation, it exempts a woman from prayer and fasting during its duration, and carries no spiritual diminishment.'},
      {title:'Duration of nifas', body:'Nifas typically lasts up to 40 days (some schools of thought set it strictly at 40 days, other schools of thought permit variation based on individual circumstance, typically between 21-40 days). Once bleeding stops before 40 days, you may resume worship.'},
      {title:'Pause salah and fasting', body:'Like menstruation, prayer and fasting are paused during nifas. Days of Ramadan missed due to nifas are made up after the postpartum period and recovery allow.'},
      {title:'Continue duas and Qur\'an reflection', body:'Spiritual connection through memory and meditation continues; the exemption is limited to formal ritual prayer and fasting.'},
      {title:'Rest and recover physically', body:'The postpartum period is recognized in Islamic teaching as a time of physical recovery. The exemption from prayer reflects the reality of healing and the demands of newborn care.'},
      {title:'Maintain spousal boundaries', body:'Sexual intercourse is forbidden during nifas, similar to menstruation. The husband\'s role is support and patience during this vulnerable time.'},
      {title:'Perform ghusl when nifas ends', body:'Once the postpartum bleeding ceases, perform ghusl to resume full worship — salah, fasting, and all acts of devotion.'},
      {title:'Know you\'re not weaker for needing rest', body:'The Islamic framework recognizes biological reality without shame. Recovery is honored, not hidden. Asking for and accepting help is part of the sunnah example of how families supported mothers historically.'}
    ]},

  { id:'pregnancy-etiquette', title:'Pregnancy Etiquette & Care', icon:'heart', tag:'Women', time:'4 min',
    summary:'How Islam honors pregnancy — spiritual practice, rights, and self-care during this sacred time.',
    steps:[
      {title:'Know pregnancy is honored in Islam', body:'The Qur\'an speaks of the carrying and nursing of children as a hardship and a kindness (Qur\'an 31:14). Pregnancy is recognized as significant spiritually and physically.'},
      {title:'Continue your regular prayers', body:'Pregnancy does not excuse prayer. Modify as needed for comfort — sit instead of stand, reduce bowing depth — but maintain your connection to salah throughout.'},
      {title:'Fast during Ramadan if able', body:'If fasting is difficult or harmful to your health or the baby\'s, you may break the fast and make up the days later (Qur\'an 2:184). This is a mercy, not a failure — consult your body and your doctor.'},
      {title:'Make duas for easy pregnancy and delivery', body:'Asking Allah for ease during pregnancy and childbirth is encouraged. Many duas exist for protection of mother and child.', arabic:'رَبِّ اجْعَلْ لِي مِنْ لَدُنْكَ نَسْلًا طَيِّبًا إِنَّكَ سَمِيعُ الدُّعَاءِ', translit:'Rabbi ij\'al li min ladunka naslan tayyiba innaka Samiul-du\'a', translation:'My Lord, grant me from You a good offspring. Indeed, You are the Hearer of supplication.'},
      {title:'Accept help and support', body:'The Prophet ﷺ emphasized the role of family and community in supporting pregnant women. Accepting help is not weakness — it is part of the Islamic community structure.'},
      {title:'Recite Qur\'an for the baby', body:'Reciting the Qur\'an, especially Surah Maryam (the chapter about Mary, mother of Jesus), is a practice many pregnant women maintain for spiritual connection with the child.'},
      {title:'Prepare practically and spiritually', body:'Alongside practical preparation for birth, spend time in dhikr, dua, and reflection. The spiritual preparation is as important as the physical.'},
      {title:'Know your rights', body:'Islam gives pregnant women specific rights: kindness from spouse, care from family, exemption from fasting if needed, and the expectation that others lighten her load during this time.'}
    ]},

  { id:'women-leadership', title:'Women in Islamic Leadership', icon:'users', tag:'Women', time:'4 min',
    summary:'Roles, rights, and Islamic history of women in decision-making and spiritual teaching.',
    steps:[
      {title:'Know women were teachers and advisors from the start', body:'Aisha, Umm Salamah, and other Sahabi women taught hadith, gave fatwas, and advised the Prophet ﷺ and the early community. Their scholarship is still studied today.'},
      {title:'Understand the difference between roles and worth', body:'Some roles in prayer leadership are reserved for men (imam of congregational prayer); this is a matter of fiqh, not an assessment of spiritual capability or intellect. Different roles reflect different contexts, not hierarchy of value.'},
      {title:'Lead in your sphere authentically', body:'Women lead in education, community building, family guidance, charitable work, and many professional roles. Islamic history is full of women scholars, judges, and advisors (some schools of thought permit women qadis, other schools of thought restrict this, but the scholarly discussion itself reflects serious engagement).'},
      {title:'Teaching is an honored role', body:'A woman teaching Islamic knowledge to men and women alike carries full reward. Umm Salamah\'s hadith are in Sahih al-Bukhari — she is a full authority in the tradition.'},
      {title:'Speak up in family decisions', body:'The Qur\'an calls for shura (consultation); a wife\'s counsel in family matters is Islamic practice, not indulgence. Your voice matters in decisions that affect you and your children.'},
      {title:'Know your rights in marriage and divorce', body:'Islam grants women specific marriage rights: mahr (bridal gift), financial support, kind treatment, and the right to seek khul\' (woman-initiated divorce) if the marriage is untenable.'},
      {title:'Don\'t confuse culture with Islam', body:'Practices restricting women\'s speech, education, or movement are often cultural, not Islamic. The Qur\'an and hadith do not forbid women from learning, working, or contributing to community decisions.'},
      {title:'Seek knowledge to lead better', body:'Whatever your role — mother, teacher, professional, community member — Islamic knowledge deepens your ability to lead authentically and serve your community.'}
    ]},

  { id:'youth-identity', title:'Islamic Identity as a Young Person', icon:'star', tag:'Youth', time:'4 min',
    summary:'Navigating faith while growing up — finding your Islamic identity in a diverse world.',
    steps:[
      {title:'Your faith is your own journey', body:'You will inherit beliefs from family, but faith that sticks is faith you choose and understand yourself. Ask questions, read, think deeply — this is not rebellion, it\'s spiritual maturity.'},
      {title:'Find your why for the five pillars', body:'Don\'t pray just because you\'re told to. Understand why salah matters to you. When you own the reason, the practice becomes alive instead of a chore.'},
      {title:'Build friendships with other Muslim youth', body:'Peer support is real. Friends who share your faith can make the difference between isolation and belonging. Seek out youth groups, camps, or communities where you feel seen.'},
      {title:'It\'s okay to be different from peers', body:'If your friends aren\'t Muslim, that\'s fine — you can be close while having different practices. If they pressure you to abandon your faith, that\'s a sign to reassess those friendships. True friends respect your values.'},
      {title:'Ask hard questions about your faith', body:'Doubts aren\'t a sign of weak faith — they\'re a sign you\'re thinking. Talk to teachers, imams, or trusted mentors about the things that confuse you. Honest questions deserve honest answers.'},
      {title:'Your body is yours to protect', body:'Modest dress, avoiding dating culture, waiting for marriage — these aren\'t restrictions meant to control you, they\'re frameworks to protect your autonomy and dignity. Own these choices as yours.'},
      {title:'Balance your culture and your faith', body:'If your family\'s culture and Islam differ, you might feel torn. It\'s possible to honor your heritage while following your own understanding of Islam. You\'re not betraying either by choosing thoughtfully.'},
      {title:'Find role models who look like you', body:'Seek out Muslim youth, professionals, activists who share your background or struggles. Seeing people like you living Islamic lives authentically makes the path feel possible.'}
    ]},

  { id:'youth-relationships', title:'Youth & Relationships (Islamic Perspective)', icon:'heart', tag:'Youth', time:'4 min',
    summary:'How Islam approaches attraction, dating, and marriage — from a young person\'s perspective.',
    steps:[
      {title:'Attraction is normal, not sinful', body:'Feeling drawn to someone is a human reality, not a sign of weak faith. How you act on that attraction matters; the feeling itself is neutral.'},
      {title:'Know what Islam forbids', body:'Premarital sexual relationships are forbidden. Dating in the Western sense — alone with someone you\'re not related to, with romantic and physical intimacy — crosses Islamic boundaries (some schools of thought permit chaperoned meetings with intent to marry, other schools of thought advise stricter separation).'},
      {title:'Understand the reasons behind these limits', body:'The restrictions exist to protect: your emotional security, your family\'s honor, your future marriage, and your ability to make clear-headed decisions about partnership. They\'re not arbitrary.'},
      {title:'Talk to parents early', body:'If you\'re serious about someone, involve your family. Parents aren\'t meant to be obstacles — they\'re meant to help ensure the person and the process are sound. The conversation might be awkward, but it\'s necessary.'},
      {title:'Marriage is the framework for commitment', body:'If you want a serious relationship, marriage is the Islamic goal. This doesn\'t mean rushing — it means being honest about intent and timeline.'},
      {title:'You can know someone before marriage', body:'Chaperoned meetings, conversations with family present, and getting to know someone\'s character, values, and family are all encouraged. You\'re not going in blind; you\'re being thoughtful.'},
      {title:'Your consent matters', body:'Islam requires a woman\'s explicit consent to a marriage contract. No guardian can force you, and if you feel pressured, that\'s a red flag. Your agreement must be genuine.'},
      {title:'It\'s okay to say no', body:'If someone doesn\'t feel right for you, saying no is Islamic and wise. Rushing into marriage to avoid loneliness or pressure is how people end up miserable. Take your time and trust your instincts.'}
    ]},

  { id:'youth-career', title:'Career & Work for Young Muslims', icon:'hand', tag:'Youth', time:'4 min',
    summary:'Finding and building a career that aligns with your faith and values.',
    steps:[
      {title:'Work is worship if your intention is right', body:'Seeking an honest livelihood to support yourself and your family is Islamic. Career ambition is not greed if the intent is responsibility and excellence.'},
      {title:'Halal income matters more than status', body:'A modest job with halal income is better than a lucrative one built on haram (forbidden) practices. Don\'t compromise your integrity for a paycheck or a title.'},
      {title:'Find fields that align with your values', body:'If you care about justice, consider law, activism, or civil service. If you care about healing, medicine or counseling might fit. If you care about education, teaching or research. Align your work with what matters to you.'},
      {title:'You don\'t have to hide your faith at work', body:'Praying at work, taking off for Eid, mentioning your Islamic values — these are protected in most workplaces and are part of your identity. Don\'t shrink yourself.'},
      {title:'Avoid industries that contradict your faith', body:'Banks dealing in riba (interest), entertainment industries you\'re uncomfortable with, or roles that exploit others — these might pay well but will cost you spiritually long-term.'},
      {title:'Seek mentors who share your values', body:'Finding people further along who\'ve built careers while staying true to their faith gives you a roadmap and moral support.'},
      {title:'Build your skills intentionally', body:'Invest in education, certifications, and skills that open doors. The Prophet ﷺ praised those who were excellent at their craft. Your professionalism is part of your Islamic identity.'},
      {title:'Remember: career is one part of life', body:'Success in work doesn\'t define you. A good job supports a good life, but it doesn\'t replace family, faith, or community. Keep perspective.'}
    ]},

  { id:'tawheed-basics', title:'Tawheed (Islamic Monotheism) Foundations', icon:'star', tag:'Spiritual', time:'5 min',
    summary:'The central principle of Islam — what it means to believe in one God and live by that belief.',
    steps:[
      {title:'Tawheed means unity of God', body:'At its core, tawheed is the belief that Allah is one — singular, unique, without partners or equals. This is the first principle of Islam, stated in the Shahada.', arabic:'لَا إِلَٰهَ إِلَّا اللَّهُ مُحَمَّدٌ رَسُولُ اللَّهِ', translit:'La ilaha illallah, Muhammadun rasulullah', translation:'There is no god but Allah, and Muhammad is His messenger.'},
      {title:'Understand the three dimensions of tawheed', body:'Tawheed of Allah\'s lordship (He alone creates and sustains), tawheed of His names and attributes (He has perfect qualities), and tawheed of worship (we worship Him alone, not created things). All three are interwoven.'},
      {title:'Avoid shirk (associating partners with God)', body:'Shirk is the opposite of tawheed — putting anything or anyone on equal standing with Allah. This includes idols, saints, money, desires, or any created thing. Shirk is the one unforgivable sin if a person dies without repenting (Qur\'an 4:48).'},
      {title:'Distinguish between major and minor shirk', body:'Major shirk is obvious — worshipping idols or calling on the dead for help. Minor shirk is subtle — showing off in good deeds, seeking praise from people instead of from Allah, or trusting something other than Allah (some schools of thought debate the boundaries, but the principle is clear).'},
      {title:'Tawheed means trusting only Allah\'s power', body:'While you plan and work, ultimate control belongs to Allah alone. You do not fear loss because only He provides; you do not fear people because only He judges. This trust (tawakkul) is the fruit of tawheed.'},
      {title:'Live tawheed, don\'t just believe it', body:'Tawheed isn\'t intellectual assent alone — it shapes how you live. When you truly believe Allah is one and all-powerful, you pray even when no one is watching, you speak truth even when it costs you, you do good even when no one will praise you.'},
      {title:'Reflect on creation as a sign of tawheed', body:'The Qur\'an repeatedly points to the sky, mountains, seas, and all creation as evidence of Allah\'s oneness. Contemplating creation deepens tawheed in the heart.'},
      {title:'Remember tawheed when you stumble', body:'Tawheed doesn\'t mean perfection — it means returning. When you sin or doubt, tawheed is the foundation that brings you back: there is only Allah to turn to, only His mercy available.'}
    ]},

  { id:'shirk-avoidance', title:'Understanding Shirk (Polytheism) & Avoiding It', icon:'shield', tag:'Spiritual', time:'4 min',
    summary:'Shirk is the greatest sin in Islam — learning what it is and how to guard against subtle forms.',
    steps:[
      {title:'Shirk is putting anything equal to or above Allah', body:'The Qur\'an defines shirk as associating partners with Allah in worship, power, or authority. It ranges from obvious (idol worship) to subtle (trusting wealth more than Allah).'},
      {title:'Know the major forms of shirk', body:'Calling on saints or the dead for help, making statues or idols for worship, believing in astrology as determining fate, or worshipping prophets or angels — these are explicit shirk that nullify tawheed.'},
      {title:'Recognize subtle shirk in daily life', body:'Seeking approval from people more than from Allah, showing off your good deeds, trusting your plans without trusting Allah, or fearing people more than fearing Allah — these are minor shirk that weaken your faith without necessarily invalidating it (some schools of thought debate severity).'},
      {title:'Guard your heart against hidden shirk', body:'The Prophet ﷺ said hidden shirk is like an ant walking on a black stone in the darkness of night — easy to miss. Regularly check your intentions: are you doing good for Allah, or for reputation?'},
      {title:'Distinguish between seeking blessing and shirk', body:'Asking for the intercession of the Prophet ﷺ or righteous people (tawassul) is debated among scholars (some schools of thought permit it, others forbid it as a form of shirk). Know your school\'s position and stay within it.'},
      {title:'Don\'t fear shirk accusation without reason', body:'Some people worry constantly about committing hidden shirk. This anxiety itself can become problematic. Shirk requires actual belief or intent — an honest mistake or momentary thought is not shirk.'},
      {title:'Repent if you fear you\'ve committed shirk', body:'If you realize you\'ve trusted something other than Allah or called on someone other than Him, repent sincerely. Allah forgives all sins except shirk if repented before death (Qur\'an 4:48).'},
      {title:'Strengthen tawheed to guard against shirk', body:'The best defense against shirk is a strong, living belief in tawheed. When Allah is truly your focus, everything else naturally falls into proper proportion.'}
    ]},

  { id:'innovation-bidah', title:'Innovation in Religion (Bid\'ah) & Staying True', icon:'book', tag:'Spiritual', time:'4 min',
    summary:'What constitutes forbidden innovation in Islam, and how to distinguish it from permissible change.',
    steps:[
      {title:'Understand bid\'ah (religious innovation)', body:'Bid\'ah is introducing something new into the religion that Allah and His Prophet ﷺ did not prescribe. The Prophet ﷺ said every innovation is misguidance (Sunan Ibn Majah). However, bid\'ah in non-religious matters is permissible.'},
      {title:'Know the distinction: religion vs. culture', body:'Adding new Qur\'anic verses, creating new prayers, or inventing new obligatory acts are bid\'ah. But innovations in how you organize daily life, use technology, or conduct business are not bid\'ah — they\'re human progress.'},
      {title:'Distinguish between bid\'ah and ijtihad (scholarly reasoning)', body:'When a scholar applies Islamic principles to a new situation (like using cameras for taraweeh during lockdown), that\'s ijtihad, not bid\'ah. When someone creates an entirely new religious practice without scriptural basis, that\'s bid\'ah (some schools of thought are stricter, others more lenient about what qualifies).'},
      {title:'Watch out for added rituals dressed as Sunnah', body:'Some practices are presented as Islamic but lack clear Qur\'anic or hadith basis — excessive rituals on certain days, elaborate commemorations, or repeated acts with specific numbers (like 313 salat-salam on specific occasions) fall into this category. Question their source.'},
      {title:'Follow established madhabs to stay grounded', body:'The four schools of thought (Hanafi, Maliki, Shafi\'i, Hanbali) represent centuries of scholarly consensus. Following one school helps you avoid wandering into innovation while still having flexibility within that framework.'},
      {title:'Be cautious of charismatic new movements', body:'Movements that claim to have rediscovered something lost or introduce practices unknown to the earliest generations should be examined carefully against Qur\'an and authentic hadith.'},
      {title:'Not everything old is sunnah, not everything new is bid\'ah', body:'Some old practices lack basis; some new approaches (like modern Islamic education methods) are permissible adaptations. Judge by Qur\'an and hadith, not by age.'},
      {title:'Bid\'ah can be sincere but still wrong', body:'Someone might innovate out of genuine love for Islam and the Prophet ﷺ, but sincere intention doesn\'t make innovation permissible. It\'s the adherence to Qur\'an and Sunnah that matters, not how much someone cares.'}
    ]},

  { id:'common-mistakes', title:'Common Mistakes in Islamic Practice', icon:'shield', tag:'Good to know', time:'6 min',
    summary:'A cross-topic look at the mistakes Muslims most often make in worship, and how small corrections lead to more meaningful practice.',
    deeperDive:'Most mistakes in Islamic practice fall into three categories: mechanical errors (getting the steps wrong), timing errors (doing the right thing at the wrong time), and intention errors (going through the motions without presence). Mechanical errors are the easiest to fix — a teacher or a guide corrects them in minutes. Intention errors are the hardest, because they require ongoing self-awareness rather than a one-time correction. The Prophet ﷺ said that the first matter to be judged on the Day of Resurrection would be prayer, and if it was sound, the rest of a person\u2019s deeds would be sound (Sunan an-Nasa\u2019i) \u2014 which is why so much attention in the tradition goes to getting salah right, not just performed. A helpful mental model: treat every mistake as information, not failure. Scholars across the four madhabs agree that Allah does not burden a soul beyond its capacity (Qur\u2019an 2:286), and that sincere effort followed by correction is itself an act of worship.',
    steps:[
      {title:'Rushing through worship', body:'Whether it\'s wudu, salah, or Qur\'an recitation, speed is the most common mistake across the board. The Prophet ﷺ corrected a man who prayed too quickly, telling him to go back and pray again because he had not truly prayed (Sahih al-Bukhari).'},
      {title:'Not knowing the "why" behind an act', body:'Performing rituals without understanding their purpose leads to mechanical worship. Take time to learn the wisdom (hikmah) behind each act — it transforms repetition into genuine devotion.'},
      {title:'Assuming one method is the only correct one', body:'Many differences between Muslims are legitimate differences between schools of thought (madhabs), not one side being wrong. Mistaking khilaf (valid difference) for error creates unnecessary division.'},
      {title:'Neglecting the heart while perfecting the form', body:'It\'s possible to have flawless outward technique — correct wudu, correct prayer positions — while the heart is distracted or indifferent. Both form and presence (khushu) matter.'},
      {title:'Delaying repentance for small sins', body:'Many people wait for a "big" sin to repent, while small sins accumulate. The Prophet ﷺ warned against belittling small sins, comparing them to sticks that build a fire (Musnad Ahmad).'},
      {title:'Comparing your practice to others', body:'Worship is not a competition. Excessive comparison — feeling superior or inferior based on how much others pray or fast — misses the point of sincere, personal devotion to Allah.'},
      {title:'Treating mistakes as permanent failures', body:'A single missed prayer, a broken fast, or an imperfect recitation does not erase your standing with Allah. Correction and consistency matter more than a flawless record.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on prayer correction'},{book:'Sunan an-Nasa\u2019i', ref:'Hadith on Day of Judgment and prayer'},{book:'Riyad as-Salihin', ref:'Chapters on sincerity and repentance'}],
    keywords:['common mistakes in islam','islamic practice errors','fixing prayer mistakes','worship mistakes muslims make'],
    snippet:'The most common mistakes in Islamic practice — from rushing worship to comparing yourself to others — and how small corrections lead to deeper, more meaningful devotion.'},


  { id:'praying-in-car', title:'Praying While Traveling by Car', icon:'plane', tag:'Scenario', time:'4 min',
    summary:'How to maintain your prayers on road trips, commutes, and long drives without missing a Salah.',
    deeperDive:'Islamic law was never designed around the assumption of constant travel, yet it built in enough flexibility that a believer is never truly excused from prayer entirely — only its form adapts. The scholars call this rukhsah (concession), a mercy built into the religion rather than a loophole. Practically, this means the driver of a car should treat the vehicle the way earlier generations treated a camel or a ship: a moving platform on which worship still happens, just modified. The psychological benefit of knowing this in advance is real — many people avoid praying while traveling simply because they assume it is impossible, when in fact Islamic law anticipated this exact situation over a thousand years before the automobile existed.',
    steps:[
      {title:'Pull over safely if you can', body:'Whenever possible and safe, stop at a rest area, gas station, or quiet spot to pray with full movements — this is always preferable to praying while driving.'},
      {title:'If stopping isn\'t possible, pray seated', body:'If you cannot safely stop (heavy traffic, no safe shoulder, tight schedule), you may pray while seated in the car, facing the Qibla as best you can, using head nods for ruku and sujood instead of full movements (some schools of thought are more lenient about this concession than others).'},
      {title:'Combine prayers when traveling long distances', body:'If your journey qualifies as travel under Islamic law, you may combine Dhuhr with Asr, and Maghrib with Isha, at one of their times — reducing how many stops you need to make.'},
      {title:'Use a Qibla app for direction', body:'Most prayer time apps include a Qibla compass using your phone\'s GPS — check it before starting to pray, especially on unfamiliar roads.'},
      {title:'Keep a small prayer mat or clean cloth in the car', body:'A collapsible mat takes little space and ensures a clean surface at rest stops, avoiding uncertainty about the ground\'s cleanliness.'},
      {title:'Plan fuel and rest stops around prayer times', body:'If you know Dhuhr or Asr is approaching, choose your next stop with prayer facilities or a quiet spot in mind — this avoids the last-minute scramble.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on prayer during travel and necessity'},{book:'Reliance of the Traveller', ref:'Section on prayer concessions'}],
    keywords:['praying in car islam','salah while driving','prayer during road trip muslim','can i pray sitting in car'],
    snippet:'How to pray while driving or traveling by car — from pulling over safely to combining prayers and using seated prayer when needed.'},

  { id:'wudu-limited-water', title:'Making Wudu with Limited Water', icon:'droplet', tag:'Scenario', time:'3 min',
    related:['wudu','tayammum','praying-in-car'],
    summary:'How to perform valid ablution when water is scarce, during travel, or in emergency situations.',
    steps:[
      {title:'Know the minimum requirement', body:'Wudu requires washing each limb only once at minimum — the three-times method is preferred, not obligatory. In water-scarce situations, one wash per limb, done thoroughly, is fully valid.'},
      {title:'Use a cup or bottle rather than a running tap', body:'Pouring small controlled amounts from a bottle over each limb uses far less water than a running faucet, while still ensuring full coverage.'},
      {title:'Prioritize covering every required area over splashing generously', body:'Thin, careful coverage over the face, arms, head-wipe, and feet matters more than the volume of water used — a wet hand wiped fully counts.'},
      {title:'If water is truly unavailable, move to tayammum', body:'When there is no accessible water at all — not just inconvenient water — tayammum (dry ablution with clean earth or dust) becomes the valid substitute (Qur\'an 5:6).'},
      {title:'Carry a small reusable water bottle when traveling', body:'A portable bottle dedicated to wudu solves most limited-water situations before they become a problem, especially at work, on hikes, or during flights.'},
      {title:'Use wet wipes or a damp cloth only as a last resort before tayammum', body:'A truly damp cloth can technically substitute for water in extreme scarcity for some scholars, but this is a minority position — tayammum is the safer, agreed-upon fallback when water genuinely runs out.'}
    ],
    sources:[{book:'Qur\'an', ref:'5:6, verse on ablution and tayammum'},{book:'Fiqh us-Sunnah', ref:'Chapter on the minimum requirements of Wudu'}],
    keywords:['wudu with little water','ablution water scarcity','minimal water wudu islam','how to save water during wudu'],
    snippet:'How to perform a fully valid wudu using minimal water — the real minimum requirements, and when to switch to tayammum instead.'},

  { id:'praying-at-work', title:'Praying at Work or School', icon:'hand', tag:'Scenario', time:'4 min',
    summary:'Navigating prayer times, space, and conversations with employers or teachers about your daily Salah.',
    steps:[
      {title:'Know your prayer window before your shift', body:'Check prayer times for the day in advance so you know exactly when Dhuhr or Asr will fall during work hours, rather than discovering it mid-shift.'},
      {title:'Ask for a quiet space in advance, not last-minute', body:'A calm conversation with HR or a manager ahead of time — explaining you need 5-10 minutes at a specific time — is usually well received and avoids awkward last-minute requests.'},
      {title:'Use empty rooms, stairwells, or your car if no prayer room exists', body:'Many workplaces don\'t have a designated space; a quiet corner, an empty meeting room, or your parked car can all work as a private prayer spot.'},
      {title:'Combine prayers if your schedule genuinely doesn\'t allow separate times', body:'If Dhuhr and Asr both fall within a shift with no reasonable break, some scholars permit combining them in situations of genuine hardship (this is more restrictive than travel combining — check with a knowledgeable source for your specific case).'},
      {title:'Keep wudu simple with a bathroom sink', body:'Most workplace and school bathrooms are sufficient for wudu — a paper towel afterward avoids dripping on shared spaces.'},
      {title:'Know your rights', body:'In many countries, requesting brief prayer breaks is a protected religious accommodation — familiarize yourself with your workplace or school\'s policy if you\'re unsure.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on excuses for combining prayers'}],
    keywords:['praying at work islam','muslim prayer school','asking employer for prayer time','salah during shift'],
    snippet:'How to fit daily prayers into a work or school schedule — finding space, talking to employers, and knowing when combining prayers is valid.'},

  { id:'finding-jamaah-away', title:'Finding Jama\'ah While Away From Home', icon:'mosque', tag:'Scenario', time:'3 min',
    related:['travel','mosque-etiquette','jumuah'],
    summary:'Locating a mosque and congregational prayer when traveling, relocating, or visiting somewhere new.',
    steps:[
      {title:'Search before you arrive, not after', body:'A quick search for mosques at your destination before you travel saves scrambling once you\'re there, especially in unfamiliar cities.'},
      {title:'Use the Find a Mosque feature', body:'Once available, this app feature will help locate nearby mosques and their Jama\'ah times directly from your location.'},
      {title:'Ask locally — taxi drivers, hotel staff, and shopkeepers often know', body:'In many cities, especially with visible Muslim communities, asking around locally can be faster than searching online.'},
      {title:'Check if the mosque follows a different madhab\'s timing', body:'Some mosques calculate Asr or Isha slightly differently based on their school of thought — don\'t assume the same schedule as home.'},
      {title:'If no mosque is nearby, gather 2-3 people for Jama\'ah anywhere', body:'Congregational prayer doesn\'t require a mosque — even a small group of Muslims in a hotel room or shared space praying together earns the reward of Jama\'ah.'},
      {title:'Check mosque apps and online directories specific to your destination country', body:'Many countries and cities have their own dedicated mosque-finder apps or community directories, often more complete than generic map searches for that region.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on the reward of congregational prayer'}],
    keywords:['find mosque while traveling','jamaah away from home','mosque near me travel','congregational prayer while visiting'],
    snippet:'How to find congregational prayer and a mosque while traveling or visiting a new city, including options when no mosque is available.'},

  { id:'fasting-physical-job', title:'Fasting with a Physically Demanding Job', icon:'moon', tag:'Scenario', time:'4 min',
    summary:'Managing Ramadan fasting alongside manual labor, long shifts, or physically strenuous work.',
    steps:[
      {title:'Adjust your suhoor for sustained energy', body:'Prioritize complex carbohydrates, protein, and hydration over sugary or heavy foods, which spike and crash energy quickly during demanding physical work.'},
      {title:'Pace your exertion throughout the shift', body:'If possible, front-load the most demanding tasks earlier in the fast when energy is higher, saving lighter tasks for later hours.'},
      {title:'Know the genuine exemption for hardship', body:'If fasting causes real harm — not just difficulty, but danger to health — Islamic law permits breaking the fast and making up the day later (Qur\'an 2:184). This is not a small allowance to take lightly, but it exists for real cases.'},
      {title:'Talk to your employer if adjustments are possible', body:'Some workplaces allow shift adjustments during Ramadan — it doesn\'t hurt to ask, especially in workplaces with other fasting employees.'},
      {title:'Stay hydrated during non-fasting hours', body:'Physically demanding work increases fluid loss — prioritize water intake at suhoor and iftar rather than relying on caffeinated drinks.'},
      {title:'Rest when you can, even briefly', body:'A short break to sit, breathe, and recover during the workday — even five minutes — helps sustain the fast without pushing your body past reasonable limits.'}
    ],
    sources:[{book:'Qur\'an', ref:'2:184, verse on exemptions from fasting due to hardship'},{book:'Fiqh us-Sunnah', ref:'Chapter on excuses for breaking the fast'}],
    keywords:['fasting manual labor ramadan','fasting physical job','ramadan construction work','fasting while working out'],
    snippet:'How to manage Ramadan fasting during physically demanding work — pacing energy, knowing genuine exemptions, and staying safe.'},

  { id:'ramadan-timezones', title:'Ramadan Timing Across Time Zones', icon:'moon', tag:'Scenario', time:'3 min',
    summary:'How fasting hours, moon sighting, and prayer times work when you travel across time zones during Ramadan.',
    steps:[
      {title:'Fasting hours follow local time, not your origin', body:'When you cross time zones, your fasting hours reset to the local dawn and sunset of wherever you currently are — not the schedule from where you started.'},
      {title:'Extremely long or short fasting days are handled with local timing', body:'In regions with unusual daylight patterns (very long or very short days), most scholars recommend following the nearest moderate location\'s timing or your home country\'s timing, rather than the extreme local hours (this is a debated area — several approaches exist).'},
      {title:'Moon sighting may differ by country', body:'Ramadan\'s start and end dates can vary by a day depending on regional moon sighting methods — check local mosque announcements rather than assuming your home country\'s dates apply.'},
      {title:'Use reliable prayer time apps set to your current location', body:'Ensure your app\'s location settings update automatically when you travel, so fasting and prayer times reflect where you actually are.'},
      {title:'A day "lost" or "gained" crossing the international date line has scholarly guidance', body:'This is a genuinely rare and complex situation — if it applies to you, consult a knowledgeable scholar for your specific itinerary rather than guessing.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on fasting and geographic variation'}],
    keywords:['ramadan different timezone','fasting hours travel','ramadan long days country','moon sighting ramadan travel'],
    snippet:'How Ramadan fasting hours, moon sighting, and prayer times adjust when traveling across time zones during the month.'},

  { id:'mosque-with-kids', title:'Attending the Mosque with Young Children', icon:'users', tag:'Scenario', time:'3 min',
    summary:'Practical tips for bringing children to the mosque without stress — for you or for others praying nearby.',
    steps:[
      {title:'Remember the Prophet ﷺ welcomed children in the mosque', body:'He was known to shorten his prayer if he heard a baby crying, out of consideration for the mother (Sahih al-Bukhari) — children belong in the mosque, not as a disruption to tolerate but as part of the community.'},
      {title:'Bring quiet activities for young children', body:'Small toys, snacks, or a coloring book can help children stay occupied calmly during longer parts of the service, like the khutbah.'},
      {title:'Position yourself near an exit for easy stepping out', body:'If a child becomes fussy, having a quick path outside means less disruption and less stress for you.'},
      {title:'Teach older children the basics gradually, not all at once', body:'Rather than expecting perfect stillness, let kids gradually learn the rhythm of standing, bowing, and prostrating by watching and mimicking over time.'},
      {title:'Talk to other parents at your mosque', body:'Many mosques have informal or formal parent networks — connecting with them normalizes the experience and provides mutual support.'},
      {title:'Don\'t feel guilty for their noise', body:'A crying baby or a fidgety toddler is not a failure on your part — the earliest Muslim community prayed with children present as a matter of course.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on shortening prayer for a crying child'}],
    keywords:['bringing kids to mosque','children in mosque islam','toddler at jummah prayer','kids disrupting salah'],
    snippet:'Practical advice for bringing young children to the mosque, rooted in how the Prophet ﷺ himself welcomed children during prayer.'},

  { id:'praying-while-sick', title:'Praying While Sick or Injured', icon:'heart', tag:'Scenario', time:'4 min',
    summary:'How Salah adapts to illness, injury, and physical limitation — prayer remains accessible in nearly every condition.',
    steps:[
      {title:'Pray standing if you can, even with support', body:'If you can stand while leaning on a wall, cane, or piece of furniture, this is still preferred over sitting.'},
      {title:'Pray seated if standing isn\'t possible', body:'If standing is too difficult or medically inadvisable, sit for the entire prayer, performing ruku and sujood with a lower bow from the seated position.'},
      {title:'Pray lying down if seated isn\'t possible either', body:'If you cannot sit up, you may pray lying on your side facing the Qibla, or on your back with feet toward the Qibla if that\'s the only option, using slight movements or eye motion for ruku and sujood in extreme cases.'},
      {title:'Adjust wudu for injuries or medical devices', body:'If a wound, cast, or bandage prevents washing a limb, wiping over the covering (masah) is often sufficient — this is a well-established concession (some schools of thought have specific conditions for how long this applies).'},
      {title:'Combine prayers if illness makes frequent movement difficult', body:'In cases of genuine hardship from illness, combining Dhuhr with Asr, and Maghrib with Isha, is permitted by many scholars to reduce physical strain.'},
      {title:'Know that reduced capacity does not reduce reward', body:'The Prophet ﷺ said that when a servant falls ill or travels, they still receive the reward of the good deeds they used to do when well and settled (Sahih al-Bukhari) — illness does not diminish your standing.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on reward during illness and travel'},{book:'Fiqh us-Sunnah', ref:'Chapter on prayer for the sick'}],
    keywords:['praying while sick islam','salah with injury','prayer bedridden muslim','how to pray if you cant stand'],
    snippet:'How to pray while sick, injured, or physically limited — standing, sitting, or lying down, with wudu adaptations for wounds and casts.'},

  { id:'breaking-fast-traveling', title:'Breaking Fast While Still Traveling', icon:'plane', tag:'Scenario', time:'3 min',
    related:['fasting','travel','ramadan-timezones'],
    summary:'What to do at sunset when you\'re mid-journey and haven\'t reached your destination.',
    steps:[
      {title:'Break your fast at the correct local time, not your destination\'s time', body:'Iftar happens based on sunset wherever you currently are — not the time zone or city you\'re heading toward.'},
      {title:'Keep dates and water accessible while traveling', body:'Packing a small snack for iftar means you\'re not caught unprepared if you\'re still in transit — on a plane, train, or road at sunset.'},
      {title:'If flying, check with airline staff or use a reliable app for local sunset time', body:'Time zones shift quickly during flights — a prayer app with GPS tracking gives a more accurate iftar time than guessing based on your departure city.'},
      {title:'Delay if you\'re unsure, don\'t break early', body:'If genuinely uncertain whether sunset has occurred at your current location, it\'s safer to wait a few extra minutes than to break the fast prematurely.'},
      {title:'Continuing travel after iftar doesn\'t affect your fast\'s validity', body:'Once you\'ve broken your fast at the correct time, continuing your journey afterward has no bearing on that day\'s fast — it was already completed correctly.'},
      {title:'Remember travelers have the option to not fast at all', body:'As a traveler, you\'re permitted to break your fast entirely and make up the missed day later — this timing guidance is for those choosing to fast anyway while in transit.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on the timing of Iftar during travel'}],
    keywords:['breaking fast while traveling','iftar time flight','ramadan travel sunset time','fasting on a plane'],
    snippet:'How to correctly time breaking your fast while still traveling — using local sunset time rather than your destination\'s schedule.'},

  { id:'quran-with-interruptions', title:'Reciting Qur\'an with Frequent Interruptions', icon:'book', tag:'Scenario', time:'3 min',
    summary:'Maintaining a Qur\'an habit around a busy, unpredictable schedule — kids, work, and constant distractions.',
    steps:[
      {title:'Lower the bar for what counts as "enough"', body:'A few verses recited with focus is better than a long session abandoned halfway through in frustration — consistency matters more than volume.'},
      {title:'Use small pockets of time intentionally', body:'Waiting rooms, commutes, or the few minutes before a meeting can hold a page or two — treat these moments as valid recitation time, not just "not enough time."'},
      {title:'Mark your place clearly so restarting is effortless', body:'A bookmark or app that saves your exact position removes the friction of "where was I?" that often derails a habit after interruption.'},
      {title:'It\'s fine to pause mid-verse if truly necessary', body:'Life interrupts — pausing to attend to a child or an urgent task and resuming later doesn\'t diminish the value of what you\'ve already recited.'},
      {title:'Pair recitation with an existing daily habit', body:'Attaching Qur\'an time to something you already do consistently (after Fajr, before sleeping) makes it easier to protect from interruption.'},
      {title:'Remember that effort amid difficulty carries its own reward', body:'The Prophet ﷺ said the one who recites the Qur\'an with difficulty will have a double reward (Sahih Muslim) — a fragmented, effortful practice is not lesser in Allah\'s sight.'}
    ],
    sources:[{book:'Sahih Muslim', ref:'Hadith on the double reward for reciting with difficulty'}],
    keywords:['quran reading busy schedule','reciting quran with kids around','quran habit interruptions','how to read quran consistently'],
    snippet:'How to build and maintain a Qur\'an recitation habit despite a busy, interrupted schedule — using small pockets of time effectively.'},


  { id:'should-i-pray-now', title:'Should I Pray Right Now? A Decision Guide', icon:'compass', tag:'Fiqh', time:'4 min',
    summary:'A practical framework for figuring out whether you can, should, or must pray in your current situation.',
    steps:[
      {title:'Check: Has the prayer time actually started?', body:'Each prayer has a defined window. If the time hasn\'t begun yet (e.g., it\'s still before Dhuhr), wait — praying early doesn\'t count for that prayer.'},
      {title:'Check: Is the time window about to close?', body:'If you\'re near the end of a prayer\'s window (like Asr just before Maghrib), pray immediately rather than risk missing it — a rushed prayer within time is better than a missed one.'},
      {title:'Check: Are you in a state of purity?', body:'If you\'re not sure you have wudu, it\'s safer to redo it. If you can\'t access water and none is nearby, tayammum becomes valid.'},
      {title:'Check: Is your current location reasonably clean?', body:'You don\'t need a perfect space — just a clean-enough spot to place your forehead. A clean cloth, mat, or even a clean patch of floor works.'},
      {title:'Check: Can you determine the Qibla direction?', body:'Use a compass app if unsure. If you genuinely cannot determine direction (like on a plane with no reference), pray facing your best estimate — the effort is what matters (some schools of thought are lenient here given genuine inability).'},
      {title:'Check: Are you physically able to perform normal movements?', body:'If yes, pray standing with full movements. If illness, injury, or the situation prevents this, adapt — sitting, lying down, or minimal movements are all valid based on your capability.'},
      {title:'Conclusion: In almost every situation, the answer is yes', body:'Islamic law is built so that prayer remains accessible in nearly every circumstance — the form adapts, but the obligation rarely disappears entirely.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on conditions and concessions in prayer'}],
    keywords:['can i pray right now','when am i allowed to pray islam','prayer conditions checklist','is it time to pray'],
    snippet:'A step-by-step decision framework to determine whether you can pray in your current situation — covering timing, purity, direction, and physical ability.'},

  { id:'can-i-fast-today', title:'Can I Fast Today? A Decision Guide', icon:'moon', tag:'Fiqh', time:'4 min',
    summary:'A clear framework for determining whether fasting is required, permitted, exempted, or discouraged for you today.',
    steps:[
      {title:'Check: Are you menstruating or in postpartum bleeding?', body:'If yes, fasting is not permitted during this time — you are exempted and will make up the day later. This is not optional avoidance; it\'s a required pause.'},
      {title:'Check: Are you pregnant or breastfeeding and fasting poses genuine risk?', body:'If a doctor or your own clear assessment indicates real risk to you or the baby, you may break the fast and make up the day later, or in some views, pay fidyah (compensation) instead — check which applies to your situation.'},
      {title:'Check: Are you traveling a recognized distance?', body:'If you\'re on a genuine journey, fasting is optional — you may fast if it\'s not difficult, or delay to another day if it is (Qur\'an 2:184).'},
      {title:'Check: Are you seriously ill or on medication that requires food?', body:'Genuine illness that fasting would worsen is a valid reason to break the fast, with make-up days once recovered — or fidyah if the illness is chronic and unlikely to improve.'},
      {title:'Check: Is today a day fasting is actually forbidden?', body:'The two Eid days (Eid al-Fitr and Eid al-Adha) are days fasting is not permitted, regardless of intention or reason.'},
      {title:'Check: None of the above apply?', body:'If you are healthy, not traveling, not menstruating, and it\'s a permitted day — fasting is expected as normal, whether it\'s Ramadan or a voluntary fast day you\'ve intended.'},
      {title:'Remember: exemptions are mercy, not failure', body:'Using a valid exemption is not a lesser form of worship — it\'s following the same guidance that instructs you to fast in the first place.'}
    ],
    sources:[{book:'Qur\'an', ref:'2:184-185, verses on fasting exemptions'},{book:'Fiqh us-Sunnah', ref:'Chapter on who is exempted from fasting'}],
    keywords:['can i fast today islam','fasting exemptions checklist','am i allowed to skip fasting','ramadan fasting rules who is exempt'],
    snippet:'A decision framework covering who is exempt from fasting — illness, travel, pregnancy, menstruation — and when fasting remains required.'},

  { id:'is-this-halal-framework', title:'Is This Halal? A General Framework', icon:'scale', tag:'Fiqh', time:'4 min',
    summary:'The underlying principles Islamic scholars use to assess whether something is permissible, rather than a list of specific rulings.',
    deeperDive:'Many people approach halal/haram as a memorized list, but the tradition actually works from a small number of underlying principles applied to countless situations. The default assumption in Islamic law is permissibility (al-asl fil-ashya al-ibaha) — things are considered allowed unless there is a specific, clear textual reason to forbid them. This matters because it shifts the burden: you don\'t need to prove something is halal, you need a real reason to believe it\'s haram. Scholars also weigh harm (dharar) heavily; anything with clear, established harm to the body, mind, or society tends to be restricted even without an explicit verse, because the broader objectives of Islamic law (maqasid al-shariah) include protecting life, intellect, and wellbeing. When genuinely unsure, the guidance to "leave what makes you doubt for what does not make you doubt" (Jami\' at-Tirmidhi) offers a practical, personal filter beyond formal rulings.',
    steps:[
      {title:'Start from the default: things are permissible unless proven otherwise', body:'Islamic law\'s baseline assumption is that everyday matters — food, activities, objects — are allowed unless clear evidence forbids them.'},
      {title:'Check if there\'s a direct textual prohibition', body:'Some things are explicitly named as haram in the Qur\'an or authentic hadith — pork, alcohol, gambling, interest (riba). These don\'t require additional reasoning.'},
      {title:'Check if it causes clear harm', body:'Even without an explicit verse, things that cause significant harm to health, mind, or relationships often fall under general principles against self-harm and harming others.'},
      {title:'Check if it involves deception or injustice', body:'Fraud, cheating, exploitation, or dishonesty in any transaction is broadly prohibited under Islamic principles of justice, even in situations not explicitly named in scripture.'},
      {title:'Check if scholars differ, and if so, why', body:'Some matters are genuinely debated among schools of thought — this isn\'t a sign of confusion in Islam, but of scholars applying the same principles to complex or new situations differently.'},
      {title:'If genuinely unsure, lean toward caution', body:'The Prophet ﷺ advised leaving what causes doubt for what doesn\'t cause doubt (Jami\' at-Tirmidhi) — when uncertain, the safer choice is often the more cautious one.'},
      {title:'Ask a knowledgeable source for anything high-stakes', body:'For significant decisions (financial products, medical procedures, business dealings), a general framework is a starting point — consult someone qualified for your specific situation.'}
    ],
    sources:[{book:'Jami\' at-Tirmidhi', ref:'Hadith on leaving doubtful matters'},{book:'Fiqh us-Sunnah', ref:'Introduction on principles of permissibility'}],
    keywords:['is this halal framework','how to know if something is haram','islamic principles permissible','halal haram general rules'],
    snippet:'The underlying principles scholars use to determine permissibility in Islam — not a memorized list, but a framework you can apply broadly.'},

  { id:'actions-during-prayer', title:'What Can I Do During Prayer? A Decision Guide', icon:'pray', tag:'Fiqh', time:'3 min',
    summary:'A quick reference for what breaks Salah, what\'s discouraged, and what\'s genuinely fine to do mid-prayer.',
    steps:[
      {title:'Speaking intentionally: breaks the prayer', body:'Deliberately talking to someone or responding to a question invalidates the prayer — this is one of the clearer invalidators across all schools of thought.'},
      {title:'Coughing, sneezing, or clearing your throat: does not break it', body:'Involuntary sounds like these don\'t invalidate the prayer — continue as normal.'},
      {title:'Correcting the Imam\'s recitation mistake: permitted, even encouraged', body:'If you\'re following an Imam and notice a recitation error, saying "Subhanallah" (for men) to alert them is acceptable and doesn\'t break your prayer.'},
      {title:'Moving to address a genuine necessity: usually permitted with limits', body:'Taking a small step to stop a child from danger, or adjusting clothing that has slipped, is generally allowed if minimal and necessary — excessive movement is discouraged.'},
      {title:'Crying due to genuine emotion or reflecting on the Qur\'an: does not break it', body:'Tears from sincere emotional response to what you\'re reciting are not only permitted but were part of the Prophet\'s ﷺ own practice.'},
      {title:'Answering your phone or checking a notification: breaks the prayer', body:'This counts as a deliberate distraction and interruption — silence your phone before starting.'},
      {title:'Laughing audibly: breaks the prayer', body:'Unlike a quiet smile, audible laughter is considered an invalidator by consensus among scholars.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on invalidators of prayer'},{book:'Sahih al-Bukhari', ref:'Hadith on correcting recitation during prayer'}],
    keywords:['what breaks salah','things that invalidate prayer islam','can i cough during prayer','actions allowed during salah'],
    snippet:'A quick reference guide for what actions invalidate prayer, what\'s discouraged, and what\'s genuinely fine to do while praying.'},

  { id:'ghusl-or-wudu', title:'Do I Need Ghusl or Just Wudu? A Decision Guide', icon:'shower', tag:'Fiqh', time:'3 min',
    summary:'Determining which level of purification you need before prayer, based on what happened.',
    steps:[
      {title:'Ask: Has sexual intimacy or ejaculation occurred?', body:'This requires a full ghusl (complete ritual bath), not just wudu — this is one of the clearest triggers for ghusl.'},
      {title:'Ask: Has your menstrual or postpartum bleeding just ended?', body:'Ghusl is required once bleeding stops, before resuming prayer and fasting.'},
      {title:'Ask: Have you just embraced Islam?', body:'A ghusl is recommended upon converting to Islam, as a symbolic and physical fresh start (some schools of thought treat this as strongly recommended rather than obligatory).'},
      {title:'Ask: Have you simply used the bathroom, passed gas, or touched something impure?', body:'These situations require only wudu, not a full ghusl — a common point of confusion.'},
      {title:'Ask: Have you slept deeply enough to lose awareness?', body:'Deep sleep that removes full consciousness invalidates wudu — you\'ll need to redo wudu, though not necessarily ghusl unless one of the ghusl triggers above also applies.'},
      {title:'Ask: Have you touched your spouse without arousal or fluid release?', body:'Simple touch or affection without the specific triggers above does not require ghusl (some schools of thought differ on whether it invalidates wudu at all).'},
      {title:'When in doubt between the two, ghusl covers both', body:'A full ghusl includes the purification of wudu within it — if genuinely uncertain which is required, performing ghusl resolves both possibilities.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapter on the causes of major and minor ritual impurity'},{book:'Sahih Muslim', ref:'Hadith on the necessity of ghusl after intimacy'}],
    keywords:['do i need ghusl or wudu','when is full bath required islam','ghusl triggers checklist','wudu vs ghusl difference'],
    snippet:'A clear decision guide for determining whether a situation requires full ghusl or just standard wudu before prayer.'},


  { id:'new-muslim-first-month', title:'A New Muslim\'s First Month', icon:'star', tag:'Life Stage', time:'5 min',
    summary:'A roadmap for the first weeks after taking Shahada — what to focus on first, and where to find deeper guidance.',
    deeperDive:'The first month after Shahada is often described by converts as simultaneously overwhelming and clarifying — overwhelming because there is genuinely a lot to learn, clarifying because the core of Islam is simpler than it can appear from outside. A useful psychological reframe: you are not expected to master everything at once. The Prophet ﷺ taught the religion to the earliest converts gradually, prioritizing belief and the essentials of worship before layering in the deeper details of law and jurisprudence over years. Many converts report that trying to learn everything simultaneously — Arabic, fiqh, history, all five prayers perfectly — creates burnout. A staged approach, one solid habit at a time, tends to produce more lasting change than trying to become a scholar in week one.',
    steps:[
      {title:'Understand what actually changed: your declaration of faith', body:'Saying the Shahada sincerely is what makes you Muslim — everything else is practice you build over time, not a prerequisite you needed beforehand.'},
      {title:'Learn Wudu and the basic prayer movements first', body:'These are the most immediate practical skills — see the Wudu and Salah guides for step-by-step walkthroughs with Arabic and transliteration.'},
      {title:'Don\'t worry about praying five times perfectly right away', body:'Start with what you can manage — even one or two prayers a day while you\'re learning — and build up. Consistency over time matters more than immediate perfection.'},
      {title:'Find a local mosque or community, even virtually', body:'Community support makes an enormous difference in the early period — see the Mosque Etiquette and Finding Jama\'ah guides for what to expect.'},
      {title:'Expect family and social adjustment, and that\'s normal', body:'How friends and family respond varies widely — see the Family Etiquette and Islamic Identity guides for navigating this transition with patience.'},
      {title:'Learn a few short Qur\'an chapters, not the whole book at once', body:'Surah Al-Fatihah and a few short chapters (like Al-Ikhlas) are enough to begin praying properly — deeper Qur\'an study can follow at your own pace.'},
      {title:'Give yourself grace for mistakes', body:'Forgetting steps, mixing up Arabic, or feeling awkward at the mosque are completely normal in the first weeks — everyone who has ever learned this started exactly where you are now.'},
      {title:'Explore Tawheed and the foundations of belief when ready', body:'Once daily practice feels more natural, the Tawheed Foundations guide offers a deeper look at the core beliefs underlying everything you\'re now practicing.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on the gradual teaching of religion to new believers'},{book:'Fiqh us-Sunnah', ref:'Introduction on the pillars of faith and practice'}],
    keywords:['new muslim guide','what to do after shahada','convert to islam first steps','new revert guide islam'],
    snippet:'A roadmap for the first month after taking Shahada — prioritizing what matters most and pointing to deeper guides as you\'re ready.'},

  { id:'converts-journey', title:'The Convert\'s Ongoing Journey', icon:'compass', tag:'Life Stage', time:'5 min',
    summary:'Guidance for the months and years after converting — identity, family relationships, and finding lasting community.',
    steps:[
      {title:'Expect your relationship with faith to keep evolving', body:'The intensity of early conversion often shifts into something steadier over time — this isn\'t losing faith, it\'s faith becoming lived-in rather than novel.'},
      {title:'Navigate family relationships with patience', body:'Some families adjust quickly, others take years, and some never fully accept it — see the Family Etiquette guide for maintaining ties of kinship even amid tension.'},
      {title:'Distinguish cultural practices from Islamic requirements', body:'Many converts feel pressure to adopt a specific culture alongside Islam — they\'re separate. See the Innovation (Bid\'ah) guide for understanding what\'s actually religious versus cultural.'},
      {title:'Build a support network of other converts if possible', body:'Other people who\'ve walked this specific path often understand challenges that born-Muslim friends, however well-meaning, may not fully grasp.'},
      {title:'Address doubts directly rather than suppressing them', body:'Questions and doubts are a normal part of a maturing faith, not a sign of failure — see the Dealing with Doubt guide for a range of perspectives on working through them.'},
      {title:'Deepen your knowledge at a sustainable pace', body:'There\'s no deadline for becoming a scholar — the Seeking Knowledge guide frames this as a lifelong process, not a race.'},
      {title:'Consider what "explaining Islam" means for you personally', body:'Some converts become natural educators for curious friends and family; others prefer to practice quietly — both are valid, and neither is required of you.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on the rights of new believers and community integration'}],
    keywords:['convert muslim journey','revert struggles islam','new muslim family issues','convert identity islam'],
    snippet:'Guidance for the ongoing journey after the first weeks of conversion — family dynamics, doubt, community, and sustainable growth.'},

  { id:'parents-teaching-kids', title:'A Parent\'s Guide to Teaching Kids Islam', icon:'users', tag:'Life Stage', time:'5 min',
    summary:'How to introduce Islamic practice to children at an age-appropriate pace, without pressure or disconnection.',
    steps:[
      {title:'Start with love and warmth, not obligation', body:'Children who associate Islam with connection and comfort in early years tend to carry that association forward — see the Family Etiquette guide for the broader framework of a warm Islamic home.'},
      {title:'Introduce prayer through participation, not instruction alone', body:'Young children often learn salah best by praying alongside you and mimicking movements, well before they understand every detail — formal teaching can follow around age seven, as is traditionally recommended.'},
      {title:'Make Ramadan inclusive even before they fast', body:'Young children can participate in suhoor, decorate for iftar, or do partial fasts as they grow — full fasting typically begins around puberty, but the culture of the month can start much earlier.'},
      {title:'Read Qur\'an stories in an engaging, age-appropriate way', body:'Stories of the prophets are often the most accessible entry point for young children — the Qur\'an Etiquette guide covers respect for the text itself as children grow into handling it directly.'},
      {title:'Answer hard questions honestly, even if imperfectly', body:'Kids ask "why" constantly — an honest "I don\'t fully know, but here\'s what I understand" builds more trust than a dismissive non-answer.'},
      {title:'Model consistency more than perfection', body:'Children notice whether practice is genuine and steady far more than whether it\'s flawless — your own effort, visible to them, teaches more than any lecture.'},
      {title:'Expect the teenage years to bring their own questions', body:'As children become teenagers, see the Islamic Identity as a Young Person guide, written directly for them, to support their own developing relationship with faith.'}
    ],
    sources:[{book:'Sunan Abu Dawud', ref:'Hadith on teaching children to pray from age seven'},{book:'Fiqh us-Sunnah', ref:'Chapter on raising children in the faith'}],
    keywords:['teaching kids islam','how to raise muslim children','kids prayer age','muslim parenting guide'],
    snippet:'How to introduce Islamic practice to children at each stage — from early participation to the teenage years — without pressure.'},

  { id:'elders-in-islam', title:'Elders in Islam: Worship, Rest, and Legacy', icon:'heart', tag:'Life Stage', time:'5 min',
    summary:'How Islamic practice adapts gracefully with age, and the honored place of elders in the Islamic tradition.',
    steps:[
      {title:'Know that prayer adapts to your body, not the other way around', body:'Sitting, using support, or reduced movements in prayer due to age are fully valid — see the Praying While Sick or Injured guide, which applies equally to the natural changes of aging.'},
      {title:'Understand the elevated status the Qur\'an gives elders', body:'The Qur\'an specifically commands gentleness and honor toward aging parents, even forbidding a sigh of impatience toward them (Qur\'an 17:23) — this is a foundational value, not an afterthought.'},
      {title:'Rest is not a spiritual failure', body:'Reduced physical capacity for standing, fasting, or attending every prayer in congregation does not diminish your standing — Allah rewards intention and consistent effort, not just physical output.'},
      {title:'Consider what legacy and knowledge you want to pass on', body:'Many elders find deep meaning in teaching grandchildren, sharing life experience, or mentoring younger community members — the Seeking Knowledge guide notes teaching as one of the most rewarded acts.'},
      {title:'Prepare practically and spiritually for end of life', body:'The Death Preparation guide covers practical steps — wills, repentance, and family clarity — that bring peace of mind rather than being something to avoid discussing.'},
      {title:'Stay connected to community even with reduced mobility', body:'Many mosques offer support for elderly attendance, or family and community members can help arrange transportation and company for prayer and gatherings.'},
      {title:'Continue seeking closeness to Allah at whatever pace fits', body:'Dhikr, dua, and reflection require no physical exertion and can deepen meaningfully in later years, often described by elders as a more peaceful and settled stage of faith.'}
    ],
    sources:[{book:'Qur\'an', ref:'17:23-24, verses on honoring aging parents'},{book:'Fiqh us-Sunnah', ref:'Chapter on prayer concessions for the elderly and infirm'}],
    keywords:['elderly muslim prayer','islam and aging','elders in islam honor','praying with limited mobility elderly'],
    snippet:'How Islamic practice gracefully adapts with age — prayer concessions, the honored status of elders, and preparing a lasting legacy.'},

  { id:'teen-young-adult-guide', title:'Teen & Young Adult: Building Your Own Islam', icon:'star', tag:'Life Stage', time:'5 min',
    summary:'A starting point for teenagers and young adults navigating faith, identity, relationships, and independence.',
    steps:[
      {title:'Start with understanding your identity as your own', body:'The Islamic Identity as a Young Person guide is written specifically for this stage — faith that becomes genuinely yours, not just inherited, tends to last.'},
      {title:'Navigate friendships, dating culture, and boundaries', body:'The Youth & Relationships guide addresses attraction, boundaries, and how Islam frames commitment — real questions this age group actually faces.'},
      {title:'Think intentionally about career and future direction', body:'The Career & Work for Young Muslims guide connects your ambitions with Islamic values, rather than treating them as separate tracks.'},
      {title:'Expect doubts, and know that\'s part of maturing faith', body:'The Dealing with Doubt in Faith guide offers multiple honest perspectives — doubt at this stage is common and workable, not something to hide or panic over.'},
      {title:'Build habits now that will carry you forward', body:'The Building a Consistent Prayer Practice guide focuses on realistic habit-building — more useful at this stage than aiming for unattainable perfection.'},
      {title:'Understand the foundations more deeply as you\'re ready', body:'The Tawheed Foundations and Seeking Knowledge guides offer a deeper dive once the basics feel settled — there\'s no rush, this is a lifelong process.'},
      {title:'Know that struggling with faith doesn\'t mean you\'re failing', body:'Many of the most grounded adults in their faith went through real questioning as teens and young adults — the struggle itself is often part of how faith becomes solid.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on the rights and responsibilities of young adults'}],
    keywords:['muslim teenager guide','young adult islam','islam for teens','muslim youth identity guide'],
    snippet:'A starting point for teens and young adults navigating faith, relationships, career, and doubt — pointing to deeper guides for each area.'},


  { id:'consistent-prayer-practice', title:'Building a Consistent Prayer Practice', icon:'refresh', tag:'Spiritual', time:'5 min',
    summary:'Practical, psychology-informed strategies for making the five daily prayers a genuine habit rather than a daily struggle.',
    deeperDive:'Habit researchers describe consistent behavior as depending less on willpower and more on removing friction and attaching new habits to existing cues — this maps closely onto how Islamic practice was structured from the start. The five prayers are already tied to natural time markers (dawn, midday, afternoon, sunset, night), which function as built-in habit cues far more reliable than an arbitrary reminder. From a psychological lens, the biggest threat to consistency isn\'t lack of belief, it\'s decision fatigue — having to decide anew each time whether "now" is a good time to stop and pray. Removing that decision (by fixing routines around the prayer window rather than deciding fresh each time) is often more effective than motivation alone. From a spiritual lens, scholars have long taught that consistency (even in small amounts) is more beloved to Allah than sporadic intensity — a teaching that happens to align closely with modern habit science.',
    steps:[
      {title:'Anchor prayer to something you already do consistently', body:'Rather than treating prayer as a separate task to remember, link it to an existing routine — right after you finish lunch for Dhuhr, right when you get home for Maghrib.'},
      {title:'Set a specific, early alarm for each prayer window', body:'An alarm right at the start of a prayer\'s time window, rather than near the end, gives you buffer and reduces the odds of the day running away from you.'},
      {title:'Track your prayers, even simply', body:'A basic checklist or app tracker creates visible momentum — many people find that not wanting to "break the streak" becomes its own motivator.'},
      {title:'Start with the prayer you find hardest, not easiest', body:'If Fajr is consistently the one you miss, focus your energy there specifically rather than spreading effort evenly — targeted habit change works better than general intention.'},
      {title:'Prepare the night before for Fajr specifically', body:'Sleeping earlier, keeping the alarm across the room, and having wudu-ready water nearby reduces the friction that usually derails the hardest prayer of the day.'},
      {title:'Forgive missed prayers without spiraling', body:'A missed prayer is a moment to make up (if within a reasonable window) and move forward — treating one miss as proof you\'ve failed tends to cause a larger collapse than the original miss itself.'},
      {title:'Remember the reward is in the effort, not just the outcome', body:'The Prophet ﷺ said the deeds most beloved to Allah are the most consistent, even if small (Sahih al-Bukhari) — small, steady effort outperforms occasional intensity.'}
    ],
    sources:[{book:'Sahih al-Bukhari', ref:'Hadith on the most beloved deeds being the most consistent'},{book:'Riyad as-Salihin', ref:'Chapter on moderation and consistency in worship'}],
    keywords:['how to be consistent with prayer','building salah habit','stop missing prayers islam','pray five times a day tips'],
    snippet:'Practical, psychology-informed strategies for making the five daily prayers a genuine, lasting habit rather than a daily struggle.'},

  { id:'prayer-feels-empty', title:'When Your Prayers Feel Empty', icon:'heart', tag:'Spiritual', time:'6 min',
    summary:'Multiple perspectives — spiritual, psychological, and practical — on the common experience of praying without feeling present.',
    deeperDive:'This experience is remarkably universal across the Islamic tradition — even companions of the Prophet ﷺ reported struggling with distraction in prayer, and entire chapters of classical fiqh texts address how to handle it. What varies is which lens helps a given person most. A theological lens frames the disconnect as spiritual — a heart in need of remembrance (dhikr) and closeness. A psychological lens frames it as attentional — the mind wandering is simply what unfocused minds do, and prayer is, among other things, a structured attention practice. A practical lens frames it as circumstantial — poor sleep, rushing, or lack of understanding of the words being recited will predictably produce a disconnected prayer regardless of sincerity. None of these lenses cancel the others out; most people benefit from addressing all three at once rather than assuming there\'s a single root cause.',
    steps:[
      {title:'Spiritual take: understand khushu as a skill, not a fixed trait', body:'Presence in prayer (khushu) is described in the tradition as something built over time through practice and sincerity, not something you either have or don\'t — early struggle is expected, not a red flag.'},
      {title:'Spiritual take: remember who you\'re speaking to', body:'Pausing before starting to consciously remember that you\'re addressing Allah directly — not performing a routine — can shift the felt experience of the prayer that follows.'},
      {title:'Psychological take: understand that mind-wandering is the brain\'s default state', body:'Neuroscience research on the brain\'s "default mode network" shows that minds wander during almost any repetitive or quiet activity — this isn\'t a personal spiritual failure, it\'s baseline human cognition.'},
      {title:'Psychological take: reduce cognitive load beforehand', body:'A racing, overloaded mind (from stress, multitasking, or rushing straight from a screen into prayer) is far less likely to settle — a brief pause before starting prayer to consciously transition can help.'},
      {title:'Practical take: learn the meaning of what you\'re reciting', body:'Reciting words in a language you don\'t understand naturally feels more mechanical — learning even the translation of Al-Fatihah and commonly recited short surahs often transforms the felt experience significantly.'},
      {title:'Practical take: slow down the physical pace', body:'Rushing through movements physically reinforces a rushed mental state — deliberately slowing your pace, even slightly, often brings the mind along with it.'},
      {title:'Combined approach: don\'t wait to "feel ready" to pray well', body:'Across all three lenses, the consistent advice is the same: keep praying attentively even when it doesn\'t feel emotionally rewarding — the feeling of connection often follows the practice, rather than preceding it.'}
    ],
    sources:[{book:'Riyad as-Salihin', ref:'Chapter on presence of heart in worship'},{book:'Fiqh us-Sunnah', ref:'Chapter on khushu and its cultivation'}],
    keywords:['prayer feels empty islam','no khushu in salah','distracted during prayer','how to focus during salah'],
    snippet:'Multiple perspectives — spiritual, psychological, and practical — on why prayers can feel disconnected, and how to work through it.'},

  { id:'dealing-with-doubt', title:'Dealing with Doubt in Faith', icon:'compass', tag:'Spiritual', time:'6 min',
    summary:'Different theological, emotional, and logical angles on religious doubt — a genuinely common experience, not a sign of failed faith.',
    deeperDive:'Islamic scholarship has a long history of directly engaging doubt rather than treating it as taboo — theologians like Al-Ghazali wrote extensively about his own period of profound doubt before arriving at a more settled faith, describing the process as ultimately strengthening rather than weakening his belief. This matters because many people experiencing doubt assume they\'re alone or uniquely broken, when in fact doubt is a well-documented and even historically productive part of religious development for many serious believers. Modern psychology of religion similarly frames doubt as a normal developmental stage rather than a pathology — often correlated with deeper, more examined faith later on, rather than apostasy. The key distinction worth holding onto is between doubt as an honest question seeking an answer, and doubt as a settled conclusion — the first is healthy and common; only you can determine, over time, which one you\'re experiencing.',
    steps:[
      {title:'Theological take: doubt is documented even among the earliest generations', body:'Companions of the Prophet ﷺ are recorded asking him directly about troubling thoughts and doubts, and he reassured them this itself was a sign of true faith, not its absence (Sahih Muslim) — this is a strikingly direct precedent.'},
      {title:'Theological take: distinguish between a whisper and a conclusion', body:'Islamic scholarship traditionally separates waswasa (intrusive, passing doubts) from a genuine settled disbelief — the former is considered a normal test, not sinful in itself.'},
      {title:'Emotional take: doubt often correlates with life stress, not just belief', body:'Grief, major life transitions, or burnout frequently manifest as spiritual doubt — addressing the underlying emotional state sometimes resolves what felt like a theological crisis.'},
      {title:'Emotional take: isolation makes doubt heavier', body:'Doubt processed alone, without any trusted person to talk to, tends to feel more catastrophic than doubt shared — even one honest conversation with someone non-judgmental can shift the emotional weight significantly.'},
      {title:'Logical take: separate the specific question from the whole framework', body:'A single unanswered question ("why does X happen") doesn\'t logically require abandoning an entire belief system — most worldviews, religious or secular, contain some unresolved questions.'},
      {title:'Logical take: seek out serious answers, not just reassurance', body:'If a specific intellectual question is driving the doubt, seeking a substantive answer from Islamic scholarship (rather than avoiding the question) tends to be more resolving than simply being told to have more faith.'},
      {title:'Practical take: give it time rather than forcing an immediate resolution', body:'Doubt resolved through patient reflection over months tends to produce more durable conviction than doubt suppressed quickly out of fear — rushing to "fix" it can sometimes bury the question rather than answer it.'}
    ],
    sources:[{book:'Sahih Muslim', ref:'Hadith on companions experiencing doubt and the Prophet\'s reassurance'},{book:'Riyad as-Salihin', ref:'Chapter on trials of faith and steadfastness'}],
    keywords:['doubting my faith islam','religious doubt muslim','waswasa doubts in islam','losing faith help'],
    snippet:'Theological, emotional, and logical perspectives on religious doubt — a documented, common experience rather than a sign of failed faith.'},

  { id:'why-islam-forbids-things', title:'Why Does Islam Forbid Certain Things?', icon:'shield', tag:'Spiritual', time:'5 min',
    summary:'A framework for understanding the reasoning behind Islamic restrictions, rather than treating them as arbitrary rules.',
    steps:[
      {title:'Understand the concept of maqasid al-shariah (objectives of Islamic law)', body:'Classical scholars identified core objectives behind Islamic law: protecting faith, life, intellect, lineage, and property — most specific rulings can be traced back to protecting one of these.'},
      {title:'Restrictions on substances protect the intellect', body:'Prohibitions like alcohol connect directly to protecting clear thinking and decision-making — the objective, not just the specific substance, is what the ruling serves.'},
      {title:'Restrictions on financial dealings protect fairness and property', body:'Riba (interest) and fraud are forbidden because they create systemic exploitation — the underlying objective is economic justice, not an arbitrary dislike of profit.'},
      {title:'Restrictions on relationships protect lineage and emotional wellbeing', body:'Boundaries around premarital relationships connect to protecting family structure, emotional security, and clear lines of responsibility — not a rejection of human connection itself.'},
      {title:'Some restrictions exist even without a fully explained reason', body:'Not every ruling comes with a stated rationale in the text — trusting divine wisdom even where the reasoning isn\'t immediately visible is itself considered part of faith (though many restrictions do have clear, traceable benefit).'},
      {title:'Restrictions are rarely about the act being "impure" for its own sake', body:'Reframing from "this is dirty or bad" to "this protects something valuable" tends to make the wisdom behind rulings more graspable than a purely moralistic framing.'},
      {title:'You\'re allowed to seek understanding, not just obey blindly', body:'Asking "why" about Islamic rulings is not disrespectful — Islamic scholarship has an extensive tradition of explaining wisdom (hikmah) behind law precisely because understanding deepens rather than threatens sincere practice.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Introduction on the objectives of Islamic law (maqasid al-shariah)'}],
    keywords:['why is this haram in islam','reasoning behind islamic rules','maqasid al shariah explained','why does islam forbid things'],
    snippet:'A framework for understanding the reasoning behind Islamic restrictions — rooted in protecting faith, life, intellect, lineage, and property.'},

  { id:'breaking-bad-habits', title:'Breaking Bad Habits: Islamic and Psychological Approaches', icon:'refresh', tag:'Spiritual', time:'5 min',
    summary:'Combining classical Islamic guidance on sin and repentance with modern behavioral science on habit change.',
    steps:[
      {title:'Islamic take: understand repentance as a repeatable process, not a one-time event', body:'Tawbah (repentance) in Islamic teaching is described as available every single time, without limit — the Prophet ﷺ said Allah is more pleased with a servant\'s repentance than a traveler finding a lost camel in the desert (Sahih Muslim), illustrating genuine relief rather than reluctant forgiveness.'},
      {title:'Psychological take: understand habits as cue-routine-reward loops', body:'Behavioral science frames habits as automatic responses to specific triggers — identifying your specific triggers (boredom, stress, a certain time of day) is often more effective than relying on willpower alone.'},
      {title:'Islamic take: replace, don\'t just remove', body:'The Prophet ﷺ taught following a bad deed with a good one to erase it (Jami\' at-Tirmidhi) — this mirrors modern habit-replacement strategies more closely than pure suppression.'},
      {title:'Psychological take: change your environment before relying on discipline', body:'Removing physical or digital triggers (blocking apps, changing routines, avoiding specific settings) reduces the number of times willpower is even tested — environment design often outperforms willpower.'},
      {title:'Islamic take: surround yourself with supportive company', body:'The Prophet ﷺ compared good and bad companionship to a perfume seller and a blacksmith (Sahih al-Bukhari) — who you spend time with measurably shapes what habits feel normal.'},
      {title:'Psychological take: expect and plan for relapse rather than being shocked by it', body:'Most successful habit change involves setbacks along the way — planning your response to a slip-up in advance prevents one lapse from spiraling into total abandonment.'},
      {title:'Combined approach: track small wins, not just the absence of failure', body:'Both traditions converge here — celebrating small, consistent progress (a day, then a week) tends to sustain motivation better than focusing only on the distant, larger goal.'}
    ],
    sources:[{book:'Sahih Muslim', ref:'Hadith on Allah\'s joy at a servant\'s repentance'},{book:'Jami\' at-Tirmidhi', ref:'Hadith on following bad deeds with good ones'},{book:'Sahih al-Bukhari', ref:'Hadith on the comparison of companionship to perfume and smoke'}],
    keywords:['breaking bad habits islam','how to stop sinning','islamic habit change','repentance and self improvement'],
    snippet:'Combining classical Islamic teaching on repentance and companionship with modern behavioral science on how habits actually change.'},

  { id:'staying-focused-salah', title:'Staying Focused During Salah', icon:'pray', tag:'Spiritual', time:'5 min',
    summary:'Practical and neurological perspectives on maintaining attention during prayer, and why distraction is normal, not shameful.',
    steps:[
      {title:'Neurological take: understand that sustained attention is naturally limited', body:'Cognitive research shows focused attention typically holds for only a few minutes before naturally drifting — expecting a completely undistracted five-minute prayer works against basic brain function, not against your sincerity.'},
      {title:'Practical take: recite with understanding, not just memorized sound', body:'Learning the meaning of what you\'re reciting engages more of the brain\'s language and comprehension centers than rote recitation, which tends to run on autopilot and drift more easily.'},
      {title:'Neurological take: reduce pre-prayer stimulation when possible', body:'Coming directly from a fast-paced, high-stimulation activity (scrolling, arguing, rushing) into prayer makes the mental shift harder — even 30 seconds of stillness beforehand can help the transition.'},
      {title:'Practical take: choose a fixed, minimally distracting spot when possible', body:'A consistent prayer space, away from visual clutter or a visible phone, reduces the number of environmental triggers competing for attention.'},
      {title:'Neurological take: gently redirect rather than fight the wandering mind', body:'Trying to forcefully "not think" about something usually backfires — noticing the distraction without frustration and gently returning to the recitation mirrors techniques used in focused-attention practices more broadly.'},
      {title:'Practical take: vary your recitation instead of always the same short surahs', body:'Repeating the exact same familiar verses every prayer can increase autopilot recitation — occasionally reciting something less memorized re-engages conscious attention.'},
      {title:'Spiritual take: remember that Allah is aware of your effort, not just the outcome', body:'The intention to focus and the effort of returning attention each time it wanders are themselves part of the worship — a wandering mind gently brought back repeatedly is not a failed prayer.'}
    ],
    sources:[{book:'Riyad as-Salihin', ref:'Chapter on presence of heart in prayer'},{book:'Fiqh us-Sunnah', ref:'Chapter on the etiquettes and inner dimensions of prayer'}],
    keywords:['how to focus in prayer','staying present during salah','mind wandering in prayer islam','improve concentration in salah'],
    snippet:'Practical and neurological perspectives on maintaining attention during prayer, and why the mind naturally wanders — and what helps.'},


  { id:'islamic-calendar-explained', title:'The Islamic Calendar Explained', icon:'moon', tag:'Good to know', time:'4 min',
    summary:'A simple guide to the Hijri calendar — its months, why dates shift each year, and how to plan around it.',
    steps:[
      {title:'Understand it\'s a lunar calendar, not solar', body:'The Islamic (Hijri) calendar follows the moon\'s cycle rather than the sun, making each year about 10-11 days shorter than the Gregorian calendar most countries use for civil dates.'},
      {title:'Know why dates shift every year', body:'Because the Hijri year is shorter, Islamic months and events (like Ramadan) shift roughly 10-11 days earlier each Gregorian year, cycling through all seasons over about 33 years.'},
      {title:'Learn the twelve months', body:'The months are: Muharram, Safar, Rabi\' al-Awwal, Rabi\' al-Thani, Jumada al-Awwal, Jumada al-Thani, Rajab, Sha\'ban, Ramadan, Shawwal, Dhul-Qa\'dah, and Dhul-Hijjah.'},
      {title:'Know the four sacred months', body:'Muharram, Rajab, Dhul-Qa\'dah, and Dhul-Hijjah are considered sacred months, traditionally associated with heightened restraint from conflict and increased mindfulness (Qur\'an 9:36).'},
      {title:'Understand the significance of key months', body:'Ramadan (the ninth month) is the month of fasting; Dhul-Hijjah (the twelfth) contains the Hajj pilgrimage and Eid al-Adha; Shawwal (the tenth) begins with Eid al-Fitr.'},
      {title:'Know how the new month is determined', body:'Traditionally, the start of each Hijri month depends on the sighting of the new crescent moon — some regions still use physical sighting, while others rely on astronomical calculation (this is a genuinely debated methodological difference, not a religious disagreement).'},
      {title:'Use both calendars practically', body:'Most Muslims track Gregorian dates for daily and work life, while following the Hijri calendar for religious observances — many prayer apps display both simultaneously for convenience.'}
    ],
    sources:[{book:'Qur\'an', ref:'9:36, verse on the sacred months'},{book:'Fiqh us-Sunnah', ref:'Chapter on the determination of Islamic months'}],
    keywords:['islamic calendar explained','hijri calendar months','why does ramadan move each year','islamic sacred months'],
    snippet:'A simple explanation of the Hijri lunar calendar — its twelve months, the four sacred months, and why Islamic dates shift each year.'},

  { id:'planning-your-islamic-year', title:'Planning Your Year Around the Islamic Calendar', icon:'moon', tag:'Good to know', time:'3 min',
    summary:'A practical look at what to expect and prepare for across the Hijri year, month by month in broad terms.',
    steps:[
      {title:'Muharram: the year begins, with Ashura included', body:'The tenth day of Muharram (Ashura) carries historical and spiritual significance, and voluntary fasting on this day is a well-established sunnah.'},
      {title:'Rajab and Sha\'ban: the lead-up to Ramadan', body:'Many Muslims use these two months to gradually increase worship and prepare spiritually and practically for the intensity of Ramadan ahead.'},
      {title:'Ramadan: the month of fasting', body:'The ninth month, marked by daily fasting from dawn to sunset, increased Qur\'an recitation, and the search for Laylat al-Qadr in the final ten nights.'},
      {title:'Shawwal: Eid al-Fitr and six days of voluntary fasting', body:'The month opens with Eid al-Fitr celebrations, and many follow the tradition of fasting six additional days sometime during this month.'},
      {title:'Dhul-Qa\'dah: a quieter sacred month', body:'One of the four sacred months, often used for continued reflection and preparation for those planning to perform Hajj the following month.'},
      {title:'Dhul-Hijjah: Hajj and Eid al-Adha', body:'The first ten days of this month are considered especially blessed, culminating in the Hajj pilgrimage for those able, and Eid al-Adha for the wider Muslim community.'},
      {title:'Use the Islamic Calendar feature in the app', body:'The Journal section\'s Islamic Calendar card tracks upcoming dates automatically, helping you plan ahead for fasting days, Eid, and other key dates without manual calculation.'}
    ],
    sources:[{book:'Fiqh us-Sunnah', ref:'Chapters on the virtues of specific months and voluntary fasting days'}],
    keywords:['islamic year planning','what to expect each hijri month','ramadan dhul hijjah calendar','muslim year overview'],
    snippet:'A practical, month-by-month overview of the Islamic calendar year — what each period means and how to prepare for it.'}
];

// Sync guides and categories to offline storage on page load
if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', () => {
    OfflineSync.syncCategories(CATEGORIES).catch(()=>0);
    OfflineSync.syncGuides(GUIDES).catch(()=>0);
  });
} else {
  OfflineSync.syncCategories(CATEGORIES).catch(()=>0);
  OfflineSync.syncGuides(GUIDES).catch(()=>0);
}

const QA = [];


// ==> GUIDE CATEGORIZATION
const GUIDE_CATEGORIES = {
  'Prayer': ['wudu', 'salah', 'ghusl', 'tayammum', 'adhan', 'sujoodsahw', 'qibla', 'jumuah', 'five-prayers', 'consistent-prayer-practice', 'prayer-feels-empty', 'actions-during-prayer', 'should-i-pray-now', 'staying-focused-salah', 'praying-in-car', 'wudu-limited-water', 'praying-at-work', 'praying-while-sick', 'prayer-with-disabilities'],
  'Etiquette': ['mosque-etiquette', 'home-etiquette', 'food-etiquette', 'quran-etiquette', 'manners', 'neighbors', 'work-etiquette', 'women-in-workplace', 'mosque-with-kids'],
  'Ritual Purification': ['wudu-mistakes', 'salah-mistakes', 'ghusl-or-wudu', 'common-mistakes'],
  'Fasting': ['fasting', 'ramadan', 'ramadan-preparation', 'ramadan-fasting-guide', 'laylat-qadr', 'eid', 'eid-prayer-detailed', 'can-i-fast-today', 'fasting-physical-job', 'ramadan-timezones', 'breaking-fast-traveling', 'fasting-medical-procedures', 'muharram-ashura'],
  'Scenarios': ['travel', 'finding-jamaah-away', 'hajj-umrah-basics', 'hajj-umrah-detailed', 'planning-your-islamic-year', 'islamic-calendar-explained'],
  'Personal Dev': ['patience-hardship', 'anger-management', 'gratitude', 'intention', 'seeking-knowledge', 'dealing-with-loss', 'dealing-with-doubt', 'why-islam-forbids-things', 'breaking-bad-habits', 'perfectionism-islamic-lens', 'geographic-isolation-faith', 'anxiety-waswasa-distinction'],
  'Knowledge': ['tawheed-basics', 'shirk-avoidance', 'innovation-bidah', 'is-this-halal-framework', 'seeking-knowledge-guide'],
  'Women': ['menstruation', 'postpartum', 'pregnancy-etiquette', 'women-leadership'],
  'Youth': ['youth-identity', 'youth-relationships', 'youth-career'],
  'Life Events': ['death-preparation', 'mourning-etiquette', 'grief-major-loss', 'divorce-islamic-process', 'interfaith-families', 'aging-parents-care', 'new-muslim-first-month', 'converts-journey', 'parents-teaching-kids', 'elders-in-islam', 'teen-young-adult-guide'],
  'Health': ['sleep', 'hygiene', 'chronic-illness-faith', 'mental-health-stigma'],
  'Finance': ['finance', 'financial-hardship-survival']
};

const CATEGORY_COLORS = {
  'Prayer': '#F4714E',
  'Etiquette': '#D4A574',
  'Ritual Purification': '#B8956A',
  'Fasting': '#E6B8A2',
  'Scenarios': '#C9A77A',
  'Personal Dev': '#A789A8',
  'Knowledge': '#8B7BA8',
  'Women': '#D4A5C8',
  'Youth': '#7FA8B8',
  'Life Events': '#A89575',
  'Health': '#9BBD8B',
  'Finance': '#C9A77A'
};
// <== GUIDE CATEGORIZATION

// Expose to other <script> blocks (e.g. the guides display override),
// which run in a sibling scope and cannot see these IIFE-local consts.
window.GUIDES = GUIDES;
window.getGuide = getGuide;
window.QA = QA;
window.GUIDE_CATEGORIES = GUIDE_CATEGORIES;
window.CATEGORY_COLORS = CATEGORY_COLORS;

/* ============================================================
   STATE
   ============================================================ */
const state = {
  selectedGuide: null,
  bookmarks: new Set(),
  completedSteps: {}, // guideId -> Set of step indices
};
GUIDES.forEach(g => { state.completedSteps[g.id] = new Set(); });
QA.forEach(q => { state.completedSteps[q.id] = new Set(); });

function getGuide(id){ return GUIDES.find(g=>g.id===id) || QA.find(q=>q.id===id); }

function persistGuides(){
  const completedSteps = {};
  Object.keys(state.completedSteps).forEach(id=>{ completedSteps[id] = Array.from(state.completedSteps[id]); });
  WWP.save('guides', { bookmarks: Array.from(state.bookmarks), completedSteps });
}
async function loadGuidesFromBackend(){
  const saved = await WWP.get('guides');
  if(!saved) return;
  if(Array.isArray(saved.bookmarks)) state.bookmarks = new Set(saved.bookmarks);
  if(saved.completedSteps){
    Object.keys(saved.completedSteps).forEach(id=>{
      if(state.completedSteps[id]) state.completedSteps[id] = new Set(saved.completedSteps[id]);
    });
  }
}

/* ============================================================
   UI :: render
   ============================================================ */
function renderSidebar(){
  const list = $('#guideList'); list.innerHTML='';
  GUIDES.forEach(g=>{
    const done = state.completedSteps[g.id];
    const allDone = done.size===g.steps.length && g.steps.length>0;
    const row = document.createElement('li');
    row.className = 'guide-row'+(state.selectedGuide===g.id?' active':'')+(allDone?' all-done':'');
    row.innerHTML = `
      <span class="g-row-icon">${iconSvg(g.icon,15)}</span>
      <div class="g-row-body">
        <div class="g-row-title">${g.title}</div>
        <div class="g-row-meta">${g.tag} · ${g.time}</div>
      </div>
      <span class="g-row-check">${allDone?iconSvg('check',11):''}</span>
    `;
    row.addEventListener('click', ()=> selectGuide(g.id));
    list.appendChild(row);
  });
  $('#guideSidebarCount').textContent = GUIDES.length+' guides';
}

function renderGuide(){
  const g = getGuide(state.selectedGuide);
  const emptyState = $('#guideEmptyState');
  const paneBody = $('#guidePaneBody');
  if(!g){
    if(emptyState) emptyState.style.display = '';
    if(paneBody) paneBody.style.display = 'none';
    return;
  }
  if(emptyState) emptyState.style.display = 'none';
  if(paneBody) paneBody.style.display = '';
  $('#guideOrn').innerHTML = iconSvg(g.icon,20);
  $('#guideTitle').textContent = g.title;
  $('#guideTag').textContent = g.tag;
  $('#guideTime').textContent = g.time;
  $('#guideSummary').textContent = g.summary;
  $('#guideBmBtn').classList.toggle('active-state', state.bookmarks.has(g.id));
  $('#guideBmBtn').style.background = state.bookmarks.has(g.id) ? 'var(--coral)' : 'var(--surface-alt)';
  $('#guideBmBtn').style.color = state.bookmarks.has(g.id) ? '#fff' : 'var(--text)';
  $('#guideBmBtn').style.borderColor = state.bookmarks.has(g.id) ? 'var(--coral)' : 'var(--border)';

  // info box (rak'ah counts, only for Salah)
  const infoSlot = $('#infoBoxSlot');
  if(g.rakahInfo){
    infoSlot.innerHTML = `
      <div class="info-box">
        <h4>Rak'ahs per prayer</h4>
        <div class="rakah-grid">
          ${g.rakahInfo.map(([name,count])=>`<div class="rakah-item"><div class="rk-name">${name}</div><div class="rk-count">${count}</div></div>`).join('')}
        </div>
      </div>`;
  } else {
    infoSlot.innerHTML = '';
  }

  const done = state.completedSteps[g.id];
  const stepsWrap = $('#guideSteps'); stepsWrap.innerHTML='';
  g.steps.forEach((step, idx)=>{
    const isDone = done.has(idx);
    const card = document.createElement('div');
    card.className = 'step-card'+(isDone?' done':'');
    card.innerHTML = `
      <span class="step-check" data-idx="${idx}">${isDone?iconSvg('check',13):''}</span>
      <div class="step-body">
        <div class="step-title"><span class="step-num" style="display:inline-flex;width:20px;height:20px;font-size:10.5px;margin-right:8px;vertical-align:middle;">${idx+1}</span>${step.title}</div>
        <div class="step-text">${step.body}</div>
        ${step.arabic ? `
          <div class="step-arabic-box">
            <div class="step-arabic">${step.arabic}</div>
            <div class="step-translit">${step.translit}</div>
            <div class="step-translation">${step.translation}</div>
          </div>` : ''}
      </div>
    `;
    card.querySelector('.step-check').addEventListener('click', ()=> toggleStep(g.id, idx));
    stepsWrap.appendChild(card);
  });

  $('#progressLabel').textContent = `${done.size} of ${g.steps.length} steps`;
  $('#progressFill').style.width = g.steps.length ? Math.round((done.size/g.steps.length)*100)+'%' : '0%';

  const crossSlot = $('#crossLinkSlot');
  if(g.crossLink){
    crossSlot.innerHTML = `<button class="cross-link-btn" id="crossLinkBtn">${g.crossLink.label} <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
    $('#crossLinkBtn').addEventListener('click', ()=>{
      if(typeof window.switchPage === 'function') window.switchPage(g.crossLink.page);
    });
  } else {
    crossSlot.innerHTML = '';
  }

  const relatedSlot = $('#relatedGuidesSlot');
  if(g.related && g.related.length){
    const chips = g.related.map(rid=>{
      const rg = getGuide(rid);
      return rg ? `<button class="related-chip" data-rid="${rid}">${rg.title}</button>` : '';
    }).join('');
    relatedSlot.innerHTML = `<div class="related-guides"><h4>Related guides</h4><div class="related-chips">${chips}</div></div>`;
    relatedSlot.querySelectorAll('.related-chip').forEach(btn=>{
      btn.addEventListener('click', ()=> window.WWP_openGuide(btn.dataset.rid));
    });
  } else {
    relatedSlot.innerHTML = '';
  }

  const noteSlot = $('#noteSlot');
  noteSlot.innerHTML = g.note ? `<div class="guide-note">💡<span>${g.note}</span></div>` : '';

  renderStats();
}

function renderStats(){
  $('#gBookmarkCount').textContent = state.bookmarks.size;
  const completedGuides = GUIDES.filter(g => state.completedSteps[g.id].size===g.steps.length && g.steps.length>0).length;
  $('#gCompletedCount').textContent = `${completedGuides} of ${GUIDES.length}`;
  const curG = getGuide(state.selectedGuide);
  $('#gContinueLabel').textContent = curG ? curG.title : 'No guide selected';
}

function renderAll(){
  renderSidebar();
  renderGuide();
}

/* ============================================================
   Actions
   ============================================================ */
function selectGuide(id, opts){
  opts = opts || {};
  // Toggle: if this guide is already selected, close it
  if(state.selectedGuide === id){
    state.selectedGuide = null;
    window.__WWP_currentGuide = null;
    renderAll();
    return;
  }
  state.selectedGuide = id;
  window.__WWP_currentGuide = id;
  renderAll();
  const pane = document.querySelector('#page-guides .guide-pane');
  if(pane) pane.scrollIntoView({behavior:'smooth', block:'start'});

  // Keep the URL in sync with the guide being read (e.g. /guides/wudu)
  // so each guide is independently linkable and indexable. Goes
  // straight to history.pushState (rather than back through
  // window.switchPage/WWP_openGuide) so clicking a guide in the list
  // can't re-trigger guide-selection and loop back into itself.
  if(!opts.skipRoute){
    const path = '/guides/'+id;
    if(location.pathname !== path){
      history.pushState({page:'guides', guide:id}, '', path);
    }
    if(window.__WWP_updateGuideSEO) window.__WWP_updateGuideSEO(id);
  }
}

function toggleStep(guideId, idx){
  const set = state.completedSteps[guideId];
  if(set.has(idx)) set.delete(idx); else set.add(idx);
  persistGuides();
  renderAll();
}

function toggleBookmark(id){
  if(state.bookmarks.has(id)){ state.bookmarks.delete(id); showToast('Removed from bookmarks'); }
  else { state.bookmarks.add(id); showToast('Guide bookmarked'); }
  persistGuides();
  renderAll();
}

/* ============================================================
   PAGE :: wire up + init
   ============================================================ */
async function init(){
  // Paint the guide shell first; bookmarks/progress hydrate afterwards.
  renderAll();
  loadGuidesFromBackend().then(renderAll).catch(()=>0);

  $('#guideBmBtn').addEventListener('click', ()=> { if(state.selectedGuide) toggleBookmark(state.selectedGuide); });
  $('#guideShareBtn').addEventListener('click', ()=>{
    const g = getGuide(state.selectedGuide);
    if(!g) return;
    const text = `${g.title} — WhereWePraying?`;
    Platform.share({title:'Guides', text}, ()=>{
      navigator.clipboard?.writeText(text).then(()=>showToast('Link copied — share it with others')).catch(()=>showToast('Sharing is not available on this device'));
    });
  });
  $('#progressReset').addEventListener('click', ()=>{
    if(!state.selectedGuide) return;
    state.completedSteps[state.selectedGuide] = new Set();
    persistGuides();
    renderAll();
    showToast('Progress reset for this guide');
  });

  // ==> CONNECT (resolved): bookmarks/progress now sync per-device via
  // WWP above. GUIDES content itself is still placeholder text pending
  // a scholar-reviewed source — separate from storage.

  // Tell the router this section is ready — if a direct visit landed
  // on /guides/<slug> before this section finished initializing, the
  // router queued the slug and opens it now.
  if(window.__WWP_guideSectionReady) window.__WWP_guideSectionReady();
}

// Cross-page deep link: lets other pages jump straight to a specific
// guide (e.g. "Explore More" cards on other sections, or the router
// resolving a direct visit to /guides/<slug>). `opts.skipRoute` is
// used internally by the router on initial load / back-forward,
// where it already owns the URL for that navigation.
window.WWP_openGuide = function(guideId, opts){
  opts = opts || {};
  if(guideId) selectGuide(guideId, {skipRoute:true});
  // Pass the *post-toggle* current guide (not the raw guideId argument)
  // on to switchPage. selectGuide() above toggles closed if guideId was
  // already open, setting __WWP_currentGuide back to null — passing the
  // original guideId here instead would make switchPage think a new
  // guide selection is needed and immediately reopen the one we just
  // closed, which is why a second tap on an open guide used to do
  // nothing (open -> close -> instant reopen).
  window.switchPage('guides', {guide: window.__WWP_currentGuide, skipHistory: !!opts.skipRoute});
};

init();

})();

/* ===== deferred: guides display override (grouped-by-category rendering) ===== */

/* ===== deferred feature script 08 ===== */
(function(){
// ==> GUIDES DISPLAY OVERRIDE
(function() {
  // Hook the real router (window.switchPage) rather than a nonexistent
  // window.showPage. switchPage is assigned synchronously above, so it
  // exists by the time this IIFE runs (this script tag loads after it).
  const originalSwitchPage = window.switchPage;
  window.switchPage = function(id, opts) {
    originalSwitchPage.call(this, id, opts);
    if (id === 'guides') {
      setTimeout(renderGroupedGuides, 150);
    }
  };

  window.renderGroupedGuides = function() {
    const pageContent = document.querySelector('#page-guides .page');
    if (!pageContent) return;

    let container = pageContent.querySelector('.guides-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'guides-container grouped-guides';
      const layout = pageContent.querySelector('.guides-layout');
      if (layout) {
        layout.parentNode.insertBefore(container, layout.nextSibling);
      } else {
        pageContent.appendChild(container);
      }
    }

    container.innerHTML = '';

    // === All Guides Section ===
    const guidesSection = document.createElement('div');
    guidesSection.className = 'collapsible-section';

    const guidesHeader = document.createElement('div');
    guidesHeader.className = 'collapsible-header open';
    guidesHeader.textContent = 'All Guides (Grouped by Category)';

    const guidesList = document.createElement('div');
    guidesList.className = 'collapsible-content';

    guidesHeader.addEventListener('click', function() {
      this.classList.toggle('open');
      guidesList.classList.toggle('closed');
    });

    guidesSection.appendChild(guidesHeader);
    guidesSection.appendChild(guidesList);

    Object.keys(GUIDE_CATEGORIES).forEach(cat => {
      const ids = GUIDE_CATEGORIES[cat];
      const guides = GUIDES.filter(g => ids.includes(g.id));
      const color = CATEGORY_COLORS[cat];

      if (guides.length > 0) {
        const catDiv = document.createElement('div');
        catDiv.className = 'guides-category';

        const catTitle = document.createElement('h3');
        catTitle.className = 'category-title';
        catTitle.textContent = cat;
        catDiv.appendChild(catTitle);

        const grid = document.createElement('div');
        grid.className = 'guides-grid';

        guides.forEach(g => {
          const card = document.createElement('div');
          card.className = 'guide-card';
          card.style.borderLeft = `4px solid ${color}`;

          const header = document.createElement('div');
          header.className = 'guide-header';

          const title = document.createElement('span');
          title.className = 'guide-title';
          title.textContent = g.title;

          const time = document.createElement('span');
          time.className = 'guide-time';
          time.textContent = g.time;

          header.appendChild(title);
          header.appendChild(time);
          card.appendChild(header);

          const summary = document.createElement('div');
          summary.className = 'guide-summary';
          summary.textContent = g.summary;
          card.appendChild(summary);

          card.addEventListener('click', () => window.WWP_openGuide(g.id));

          grid.appendChild(card);
        });

        catDiv.appendChild(grid);
        guidesList.appendChild(catDiv);
      }
    });

    container.appendChild(guidesSection);
  };

  // If the guides page is already the active page on load (e.g. direct
  // URL to /guides/...), render immediately rather than waiting for a
  // switchPage call that may never come.
  document.addEventListener('DOMContentLoaded', function() {
    const guidesPageEl = document.getElementById('page-guides');
    if (guidesPageEl && !guidesPageEl.classList.contains('hidden')) {
      setTimeout(renderGroupedGuides, 150);
    }
  });
})();
// <== GUIDES DISPLAY OVERRIDE

})();