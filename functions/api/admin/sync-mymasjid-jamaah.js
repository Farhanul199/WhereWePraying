// functions/api/admin/sync-mymasjid-jamaah.js
//
// Scraper for MyMasjid (time.my-masjid.com) Jama'ah times. Public API,
// no key needed. Discovered via browser DevTools; endpoints documented
// publicly (see github.com/RaulMalik/mymasjid-widget-design).
//
// The API returns a FULL YEAR of data per mosque (366 day/month entries,
// no year attached). We only WRITE a rolling 90-day-ahead window of that
// to D1, not all 365 days — writing the full year for all 553 mosques
// (~200k rows) blew the D1 free tier's 100,000-rows-written/day cap in a
// single Sunday run. 90 days keeps a full cycle (553 mosques) to roughly
// 50k rows written even if it all lands in one day, with headroom for
// MasjidBox's daily ~2.4k rows on top.
//
// Committee times are fixed almost all year (change only around DST
// shifts and Ramadan — see jamaah-data-accuracy-plan), so this does NOT
// need a daily or even weekly cron. Run it MONTHLY. A 90-day window
// refreshed monthly always covers 2-3 months ahead, which is enough
// lead time to catch any committee update.
//
// v2: writes into jamaah_raw (the raw inbox) under source
// 'mymasjid_scrape' keyed by MyMasjid's guid, and registers guid + name
// on the translator sheet (mosque_sources). The fused thm_jamaah_times
// view resolves overlaps between sources by priority, so a mosque on
// both MyMasjid and MasjidBox now produces ONE clean row per day.
//
// USAGE - prefer curl with a header (query-string secrets end up in
// Cloudflare's request logs and your browser history):
//   curl "https://wherewepraying.com/api/admin/sync-mymasjid-jamaah?start=0&end=30" \
//     -H "X-Sync-Key: YOUR_SYNC_SECRET"
//
// 553 mosques total, ~30 per visit:
//   start=0&end=30 ... up to start=540&end=553

import { isSyncRequest } from '../../_lib/auth.js';

const API_BASE = "https://time.my-masjid.com/api/TimingsInfoScreen/GetMasjidTimings";
const EXCLUDED_MOSQUES = new Set(); // matched by name below if ever needed
const EXCLUDED_NAME_MATCH = "imamia"; // safety net, case-insensitive substring
const DELAY_MS = 200; // politeness delay between requests
const WINDOW_DAYS = 90; // rolling forward window written to D1 (see header note)

const MYMASJID_MOSQUES = [
  { guid: "1472725f-a243-422c-afe0-ea1be35183c2", name: "Masjid Abdulhamid Han" },
  { guid: "a3dd541d-1bbe-4810-8fb4-391c9bbbcb61", name: "Masjid Alhikmah and Community Centre" },
  { guid: "8d324f7a-a508-48c8-9002-079df585df1e", name: "Masjid As Sunnah Accrington" },
  { guid: "b415ed54-c351-43a3-83e8-26c67fe254b8", name: "Raza Jamia Masjid" },
  { guid: "ad230e67-644d-43ad-9839-6f2c0fb9916a", name: "Raza Jamia Masjid Islamic Centre" },
  { guid: "556b64ea-5a92-48c5-8272-67fcd24f97b8", name: "Masjid E Dawatul Islam" },
  { guid: "0de3f42c-99f4-43dc-81b6-68f1400205ab", name: "Andover Muslim Cultural Association" },
  { guid: "dc2c5c50-8ef2-405f-b75c-0187b3f445b6", name: "Ashton Jam'e Mosque" },
  { guid: "c38660c5-ca3f-4812-b29c-5ea918d300d2", name: "Imam Jabir Bin Zayd Islamic Centre" },
  { guid: "8255f6a0-7dee-4573-9a2a-3e2fa290daf6", name: "Thames View Muslim Association" },
  { guid: "bdce50cc-f99c-4091-b1ab-64d6614b9abf", name: "South Essex Islamic Trust" },
  { guid: "9ada5c35-0149-4358-a3ba-db601e2e29b6", name: "Masjid ar Rashideen" },
  { guid: "4862bb2a-ccc6-4c54-ad61-052c7a9605c7", name: "Upper Soothill Islamic Center" },
  { guid: "37811fb9-f6d8-46e6-a742-e1dce6db8b11", name: "Al-Haramain Mosque" },
  { guid: "14c2134c-ca44-49c2-8640-6c53d154fe83", name: "BEDFORD CENTRAL JAMMEE MASJID" },
  { guid: "b82a812e-f9ca-4c03-92c8-206bed5f33d4", name: "Daarul Huda" },
  { guid: "af51b4da-ad65-46ee-ace5-dfe43a96e686", name: "South Bedford ICC & Masjid" },
  { guid: "ab95ff7f-0679-44f3-9493-69c506ddc11b", name: "Belfast Islamic Centre" },
  { guid: "ee1ac459-9f33-4d07-8fc6-75572a6e7138", name: "Belfast Multi Cultural Association" },
  { guid: "f298e739-98c0-4b38-8e52-ce30d3a6dd4b", name: "Ihsan Youth & Family Centre" },
  { guid: "387765c0-31d7-422f-83a4-10578620ab3c", name: "Iqraa Masjid" },
  { guid: "c72bc58e-8156-4343-bd08-bf73e0d74f0a", name: "Wirral ICC & Shahjalal Mosque" },
  { guid: "60fe0a65-de8d-447f-8ffd-05e6c4e3b683", name: "Ad-Duha Institute" },
  { guid: "c560c37e-5269-4b43-950f-f32319fcd1cb", name: "Al Habib Trust" },
  { guid: "46f6cfd3-fab8-4482-adfe-d654b830202f", name: "Al Hafidhoon" },
  { guid: "628b0d3e-b615-462a-bde9-841dbd7ee432", name: "Al Madani Centre Academy" },
  { guid: "69e8a1a2-b23b-42d9-aa43-6e4376b03b5a", name: "Al-Huda Community Centre" },
  { guid: "41cf67e4-150a-4268-b5b3-a4b8c1a32366", name: "An-Noor Masjid" },
  { guid: "a82d0574-d7d6-42d6-8bca-92254037f654", name: "Bilal" },
  { guid: "b051266d-151d-45b2-9cbb-e2040107626a", name: "Central Jamia Mosque Zia-ul Quran" },
  { guid: "c28d3efc-1647-40b6-b0d1-6475ef2c4472", name: "Esa Ibn Maryam" },
  { guid: "98242696-f1c0-4fff-9297-83572361a3b7", name: "Faizane Medina Stechford" },
  { guid: "35a4ee7a-6716-42df-b58e-1c04d8bdfc96", name: "Faizan-E-Madina Sandwell" },
  { guid: "13ffbf41-ed61-4216-a16b-c69a8caf9023", name: "Ghamkol Sharif Mosque" },
  { guid: "f2a9ea59-4cd0-4ba2-bdf2-564c4459ac0d", name: "Green Lane Masjid" },
  { guid: "4491a0a0-ecc4-4297-b411-f39d9b9043fc", name: "Hall Green Mosque" },
  { guid: "38674efa-be6a-4907-a0a4-515a4347e615", name: "Hazrat Sultan Bahu Trust" },
  { guid: "65b04391-3815-4d20-a7dd-53b75050bcd3", name: "Jamatia Islamic Centre" },
  { guid: "6fbaeb3a-0eab-4186-800c-3cdf6fb984de", name: "Gulhar Shareef Birmingham" },
  { guid: "a4cbbbf7-6ecf-4126-8b30-878125d566a9", name: "JAMIA MASJID HAROONIA" },
  { guid: "ecf5f5a2-8b5a-4fcf-93dd-c243549b6d94", name: "Jamia Masjid Minhaj-ul-Quran" },
  { guid: "70a6fa4f-e15c-44f8-9624-3fe3a2e3a129", name: "Lozells central mosque" },
  { guid: "118a97c1-a621-4067-99d1-ce4cea6a1cf0", name: "Madina Mosque Welfare Society" },
  { guid: "86e98b7c-4ba4-4322-9655-585f1d362988", name: "Madinatul Uloom Jami Masjid" },
  { guid: "3734a51e-f310-4b85-8150-2dc094f375b2", name: "Mahmud Sabir-Al Furqan" },
  { guid: "4261dac1-11f8-41c6-99dd-a0e636468d97", name: "Majid Darul Elm" },
  { guid: "8fc63d4b-46d7-4c84-a502-7902a3c6b1f6", name: "Makki Masjid and Iqra Academy" },
  { guid: "cf7b037e-7e1c-4e74-8088-a72cd78e91bb", name: "Masjid abu bakar" },
  { guid: "e85e3bdd-f170-41ff-b5ec-bb8947d41e82", name: "Masjid Abu Bakr Billesley" },
  { guid: "dd4b3531-7258-40a0-b08f-47e9343993f7", name: "Masjid Darul Elm" },
  { guid: "8432ae68-9737-4310-9b5a-741b3266d4a4", name: "Masjid Hamza" },
  { guid: "43e071f0-4a1f-4282-b765-96ce3dd756f6", name: "Masjid Naqeebul Islam" },
  { guid: "33fd9db9-7a6e-421a-8d6e-093793a576e4", name: "Masjid Sulayman Bin Dawud" },
  { guid: "6a006d00-d0c7-493b-875a-0c18eb59729c", name: "Masjid Taqwa" },
  { guid: "f248db21-170d-4db5-93be-c57985a5be67", name: "Masjid Umar" },
  { guid: "94d8b064-6a2e-4be4-abd6-fba06d405755", name: "Masjid zia ul eiman" },
  { guid: "075fe2ba-8537-43b4-9327-13ed91932eae", name: "Masjidus Sunna An Nabawiyyah" },
  { guid: "0b09f8bf-9bc7-4dc8-bc4c-a88cc752ab4c", name: "Mohammadi Masjid Alum Rock" },
  { guid: "388dd77a-810f-4a07-8fb3-bced113075a0", name: "Najashi Islamic Centre" },
  { guid: "a405a601-e18e-4178-bf3d-d652841abb2d", name: "PAIGHAM E ISLAM TRUST" },
  { guid: "40dbfe21-3578-47d2-8aa4-3a67aeda6b15", name: "Runaky masjid" },
  { guid: "77b77fde-2fc9-4cc3-a03b-80d9dd6b3926", name: "SULTAN BAHU CENTRE" },
  { guid: "6eea30ae-a07a-40d0-91f0-dbcca50a821f", name: "The Salafi Masjid" },
  { guid: "a52b0b33-575d-4e22-bf7c-05cfb5d3a331", name: "Herts & Essex Mosque" },
  { guid: "b5f71ce5-af7f-4544-bf41-b2a56e47f886", name: "Al Aqsa" },
  { guid: "5fdfe6a6-b936-4f75-8e67-9e175da87a98", name: "Al Asr" },
  { guid: "c2ab5154-fd57-4a1b-ad70-0717932eb379", name: "AL-BURAQ MASJID" },
  { guid: "f4c00f1b-7b9a-4fb9-a809-38503800644f", name: "Ashrafi Study Centre" },
  { guid: "9887ae0c-4481-4f16-b7de-1518f575d2ab", name: "Beardwood Musallah" },
  { guid: "22f458bd-00ba-462a-9811-3ce2da6913db", name: "Blackburn markaz" },
  { guid: "b37875db-4976-47c0-b0e2-4256b0bbe73b", name: "Darussalam Education Centre" },
  { guid: "bb701683-cb45-4055-a8df-4cfc79bd2000", name: "EG Head Office Musallah" },
  { guid: "366e4f7a-3ced-4742-9b7b-cd0819c2b635", name: "Jaame Masjid ICC" },
  { guid: "ab69ab65-3c7c-4eb2-86eb-070f5ca3dace", name: "Jamia Al Hashmi" },
  { guid: "9ba8d1e8-c305-40b9-93f6-f13c2c07523a", name: "Jamia Ghousia Masjid" },
  { guid: "f98c4930-7f87-484e-99b0-4dc80eefddf5", name: "Jamia Masjid Allah Hoo" },
  { guid: "6de89364-aac5-43ec-8dc4-a51d5c6d0877", name: "Jamia Syeda Fatima Al Zahra" },
  { guid: "92bb695a-d8a0-4069-aa93-ae67978c6e01", name: "Jamia Syeda Fatima Al Zahra 2" },
  { guid: "083b8beb-c71e-48d1-8bc4-959fb8dff24c", name: "Jamiatul Ilm Wal Huda" },
  { guid: "9dfb3b0f-b337-449f-9579-ccc89385c342", name: "Khanqah Blackburn" },
  { guid: "360fa517-59dc-4b93-b16d-99ec70c79c3b", name: "Kurdish mosque" },
  { guid: "c26b6388-b5b5-4be3-a535-56e99eecf243", name: "Madni Masjid" },
  { guid: "a350603a-09ae-40c5-b821-b11686498902", name: "Masjid Alberr" },
  { guid: "744000f0-e279-4e13-876b-256074b500f3", name: "Masjid Al-Hidayah" },
  { guid: "0e1a4a27-9119-4164-8605-cb25d120605e", name: "Masjid al-Momineen" },
  { guid: "f0c081df-8b9d-4d25-a4b4-ee38ed1e5f27", name: "Masjid Taleem ul Islam" },
  { guid: "362cc61d-6002-40e7-b687-96df65180e7f", name: "Masjid e Noor" },
  { guid: "9db36414-9eaa-4892-a8b8-2a3dc5f68db5", name: "Masjid e Raza HSMC" },
  { guid: "63ae74af-40e0-4357-9692-2a582653ab52", name: "Masjid E Tauheedul Islam" },
  { guid: "f9512841-23c2-4425-8793-f2e7c3d71d43", name: "Masjid E Vali" },
  { guid: "8b5bf5c6-cb95-4782-aa97-9c53676da37b", name: "Masjid -E-Anwaar" },
  { guid: "aebfb878-5236-49ba-a187-c046707dcc6f", name: "Masjid Shah Jalal Zeenatul Quran" },
  { guid: "3e7cc645-2dfc-401c-a976-8d3aa6d0d1ab", name: "Masjide Noorul Islam" },
  { guid: "741b0839-f914-4633-ad3b-55237b3cf71f", name: "Masjid-e-Anisul Islam" },
  { guid: "c07b3901-78c7-4500-9bd7-a5019635406a", name: "Masjid-e-Anwaar" },
  { guid: "7f809665-5c44-42a2-8df7-f104d2c4b73c", name: "Masjid-e-Bilaal" },
  { guid: "30a6535d-a565-44c7-8121-90e1d2ac965a", name: "Masjid-e-Ghousiya IRC" },
  { guid: "e304d4bd-09fd-4f03-b0fd-cad306fdb87d", name: "Masjid-e-Irfan" },
  { guid: "5fa0c7cb-344c-455b-ae6f-8d56e63932e4", name: "Masjid-E-Raza Jamia Madina" },
  { guid: "5099fe44-7e32-4e40-a244-480baf1c83ce", name: "Masjid-E-Rizwan" },
  { guid: "06b5596c-c224-4639-965e-1a8d30fa6798", name: "Masjid-e-Sajedeen" },
  { guid: "c8b0ccbf-4709-43ec-94fe-71732ae32954", name: "Masjid-e-Saliheen" },
  { guid: "6f18bfdf-1d87-4028-bb2c-0e9194be846a", name: "MASJID-E-TAQWA" },
  { guid: "f30b1495-de88-451f-8730-d94a87649dff", name: "Mellor Musalla" },
  { guid: "599fc3b2-4bea-4d75-ab3a-af20868f7409", name: "Mohaddis-E-Azam Mission" },
  { guid: "0d262471-271c-4dc8-b3d0-ac94c760feab", name: "Musalla Maryam" },
  { guid: "a3a72b0e-120b-477c-ba0c-4aac8f039cf8", name: "Adam Masjid Ladybridge" },
  { guid: "36c08066-91fd-4b46-bd5f-a77ea9cee6ba", name: "Aleef Masjid Bolton" },
  { guid: "e7a33f5a-881a-49a7-b369-cc611ff4d028", name: "Al-Falah Masjid" },
  { guid: "272aa205-a2e7-4764-bdfd-301576b50d0a", name: "AZHAR ACADEMY BOLTON" },
  { guid: "61d80085-ed50-4523-bd3c-302a534ab5e0", name: "Daarussalaam Oromo" },
  { guid: "78e12fb5-4c35-4f34-a85b-2ccaf8c0f0af", name: "Makkah Masjid" },
  { guid: "df73b713-380c-44b7-bf50-3abdb7516345", name: "Makki Masjid Education Centre" },
  { guid: "6d5ef45d-aa5a-4025-ae0f-cc22611bbd52", name: "Masjid e Salaam" },
  { guid: "902e7add-d69d-4519-960a-6f9a04f1d805", name: "Masjid-e-Noorul Islam" },
  { guid: "94001885-0bef-4850-a3df-9d9ecc7c2211", name: "Shahjalal Masjid Bolton" },
  { guid: "b20f7c27-ba6e-42a6-a4eb-60917163fa2a", name: "Taiyabah Masjid" },
  { guid: "6d9e1f02-3082-456a-a4aa-2cadf3397246", name: "Zakariyya Jaame Masjid" },
  { guid: "8c5b8bb5-20ff-4a89-83e8-d0e1c39b1b13", name: "Bournemouth ICC Central Mosque" },
  { guid: "caf9b580-ba4c-408f-a04b-1461dea16e13", name: "Al Amin masjid" },
  { guid: "23a6f2bc-5c65-4e79-af36-195c2ec5fa84", name: "Al Hidaya Academy" },
  { guid: "08f8b880-bec8-477e-91f2-658e8644f219", name: "Al-Hikam Institute" },
  { guid: "2057fd11-b137-42b1-9dd5-e50324b1fc38", name: "Darul Mahmood" },
  { guid: "da3a0632-d15e-4da9-929b-8bcc4c7064dc", name: "Darul Uloom Dawatul Imaan" },
  { guid: "766cb21f-c5cb-42c8-bca2-699a3e531a3c", name: "Doha Mosque" },
  { guid: "8005e2db-749f-4cf8-98df-eb613734155c", name: "FIRDAWS MOSQUE" },
  { guid: "117e74b2-ccf8-4f70-bcf1-5ca63d7685b0", name: "Imam Yusuf Motala Academy" },
  { guid: "10d1edf4-7adf-4c0d-a2e6-5fab9e8b968c", name: "Iqra Masjid" },
  { guid: "52668c92-8853-4f84-912b-8056c4256e6e", name: "IslamBradford" },
  { guid: "58309905-48f7-419d-b7db-97df9782b9eb", name: "Jamia masjid" },
  { guid: "6c8088c0-397c-48a8-9ece-4bcdac3bf178", name: "Jamia Masjid Al Faiz" },
  { guid: "e997a256-2b6a-4f1f-a935-af2c1d3e0d74", name: "Jamia Muhammadia" },
  { guid: "97c2b138-543c-417b-81d6-55992de9b1d0", name: "Jamiyat Tabligh Victor street" },
  { guid: "52fb1999-ae77-49be-864d-a84a538eff44", name: "Jamiyat Tabligh-ul-Islam" },
  { guid: "b8b07a64-0cf0-47f8-9b96-9c4f8cb491be", name: "Jamiyat Browning Street" },
  { guid: "7d5d64ba-7247-4812-95a6-25c94de512f7", name: "Kashmir Crown Bakery Prayer Hall" },
  { guid: "1d921e88-60d8-4d9c-849b-98438e628199", name: "Madni Jamia Masjid Bradford 3" },
  { guid: "de5ef695-5300-4fa0-858a-47ab0f90bda5", name: "Madrasah Abdullah Bin Masood" },
  { guid: "239ca962-261b-4072-8b7c-50927edea1f3", name: "Madrassa Abbasiya" },
  { guid: "74c10403-944e-4c78-a8aa-ced2c0f71727", name: "Masjid Abu Bakr" },
  { guid: "01131cbf-3f01-48b2-a5ac-931cd36ebaa6", name: "Masjid As-sunnah" },
  { guid: "8a8eaa98-6627-4fa6-8bfd-2471a7c7722a", name: "Masjid at-Taqwa" },
  { guid: "e532afca-047d-4aff-adf3-d6ae8acbe87c", name: "Masjid Ayesha" },
  { guid: "f741e923-1a54-4946-9b18-5b704ca34605", name: "Masjid Bilal" },
  { guid: "8b738462-1202-4797-b3d0-89be6ad255af", name: "Masjid e quba" },
  { guid: "0608db48-f79b-41f7-9535-1039da8cbf8b", name: "Masjid Ibraheem Education Centre" },
  { guid: "47aebc9a-bb1d-4a18-bb55-5755952d5f78", name: "Masjid Noor Bradford" },
  { guid: "3bef3a1b-51f2-4bd7-9a26-bbdb3f9ff185", name: "Masjid Noorul Islam" },
  { guid: "cf37794c-7835-44a1-b4af-2e5e091753e9", name: "Masjid Quba" },
  { guid: "7dfb7656-e6e7-45ee-ad99-5cefe3347e2d", name: "Masjid Tahir" },
  { guid: "60355db4-c54a-4f4e-84bd-daabde8503e7", name: "Masjide Ali" },
  { guid: "03c9f680-1ddc-43ef-ad3a-f249357be079", name: "Masjid-E-Umar" },
  { guid: "e9f6b2e8-6a08-4659-bce1-086b6cdbfa02", name: "Masjid-e-Usman" },
  { guid: "754b2ffe-0841-49f2-bda8-c059edc6b185", name: "Masjidur Raashideen" },
  { guid: "efb56c30-8189-411c-886c-0e7692c0d617", name: "Millat-e-Islamia Masjid" },
  { guid: "ccb7ca12-b036-4c4d-b88e-0d4140033be0", name: "Muhammadi Masjid" },
  { guid: "90b2cf82-df38-40ca-be4d-c8c71ba307f0", name: "Nusrat Ul Islam" },
  { guid: "fc234cc6-a30f-4705-b11c-df64cbb8161a", name: "Salahadin Mosque" },
  { guid: "bcfd818d-9a8f-4ee0-b05b-1cc556a786e0", name: "Shipley Islamic Education Centre" },
  { guid: "4f0e55c3-d851-4617-b124-d637b24ae78a", name: "Tawakkaluia Islamic Society" },
  { guid: "3393828e-2d3d-46ec-b84d-5bcde1c06708", name: "Umm Ul Qura Islamic Centre" },
  { guid: "4682aaa5-1fa9-4095-9935-b60aee6268b2", name: "Brentwood Mosque" },
  { guid: "2167aecd-2ce0-442c-91b9-13aa25b32552", name: "The Ayla Centre" },
  { guid: "ff3ee03a-6e05-46e7-97a6-727b5737a917", name: "Bridgwater Central Mosque" },
  { guid: "028a6295-144c-4e70-aa3f-87aced883260", name: "Adur Muslim Centre" },
  { guid: "ad2853f3-4327-4364-8375-386b2fc9edbf", name: "Brighton Mosque" },
  { guid: "69804b9f-e89a-4fd4-a37b-8893ccf03f42", name: "Masjid Tawfiq" },
  { guid: "9ae1574b-7475-45de-812f-7a2b7a66d240", name: "RED LANE MASJID COVENTRY" },
  { guid: "48f10ccc-a4b8-4eb4-9ffa-119e4336a0eb", name: "Zeenatul Islam" },
  { guid: "96448423-4ba5-4c97-9585-54b580d9be32", name: "Craigavon Masjid" },
  { guid: "160b489f-3886-41c8-a003-719656129844", name: "Craven Arms Islamic Centre" },
  { guid: "3ba88fea-6664-4b45-a160-4d820995e067", name: "Gulzar-e-Habib" },
  { guid: "7a036d31-b4ac-44f6-a68e-2dbb1f7a7994", name: "Dagenham Ummah Welfare Trust" },
  { guid: "7d69e69f-694a-40a1-9629-c5640a6b205b", name: "Darlington Jamia Mosque" },
  { guid: "dfb45a32-e3a6-4591-a606-54aa5bdb4a0c", name: "Jamia Mosque Darlington" },
  { guid: "b63bc155-2ecd-44bd-8368-8da6b83c9ea7", name: "Darwen Madina Masjid" },
  { guid: "33184ee4-4b89-4236-a6a5-4f581916f47d", name: "Derby Jamia Mosque" },
  { guid: "37f23f7d-3f92-4656-90a8-9df465b02c43", name: "Masjid Al-Jannah Derby" },
  { guid: "ac24914f-0cfb-4159-a887-4a43ae351cc7", name: "North West Islamic Centre" },
  { guid: "d84f0dea-de86-4ca2-b568-42c546663fe9", name: "Islam Dewsbury" },
  { guid: "8962936d-7a14-4647-a5dd-dc3a9178f4c3", name: "Masjid Noor Dewsbury" },
  { guid: "c76623cd-c03d-4a5a-b7f4-7e600d4cf599", name: "Masjid-e-Bilal Dewsbury" },
  { guid: "62bcc579-ebe2-4d67-9771-ddf7d191bfc6", name: "Ummah Masjid Dewsbury" },
  { guid: "9e25edae-9f8f-4394-bddc-0866475d1b70", name: "Zakaria Masjid" },
  { guid: "d9930dcb-c574-41c1-9f52-e44410b86d32", name: "Isle of Man Islamic Centre" },
  { guid: "f2f92a10-971a-4d9a-99bc-95ef07f62e1f", name: "Dover masjid" },
  { guid: "ae60c006-4630-4653-9733-b95f95e0b077", name: "Faizan E Farooq E Azam" },
  { guid: "aa74899a-cc76-4997-965b-4a544c7ae268", name: "Lye Ghausia Jamia Mosque" },
  { guid: "73a33d7f-3d81-49cf-9d66-cdbd0c768fd8", name: "Dundee Central Mosque" },
  { guid: "ccbb199c-ff18-472c-b258-8d89e9cc5d96", name: "Jami Masjid Bilal Dundee" },
  { guid: "16aca530-c200-4859-9b8c-63f1daf3e9d7", name: "Tayside Islamic Centre" },
  { guid: "a41fd9d0-aae8-44f4-81c2-3b0b9d019db7", name: "Green Dome Mosque" },
  { guid: "b859ed2d-f550-42f2-8815-51d9d9fc9d09", name: "Faizan E Attar" },
  { guid: "1e1705ee-a839-4972-8cbd-6197f2c9ef17", name: "Eccles and Salford Islamic Society" },
  { guid: "6d18d3db-96ab-4810-9ddd-2e55be2a3e15", name: "Annandale Mousque" },
  { guid: "bbce0a14-e2c2-414f-b541-8311e25eb6c5", name: "Runnymede Muslim Society" },
  { guid: "4a3968a9-a17d-485f-bafc-6a5f1c6b6ea3", name: "Elland Masjid" },
  { guid: "dd827bd2-0c78-46d2-90df-7bd9c70fed99", name: "Al-Emaan Centre" },
  { guid: "238c0a2a-deac-4f50-9e9f-3b1dfb36b133", name: "Madinatul Uloom Al Islamiya" },
  { guid: "3e315e2a-e01b-4ee1-8cad-a95674b6d83e", name: "Ayrshire Central Mosque Kilmarnock" },
  { guid: "db875ece-c2e1-4b4b-a339-525ff3a4b143", name: "Masjid Al Noor WNIA" },
  { guid: "819fdd58-80df-4a8b-916a-dd115427b721", name: "Lancaster Islamic Society" },
  { guid: "15943ea7-8c3f-4c55-ba12-b6da930c9caf", name: "Moorlands Islamic Centre" },
  { guid: "d800ff38-f9cc-4f14-86b5-a52a3023a39d", name: "Al-Rahmah" },
  { guid: "2ba55312-9a38-4563-9213-8ab8e1af70ad", name: "Al-towbah Islamic centre" },
  { guid: "706cd37b-2be5-4e2f-a212-c727c1757232", name: "Leeds islamic centre" },
  { guid: "1b66688e-fa2b-4caf-9342-566655ad1820", name: "Lincoln green mosque" },
  { guid: "bd9b41c2-8460-48f0-968e-2bb2ae031780", name: "Abu Huraira" },
  { guid: "838ce9a3-1aea-4b4e-a9f2-7c5dcff55240", name: "AL EHSAAN ACADEMY" },
  { guid: "64704f63-35c5-4149-987d-c318e7324e7a", name: "Al Huda" },
  { guid: "3ad0a8a2-48f5-431f-8e02-be1e5f4af10f", name: "As-Salaam Trust Peace Centre" },
  { guid: "e725aae5-eebc-4729-b648-6f2f2486031e", name: "Beaumont Leys Muslims" },
  { guid: "acf3cd69-9769-43a1-b68e-dff2f4dd8663", name: "City Retreat Leicester" },
  { guid: "8d93302a-0594-4594-b440-6078ad2f878c", name: "Darul Fath" },
  { guid: "f117e7f1-1ebf-43ed-b261-5828a269693d", name: "DARUL SUNNAH" },
  { guid: "83f960c1-a6ec-4652-b447-935dcd399ae9", name: "Darus Salam Masjid" },
  { guid: "6248c661-002c-4654-a57a-699a9c722ca1", name: "Islamiccentre" },
  { guid: "3dc4276f-0ab0-4f97-b6a9-ea5b630ff42e", name: "Jame' Masjid" },
  { guid: "ace1592d-4e96-466e-bb0b-e697467e4bce", name: "Markaz Attawheed" },
  { guid: "aad1d1a9-44b6-4b80-b322-66573270f736", name: "Markaz Quba" },
  { guid: "74452637-c4e1-438c-a78e-3ee02652f3ce", name: "Masjid Abu Bakr Leicester" },
  { guid: "7404a959-02d9-4a2f-a864-aa1e467f88e2", name: "Masjid Al Furqan" },
  { guid: "76b57c3b-2926-4792-a983-0e1252a50c3c", name: "Masjid Ali" },
  { guid: "eb7b5572-b9e1-46f6-ab2e-02b1a958c8ff", name: "Masjid An Noor" },
  { guid: "0dfbd1c7-79b2-4a25-b831-7412b2290c69", name: "Masjid At-Taqwa Leicester" },
  { guid: "9438942b-8488-40f9-8eee-5b4eca392cd4", name: "Masjid Fida" },
  { guid: "853b8c21-d8bd-4a03-8cee-1afaab9f87f8", name: "Masjid Quba Leicester" },
  { guid: "bdd2d9f0-7c90-4803-a6f3-d70535b069f8", name: "Masjid Salahuddin" },
  { guid: "cf6bfc35-e4f8-4fe8-9c74-40b1aabd2831", name: "Masjid Taybah" },
  { guid: "549e82fc-f67b-4a4e-a14a-01e14384cb9b", name: "Masjid Umar Leicester" },
  { guid: "da3ed5f1-992d-426d-a44b-82c341d7d12b", name: "Masjid-us-Sunnah" },
  { guid: "fb1e7520-8b0c-47b1-9e13-7e33eab46e02", name: "Mostyn Street Musalla" },
  { guid: "a3164ccc-f72b-4848-9616-4b714c15e270", name: "Sayyidah Zahra Centre" },
  { guid: "ad95fed1-10d3-41dc-92f7-b94b9bd671c4", name: "SJMMJ" },
  { guid: "a327eebd-6541-4fe7-a2ba-a979975af8af", name: "Masjid al-Furqan Leigh" },
  { guid: "061ab1ed-8377-41b0-82f5-ef837ca04e64", name: "Lincoln Central Mosque" },
  { guid: "ab5dfb1d-a1d9-4893-a1ed-ae83e3d6bf6b", name: "Abdullah Quilliam Mosque" },
  { guid: "3e3d56a6-a70d-4728-bb22-4f180c561490", name: "Al-Rahma Liverpool" },
  { guid: "0e902e78-29f9-4df8-9a7a-5c9c1ed33f45", name: "Hamza Centre" },
  { guid: "2b26e582-15d7-4a53-b87d-b5667c77c941", name: "Masjid Altiseer" },
  { guid: "4dc0674f-c55a-4d7d-b0aa-15054975117f", name: "AL AMAAN EDUCATION TRUST" },
  { guid: "03ea0824-6755-4a0e-89b0-3d7f555ae1c1", name: "Al huda Welfare Foundation UK" },
  { guid: "8ef28c6d-6892-4d33-b285-4d6dc976a6cd", name: "Al-Fatihah Mosque" },
  { guid: "64b9480d-6afb-40ec-b3ee-87a895581f33", name: "AlFurqan Education Trust" },
  { guid: "f4c8cc40-8e42-47ce-9e74-d8125a10b0ba", name: "Al-Huda Cultural Centre" },
  { guid: "ea03701f-b72a-4ed5-8d80-005e05fe0e43", name: "Arabic Islamic Centre" },
  { guid: "c0dfdd77-c2e0-42ac-a626-4a107256e334", name: "Assunnah Islamic Centre" },
  { guid: "37db29ba-9e01-4db7-84cc-7794ac1a3a9a", name: "Barnet Islamic Centre" },
  { guid: "84339d57-b5fa-4bdc-8777-bd635a31e71c", name: "Bilal Masjid" },
  { guid: "5447ab39-f8b2-4504-b061-56cec97f5fd9", name: "Bilal Masjid Trust Greenford" },
  { guid: "d91cfe1b-8c02-44ee-8763-0b7fd739b3ae", name: "Bishopway community centre" },
  { guid: "eaeaf0ce-3abb-44ea-bc56-d9db42fd8171", name: "Bow Muslim Community Centre" },
  { guid: "f802f957-38c0-4530-956d-5c36b83ce488", name: "BRENT CULTURAL CENTRE" },
  { guid: "abca757a-0fdb-4787-8135-89af3af48720", name: "Brent Cultural Centre 2" },
  { guid: "fa60766f-99ae-4c6c-aa4b-b7df66184fcb", name: "Brixton Mosque" },
  { guid: "8466bae0-12c7-43ef-825e-970934c8a721", name: "Bromley By Bow Muslim CC" },
  { guid: "f4cc201c-9837-4def-a312-50a8020a945b", name: "BUSHEY ISLAMIC CIRCLE" },
  { guid: "230a0d2f-8a5e-487e-8917-367c1712bd7c", name: "BWA MUSLIM CENTRE" },
  { guid: "78530272-be73-4b50-98a3-5487f3b8fafe", name: "Central Park CC Mosque" },
  { guid: "88d51c89-c8d7-4cf9-a408-548b66f76942", name: "Coventry Cross Mosque" },
  { guid: "a8261431-6282-4dd1-bb06-92ae7ac1ab7b", name: "Darul Ummah Goresbrook" },
  { guid: "3c47f094-fa15-4e1c-9d83-c08728ae83ab", name: "Darul Ummah Hornchurch" },
  { guid: "3244d139-741c-4d00-be04-d4b1ec9ab40a", name: "Darul Ummah Mosque" },
  { guid: "a1651e59-1461-4412-8103-7349f073024d", name: "Darulilm-SLMCEL" },
  { guid: "3540ffd7-1e01-4f89-9d84-745093032e8e", name: "Darussalam Masjid Culture Centre" },
  { guid: "9d3ee3c3-6ac0-4490-a816-1237feffd842", name: "Duwlich Islamic Centre" },
  { guid: "287de68e-2345-461d-ac74-64b96c3c5840", name: "East London Mosque" },
  { guid: "27f05e8f-e307-4b29-b4a8-357091802374", name: "Edgware Road Mosque" },
  { guid: "04187224-0c29-40e6-b0fa-d216d15a2076", name: "Edmonton Islamic Centre" },
  { guid: "5f10d885-c47c-4d47-826c-bf7ed162cd99", name: "Feltham HIRA Centre" },
  { guid: "ec438f2f-5871-4c8e-b967-a87160efa7b6", name: "Green Street Masjid" },
  { guid: "190949ea-f9fb-4d8e-830a-d279ae434a0c", name: "Hackney Central Masjid" },
  { guid: "45374800-f6fb-4618-b86c-55d03f02762b", name: "Hafs academy" },
  { guid: "5a632f11-fcd7-4578-aa34-5b5d4a860ed3", name: "Hefazothe Islam Centre Uk" },
  { guid: "cd832084-3f7c-4396-ad17-4c449b41eda3", name: "High Barnet Islamic Centre" },
  { guid: "32a3ffdc-b966-4509-8a72-b02475518b56", name: "Hind Grove CCA" },
  { guid: "4f2c58d2-1032-4511-befe-a11a6eec17f1", name: "Islamic Association N London" },
  { guid: "6ff6e9cf-3d50-44e6-a456-9773ebcc56a0", name: "Kilburn And Hampstead Masjid" },
  { guid: "2ed51c82-086b-4e21-a45b-92a88432dc19", name: "Lambeth Masjid PCC" },
  { guid: "2085ae48-3dc8-4434-8aee-f9749479c6eb", name: "Markazul" },
  { guid: "d193107e-ca3e-4eb3-872d-554140b285af", name: "Masjid At-Tarbiyah" },
  { guid: "9919faff-5d85-438b-b627-6a14c11b67ee", name: "Masjid Ayesha London" },
  { guid: "b89b224d-43c8-4450-b868-d6b45e9227b3", name: "Masjid Isa Ibn Maryam" },
  { guid: "0cb8d4fe-596f-411b-9475-bcde38e15aa9", name: "Masjid Taha" },
  { guid: "87d003a1-b090-4101-a30b-09093bf64312", name: "Masjid Yousuf" },
  { guid: "09af0193-6d37-486e-a780-333d8eb5668b", name: "MCWAS" },
  { guid: "40b46993-6216-4c41-948f-c900d0cda8b3", name: "MDWI" },
  { guid: "6f0e0b31-9543-45c5-9a73-efea6a91174b", name: "Mile End Bengali Muslim CA" },
  { guid: "3af505de-da3e-4830-8698-07d60ba7fac6", name: "Mosque and Islamic Centre Brent" },
  { guid: "e461138e-0b62-4df0-ba25-8c52c215333a", name: "Muradiye Camii" },
  { guid: "c912f7d3-2ee3-4f79-b3b0-2f75a27612c6", name: "Muslim Unity Centre" },
  { guid: "7ebbd9fe-f43f-4a60-b022-3cb5d3e29ada", name: "New Peckham Mosque" },
  { guid: "ceea99e9-e3ac-4d39-a0a1-6984666f728e", name: "Northolt Islamic Centre" },
  { guid: "c2c1abe7-4b3d-4a4e-b585-5109be8365d7", name: "Omar Ibn Al Khattab Academy" },
  { guid: "794d7f35-84e1-4318-b4fb-0c563b1e455a", name: "Plashet Grove Mosque" },
  { guid: "58d0a1b8-e6db-4a2c-b6f2-d86eaf3861e9", name: "Poplar Mosque CC" },
  { guid: "12a9b024-4b18-4f72-83c9-ba131e102980", name: "QUBA MASJID EDUCATION CENTRE" },
  { guid: "f86ca53c-dba5-4b79-8497-d394ee4af927", name: "Quwwat-ul-Islam" },
  { guid: "f21cc5bc-b031-4a08-a184-3e7982c48957", name: "Shadwell TRA Masjid" },
  { guid: "2a1b61d7-b40e-4558-874a-4d58fa022ab0", name: "South london islamic centre" },
  { guid: "cdc06cc7-2027-4ab6-8eef-e67aadbd158d", name: "Wembley Central Masjid" },
  { guid: "dc234e97-5bcd-4d1c-bccf-439d06e674ca", name: "West London Centre Jamia Masjid" },
  { guid: "03b8d82c-5b0e-4cb9-ad68-8c7e204cae00", name: "Al-Jalal Masjid" },
  { guid: "b50e8952-44e2-4bd5-bbae-fcfe081f45a9", name: "Baitul Abraar Jami Masjid" },
  { guid: "f747a156-97a7-48a3-97ba-a1d2b900f3d2", name: "Bury Park Masjid Luton" },
  { guid: "c63f9383-395e-423b-8707-32586838054a", name: "Leagrave Hall Masjid" },
  { guid: "55940f4f-6c87-4723-93fb-7616838bf977", name: "Luton Central mosque" },
  { guid: "84849250-e7cd-4b2e-83f0-29a42b547465", name: "Masjid Al Huda Luton" },
  { guid: "192f225b-184e-45eb-abda-aea1a621a653", name: "Masjid Al Noor Luton" },
  { guid: "2ef47032-e719-43d1-8f01-9789a4c664ae", name: "Suffa Tul Islam" },
  { guid: "b4ef2658-3c8d-4c7d-9088-59e9f152b17e", name: "UKIM Madinah Masjid Luton" },
  { guid: "b8c3e45c-14b4-410a-b1bf-3baf2721956e", name: "Zakariya Masjid Luton" },
  { guid: "b29f1208-b021-470b-a320-db4e00b64b29", name: "Zuhri Trust" },
  { guid: "ebc87721-3504-4267-a377-957e0c3cca40", name: "Maidenhead Central Mosque" },
  { guid: "611c9253-571f-41c3-9012-7ead4b6bddaf", name: "Maidstone Mosque" },
  { guid: "412ba626-e904-4935-ac2e-a11d9552cfa9", name: "Al Falah Markaz Manchester" },
  { guid: "c59c65c2-a43f-4b25-82b5-24cd103b7b81", name: "Al-sunnah Mosque" },
  { guid: "edcc0540-63f1-44e5-a3cc-7d1222e2a00e", name: "Anwaar Ul Haramain Jame Masjid" },
  { guid: "a78cd0e1-2741-4c90-9c86-d98edc767403", name: "Anwar up haramain" },
  { guid: "6b142c07-c4e3-4011-bfc9-b82995975dd4", name: "British Muslim Heritage Centre" },
  { guid: "6d3d1990-b159-4f35-9dab-c4cb5ec8f331", name: "Cheadle Masjid" },
  { guid: "965ecdf1-ad34-4679-83a2-337fd8e85a84", name: "City Jamia Masjid" },
  { guid: "2cca06a3-a015-4423-a027-aa9d8ede0da4", name: "Dar Ul Uloom Islamia Longsight" },
  { guid: "89eb7e05-d26b-4a98-bebd-fda1a563db9a", name: "Grand Mosque" },
  { guid: "dffa8779-abff-4a4b-89bb-2dc6fac9e84a", name: "Hazrat Sultan Bahu Centre Manc" },
  { guid: "690762a5-a89a-4cf6-8ee3-02a4c63e14c7", name: "Makki Masjid Manchester" },
  { guid: "300659be-6aa5-40bb-9780-70d7227f87e0", name: "Manchester Central Mosque VP" },
  { guid: "c4655788-ad81-4aee-a9ff-3311b4a97665", name: "Masjid Al Malik" },
  { guid: "3a3c2aa0-e57e-44fe-a006-612f93bad39b", name: "Masjid Bilal Prestwich" },
  { guid: "018fb34f-28e2-465a-816a-bbf1ab4ee650", name: "Minhaj ul Quran Manchester" },
  { guid: "1b529e0e-577d-47b9-a544-051426e5c593", name: "MRI Multi Faith Centre" },
  { guid: "1753583a-76c0-496b-b821-845f1811cf55", name: "Salahadeen Al-Ayubi Mosque" },
  { guid: "309145dd-08fe-412b-8912-2f186d87d362", name: "Shahjalal Mosque Manchester" },
  { guid: "f1783598-0cb0-4b83-9665-bb5d988f483e", name: "Al-Birr Margate Mosque" },
  { guid: "ea2dad43-4966-4714-944e-a9efc2b0cffa", name: "Central Jamia Mosque Wolverton MK" },
  { guid: "5014f8ef-bef4-4efe-993e-dd86d7a30b4e", name: "Milton Keynes Jamee Masjid" },
  { guid: "a9c7f3d3-d82e-4a23-89ef-cd08cd446a6f", name: "Al Hira Jamia Masjid" },
  { guid: "cdbcecda-0552-4d38-a16a-730167de6489", name: "Ghausia Masjid Nelson" },
  { guid: "986f4cf6-fe15-4837-8351-0162615e78a2", name: "Ghousia Masjid Nelson" },
  { guid: "ff01f300-9b24-41ed-8461-a97ad3ed7c8f", name: "Jamia Masjid Syeda Fatima" },
  { guid: "2ede4b06-80e4-4412-88f6-ebfc98fb3099", name: "Labbayk Ya RasoolAllah Masjid" },
  { guid: "632ccb8d-0bd2-4aaf-b9c4-5cd57bf4d994", name: "Masjid Sunnah Nelson" },
  { guid: "4c806765-8fc6-4a9b-af64-4b31b2062617", name: "Minhaj ul Quran Nelson" },
  { guid: "5fba66cc-81a3-423d-a19b-14c0004a4658", name: "UKIM Madina Masjid Nelson" },
  { guid: "27e21548-8c3e-4b11-a056-3da925bff09c", name: "Madina Masjid CC Newcastle" },
  { guid: "b864ffa3-83e2-4200-a611-d4751ddc96b7", name: "Masjid At-Taqwa Newcastle Staffs" },
  { guid: "a8239bce-86bb-49ec-be7d-4a111accc841", name: "Al-Islah Jamia Masjid Newcastle" },
  { guid: "fcb089a2-bfc4-4a0a-8e24-6d6b98a430fa", name: "Kotku Mosque" },
  { guid: "401dd1a2-e0f8-4d3c-993d-9bf65804b201", name: "Newcastle Central Mosque" },
  { guid: "bd52645c-4970-4336-8be3-3a40d5f00160", name: "Newcastle City Mosque" },
  { guid: "a97b8b64-848f-41c3-9b8d-1aef510847c2", name: "Newcastle Muslim Centre" },
  { guid: "5abe2442-225d-4e22-a6fc-e9111908eece", name: "Shrewsbury Muslim Centre" },
  { guid: "2700d2b3-048d-4324-8784-95ef1af401fa", name: "Al-Madani Masjid Slough" },
  { guid: "d476e587-563a-42fd-a04e-86879afc7ab2", name: "Jamia Masjid Slough" },
  { guid: "e01ed376-6f75-4114-87bf-007da55fa0da", name: "Masjid Al-Jannah Slough" },
  { guid: "fecbd2ea-889e-41d7-822a-e4b85d8ee94c", name: "MASJID ILYAS" },
  { guid: "a537ed3f-9f32-4c97-8a30-fb21c08ad236", name: "Al Judi Masjid" },
  { guid: "26220fd3-d207-4ba7-9d00-4b82223d4ff5", name: "Solihull Islamic Education Academy" },
  { guid: "733d5af9-0a88-400f-b34e-7fa2983df098", name: "Baitul Ma'Mur Jame'E Masjid" },
  { guid: "2f76f0f8-251f-475b-98ad-77146206e9fa", name: "South Tyneside Jame Masjid" },
  { guid: "eaa2ab31-1819-47d3-b252-991b93a7ff71", name: "Central Jamia Masjid Southall" },
  { guid: "7da5e621-0443-41bc-8651-0a6245f0cdd5", name: "Abu Bakr Jamia Masjid Southampton" },
  { guid: "464b717a-0033-4912-9d20-e9b08d75e855", name: "ArRahmah Mosque" },
  { guid: "ff513a8a-4c29-4cce-b8eb-7632ab447145", name: "Bashir Ahmed Masjid" },
  { guid: "3dbb8428-12a5-422d-9eb1-6bbccffce735", name: "Razvia Mosque Daar-al-Uloom" },
  { guid: "bdd318c9-862d-44a4-9bb3-04b2868c36b3", name: "Shahjalal Mosque Southampton" },
  { guid: "f86f83e8-5a89-4038-b2c3-1d32b5b681ab", name: "LCBC Mosque" },
  { guid: "08cd8712-3974-4da7-bf96-1b29c3770a6f", name: "London Colney Islamic Centre" },
  { guid: "a674b710-2435-42c6-85b3-a73f9dcfe40a", name: "Masjid Ar Rahman St Albans" },
  { guid: "e2bc0aa0-cf10-4f7f-bc87-c5d0d2bd3efb", name: "St Albans Islamic center" },
  { guid: "5d0603fe-f4b0-4093-bdb5-404827ef8002", name: "Jamia Masjid Faizan-E-Madina" },
  { guid: "96d38187-3ab1-4ee5-b800-33bc7c76fcb2", name: "Stevenage Bangladeshi CC" },
  { guid: "3bf29ae9-f0ee-490f-bdb0-1a12695a2dd8", name: "Stevenage Muslim Community Centre" },
  { guid: "b6099dcc-2d58-4df5-9960-d18347e1a5b5", name: "Central Scotland Islamic Centre" },
  { guid: "f4204032-fe9c-4de9-ac90-389b19303a57", name: "Al-Tawbah mosque" },
  { guid: "58dc91d2-04cc-4f08-b9f6-f3958967900a", name: "HMCT" },
  { guid: "574e9ce7-f57f-4fa7-bc85-998abaa40d47", name: "Darul Falah Centre" },
  { guid: "d59c633e-0dc7-4e51-b407-ab326b8dbd56", name: "Makki Masjid Stoke" },
  { guid: "b70e601e-8c14-4d53-b2e2-67b4c1664d8e", name: "Markaz At-Tawheed" },
  { guid: "2aacc4fb-7520-4abc-82a4-f3af70f431c5", name: "Anwaar E-Madinah Mosque" },
  { guid: "673621a6-b999-4965-8071-8e63550475ee", name: "Hendon Jami Masjid" },
  { guid: "6594b9f7-a5ab-4e3b-bd8c-f291b5b2c9cd", name: "Sunderland Jami Masjid" },
  { guid: "1df96817-82df-4651-9a96-ebd925e8b504", name: "Swansea Mosque" },
  { guid: "db6f3b47-8142-4803-b786-923272f085bc", name: "Bayt al Hikmah Swindon" },
  { guid: "75f027bf-43bb-40e4-b13e-6f1f64ab6f78", name: "Shahjalal Swindon Mosque" },
  { guid: "b20b2487-96e4-4177-a040-fc50c8f4c130", name: "Jamia Masjid Gousia Telford" },
  { guid: "e39916b9-c38d-43ee-8aab-7c00b8e08029", name: "Thetford Central Mosque" },
  { guid: "38991239-fc2e-4b34-a0c6-95f241959b2f", name: "Torbay Islamic Centre" },
  { guid: "cf197044-167f-4dd6-9275-e6acded1d303", name: "Jamia Masjid Swafia" },
  { guid: "69f54ebf-42da-4d68-a075-2511b0f526f4", name: "Abu baker Wakefield" },
  { guid: "9f0014c5-f845-446a-9530-406715b3c273", name: "Bab-ul-Islam Wakefield" },
  { guid: "aacb0212-f7aa-4dc9-a209-81301614e02e", name: "Madina Masjod" },
  { guid: "94dfc14a-c06e-4c66-9611-2e1d009f6287", name: "Al-Medinah Mosque Brighton" },
  { guid: "39d75f85-a0ce-4cf5-bb52-1152eed859e8", name: "Easton Jamia Masjid" },
  { guid: "d8d5bb7d-5bd7-4053-876b-32b3b82723e8", name: "Greenbank Masjid" },
  { guid: "5bff9464-ab5b-49f4-8d60-65efc1c130a9", name: "Hazrat Bilal Masjid" },
  { guid: "6196e2f1-abcf-4409-b58b-6918e0363fdf", name: "Quran Academy Bristol" },
  { guid: "1839fe39-c02e-4394-a3e0-3fa2242b55d6", name: "Daneshouse Masjid" },
  { guid: "c2fe1afb-5599-4b91-b35e-b066a1535343", name: "Faizan e Madina Burnley" },
  { guid: "9d43a1b0-1d18-4a0c-9e59-9ad4fb9c3c90", name: "Jamia Masjid Ghausia Burnley" },
  { guid: "02648b97-0028-4c60-892a-ce7faba025cf", name: "Masjid Abu Bakr Burnley" },
  { guid: "a8a78c96-eda9-42c9-9df4-aa0f61134ae2", name: "Masjid Ferooq e Azam" },
  { guid: "0c3ee28f-fed3-4b51-b77a-ffdbed992cd5", name: "Shah Jalal Masjid Burnley" },
  { guid: "e1baa3af-485f-4bca-a115-0f04fe8cc12e", name: "UKIM Masjid Ibrahim Burnley" },
  { guid: "6385e9b0-35e5-41ad-8233-8a9ef13f38b4", name: "Jamia Hanifa Ghousia" },
  { guid: "a1d6c6a0-33a6-4fdf-9988-d2fec9de46ab", name: "Central Jamia Masjid Rizvia" },
  { guid: "03a7491b-a286-42da-8b05-efb5933eba6f", name: "Jamia Hanfia Ghosia" },
  { guid: "165f9123-9ffa-4f94-b454-06b7428c89b9", name: "Makki Masjid Burton" },
  { guid: "15efa646-51a0-4782-b53e-f0098a4f8d16", name: "York Street Masjid" },
  { guid: "521978d4-ac7f-400c-8f64-861754be0519", name: "Bury Learning Centre" },
  { guid: "c86893b2-b0eb-4098-bb20-27c29fe2ed40", name: "Jamia Khizra Masjid Bury" },
  { guid: "9a43d20b-90d3-42ed-adb9-0612cb2feaf2", name: "Khizra Masjid Bury" },
  { guid: "665ae9bf-2de2-4680-9965-ca8888230f89", name: "Noor ul Islam Mosque" },
  { guid: "880308e1-baf7-4205-afe2-8ab2542d91e9", name: "QADRIA JILLANIA ISLAMIC CENTRE" },
  { guid: "996eb925-f3a1-4007-b6d4-b00d738a6774", name: "Bury St Edmunds ICO" },
  { guid: "47a64a3a-9116-466d-a1f8-9a82498ace14", name: "M.A.Al Kharafi Islamic Centre" },
  { guid: "66503b47-2659-4d37-b53a-cb2e3d6ea88e", name: "Abu Bakr Jamia Cambridge" },
  { guid: "ae3cb3a6-066b-42fd-9684-3e10e8a3c118", name: "Cambridge Central Mosque" },
  { guid: "294895e1-06c1-4a40-a4e1-9d4f49839cf8", name: "Masjid Al Ikhlas Cambridge" },
  { guid: "87d52273-ad7a-4e13-b6e4-38a3784ae789", name: "Omar Faruque Mosque" },
  { guid: "f5fe2565-43be-4333-895a-c067da536a92", name: "Shah Jalal Islamic Centre Camb" },
  { guid: "e2b33002-f4b6-4fe8-8f2b-f266740adf13", name: "Al Ikhlas Center Cardiff" },
  { guid: "5afa0594-f8b9-48fd-abc1-1fb013a593a0", name: "Al-Manar Centre Trust" },
  { guid: "de97a9ee-e10f-4c80-ab81-73ff3602177d", name: "Jalalia Mosque Cardiff" },
  { guid: "f596d346-4d4a-4fe8-9fd0-3ce85e763a67", name: "Masjid Al Falaah Cardiff" },
  { guid: "f0d2eedf-8607-4a57-b8c2-a0cce063adab", name: "Masjid At-Tawheed Cardiff" },
  { guid: "8e4f19eb-445a-4f8b-801e-7ce87420c5dc", name: "Shah Jalal Mosque Cardiff" },
  { guid: "853d94bc-ea42-4ced-bf1f-480a3e872f72", name: "Gatley Islamic Centre" },
  { guid: "feb5299c-1a8d-4043-a215-ca9fa9f60103", name: "Bangladesh Assoc Chippenham" },
  { guid: "1f04ba65-fa2a-42eb-82a6-88ece8a3bab2", name: "Ar-Rahma academy Chorley" },
  { guid: "ce97b9a1-3556-4ae7-88d9-80927db486c2", name: "Central Masjid Abu Bakr Clydebank" },
  { guid: "2d203b61-8676-4cd3-ad5e-bdd0621bb192", name: "Coatbridge Islamic Centre" },
  { guid: "bfe2fed4-bb7a-4703-a4dd-21c0c3747943", name: "Colchester ICA" },
  { guid: "ae89a5c8-999d-485a-b2e0-cfe57b0382f7", name: "Jamia Masjid Madina Colne" },
  { guid: "08717db1-c9da-48fe-b084-956d7a1f367d", name: "Exeter Mosque CC" },
  { guid: "c174aaf5-88bf-4f6f-86f3-6cac0501e7ec", name: "Multifaith Centre Exeter" },
  { guid: "5e7987f9-69a6-45b2-8466-efb23d8260f3", name: "Falkirk Central Mosque" },
  { guid: "b8125fdd-78c1-44de-bb56-1348354ab09a", name: "Sakina Ahmed Masjid Fareham" },
  { guid: "8a9b19ce-13ed-4438-a0ca-ae6f3bca6629", name: "Al Falaah Academy Glasgow" },
  { guid: "d4c48a4e-880b-408a-97ab-924d3b3c3a67", name: "Bilal Mosque Glasgow" },
  { guid: "74621e2f-7935-4bfa-b4ee-7326f3fdbc15", name: "Dawatul Islam Glasgow" },
  { guid: "fa08d1a7-9f88-45b1-8b7b-9b57f144b752", name: "Glasgow Central Mosque" },
  { guid: "230247c3-9129-4ebb-928e-08e8b6b2c7bc", name: "Hillview Islamic Education Centre" },
  { guid: "9108ad09-2ee1-4eae-ba90-7fbbf55295bc", name: "Islamic Academy of Scotland" },
  { guid: "1afe61ea-1a45-43c3-9c92-f6bd07b8854a", name: "ISLAMIC CENTER SCOTSTOUN" },
  { guid: "094a557c-67d1-4c03-a74e-d74d2572ef9a", name: "Jamia Khadija Tul Kubra" },
  { guid: "ecf0b258-14f2-412a-8a3d-82e44941f979", name: "Masjid Uthman Glasgow" },
  { guid: "378d1cea-ebdb-44f1-942e-4c69987ba1f4", name: "Masjid Yusuf Glasgow" },
  { guid: "5c2d90e4-4874-4d8f-afab-f1ed91f894da", name: "Masjid-e-Khazra Glasgow" },
  { guid: "9b594082-36e6-4538-9d50-8d06f229df68", name: "Minhaj-ul-Quran Glasgow" },
  { guid: "5c706562-ac34-474b-8a5d-7486d3ca690d", name: "Fife Muslim Educational Centre" },
  { guid: "b4848c54-7299-4a5b-9900-43726023df7b", name: "Hubb Gloucestershire" },
  { guid: "d4689833-bd46-4705-833e-6f28e1ac1429", name: "Gravesend Central Masjid" },
  { guid: "0b47ba98-2175-4172-a8b8-f44ece45d735", name: "Gravesend Shah Jalal Masjid" },
  { guid: "76c72373-79ac-41c6-b765-7e4d1c902745", name: "Taleem Mosque CC Grays" },
  { guid: "61bfaec4-a306-46fb-8419-80b82c243ec0", name: "Masjid At Tauwheed Yarmouth" },
  { guid: "3bb1fc26-6b9d-4784-bb8c-48a0bbfbde6d", name: "TAIBA WELFARE FOUNDATION" },
  { guid: "04af090e-0298-42f9-ba83-8f66bceca67e", name: "Guildford Central Masjid" },
  { guid: "d5332aef-8dd2-4a87-a9f1-4aaa3045e147", name: "Surrey Islamic Society" },
  { guid: "fa59e0a8-2313-44ba-be4e-138073cab485", name: "Blackheath Jamia Mosque Trust" },
  { guid: "cba535b2-269f-425f-beb2-a6d92b083c71", name: "Hamilton Masjid" },
  { guid: "0f944c66-0ecc-45a1-9eb5-ebdbb2960eb6", name: "Mid Sussex Islamic Centre" },
  { guid: "9cda5145-bd3b-4695-bb7d-7c0bb03391db", name: "Jamia Rehmania High Wycombe" },
  { guid: "5b36db44-2487-4121-9fc8-ebd1be29146e", name: "Hanfia Masjid Huddersfield" },
  { guid: "f11a6b16-418f-4241-b1a0-ceb700579b18", name: "Jamia Masjid Bilal Huddersfield" },
  { guid: "b44c0d8d-946a-4896-8360-d216c7bea7c0", name: "MASJID IMAN Huddersfield" },
  { guid: "4e8e37c2-b929-412d-b535-d9a689de1087", name: "Al-Salam Mosque Hull" },
  { guid: "e53c8ef9-2d6e-4d7f-9e5b-8b46b6a23b80", name: "East Riding CFT" },
  { guid: "055812ff-b765-4e9b-b81d-bdb5e08be748", name: "Hull Mosque ICC" },
  { guid: "ae294b9d-54f3-4d20-bf7b-b8e350215689", name: "Hull University Prayer Facility" },
  { guid: "e2ff723b-c41b-47bb-a579-682851288b97", name: "Jame Masjid Hull" },
  { guid: "878fbaf6-3f86-494c-a430-26142f7fae65", name: "Masjid Assahabah Hull" },
  { guid: "cf645eb0-a8e6-4c6b-9d11-528b415cfca8", name: "Masjid at-Tahir Hull" },
  { guid: "46bf6e8a-09d8-4487-912b-e65b30660e39", name: "Spring Bank Masjid" },
  { guid: "36efbedf-566c-47bc-8dbd-78410f74aa32", name: "Jamia Masjid Huntingdon" },
  { guid: "a74cfa52-c43e-479e-92f0-56a2a085cfdd", name: "Masjid Al-Falah Ilford" },
  { guid: "f830daa8-1919-4902-8a27-e869012e75ba", name: "Nawracy mosque Ipswich" },
  { guid: "65da8f36-9b13-45cc-9227-f48f01608e70", name: "Omar Al Farooq Islamic Centre" },
  { guid: "7037d7fc-60fe-45be-8dfd-5a258391094a", name: "NEWMARKET ICC" },
  { guid: "b1a44630-62cf-4585-8328-0e74e68df27b", name: "Isle of Wight Jame-e-Mosque" },
  { guid: "066682e7-74ef-4112-a8b6-c07a854e154f", name: "Jamia Mosque Newport" },
  { guid: "4294c894-c695-4ad6-8911-1f5fef8dcbe4", name: "Aysha-Siddique MCC" },
  { guid: "af306291-cdc7-4658-9889-b1ce32fb759f", name: "Al Madinah Masjid Norwich" },
  { guid: "1329d675-5a7d-40fc-a0b0-c1c74bb5555d", name: "East Anglian Bangladeshi Islam" },
  { guid: "74d99c8b-2f46-41f3-8ac6-3b904c725c28", name: "Hethersett Masjid" },
  { guid: "2b8d4d46-6ca4-41b1-9a6a-8ed08d931595", name: "Siddiqa Nawaz Mosque" },
  { guid: "cf239846-3ac8-4ecb-a0c3-a8a5fc3224da", name: "Jamia Masjid Sultania Nottingham" },
  { guid: "20707e70-5642-4f90-a317-3c13aff54276", name: "Madni Nottingham" },
  { guid: "00427cc7-2b15-49d6-95a3-df723e3a11d0", name: "Makki Masjid Nottingham" },
  { guid: "8039fa7d-d855-4be5-bcf3-82a4cfc63cde", name: "Masjid Al-Khazra Nottingham" },
  { guid: "d7b71149-6c91-4d07-978f-895b2e1f2895", name: "Masjid e Bilaal Nottingham" },
  { guid: "c60f95cf-375c-406f-b9cb-07e0bf2248e2", name: "Masjid E Noor Nottingham" },
  { guid: "7893c6b9-f245-47eb-a935-f7bddb6fc1e9", name: "Millata Ibrahim Mosque" },
  { guid: "a5040c1d-7c40-46c1-b395-e1261b8fd50e", name: "Masjid Adam Oadby" },
  { guid: "3220d996-9651-4dcc-ad29-b284e209d092", name: "Masjid-al-Ameen Oadby" },
  { guid: "6abfc2f0-032c-4da2-aa17-b1bc1475e1e9", name: "Madina Institute Oldham" },
  { guid: "8b21d1fa-61fd-4097-a2b6-abc54eb27121", name: "Masjid-ul-Aqsa Oldham" },
  { guid: "9e173765-6b36-41f0-a666-e039f6c46077", name: "Muhammadia Saifia Education Trust" },
  { guid: "508a889b-131c-483f-bad2-df11b8b9420f", name: "Oldham Mosque ICC" },
  { guid: "14ec97dc-1ef1-4982-93b5-3b310d48311e", name: "Nurani Cultural Centre" },
  { guid: "9cbea0ca-9c91-45b0-8d85-dea98b41298e", name: "Peacehaven masjid" },
  { guid: "06fb0801-6569-4100-bdb5-a19fab682736", name: "Jamia Masjid Faizan-E-Madina Peterborough" },
  { guid: "c08ab22e-066f-4463-89d7-2de3f1c100af", name: "Masjid Darassalaam" },
  { guid: "9ee3972e-3b1b-4123-982a-124bb43f8bc7", name: "Masjid Ghousia Peterborough" },
  { guid: "6b129042-d459-43c5-be2e-4ccf0a066150", name: "Salahaddin Peterborough" },
  { guid: "4ecb8eb2-7dff-4cd2-8bcd-1176ac91326d", name: "Poole Mosque" },
  { guid: "3e3ff0d6-c1cc-459b-8efe-f4635ab1ae3f", name: "North End Islamic Centre" },
  { guid: "d4208201-6430-4f4a-8646-848a6ecff202", name: "Portsmouth Central Masjid" },
  { guid: "5611de68-c63b-4744-b23f-03fae0c8f7b3", name: "Portsmouth Jami Mosque" },
  { guid: "e27e0abc-853c-4aae-b658-55c30afcc742", name: "University of Portsmouth" },
  { guid: "3557d43c-1438-4613-a83b-8d21d15b10ae", name: "Darul Uloom Preston" },
  { guid: "2fae4f35-265f-47c4-a3d6-13981235e851", name: "Eldon Street Madrasa Preston" },
  { guid: "16e5d9d1-c809-4812-a7c2-2fe976217e24", name: "Jamea Masjid Preston" },
  { guid: "51451f1b-bfba-49cc-ba36-5d6f9e8b30a6", name: "Masjid e Falah Preston" },
  { guid: "f09a6bb9-499a-4085-9dcf-8da3b23cee73", name: "Penwortham Musallah" },
  { guid: "606eda77-a972-4b73-8a8d-863d95c48eda", name: "The Suffah Institute" },
  { guid: "19ecb73b-9a40-4c73-85e6-6b1e1e195842", name: "Aisha Masjid Reading" },
  { guid: "044fe65d-bf9e-413d-b923-dd981faa5c59", name: "University of Reading Muslim Centre" },
  { guid: "86b589af-2211-498f-9ae7-37bd17421574", name: "Al Amin Jame masjid Rochdale" },
  { guid: "7955a131-8c5a-4781-ad5d-aa92a2ae19de", name: "Al-Quba Jamia Masjid" },
  { guid: "1b60c708-ac39-429e-8e4a-99028c932a3e", name: "Jamia Ghausia Masjid Sparth" },
  { guid: "e036ad0c-f761-4224-ac7f-b34b2d2f4bf8", name: "Jamia Masjid Bilal Rochdale" },
  { guid: "c0ce2c14-e06f-4c3b-b76a-8cbeee2a8687", name: "Collier Row Mosque" },
  { guid: "94e612d5-2a04-4a7f-bbc8-264e3e69d8cc", name: "Jamia Masjid Noor Ul Huda" },
  { guid: "978ed617-cb57-4a2c-8c80-aa7fcacd47ad", name: "Masjid ahl e hadith Rotherham" },
  { guid: "9f4fbbf6-9df0-4c91-9bab-3fb021d82e86", name: "Masjid Uthman Rotherham" },
  { guid: "66f45641-d28b-4a2e-8823-449661ef27bd", name: "Raza e Mustafa" },
  { guid: "17594c7e-03d4-4552-a491-35cd16277088", name: "Salisbury Central Masjid" },
  { guid: "ca3b07b8-97ef-42dc-84aa-10a586fa8a08", name: "Scunthorpe Central Masjid" },
  { guid: "c6326056-7631-409c-a2aa-0c2d16b04e82", name: "Scunthorpe Islamic Centre" },
  { guid: "24874972-9224-4bfd-8a9e-963b84943f86", name: "Shahjalal Jamia Mosque Scunthorpe" },
  { guid: "010a7e1a-ea28-4cfa-827a-eea97e2b8224", name: "Al-Huda Academy Sheffield" },
  { guid: "a142bc0e-4270-4c4b-9246-bc438c70a6ba", name: "Madani Education Centre Sheffield" },
  { guid: "98e33a8a-0f2c-47d3-9b51-1a605ffaa117", name: "Masjid Abu Bakr Sheffield" },
  { guid: "70c11290-9fd1-4ea7-aae4-ff901ebcefed", name: "Sheffield teaching hospital" },
  { guid: "2bf6350c-6e1a-4ca9-a721-72bccd4084c3", name: "Al-Furquaan Shipley" },
  { guid: "fce58035-0d73-4bbd-a5ac-906e9ade70f4", name: "Minhaj-ul-Quran Walsall" },
  { guid: "3c979b5c-daa5-4dba-aaa1-c97cf7211d08", name: "Walsall Jamia Masjid Ghausia" },
  { guid: "4409b545-9468-49b9-be36-d5270732fdc8", name: "Warrington Islamic Association" },
  { guid: "c5d4da0b-48ca-456b-ae6f-325fa5e10a19", name: "Zia E Madinah Wednesbury" },
  { guid: "6b570135-f845-4f8c-8843-298f6e7a936f", name: "Welwyn Islamic Society" },
  { guid: "113e7338-f17f-4a49-958e-f72ef5570559", name: "Jami Masjid ICC West Bromwich" },
  { guid: "c131327c-ffda-4b50-9877-7608239a2bf6", name: "Sandwell Grand Masjid" },
  { guid: "c2de4418-0c09-4c82-8c2a-1b29ed65e6f6", name: "Weston Islamic education centre" },
  { guid: "b6747061-1708-4b4a-9491-72f8da6430de", name: "Masjid Tooba Wigan" },
  { guid: "e000306c-45a3-43a6-a01a-08915265dcda", name: "Wirral Deen Centre" },
  { guid: "f235f0b2-f6d1-4059-a8a5-33039102158b", name: "Jaamia Masjid Aqsa Wolverhampton" },
  { guid: "2105115c-08c3-43b1-a01e-0945eb8eec60", name: "Masjid Alrahma Wolverhampton" },
  { guid: "33f44c5a-fd50-4f85-a18b-b49e24b8048b", name: "Masjid At-Taqwa Wolverhampton" },
  { guid: "92275873-375b-4450-a79d-9c321aded4d2", name: "Rwnaky Masjid" },
  { guid: "c6e78a99-4d8a-4358-b530-80a97130384a", name: "Yeovil Islamic Centre" },
  { guid: "2aa8f9d3-fa28-4a7d-a261-2fa4b2722732", name: "York Mosque ICC" },
  { guid: "0f90ea44-fefe-45b7-b9d1-2ec6f875d1dc", name: "York Muslim Association" }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// day/month (no year) -> ISO date string, resolved against the NEXT
// occurrence of that day/month from today (rolls into next year once
// this year's date has passed), or null if invalid (e.g. Feb 29 in a
// non-leap year) or outside the WINDOW_DAYS forward window.
function dayMonthToIso(day, month, today) {
  const tryYear = (y) => {
    const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    if (month === 2 && day === 29 && !isLeap) return null;
    const d = new Date(Date.UTC(y, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null; // invalid combo
    return d;
  };

  const todayMidnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const windowEnd = todayMidnight + WINDOW_DAYS * 86400000;

  // Try this year first, then next year (handles the wrap at year-end).
  let candidate = tryYear(today.getUTCFullYear());
  if (!candidate || candidate.getTime() < todayMidnight) {
    candidate = tryYear(today.getUTCFullYear() + 1);
  }
  if (!candidate) return null;
  if (candidate.getTime() < todayMidnight || candidate.getTime() > windowEnd) return null; // outside the rolling window

  return candidate.toISOString().slice(0, 10);
}

const UPSERT_SQL = `
  INSERT INTO jamaah_raw
    (source, source_ref, date, fajr_jamaah, zuhr_jamaah, asr_jamaah, maghrib_jamaah, isha_jamaah, updated_at)
  VALUES ('mymasjid_scrape', ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source, source_ref, date) DO UPDATE SET
    fajr_jamaah=excluded.fajr_jamaah,
    zuhr_jamaah=excluded.zuhr_jamaah,
    asr_jamaah=excluded.asr_jamaah,
    maghrib_jamaah=excluded.maghrib_jamaah,
    isha_jamaah=excluded.isha_jamaah,
    updated_at=excluded.updated_at
  WHERE
    fajr_jamaah    IS NOT excluded.fajr_jamaah OR
    zuhr_jamaah    IS NOT excluded.zuhr_jamaah OR
    asr_jamaah     IS NOT excluded.asr_jamaah OR
    maghrib_jamaah IS NOT excluded.maghrib_jamaah OR
    isha_jamaah    IS NOT excluded.isha_jamaah
`;

// Registers this source's mosque code on the translator sheet
// (mosque_sources). Never touches mosque_slug, so manual matching is
// preserved no matter how many times a sync runs.
const REGISTER_SOURCE_SQL = `
  INSERT INTO mosque_sources (source, source_ref, name, first_seen, last_seen)
  VALUES ('mymasjid_scrape', ?, ?, ?, ?)
  ON CONFLICT(source, source_ref) DO UPDATE SET
    name = COALESCE(mosque_sources.name, excluded.name),
    last_seen = excluded.last_seen
`;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!isSyncRequest(context)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const start = parseInt(url.searchParams.get("start") || "0", 10);
  const end = parseInt(url.searchParams.get("end") || "30", 10);
  const nowIso = new Date().toISOString();
  const today = new Date(); // reference point for the 90-day rolling window

  const results = { processed: [], failed: [], skipped: [], recordsSaved: 0 };

  const slice = MYMASJID_MOSQUES.slice(start, end);

  for (const { guid, name } of slice) {
    if (name.toLowerCase().includes(EXCLUDED_NAME_MATCH)) {
      results.skipped.push(guid);
      continue;
    }

    try {
      const apiUrl = `${API_BASE}?GuidId=${guid}`;
      const resp = await fetch(apiUrl, { headers: { Accept: "application/json" } });

      if (!resp.ok) {
        results.failed.push({ guid, name, status: resp.status });
        await sleep(DELAY_MS);
        continue;
      }

      const data = await resp.json();
      const timings = data.model?.salahTimings || [];

      // Register this mosque's MyMasjid guid + display name on the translator sheet.
      await env.DB.prepare(REGISTER_SOURCE_SQL).bind(guid, name, nowIso, nowIso).run();

      const statements = [];
      for (const day of timings) {
        const dateIso = dayMonthToIso(day.day, day.month, today);
        if (!dateIso) continue; // outside the 90-day window, or e.g. Feb 29 in non-leap year

        statements.push(
          env.DB.prepare(UPSERT_SQL).bind(
            guid,
            dateIso,
            day.iqamah_Fajr || null,
            day.iqamah_Zuhr || null,
            day.iqamah_Asr || null,
            day.iqamah_Maghrib || null,
            day.iqamah_Isha || null,
            nowIso
          )
        );
      }

      // D1 batch has a practical limit per call; chunk into groups of 100
      for (let i = 0; i < statements.length; i += 100) {
        await env.DB.batch(statements.slice(i, i + 100));
      }
      results.recordsSaved += statements.length;
      results.processed.push({ guid, name, days: statements.length });
    } catch (e) {
      results.failed.push({ guid, name, error: String(e) });
    }

    await sleep(DELAY_MS);
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { "Content-Type": "application/json" },
  });
}
