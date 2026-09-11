// functions/api/admin/sync-masjidbox-jamaah.js
//
// Scraper for MasjidBox Jama'ah times (public frontend API, discovered via
// browser DevTools Network tab on masjidbox.com/prayer-times/{slug}).
// Approval on record: Abdullahi, MasjidBox chief of operations, via email.
//
// IMPORTANT: MasjidBox's API caps at a 7-day rolling window regardless of
// the `days` query param requested (verified: days=90/120/200 all silently
// return exactly 7 days; days=30/60/180 sometimes 500 under concurrent load).
// There is no bulk/year pull possible here — this must run on a recurring cron.
//
// STAGGERING STRATEGY: This endpoint processes all 348 mosques spread across
// 7 daily runs (~50 mosques per day). The cron should run DAILY at the same
// time (recommended: 0 3 * * * for 03:00 UTC every day). Each day's batch
// is auto-selected based on day-of-week (Sunday=0, Monday=1, ..., Saturday=6).
// Combined with the WHERE clause in the UPSERT (only write if values changed),
// each run writes ~350 rows, and steady-state should be near zero most days.
//
// USAGE - prefer curl with a header (query-string secrets end up in
// Cloudflare's request logs and your browser history):
//   curl "https://wherewepraying.com/api/admin/sync-masjidbox-jamaah" \
//     -H "X-Sync-Key: YOUR_SYNC_SECRET"
//
// Manual testing (override auto-stagger): pass ?start=N&end=M:
//   curl "https://wherewepraying.com/api/admin/sync-masjidbox-jamaah?start=0&end=50" \
//     -H "X-Sync-Key: YOUR_SYNC_SECRET"

import { isSyncRequest } from '../../_lib/auth.js';

const API_BASE = "https://api.masjidbox.com/1.0/masjidbox/landing/athany/";
const APIKEY = "JejYcMS7hsOsZTPDk2ZhKOAlW9IyQ6Px"; // public frontend key, embedded in MasjidBox's own JS bundle
const EXCLUDED_MOSQUES = new Set(["imamiamissionlondon"]); // per instruction: always excluded, safety net
const DELAY_MS = 200; // politeness delay between requests

// Full list of confirmed MasjidBox-sourced mosques (slug -> name), extracted
// and verified against the live API from bilalathan.co.uk's UK listing page.
// slug here = the same slug MasjidBox itself uses in masjidbox.com/prayer-times/{slug}
const MASJIDBOX_MOSQUES = [
  { slug: "1st-4-education", name: "1st 4 Education" },
  { slug: "aberdeen-mosque-and-islamic-centre-scio", name: "Aberdeen Mosque and Islamic Centre SCIO" },
  { slug: "abu-bakr-islamic-centre-reading", name: "Abu Bakr Islamic Centre Reading" },
  { slug: "acton-mosque", name: "Acton Mosque" },
  { slug: "ad-duha-institute", name: "Ad-Duha Institute" },
  { slug: "adam-masjid", name: "Adam masjid" },
  { slug: "adil-anisa-masjid", name: "Adil Anisa masjid" },
  { slug: "adur-muslim-centre", name: "Adur Muslim Centre" },
  { slug: "aisha-islamic-centre", name: "Aisha islamic centre" },
  { slug: "al-amin-jam-e-masjid", name: "Al Amin jam-e Masjid" },
  { slug: "al-bayaan-academy", name: "Al Bayaan Academy" },
  { slug: "al-farooq-academy-and-masjid", name: "Al Farooq Academy and Masjid" },
  { slug: "al-madina-trust", name: "Al Madina Trust" },
  { slug: "al-manaar-academy", name: "Al Manaar Academy" },
  { slug: "al-mustafa-centre", name: "Al Mustafa Centre" },
  { slug: "al-noor-masjid-and-education-trust", name: "Al Noor Masjid and education trust" },
  { slug: "al-ansar-iec", name: "Al-Ansar IEC" },
  { slug: "al-aqsa-islamic-centre", name: "Al-Aqsa Islamic Centre" },
  { slug: "al-buraq-masjid", name: "Al-Buraq Masjid" },
  { slug: "al-furqan-mosque-glasgow", name: "Al-Furqan Mosque Glasgow" },
  { slug: "al-ikhlas-centre", name: "Al-Ikhlas Centre" },
  { slug: "al-rahman-mosque-and-education-centre", name: "Al-Rahman Mosque and Education Centre" },
  { slug: "al-tawbah-mosque", name: "Al-Tawbah mosque" },
  { slug: "albirr-mosque-basingstoke", name: "Albirr Mosque Basingstoke" },
  { slug: "alfurqan-education-trust", name: "Alfurqan Education Trust" },
  { slug: "alhikmah-project", name: "Alhikmah project" },
  { slug: "alhira", name: "Alhira" },
  { slug: "alnagashi-mosque-and-centre", name: "Alnagashi Mosque and centre" },
  { slug: "alrahman", name: "AlRahman" },
  { slug: "alton-islamic-centre", name: "Alton Islamic Centre" },
  { slug: "ameenia-sultania-educational-trust", name: "Ameenia Sultania Educational Trust" },
  { slug: "amic", name: "AMIC" },
  { slug: "as-sabr-institute", name: "As Sabr Institute" },
  { slug: "asha-islamic-centre", name: "Asha Islamic Centre" },
  { slug: "ascc", name: "Ashford and Staines Community Centre" },
  { slug: "ashrafistudycentre", name: "Ashrafi Study Centre" },
  { slug: "ajmic", name: "Ashton Jame Mosque and Islamic Centre" },
  { slug: "assunnah-islamic-centre", name: "Assunnah Islamic Centre" },
  { slug: "at-taqwa-centre-birmingham", name: "At-Taqwa Centre (Birmingham)" },
  { slug: "aylesbury-ghausia-mosque", name: "Aylesbury Ghausia Mosque" },
  { slug: "ayrshire-central-mosque", name: "Ayrshire Central Mosque" },
  { slug: "azhar-academy-masjid", name: "Azhar Academy Masjid" },
  { slug: "bab-ul-islam-wakefield", name: "Bab-ul-Islam Wakefield" },
  { slug: "banbury-madni-masjid", name: "Banbury Madni Masjid" },
  { slug: "barakah-educational-and-cultural-association", name: "Barakah educational and cultural association" },
  { slug: "nt", name: "Barnoldswick Islamic Centre" },
  { slug: "bathgatemosque", name: "Bathgate Mosque" },
  { slug: "baytus-salaam", name: "Baytus Salaam" },
  { slug: "bd5-masjid", name: "BD5 MASJID" },
  { slug: "beacon-tree-masjid", name: "Beacon Tree Masjid" },
  { slug: "beam-park-islamic-centre", name: "Beam Park Islamic Centre" },
  { slug: "bedford-central-jammee-masjid", name: "Bedford Central Jammee Masjid" },
  { slug: "bedford-islamic-centre", name: "Bedford Islamic Centre" },
  { slug: "bexhill-masjid-and-islamic-centre", name: "Bexhill Masjid and Islamic Centre" },
  { slug: "biggleswade-islamic-cultural-centre", name: "Biggleswade Islamic Cultural Centre" },
  { slug: "birwa-kurdish-community-centre", name: "Birwa Kurdish Community Centre" },
  { slug: "bostan-welfare", name: "Bostan Welfare" },
  { slug: "braunstone-islamic-community-centre", name: "Braunstone Islamic Community Centre" },
  { slug: "bridgwater-islamic-cultural-centre", name: "Bridgwater Islamic Cultural Centre" },
  { slug: "bromley-islamic-centre", name: "Bromley ISLAMIC CENTRE" },
  { slug: "broomhouse-mosque", name: "Broomhouse Mosque" },
  { slug: "burnley-general-hospital-muslim-spiritual-care-centre", name: "Burnley General Hospital Muslim Spiritual Care Centre" },
  { slug: "bury-islamic-centre", name: "Bury Islamic Centre" },
  { slug: "bpjm", name: "Bury Park Jamie Masjid" },
  { slug: "cambridge-university-islamic-society-prayer-room", name: "Cambridge University Islamic Society Prayer Room" },
  { slug: "canolfan-iqra-west-cardiff-islamic-centre", name: "Canolfan IQRA, West Cardiff Islamic Centre" },
  { slug: "ccc", name: "Carmarthen Community Center" },
  { slug: "central-jamia-masjid-razvia", name: "Central Jamia Masjid Razvia" },
  { slug: "chadwel-heath-muslim-centre", name: "Chadwel Heath Muslim Centre" },
  { slug: "cheshunt-muslim-centre", name: "Cheshunt Muslim Centre" },
  { slug: "chester-welfare-trust", name: "CHESTER WELFARE TRUST" },
  { slug: "city-jamia-masjid", name: "City Jamia Masjid" },
  { slug: "city-retreat-leicester", name: "City Retreat Leicester" },
  { slug: "clacton-mosque", name: "Clacton Mosque" },
  { slug: "clayhall-islamic-centre", name: "Clayhall Islamic Centre" },
  { slug: "collierrowmosque", name: "Collier Row Mosque" },
  { slug: "corby-central-masjid", name: "Corby Central Masjid" },
  { slug: "coventry-education-and-cultural-centre", name: "Coventry Education And Cultural Centre" },
  { slug: "craigavon-masjid", name: "Craigavon Masjid" },
  { slug: "dar-al-arqam", name: "Dar Al Arqam" },
  { slug: "dar-ul-isra", name: "Dar Ul Isra" },
  { slug: "dar-ul-uloom-islamia-longsight", name: "Dar Ul Uloom Islamia Longsight" },
  { slug: "dar-ul-munawar-ghamkol-sharif", name: "Dar-Ul-Munawar Ghamkol Sharif" },
  { slug: "dartford-masjid-and-islamic-center", name: "Dartford Masjid and Islamic Center" },
  { slug: "darul-ihsaan-barking", name: "Darul Ihsaan Barking" },
  { slug: "darul-uloom-preston", name: "Darul Uloom Preston" },
  { slug: "darul-uloom-qadria-jilania", name: "Darul uloom Qadria Jilania" },
  { slug: "darus-salam-masjid", name: "Darus Salam Masjid" },
  { slug: "darus-salam-mosque", name: "Darus Salam Mosque" },
  { slug: "derby-jamia-masjid", name: "Derby Jamia Masjid" },
  { slug: "dh-foundation", name: "DH Foundation" },
  { slug: "dover-masjid", name: "Dover Masjid" },
  { slug: "dicm", name: "Dulwich Islamic Centre & Mosque" },
  { slug: "earls-court-prayer-room", name: "Earls court prayer room" },
  { slug: "east-birmingham-central-masjid", name: "East Birmingham Central Masjid" },
  { slug: "east-ham-islamic-centre", name: "East Ham Islamic Centre" },
  { slug: "east-lancashire-hospitals-masjids", name: "East Lancashire Hospitals Masjids" },
  { slug: "eic-al-masjid", name: "EIC AL-MASJID" },
  { slug: "etic", name: "Enfield Town Islamic Centre" },
  { slug: "epsom-and-ewell-islamic-centre", name: "Epsom and Ewell Islamic Centre" },
  { slug: "essex-islamic-academy", name: "Essex Islamic Academy" },
  { slug: "essex-jamme-masjid", name: "Essex Jamme Masjid" },
  { slug: "emc", name: "Essex Muslim Centre" },
  { slug: "eic", name: "European Islamic Centre" },
  { slug: "ezzeitouna", name: "Ezzeitouna" },
  { slug: "faizaneislam", name: "Faizan E Islam" },
  { slug: "faizan-e-madina-masjis-southend", name: "FAIZAN E MADINA MASJIS SOUTHEND" },
  { slug: "faizan-e-madina-oldham", name: "Faizan e Madina Oldham" },
  { slug: "faizan-e-madinah-rotherham", name: "Faizan e Madinah Rotherham" },
  { slug: "faizan-e-madinah-sheffield", name: "FAIZAN E MADINAH SHEFFIELD" },
  { slug: "faizan-e-madina-accrington", name: "Faizan-e-madina-accrington" },
  { slug: "faizan-e-madinah-huddersfield", name: "Faizan-e-Madinah - Huddersfield" },
  { slug: "faizan-e-madinah-derby", name: "Faizan-e-Madinah Derby" },
  { slug: "faizane-madina-lincoln-islamic-center", name: "Faizane Madina Lincoln Islamic Center" },
  { slug: "farooq-e-azam-mosque", name: "Farooq e Azam Mosque" },
  { slug: "feltham-hira-centre", name: "Feltham Hira Centre" },
  { slug: "fife-islamic-centre", name: "Fife Islamic centre" },
  { slug: "forest-central-gate-masjid", name: "Forest Central Gate Masjid" },
  { slug: "fultaliislamiccentrecoventry", name: "Fultali Islamic Centre Coventry" },
  { slug: "gambian-islamic-community-centre", name: "Gambian Islamic Community Centre" },
  { slug: "glastonbury-masjid", name: "Glastonbury Masjid" },
  { slug: "global-helping-hands", name: "Global Helping Hands" },
  { slug: "greenbank-masjid", name: "Greenbank Masjid" },
  { slug: "greenwich-islamic-centre", name: "Greenwich Islamic Centre" },
  { slug: "greenwich-madina-trust", name: "Greenwich Madina Trust" },
  { slug: "grimsby-central-mosque", name: "Grimsby Central Mosque" },
  { slug: "guinean-community-masjid", name: "Guinean Community Masjid" },
  { slug: "gulhar-shareef-birmingham", name: "Gulhar Shareef Birmingham" },
  { slug: "hackney-central-masjid", name: "Hackney Central Masjid" },
  { slug: "hall-green-mosque-and-muslim-association", name: "Hall Green Mosque and Muslim Association" },
  { slug: "cms", name: "Hamptons Centre" },
  { slug: "hamza-centre", name: "Hamza centre" },
  { slug: "hanfia-ghousia-masjid", name: "Hanfia Ghousia Masjid" },
  { slug: "haroonia-islamic-teaching-centre", name: "Haroonia Islamic Teaching Centre" },
  { slug: "harrogate-islamic-association", name: "Harrogate Islamic Association" },
  { slug: "hastings-mosque", name: "Hastings Mosque" },
  { slug: "hazrat-bilal-masjid", name: "Hazrat Bilal Masjid" },
  { slug: "hazrath-shahjalal-jamie-masjid", name: "Hazrath Shahjalal Jamie Masjid" },
  { slug: "heart-of-enfield-mosque", name: "Heart of Enfield Mosque" },
  { slug: "heathrow-jamia-masjid", name: "HEATHROW JAMIA MASJID" },
  { slug: "holborn-mosque", name: "Holborn Mosque" },
  { slug: "hubb-gloucestershire", name: "Hubb Gloucestershire" },
  { slug: "hudhayfah-bin-al-yamaan-islamic-centre", name: "Hudhayfah bin Al Yamaan Islamic Centre" },
  { slug: "hwms", name: "HWMS" },
  { slug: "ianl", name: "IANL" },
  { slug: "ihya-foundation", name: "Ihya Foundation" },
  { slug: "ikhewa-mosque", name: "Ikhewa mosque" },
  { slug: "ilford-community-center", name: "Ilford Community Center" },
  { slug: "imam-yusuf-motala-academy", name: "Imam Yusuf Motala Academy" },
  { slug: "inverclyde-muslim-centre", name: "Inverclyde Muslim Centre" },
  { slug: "iqra-academy-edinburgh", name: "Iqra Academy Edinburgh" },
  { slug: "iqra-centre-derby", name: "Iqra centre Derby" },
  { slug: "iqra-salisbury", name: "Iqra Salisbury" },
  { slug: "irfaniye-mosque-newcastle-under-lyme", name: "Irfaniye mosque Newcastle under lyme" },
  { slug: "islamic-centre-nottingham", name: "Islamic Centre Nottingham" },
  { slug: "islamic-community-milli-gorus-united-kingdom", name: "Islamic Community Milli Gorus United Kingdom" },
  { slug: "jalalabad", name: "Jalalabad" },
  { slug: "jmic", name: "Jami Mosque and Islamic Centre Birmingham" },
  { slug: "jmn", name: "Jami' Masjid Noorani" },
  { slug: "jamia-madina-masjid", name: "Jamia Madina Masjid" },
  { slug: "jamia-masjid-bilal-rochdale", name: "Jamia Masjid Bilal Rochdale" },
  { slug: "jamia-masjid-ghausia", name: "Jamia Masjid Ghausia" },
  { slug: "jamia-masjid-ghousia", name: "JAMIA MASJID GHOUSIA" },
  { slug: "jamia-masjid-noor", name: "Jamia Masjid Noor" },
  { slug: "jamia-masjid-swafia", name: "Jamia Masjid Swafia" },
  { slug: "jamia-usmania", name: "Jamia Usmania" },
  { slug: "jamme-masjid-reading", name: "Jamme Masjid Reading" },
  { slug: "jkninstitute", name: "JKN Institute" },
  { slug: "jmah-halifax", name: "JMAH Halifax" },
  { slug: "jmic-slough", name: "JMIC Slough" },
  { slug: "karimia-masjid", name: "Karimia Masjid" },
  { slug: "khadijatul-kubra-trust", name: "Khadijatul Kubra Trust" },
  { slug: "khanqah-naqshbandia", name: "Khanqah Naqshbandia" },
  { slug: "kingbsury-muslim-centre", name: "Kingbsury Muslim Centre" },
  { slug: "kingsbury-islamic-cultural-centre", name: "Kingsbury Islamic Cultural Centre" },
  { slug: "kingston-mosque", name: "Kingston Mosque" },
  { slug: "lancaster-islamic-group", name: "Lancaster Islamic Group" },
  { slug: "lbu-isoc", name: "LBU ISOC" },
  { slug: "lincoln-central-mosque-and-cultural-centre", name: "Lincoln Central Mosque and Cultural Centre" },
  { slug: "lmcrc", name: "London Muslim Cultural and Recreational Charity" },
  { slug: "lmica", name: "Loughborough Mosque & Islamic Cultural Association" },
  { slug: "lmc", name: "Loughborough Muslim Centre" },
  { slug: "lusom", name: "LUSOM" },
  { slug: "luton-central-mosque", name: "Luton Central Mosque" },
  { slug: "lye-ghausia-mosque-and-welfare-association", name: "Lye Ghausia Mosque and Welfare Association" },
  { slug: "ma-mission-learning-centre", name: "MA Mission Learning Centre" },
  { slug: "madani-masjid-kiddderminster", name: "Madani Masjid Kiddderminster" },
  { slug: "madina-islamic-missino", name: "Madina Islamic Missino" },
  { slug: "madina-masjid", name: "Madina Masjid" },
  { slug: "mmic", name: "Madina Masjid & Islamic Centre" },
  { slug: "madina-mosque", name: "Madina Mosque" },
  { slug: "mahmud-sabir-masjid", name: "Mahmud Sabir Masjid" },
  { slug: "majlis-e-dawatul-haq", name: "Majlis-e-Dawatul Haq" },
  { slug: "makki-mosque", name: "Makki Mosque" },
  { slug: "makki", name: "Makki Mosque Sheffield" },
  { slug: "manchester-central-mosque", name: "Manchester Central Mosque" },
  { slug: "manden-uk-masjid", name: "Manden UK Masjid" },
  { slug: "markaz-dawat-wal-irshad", name: "Markaz dawat wal irshad" },
  { slug: "markaz-us-sunnah", name: "Markaz Us Sunnah" },
  { slug: "masjid-abu-bakr", name: "Masjid Abu Bakr" },
  { slug: "masjidabuhanifah", name: "Masjid Abu Hanifah" },
  { slug: "masjid-ahl-e-hadith-rotherham", name: "Masjid Ahl E Hadith Rotherham" },
  { slug: "masjid-al-falaah", name: "Masjid Al Falaah" },
  { slug: "masjidalfurqan", name: "Masjid Al Furqan" },
  { slug: "masjid-al-hasan-centre-of-islam-bradford", name: "Masjid al Hasan - Centre of Islam Bradford" },
  { slug: "masjid-al-hidayah", name: "Masjid Al Hidayah" },
  { slug: "masjid-al-khazra", name: "Masjid Al Khazra" },
  { slug: "masjid-al-falah", name: "Masjid Al-Falah" },
  { slug: "masjid-al-furqan-gateshead", name: "Masjid al-Furqan Gateshead" },
  { slug: "masjid-al-raheem", name: "Masjid Al-Raheem" },
  { slug: "masjid-albirr", name: "Masjid Albirr" },
  { slug: "masjid-an-noor", name: "Masjid An Noor" },
  { slug: "masjid-ar-rashideen", name: "Masjid Ar-Rashideen" },
  { slug: "masjid-ash-shifa", name: "Masjid Ash-Shifa" },
  { slug: "masjideaman", name: "Masjid E Aman" },
  { slug: "masjid-e-bilal", name: "Masjid E Bilal" },
  { slug: "masjid-e-nimra-community-centre", name: "Masjid E Nimra Community centre" },
  { slug: "masjid-e-salaam", name: "Masjid e Salaam" },
  { slug: "masjid-e-saliheen", name: "Masjid E Saliheen" },
  { slug: "masjid-e-umer", name: "Masjid e Umer" },
  { slug: "masjid-ibn-salah", name: "Masjid Ibn Salah" },
  { slug: "masjid-maryam", name: "Masjid Maryam" },
  { slug: "masjid-millat-e-islamia", name: "Masjid Millat-E-Islamia" },
  { slug: "masjid-noor", name: "Masjid Noor" },
  { slug: "masjid-noor-ul-huda", name: "Masjid Noor Ul Huda" },
  { slug: "masjid-sunnah-nelson", name: "Masjid sunnah nelson" },
  { slug: "talha", name: "MASJID TALHA" },
  { slug: "masjid-tooba", name: "Masjid Tooba" },
  { slug: "masjid-tus-salam", name: "Masjid Tus Salam" },
  { slug: "masjid-umar-sheffield", name: "Masjid Umar Sheffield" },
  { slug: "masjid-umm-alqura", name: "Masjid Umm Alqura" },
  { slug: "masjid-us-sunnah-cranford", name: "Masjid Us Sunnah Cranford" },
  { slug: "masjiduthman", name: "Masjid Uthman" },
  { slug: "masjid-uthman", name: "Masjid Uthman" },
  { slug: "masjid-e-aqsa", name: "Masjid-e-Aqsa" },
  { slug: "masjid-e-owais-e-qarni", name: "Masjid-e-Owais-e-Qarni" },
  { slug: "masjid-e-quba", name: "Masjid-E-Quba" },
  { slug: "masjide-noorul-islam", name: "Masjide Noorul Islam" },
  { slug: "masjidenoor-preston-uk", name: "Masjidenoor Preston UK" },
  { slug: "mcwas", name: "MCWAS" },
  { slug: "middlesbrough-central-mosque", name: "Middlesbrough Central Mosque" },
  { slug: "minhaj-ul-quran-international-london", name: "MINHAJ UL QURAN INTERNATIONAL LONDON" },
  { slug: "mohammadi-masjid-alum-rock", name: "Mohammadi Masjid Alum Rock" },
  { slug: "molesey-islamic-cultural-centre", name: "Molesey Islamic Cultural Centre" },
  { slug: "okrm", name: "Muslim Association of Nigeria UK" },
  { slug: "muslim-community-centre-uxbridge", name: "Muslim Community Centre Uxbridge" },
  { slug: "muslim-maps", name: "Muslim Maps" },
  { slug: "nasfat-islamic-community-centre", name: "NASFAT ISLAMIC COMMUNITY CENTRE" },
  { slug: "neath-mosque-and-islamic-cultural-centre", name: "Neath Mosque and Islamic Cultural Centre" },
  { slug: "neelimosqueislamiccentreukim", name: "Neeli Mosque & Islamic Centre (UKIM)" },
  { slug: "myncm", name: "Nelson Community Masjid" },
  { slug: "netherton-islamic-trust", name: "Netherton Islamic Trust" },
  { slug: "nmma", name: "New Malden Muslim Association" },
  { slug: "newparksacademy", name: "New Parks Academy" },
  { slug: "npm", name: "Newbury Park Masjid" },
  { slug: "newcastle-central-bilal-jamia-masjid", name: "Newcastle central Bilal Jamia masjid" },
  { slug: "newport-diyanet-masjid", name: "Newport Diyanet Masjid" },
  { slug: "nigerian-muslim-community-hampshire", name: "Nigerian Muslim Community Hampshire" },
  { slug: "nnma", name: "NNMA" },
  { slug: "noor-ul-islam-fagley", name: "Noor Ul Islam Fagley" },
  { slug: "noor-ul-islam-mosque", name: "Noor ul Islam Mosque" },
  { slug: "noorani-masjid-preston", name: "Noorani Masjid Preston" },
  { slug: "northfields-education-centre", name: "Northfields Education Centre" },
  { slug: "northolt-islamic-centre", name: "Northolt Islamic Centre" },
  { slug: "nottingham-islam-information-centre", name: "Nottingham Islam Information Centre" },
  { slug: "nuneaton-masjid", name: "Nuneaton Masjid" },
  { slug: "nwkma-masjid-abu-bakar", name: "NWKMA - Masjid Abu Bakar" },
  { slug: "oswestry-muslim-centre", name: "Oswestry Muslim Centre" },
  { slug: "peace-centre", name: "Peace centre" },
  { slug: "peckham-high-street-islamic-and-cultural-centre", name: "Peckham High Street Islamic And Cultural Centre" },
  { slug: "pic", name: "Peckham Islamic Centre" },
  { slug: "pengemosque", name: "Penge Mosque" },
  { slug: "perth-islamic-society", name: "Perth Islamic Society" },
  { slug: "ponders-end-islamic-centre", name: "Ponders End Islamic Centre" },
  { slug: "pontypridd-mosque", name: "Pontypridd mosque" },
  { slug: "portsmouth-muslim-academy", name: "Portsmouth Muslim Academy" },
  { slug: "purley-masjid", name: "Purley Masjid" },
  { slug: "quran-academy", name: "Quran Academy" },
  { slug: "quran-academy-bristol", name: "Quran Academy Bristol" },
  { slug: "rayners-lane-islamic-centre", name: "Rayners Lane Islamic Centre" },
  { slug: "razamosque", name: "Raza Mosque" },
  { slug: "redhill-bangla-muslim-centre", name: "REDHILL BANGLA MUSLIM CENTRE" },
  { slug: "roehampton-cultural-center", name: "Roehampton Cultural Center" },
  { slug: "romfordmosque", name: "Romford Mosque" },
  { slug: "rotherham-central-mosque", name: "Rotherham central mosque" },
  { slug: "royal-blackburn-hospital-muslim-spiritual-care-centre", name: "Royal Blackburn Hospital Muslim Spiritual Care Centre" },
  { slug: "sadaqat-community-centre", name: "Sadaqat Community Centre" },
  { slug: "satuq-bughra-khan-mosque", name: "Satuq bughra khan mosque" },
  { slug: "scunthorpe-central-mosque", name: "Scunthorpe Central Mosque" },
  { slug: "shadwell-tra-masjid", name: "Shadwell TRA Masjid" },
  { slug: "shah-jalal-jame-masjid", name: "Shah Jalal Jame Masjid" },
  { slug: "shahjalal-islamic-centre", name: "Shahjalal Islamic Centre" },
  { slug: "shahjalal-jamia-mosque-scunthorpe", name: "Shahjalal Jamia Mosque Scunthorpe" },
  { slug: "shahjalal-mosque", name: "Shahjalal mosque" },
  { slug: "sheerwater-mosque", name: "Sheerwater Mosque" },
  { slug: "sheikh-nazim-sufi-centre", name: "Sheikh Nazim Sufi Centre" },
  { slug: "sheppey-islamic-center", name: "Sheppey Islamic Center" },
  { slug: "sirajam-muneera-jamia-masjid-and-education-centre", name: "Sirajam Muneera Jamia Masjid and Education Centre" },
  { slug: "sittingbourne-islamic-cultural-centre", name: "Sittingbourne Islamic Cultural Centre" },
  { slug: "south-essex-islamic-trust", name: "South Essex Islamic trust" },
  { slug: "swicuk", name: "South Woodford Islamic Centre" },
  { slug: "southgate-mosque", name: "Southgate Mosque" },
  { slug: "sri-lankan-muslim-cultural-centre", name: "Sri Lankan Muslim Cultural Centre" },
  { slug: "suffa-tul-islam-luton", name: "Suffa Tul Islam Luton" },
  { slug: "sultan-bahu-bradford", name: "Sultan Bahu Bradford" },
  { slug: "sunni-muslim-association", name: "Sunni Muslim association" },
  { slug: "surrey-islamic-society", name: "Surrey Islamic Society" },
  { slug: "sutton-coldfeild-muslim-association", name: "Sutton Coldfeild Muslim Association" },
  { slug: "swanseaisoc", name: "Swansea ISOC" },
  { slug: "swansea-mosque", name: "Swansea Mosque" },
  { slug: "syed-shah-mustafa-jame-masjid", name: "SYED SHAH MUSTAFA JAME MASJID" },
  { slug: "taybahmasjid", name: "Taybah Masjid" },
  { slug: "thames-view-muslim-centre", name: "Thames view Muslim centre" },
  { slug: "the-abrahamic-foundation", name: "The Abrahamic Foundation" },
  { slug: "wilc", name: "The Lantern Foundation" },
  { slug: "the-light-project", name: "The light Project" },
  { slug: "the-lingfield-centre", name: "The Lingfield Centre" },
  { slug: "the-lote-tree-institute", name: "The Lote Tree Institute" },
  { slug: "thornaby-masjid", name: "Thornaby Masjid" },
  { slug: "uk-murid-coomunity", name: "UK MURID COOMUNITY" },
  { slug: "ukim-alumrock-islamic-centre", name: "UKIM Alumrock Islamic Centre" },
  { slug: "ukim-madina-masjid-keighley", name: "UKIM Madina Masjid Keighley" },
  { slug: "ukim-madina-masjid-newbold", name: "UKIM Madina Masjid Newbold" },
  { slug: "ukim-masjid-bilal-and-islamic-centre", name: "UKIM Masjid Bilal and Islamic Centre" },
  { slug: "ukim-umar-masjid", name: "UKIM Umar Masjid" },
  { slug: "ukim-west-london-islamic-centre", name: "UKIM West London Islamic Centre" },
  { slug: "uewt", name: "Umar Education Welfare Trust (UEWT)" },
  { slug: "umar-trust", name: "Umar Trust" },
  { slug: "united-muslim-mosque-scunthorpe", name: "United Muslim Mosque Scunthorpe" },
  { slug: "unity-madrassah", name: "Unity Madrassah" },
  { slug: "university-of-sussex-prayer-room", name: "University of Sussex Prayer Room" },
  { slug: "voice-of-truth", name: "Voice Of Truth" },
  { slug: "walsall-central-mosque", name: "Walsall Central Mosque" },
  { slug: "warwick-islamic-prayer-hall", name: "Warwick Islamic Prayer Hall" },
  { slug: "waterlooville-islamic-centre", name: "Waterlooville Islamic Centre" },
  { slug: "west-berkshire-muslim-centre", name: "West Berkshire Muslim Centre" },
  { slug: "west-bromwich-jami-masjid", name: "West Bromwich Jami Masjid" },
  { slug: "west-norwood-mosque", name: "West Norwood Mosque" },
  { slug: "westbourneislamiccentre", name: "Westbourne Islamic Centre" },
  { slug: "wmca", name: "Winchester Muslim Cultural Association" },
  { slug: "witton-islamic-centre", name: "Witton Islamic Centre" },
  { slug: "wood-green-fatih-mosque", name: "Wood Green Fatih Mosque" },
  { slug: "wmwa", name: "Worcester Muslim Welfare Association" },
  { slug: "worcester-park-muslim-centre", name: "Worcester Park Muslim Centre" },
  { slug: "wybourn-islamic-centre", name: "Wybourn Islamic Centre" },
  { slug: "zakariyya-masjid", name: "Zakariyya Masjid" },
  { slug: "zia-e-madinah-masjid", name: "Zia E Madinah Masjid" },
  { slug: "zia-ul-quran-centre", name: "Zia Ul Quran centre" }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isoToHms(iso) {
  if (!iso) return null;
  // "2026-09-08T05:45:00+01:00" -> "05:45"
  const match = iso.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : null;
}

const UPSERT_SQL = `
  INSERT INTO thm_jamaah_times
    (mosque, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, source, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(mosque, date) DO UPDATE SET
    fajr_jamaah=excluded.fajr_jamaah,
    zuhr_jamaah=excluded.zuhr_jamaah,
    asr_jamaah=excluded.asr_jamaah,
    maghrib_jamaah=excluded.maghrib_jamaah,
    isha_jamaah=excluded.isha_jamaah,
    source=excluded.source,
    updated_at=excluded.updated_at
  WHERE
    fajr_jamaah    IS NOT excluded.fajr_jamaah OR
    zuhr_jamaah    IS NOT excluded.zuhr_jamaah OR
    asr_jamaah     IS NOT excluded.asr_jamaah OR
    maghrib_jamaah IS NOT excluded.maghrib_jamaah OR
    isha_jamaah    IS NOT excluded.isha_jamaah
`;

function calculateWeeklySlice(dayOfWeek) {
  const MOSQUES_PER_DAY = 50; // 348 / 7 ≈ 49.7, round to 50
  const start = dayOfWeek * MOSQUES_PER_DAY;
  const end = Math.min(start + MOSQUES_PER_DAY, MASJIDBOX_MOSQUES.length);
  return { start, end };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isSyncRequest(context)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  
  let start, end;
  if (startParam !== null && endParam !== null) {
    // Manual override: use provided start/end for testing
    start = parseInt(startParam, 10);
    end = parseInt(endParam, 10);
  } else {
    // Auto-stagger: use day-of-week to pick this day's slice
    // This spreads 348 mosques across 7 days, ~50 per day
    // Sunday=0, Monday=1, ... Saturday=6
    const today = new Date();
    const dayOfWeek = today.getUTCDay();
    const weekly = calculateWeeklySlice(dayOfWeek);
    start = weekly.start;
    end = weekly.end;
  }
  
  const nowIso = new Date().toISOString();

  const results = { processed: [], failed: [], skipped: [], recordsSaved: 0 };

  const slice = MASJIDBOX_MOSQUES.slice(start, end);

  for (const { slug, name } of slice) {
    if (EXCLUDED_MOSQUES.has(slug)) {
      results.skipped.push(slug);
      continue;
    }

    try {
      const begin = new Date().toISOString().slice(0, 10) + "T00:00:00.000+00:00";
      const apiUrl = `${API_BASE}${slug}?get=at&days=7&begin=${encodeURIComponent(begin)}`;

      const resp = await fetch(apiUrl, {
        headers: {
          Apikey: APIKEY,
          Accept: "application/json",
        },
      });

      if (!resp.ok) {
        results.failed.push({ slug, status: resp.status });
        await sleep(DELAY_MS);
        continue;
      }

      const data = await resp.json();
      const timetable = data.timetable || [];

      const statements = [];
      for (const day of timetable) {
        const dateIso = (day.date || "").slice(0, 10);
        if (!dateIso) continue;

        const iq = day.iqamah || {};
        statements.push(
          env.DB.prepare(UPSERT_SQL).bind(
            slug,
            dateIso,
            isoToHms(iq.fajr),
            isoToHms(iq.dhuhr),
            isoToHms(iq.asr),
            isoToHms(iq.maghrib),
            isoToHms(iq.isha),
            "masjidbox_scrape",
            nowIso
          )
        );
      }

      if (statements.length > 0) {
        await env.DB.batch(statements); // single subrequest for the whole mosque's week
        results.recordsSaved += statements.length;
      }

      results.processed.push({ slug, name, days: statements.length });
    } catch (e) {
      results.failed.push({ slug, error: String(e) });
    }

    await sleep(DELAY_MS); // politeness delay between mosques
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
