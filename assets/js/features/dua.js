
/* ============================================================
   DU'A & DHIKR SECTION
   ============================================================ */
(function(){

/* ============================================================
   UTIL
   ============================================================ */
const $ = (sel,root)=> (root||document).querySelector(sel);
const $$ = (sel,root)=> Array.from((root||document).querySelectorAll(sel));
// showToast: shared, defined once in wwp-core.js (loads first) — no local copy needed.

const ICONS = {
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon:'<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"/>',
  moonstars:'<path d="M20 12.8A8 8 0 1 1 11.2 4 6.2 6.2 0 0 0 20 12.8Z"/><path d="M19 3v3M17.5 4.5h3"/>',
  mosque:'<path d="M12 3c3.5 3 5 6 5 10H7c0-4 1.5-7 5-10Z"/><path d="M4 21v-6h4v6M16 21v-6h4v6"/><path d="M4 21h16"/>',
  allah:'<circle cx="12" cy="12" r="8"/><path d="M9 8v8M15 8v5a3 3 0 0 1-3 3"/>',
  bookstand:'<path d="M4 19V6l8-3 8 3v13"/><path d="M12 3v16M4 19h16"/>',
  tasbih:'<circle cx="12" cy="5" r="2"/><circle cx="18" cy="9" r="2"/><circle cx="19" cy="16" r="2"/><circle cx="14" cy="21" r="2"/><circle cx="7" cy="20" r="2"/><circle cx="3" cy="14" r="2"/><circle cx="5" cy="7" r="2"/>',
  people:'<circle cx="8" cy="8" r="3"/><circle cx="16" cy="8" r="3"/><path d="M2 21c0-3.5 2.7-6 6-6s6 2.5 6 6M10 21c0-3.5 2.7-6 6-6s6 2.5 6 6"/>',
  clouds:'<path d="M6 17a4 4 0 0 1 .3-8 5 5 0 0 1 9.6-1.6A4.5 4.5 0 0 1 17 17H6Z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4H6.5A2.5 2.5 0 0 0 4 6.5v13Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20"/>',
  star:'<path d="M12 3l2.6 6 6.4.6-4.8 4.3 1.4 6.3L12 17l-5.6 3.2 1.4-6.3L3 7.6 9.4 7Z"/>',
  shield:'<path d="M12 3l7 3v6c0 4.5-3 8-7 9-4-1-7-4.5-7-9V6Z"/>',
  repeat:'<path d="M17 2l4 4-4 4"/><path d="M3 12v-2a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 12v2a4 4 0 0 1-4 4H3"/>',
  heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"/>'
};
function iconSvg(name, size){ size = size||14; return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${ICONS[name]||ICONS.star}</svg>`; }

/* ============================================================
   DUA_TILE_IMAGES / DUA_BANNER_IMAGES :: category card artwork
   (illustrated scenes with baked-in title text) for the Du'a &
   Dhikr section. Two sizes are served because the grid tile
   (~1.22:1) and the opened-category banner (~1.62:1) have very
   different box ratios — using one crop for both caused uneven
   zoom/cropping across cards. Tile crops are pre-cropped to the
   grid's own ratio (anchored to keep each image's title text and
   arrow fully in frame) so every tile looks consistently framed;
   banner images use the original wider artwork, which already
   matches that box's ratio closely. Served as static files from
   /assets/dua/ so they cache independently of the page and keep
   index.html lean.
   ============================================================ */
const DUA_TILE_IMAGES = {
  morning: "assets/dua/tile/morning.webp",
  evening: "assets/dua/tile/evening.webp",
  salah: "assets/dua/tile/salah.webp",
  sleep: "assets/dua/tile/sleep.webp",
  praise: "assets/dua/tile/praise.webp",
  qurandua: "assets/dua/tile/qurandua.webp",
  istighfar: "assets/dua/tile/istighfar.webp",
  ummah: "assets/dua/tile/ummah.webp",
  names: "assets/dua/tile/names.webp",
  other: "assets/dua/tile/other.webp"
};
const DUA_BANNER_IMAGES = {
  morning: "assets/dua/banner/morning.webp",
  evening: "assets/dua/banner/evening.webp",
  salah: "assets/dua/banner/salah.webp",
  sleep: "assets/dua/banner/sleep.webp",
  praise: "assets/dua/banner/praise.webp",
  qurandua: "assets/dua/banner/qurandua.webp",
  istighfar: "assets/dua/banner/istighfar.webp",
  ummah: "assets/dua/banner/ummah.webp",
  names: "assets/dua/banner/names.webp",
  other: "assets/dua/banner/other.webp"
};

/* ============================================================
   SCENES :: high-quality vector illustrations, one per category —
   layered gradients, soft glows and fine linework for a premium
   finish while staying crisp at any size (unlike a raster crop).
   Kept as a fallback source for views without dedicated artwork
   (e.g. the "My Favourites" banner).
   ============================================================ */

const SCENES = {
  morning: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="m-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FFF3D9"/><stop offset=".5" stop-color="#FBCE8F"/><stop offset="1" stop-color="#EE9A5C"/>
      </linearGradient>
      <radialGradient id="m-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#FFF8E6" stop-opacity=".95"/><stop offset="1" stop-color="#FFF8E6" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="m-sun" cx="38%" cy="35%" r="65%">
        <stop offset="0" stop-color="#FFF3CE"/><stop offset="1" stop-color="#F8B65E"/>
      </radialGradient>
      <linearGradient id="m-hill1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9A465"/><stop offset="1" stop-color="#DD8C4E"/></linearGradient>
      <linearGradient id="m-hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C97142"/><stop offset="1" stop-color="#A85A34"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#m-sky)"/>
    <circle cx="224" cy="66" r="46" fill="url(#m-glow)"/>
    <circle cx="224" cy="66" r="22" fill="url(#m-sun)"/>
    <g stroke="#FCD9A0" stroke-width="1.4" opacity=".55" stroke-linecap="round">
      <path d="M224 26v10"/><path d="M224 96v10"/><path d="M264 66h-10"/><path d="M194 66h-10"/>
      <path d="M252 38l-7 7"/><path d="M203 94l-7 7"/><path d="M252 94l-7-7"/><path d="M203 38l-7-7"/>
    </g>
    <path d="M0 118 Q45 100 90 112 T190 106 T300 100 L300 170 L0 170 Z" fill="url(#m-hill1)" opacity=".9"/>
    <path d="M0 142 Q60 122 130 138 T300 126 L300 170 L0 170 Z" fill="url(#m-hill2)"/>
    <g stroke="#7A3F22" stroke-width="1.5" fill="none" stroke-linecap="round" opacity=".55">
      <path d="M40 46 q5 -5 10 0 q5 -5 10 0"/>
      <path d="M76 34 q5 -5 10 0 q5 -5 10 0"/>
      <path d="M108 50 q5 -5 10 0 q5 -5 10 0"/>
    </g>
  </svg>`,

  evening: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="e-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#C9BEE6"/><stop offset=".55" stop-color="#8478B8"/><stop offset="1" stop-color="#463B67"/>
      </linearGradient>
      <radialGradient id="e-glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#F6EFD8" stop-opacity=".8"/><stop offset="1" stop-color="#F6EFD8" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="e-hill1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8172AC"/><stop offset="1" stop-color="#655594"/></linearGradient>
      <linearGradient id="e-hill2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4C3F71"/><stop offset="1" stop-color="#392E56"/></linearGradient>
      <linearGradient id="e-flame" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFEBB0"/><stop offset="1" stop-color="#F4B94A"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#e-sky)"/>
    <circle cx="220" cy="34" r="30" fill="url(#e-glow)"/>
    <path d="M212 20a15 15 0 1 0 18-13 11.5 11.5 0 1 1-18 13Z" fill="#FBF3DC"/>
    <g fill="#fff">
      <circle cx="258" cy="24" r="1.5" opacity=".85"/><circle cx="272" cy="46" r="1.1" opacity=".7"/>
      <circle cx="60" cy="30" r="1.2" opacity=".7"/><circle cx="100" cy="18" r="1.4" opacity=".8"/>
      <circle cx="150" cy="14" r="1" opacity=".6"/>
    </g>
    <path d="M0 108 Q60 84 130 104 T300 92 L300 170 L0 170 Z" fill="url(#e-hill1)" opacity=".85"/>
    <path d="M0 138 Q70 116 150 134 T300 122 L300 170 L0 170 Z" fill="url(#e-hill2)"/>
    <g transform="translate(50,84)">
      <line x1="0" y1="-30" x2="0" y2="-20" stroke="#E4C27C" stroke-width="1.6"/>
      <path d="M-4 -20 h8 l3 6 h-14 Z" fill="#D9B25C"/>
      <path d="M-13 -14 L13 -14 L10 22 L-10 22 Z" fill="none" stroke="#E4C27C" stroke-width="1.8"/>
      <path d="M-13 -2 h26 M-13 8 h26" stroke="#E4C27C" stroke-width="1" opacity=".6"/>
      <ellipse cx="0" cy="6" rx="5.5" ry="7" fill="url(#e-flame)" opacity=".92"/>
      <path d="M-10 22 h20 l-3 6 h-14 Z" fill="#D9B25C"/>
    </g>
  </svg>`,

  salah: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="s-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EEF6E4"/><stop offset="1" stop-color="#9BBC8C"/>
      </linearGradient>
      <radialGradient id="s-glow" cx="50%" cy="45%" r="55%">
        <stop offset="0" stop-color="#FFFDF2" stop-opacity=".7"/><stop offset="1" stop-color="#FFFDF2" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="s-dome" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C9A6E"/><stop offset="1" stop-color="#516D48"/></linearGradient>
      <linearGradient id="s-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#688861"/><stop offset="1" stop-color="#4C6944"/></linearGradient>
      <linearGradient id="s-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#87A879"/><stop offset="1" stop-color="#6C8C60"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#s-sky)"/>
    <circle cx="150" cy="80" r="70" fill="url(#s-glow)"/>
    <path d="M0 132 Q80 110 160 128 T300 118 L300 170 L0 170 Z" fill="url(#s-hill)" opacity=".8"/>
    <g>
      <path d="M150 62c13 11 20 24 20 40h-40c0-16 7-29 20-40Z" fill="url(#s-dome)"/>
      <circle cx="150" cy="56" r="3" fill="#4C6944"/><line x1="150" y1="48" x2="150" y2="56" stroke="#4C6944" stroke-width="2"/>
      <rect x="112" y="102" width="76" height="46" fill="url(#s-body)"/>
      <path d="M136 148v-24a14 14 0 0 1 28 0v24Z" fill="#3F5A38"/>
      <rect x="102" y="76" width="11" height="72" fill="#5C7A54"/>
      <rect x="187" y="76" width="11" height="72" fill="#5C7A54"/>
      <path d="M102 76 L107.5 60 L113 76Z" fill="#4C6944"/>
      <path d="M187 76 L192.5 60 L198 76Z" fill="#4C6944"/>
      <circle cx="107.5" cy="54" r="2.2" fill="#4C6944"/><circle cx="192.5" cy="54" r="2.2" fill="#4C6944"/>
      <rect x="103" y="92" width="9" height="6" fill="#41593B" opacity=".7"/>
      <rect x="188" y="92" width="9" height="6" fill="#41593B" opacity=".7"/>
      <path d="M122 122a8 8 0 0 1 16 0v10h-16Z" fill="#41593B" opacity=".8"/>
      <path d="M162 122a8 8 0 0 1 16 0v10h-16Z" fill="#41593B" opacity=".8"/>
    </g>
  </svg>`,

  sleep: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="sl-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#31356A"/><stop offset="1" stop-color="#121227"/>
      </linearGradient>
      <linearGradient id="sl-win" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#454A87"/><stop offset="1" stop-color="#2B2F5C"/></linearGradient>
      <radialGradient id="sl-moon-glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#F6EFCB" stop-opacity=".65"/><stop offset="1" stop-color="#F6EFCB" stop-opacity="0"/></radialGradient>
      <radialGradient id="sl-lamp" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#FFE9B0" stop-opacity=".9"/><stop offset="1" stop-color="#FFE9B0" stop-opacity="0"/></radialGradient>
      <linearGradient id="sl-bed" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#565A93"/><stop offset="1" stop-color="#3E4278"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#sl-sky)"/>
    <g fill="#fff">
      <circle cx="26" cy="20" r="1.3" opacity=".8"/><circle cx="55" cy="38" r="1" opacity=".6"/>
      <circle cx="90" cy="16" r="1.4" opacity=".85"/><circle cx="130" cy="30" r="1" opacity=".6"/>
      <circle cx="170" cy="14" r="1.2" opacity=".7"/>
    </g>
    <rect x="200" y="14" width="80" height="102" rx="6" fill="url(#sl-win)"/>
    <rect x="204" y="18" width="72" height="94" rx="4" fill="#1B1E42"/>
    <line x1="240" y1="18" x2="240" y2="112" stroke="url(#sl-win)" stroke-width="3"/>
    <line x1="204" y1="65" x2="276" y2="65" stroke="url(#sl-win)" stroke-width="3"/>
    <circle cx="255" cy="42" r="16" fill="url(#sl-moon-glow)"/>
    <path d="M248 33a9 9 0 1 0 11-8 7 7 0 1 1-11 8Z" fill="#F3EAC9"/>
    <circle cx="222" cy="86" r="1.5" fill="#fff" opacity=".9"/>
    <circle cx="264" cy="94" r="1" fill="#fff" opacity=".7"/>
    <circle cx="46" cy="96" r="26" fill="url(#sl-lamp)"/>
    <line x1="46" y1="60" x2="46" y2="80" stroke="#8B8FBE" stroke-width="1.6"/>
    <path d="M36 80h20l4 14h-28Z" fill="#6C6FA0"/>
    <rect x="8" y="130" width="164" height="14" rx="5" fill="url(#sl-bed)"/>
    <rect x="12" y="106" width="38" height="26" rx="8" fill="#E7E9F5"/>
    <rect x="8" y="120" width="164" height="28" rx="7" fill="#6468A0"/>
    <path d="M60 122 q40 -8 100 0" stroke="#7B7FB4" stroke-width="1.4" fill="none" opacity=".6"/>
  </svg>`,

  praise: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="p-bg" cx="50%" cy="45%" r="75%">
        <stop offset="0" stop-color="#FBF2DC"/><stop offset="1" stop-color="#D9B87C"/>
      </radialGradient>
      <radialGradient id="p-glow" cx="50%" cy="48%" r="45%">
        <stop offset="0" stop-color="#FFFAEC" stop-opacity=".9"/><stop offset="1" stop-color="#FFFAEC" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="p-gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C99A4C"/><stop offset="1" stop-color="#9C7130"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#p-bg)"/>
    <circle cx="150" cy="85" r="58" fill="url(#p-glow)"/>
    <circle cx="150" cy="85" r="50" fill="none" stroke="url(#p-gold)" stroke-width="1.6" opacity=".55"/>
    <circle cx="150" cy="85" r="41" fill="none" stroke="url(#p-gold)" stroke-width="1" opacity=".4"/>
    <g fill="url(#p-gold)" opacity=".65">
      <circle cx="150" cy="35" r="2.4"/><circle cx="150" cy="135" r="2.4"/>
      <circle cx="100" cy="85" r="2.4"/><circle cx="200" cy="85" r="2.4"/>
      <circle cx="115" cy="50" r="1.7"/><circle cx="185" cy="50" r="1.7"/>
      <circle cx="115" cy="120" r="1.7"/><circle cx="185" cy="120" r="1.7"/>
    </g>
    <text x="150" y="100" font-family="Amiri,serif" font-size="40" fill="url(#p-gold)" text-anchor="middle">اللَّه</text>
  </svg>`,

  qurandua: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="q-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#E4F4EF"/><stop offset="1" stop-color="#7FB6AC"/>
      </linearGradient>
      <radialGradient id="q-glow" cx="50%" cy="40%" r="55%"><stop offset="0" stop-color="#FBFFFB" stop-opacity=".7"/><stop offset="1" stop-color="#FBFFFB" stop-opacity="0"/></radialGradient>
      <linearGradient id="q-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6FA79C"/><stop offset="1" stop-color="#548C81"/></linearGradient>
      <linearGradient id="q-wood" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8A5A34"/><stop offset="1" stop-color="#6B4426"/></linearGradient>
      <linearGradient id="q-page" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFCF3"/><stop offset="1" stop-color="#F3E9D2"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#q-sky)"/>
    <circle cx="150" cy="60" r="60" fill="url(#q-glow)"/>
    <path d="M0 132 Q90 112 180 130 T300 120 L300 170 L0 170 Z" fill="url(#q-hill)" opacity=".55"/>
    <ellipse cx="150" cy="140" rx="52" ry="6" fill="#345048" opacity=".25"/>
    <g stroke="url(#q-wood)" stroke-width="4.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M112 132 L150 90 L188 132"/>
      <path d="M98 135 L202 135"/>
    </g>
    <path d="M114 92 q36 -14 72 0 v22 a36 6 0 0 1 -72 0 Z" fill="url(#q-page)" stroke="#C7A968" stroke-width="1.4"/>
    <path d="M150 92 v22" stroke="#C7A968" stroke-width="1.4"/>
    <g stroke="#B79E77" stroke-width="1" opacity=".65">
      <path d="M122 98 q14 -5 26 -1"/><path d="M122 104 q14 -5 26 -1"/>
      <path d="M152 97 q14 -4 26 1"/><path d="M152 103 q14 -4 26 1"/>
    </g>
  </svg>`,

  istighfar: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="i-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EEF3E0"/><stop offset="1" stop-color="#A9BE87"/>
      </linearGradient>
      <radialGradient id="i-glow" cx="50%" cy="48%" r="50%"><stop offset="0" stop-color="#FBFFF0" stop-opacity=".7"/><stop offset="1" stop-color="#FBFFF0" stop-opacity="0"/></radialGradient>
      <radialGradient id="i-bead" cx="35%" cy="32%" r="70%">
        <stop offset="0" stop-color="#A8C288"/><stop offset=".55" stop-color="#6E8A50"/><stop offset="1" stop-color="#516738"/>
      </radialGradient>
      <radialGradient id="i-imam" cx="35%" cy="32%" r="70%">
        <stop offset="0" stop-color="#8FAE72"/><stop offset=".6" stop-color="#547038"/><stop offset="1" stop-color="#3C5226"/>
      </radialGradient>
    </defs>
    <rect width="300" height="170" fill="url(#i-sky)"/>
    <circle cx="150" cy="85" r="66" fill="url(#i-glow)"/>
    <ellipse cx="150" cy="146" rx="46" ry="6" fill="#41531F" opacity=".18"/>
    <g>
      <circle cx="150" cy="40" r="7.5" fill="url(#i-bead)"/>
      <circle cx="182" cy="49" r="7" fill="url(#i-bead)"/>
      <circle cx="204" cy="76" r="7" fill="url(#i-bead)"/>
      <circle cx="211" cy="108" r="7" fill="url(#i-bead)"/>
      <circle cx="196" cy="136" r="7" fill="url(#i-bead)"/>
      <circle cx="167" cy="152" r="7" fill="url(#i-bead)"/>
      <circle cx="133" cy="152" r="7" fill="url(#i-bead)"/>
      <circle cx="104" cy="136" r="7" fill="url(#i-bead)"/>
      <circle cx="89" cy="108" r="7" fill="url(#i-bead)"/>
      <circle cx="96" cy="76" r="7" fill="url(#i-bead)"/>
      <circle cx="118" cy="49" r="7" fill="url(#i-bead)"/>
      <circle cx="150" cy="40" r="10" fill="url(#i-imam)"/>
    </g>
    <path d="M150 156 q3 12 -2 24" stroke="#6E8A50" stroke-width="2.4" fill="none" stroke-linecap="round"/>
    <path d="M144 178 q6 5 12 0 q6 5 -0 8" stroke="#8FAE72" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".8"/>
  </svg>`,

  ummah: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="u-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#FBEACB"/><stop offset="1" stop-color="#DE9E6D"/>
      </linearGradient>
      <radialGradient id="u-glow" cx="50%" cy="35%" r="60%"><stop offset="0" stop-color="#FFF6E4" stop-opacity=".8"/><stop offset="1" stop-color="#FFF6E4" stop-opacity="0"/></radialGradient>
      <linearGradient id="u-hill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D2926866"/><stop offset="1" stop-color="#C97B4E"/></linearGradient>
      <linearGradient id="u-fig1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#B36A3E"/><stop offset="1" stop-color="#8F5029"/></linearGradient>
      <linearGradient id="u-fig2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C67C4A"/><stop offset="1" stop-color="#9C5C31"/></linearGradient>
    </defs>
    <rect width="300" height="170" fill="url(#u-sky)"/>
    <circle cx="150" cy="55" r="70" fill="url(#u-glow)"/>
    <path d="M0 146 Q90 126 180 144 T300 134 L300 170 L0 170 Z" fill="url(#u-hill)" opacity=".55"/>
    <path d="M62 150 V96 a30 30 0 0 1 60 0 v54" fill="none" stroke="#B4795032" stroke-width="10" opacity=".35"/>
    <g fill="url(#u-fig1)">
      <path d="M118 150 v-42 a17 17 0 0 1 34 0 v42 Z"/>
      <circle cx="135" cy="97" r="10"/>
    </g>
    <g fill="url(#u-fig2)">
      <path d="M162 150 v-50 a21 21 0 0 1 42 0 v50 Z"/>
      <circle cx="183" cy="87" r="11"/>
    </g>
    <path d="M126 150 v-18 q9 -8 18 0 v18" fill="none" stroke="#7A431E" stroke-width="1.4" opacity=".5"/>
  </svg>`,

  names: `<svg viewBox="0 0 300 170" preserveAspectRatio="xMidYMid slice">
    <defs>
      <linearGradient id="n-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#F3E7F8"/><stop offset="1" stop-color="#AD91C9"/>
      </linearGradient>
      <radialGradient id="n-glow" cx="50%" cy="45%" r="50%"><stop offset="0" stop-color="#FFF9FF" stop-opacity=".85"/><stop offset="1" stop-color="#FFF9FF" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="300" height="170" fill="url(#n-sky)"/>
    <circle cx="150" cy="80" r="60" fill="url(#n-glow)"/>
    <g fill="#fff" opacity=".5">
      <ellipse cx="60" cy="118" rx="42" ry="15"/>
      <ellipse cx="92" cy="106" rx="28" ry="12"/>
      <ellipse cx="230" cy="52" rx="46" ry="16"/>
      <ellipse cx="258" cy="68" rx="24" ry="10"/>
    </g>
    <g fill="#fff" opacity=".38">
      <ellipse cx="150" cy="140" rx="60" ry="12"/>
    </g>
    <text x="150" y="96" font-family="Amiri,serif" font-size="32" fill="#6B4E82" text-anchor="middle" opacity=".92">اللَّه</text>
  </svg>`
};
function sceneSvg(catId){ return SCENES[catId] || ''; }

/* ============================================================
   DATA :: original plain-English renderings — not quoted from any
   published translation. Hadith references are described in general
   terms rather than citing a specific book+number where that exact
   citation hasn't been verified against a primary source.
   ==> CONNECT: replace with a verified, licensed content source.
   ============================================================ */
const ITEMS = {
  // ============ MORNING ============
  'morning-dhikr':{ title:"Morning Remembrance", subtitle:"Asbahna wa asbahal-mulku lillah", icon:'sun',
    arabic:"أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
    translit:"Aṣbaḥnā wa aṣbaḥa l-mulku lillāh, wal-ḥamdu lillāh, lā ilāha illallāhu waḥdahū lā sharīka lah.",
    translation:"We have entered the morning, and with us the whole dominion belongs to Allah. All praise is for Allah. There is no god but Allah alone, without any partner.",
    reference:"Hisn al-Muslim 77 (Muslim 4/2088)" },

  'ayat-al-kursi':{ title:"Ayat al-Kursi", subtitle:"Al-Baqarah 2:255", icon:'star',
    arabic:"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ ۚ لَّهُ مَا فِي السَّمَاوَاتِ وَمَا فِي الْأَرْضِ ۗ مَن ذَا الَّذِي يَشْفَعُ عِندَهُ إِلَّا بِإِذْنِهِ ۚ يَعْلَمُ مَا بَيْنَ أَيْدِيهِمْ وَمَا خَلْفَهُمْ ۖ وَلَا يُحِيطُونَ بِشَيْءٍ مِّنْ عِلْمِهِ إِلَّا بِمَا شَاءَ ۚ وَسِعَ كُرْسِيُّهُ السَّمَاوَاتِ وَالْأَرْضَ ۖ وَلَا يَئُودُهُ حِفْظُهُمَا ۚ وَهُوَ الْعَلِيُّ الْعَظِيمُ",
    translit:"Allāhu lā ilāha illā huwa l-ḥayyu l-qayyūm, lā taʾkhudhuhū sinatun wa lā nawm, lahū mā fī s-samāwāti wa mā fī l-arḍ, man dhā lladhī yashfaʿu ʿindahū illā bi-idhnih, yaʿlamu mā bayna aydīhim wa mā khalfahum, wa lā yuḥīṭūna bi-shayʾin min ʿilmihī illā bi-mā shāʾ, wasiʿa kursiyyuhu s-samāwāti wa l-arḍ, wa lā yaʾūduhū ḥifẓuhumā, wa huwa l-ʿaliyyu l-ʿaẓīm.",
    translation:"Allah — there is no god but Him, the Ever-Living, the Sustainer of all existence. Neither drowsiness nor sleep overtakes Him. To Him belongs everything in the heavens and everything on the earth. Who could intercede with Him without His permission? He knows what lies before His creation and what lies behind them, and they grasp none of His knowledge except what He wills. His throne extends over the heavens and the earth, and preserving them tires Him not. He is the Most High, the Most Great.",
    reference:"Qur'an 2:255 — Hisn al-Muslim 75, recited morning and evening for protection" },

  'sayyidul-istighfar':{ title:"Sayyidul Istighfar", subtitle:"The Master Supplication for Forgiveness", icon:'star',
    arabic:"اللَّهُمَّ أَنْتَ رَبِّي لَا إِلَٰهَ إِلَّا أَنْتَ، خَلَقْتَنِي وَأَنَا عَبْدُكَ، وَأَنَا عَلَىٰ عَهْدِكَ وَوَعْدِكَ مَا اسْتَطَعْتُ، أَعُوذُ بِكَ مِنْ شَرِّ مَا صَنَعْتُ، أَبُوءُ لَكَ بِنِعْمَتِكَ عَلَيَّ، وَأَبُوءُ بِذَنْبِي فَاغْفِرْ لِي فَإِنَّهُ لَا يَغْفِرُ الذُّنُوبَ إِلَّا أَنْتَ",
    translit:"Allāhumma anta Rabbī lā ilāha illā ant, khalaqtanī wa anā ʿabduk, wa anā ʿalā ʿahdika wa waʿdika mastaṭaʿt, aʿūdhu bika min sharri mā ṣanaʿt, abūʾu laka bi niʿmatika ʿalayya, wa abūʾu bidhanbī faghfir lī, fa-innahū lā yaghfirudh-dhunūba illā ant.",
    translation:"O Allah, You are my Lord, there is none worthy of worship but You. You created me and I am Your slave. I keep Your covenant and my pledge to You so far as I am able. I seek refuge in You from the evil of what I have done. I acknowledge Your blessing upon me, and I acknowledge my sin. Forgive me, for there is none who may forgive sins but You.",
    reference:"Hisn al-Muslim 79 (Al-Bukhari 7/150) — whoever recites this with conviction in the morning and dies that day enters Paradise" },

  'morning-wellbeing':{ title:"For Wellbeing in Body, Hearing and Sight", subtitle:"Recite three times", icon:'shield',
    arabic:"اللَّهُمَّ عَافِنِي فِي بَدَنِي، اللَّهُمَّ عَافِنِي فِي سَمْعِي، اللَّهُمَّ عَافِنِي فِي بَصَرِي، لَا إِلَٰهَ إِلَّا أَنْتَ",
    translit:"Allāhumma ʿāfinī fī badanī, Allāhumma ʿāfinī fī samʿī, Allāhumma ʿāfinī fī baṣarī, lā ilāha illā ant. (×3)",
    translation:"O Allah, make me healthy in my body. O Allah, preserve for me my hearing. O Allah, preserve for me my sight. There is none worthy of worship but You.",
    reference:"Hisn al-Muslim 82 (Abu Dawud 4/324, Ahmad 5/42) — recite three times" },

  'morning-sufficient':{ title:"Allah is Sufficient for Me", subtitle:"Recite seven times", icon:'shield',
    arabic:"حَسْبِيَ اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ عَلَيْهِ تَوَكَّلْتُ، وَهُوَ رَبُّ الْعَرْشِ الْعَظِيمِ",
    translit:"Ḥasbiyallāhu lā ilāha illā huwa ʿalayhi tawakkaltu, wa huwa Rabbu l-ʿArshi l-ʿAẓīm. (×7)",
    translation:"Allah is sufficient for me. There is none worthy of worship but Him. I have placed my trust in Him, He is Lord of the Majestic Throne.",
    reference:"Hisn al-Muslim 83 (Ibn As-Sunni, Abu Dawud 4/321) — recite seven times in the morning or evening" },

  'hundred-hasanat':{ title:"None Has the Right to Be Worshipped But Allah", subtitle:"Recite ten times (or one hundred for the fuller reward)", icon:'repeat',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ",
    translit:"Lā ilāha illallāhu waḥdahu lā sharīka lah, lahu l-mulku wa lahu l-ḥamd, wa huwa ʿalā kulli shayʾin qadīr. (×10)",
    translation:"None has the right to be worshipped but Allah alone, He has no partner. His is the dominion and His is the praise, and He is able to do all things.",
    reference:"Hisn al-Muslim 92 (An-Nasa'i, 'Amal al-Yawm wal-Laylah) — recited ten times, this carries the reward of freeing ten slaves; recited one hundred times a day carries the reward of freeing ten slaves from the Children of Isma'il, plus one hundred good deeds recorded and one hundred sins erased (Al-Bukhari, Muslim)" },

  'two-light-words':{ title:"Two Phrases Light on the Tongue", subtitle:"Beloved to the Most Merciful, heavy on the Scale", icon:'star',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ",
    translit:"Subḥānallāhi wa biḥamdih, subḥānallāhi l-ʿAẓīm.",
    translation:"Glory be to Allah and praise Him, glory be to Allah the Magnificent.",
    reference:"Al-Bukhari 6682, Muslim 2694 — two phrases light on the tongue, heavy on the Scale, and beloved to the Most Merciful" },

  'four-witnesses-morning':{ title:"Bearing Witness at the Start of the Day", subtitle:"Recite four times", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَصْبَحْتُ أُشْهِدُكَ وَأُشْهِدُ حَمَلَةَ عَرْشِكَ، وَمَلَائِكَتَكَ وَجَمِيعَ خَلْقِكَ، أَنَّكَ أَنْتَ اللَّهُ لَا إِلَٰهَ إِلَّا أَنْتَ وَحْدَكَ لَا شَرِيكَ لَكَ، وَأَنَّ مُحَمَّدًا عَبْدُكَ وَرَسُولُكَ",
    translit:"Allāhumma innī aṣbaḥtu ush-hiduka wa ush-hidu ḥamalata ʿarshik, wa malāʾikataka wa jamīʿa khalqik, annaka anta-llāhu lā ilāha illā ant, waḥdaka lā sharīka lak, wa anna Muḥammadan ʿabduka wa rasūluk. (×4)",
    translation:"O Allah, I have entered a new morning and call upon You and upon the bearers of Your Throne, upon Your angels and all creation to bear witness that You are Allah, none has the right to be worshipped but You alone, You have no partner, and that Muhammad is Your slave and Your Messenger.",
    reference:"Hisn al-Muslim 80 (Abu Dawud 4/317) — whoever says this four times in the morning or evening, Allah spares them from the Fire" },

  'four-witnesses-evening':{ title:"Bearing Witness at the Close of the Day", subtitle:"Recite four times", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَمْسَيْتُ أُشْهِدُكَ وَأُشْهِدُ حَمَلَةَ عَرْشِكَ، وَمَلَائِكَتَكَ وَجَمِيعَ خَلْقِكَ، أَنَّكَ أَنْتَ اللَّهُ لَا إِلَٰهَ إِلَّا أَنْتَ وَحْدَكَ لَا شَرِيكَ لَكَ، وَأَنَّ مُحَمَّدًا عَبْدُكَ وَرَسُولُكَ",
    translit:"Allāhumma innī amsaytu ush-hiduka wa ush-hidu ḥamalata ʿarshik, wa malāʾikataka wa jamīʿa khalqik, annaka anta-llāhu lā ilāha illā ant, waḥdaka lā sharīka lak, wa anna Muḥammadan ʿabduka wa rasūluk. (×4)",
    translation:"O Allah, I have entered a new evening and call upon You and upon the bearers of Your Throne, upon Your angels and all creation to bear witness that You are Allah, none has the right to be worshipped but You alone, You have no partner, and that Muhammad is Your slave and Your Messenger.",
    reference:"Hisn al-Muslim 80 (Abu Dawud 4/317) — evening form of the same witnessing du'a; Allah spares from the Fire whoever recites it four times" },

  'fitrah-morning':{ title:"Upon the Fitrah of Islam", subtitle:"Rising upon the natural religion", icon:'sun',
    arabic:"أَصْبَحْنَا عَلَىٰ فِطْرَةِ الْإِسْلَامِ، وَعَلَىٰ كَلِمَةِ الْإِخْلَاصِ، وَعَلَىٰ دِينِ نَبِيِّنَا مُحَمَّدٍ ﷺ، وَعَلَىٰ مِلَّةِ أَبِينَا إِبْرَاهِيمَ، حَنِيفًا مُسْلِمًا وَمَا كَانَ مِنَ الْمُشْرِكِينَ",
    translit:"Aṣbaḥnā ʿalā fiṭrati l-Islām, wa ʿalā kalimati l-ikhlāṣ, wa ʿalā dīni Nabiyyinā Muḥammadin (ṣallallāhu ʿalayhi wa sallam), wa ʿalā millati abīnā Ibrāhīm, ḥanīfan musliman wa mā kāna minal-mushrikīn.",
    translation:"We have risen this morning upon the fitrah of Islam, upon the word of pure faith, upon the religion of our Prophet Muhammad ﷺ, and upon the way of our father Ibrahim, who was upright and submitted to Allah, and was not of those who associate partners with Him.",
    reference:"Hisn al-Muslim 90 (Ahmad 3/406-407, 3/439) — narrated by Ibn 'Umar; the evening form substitutes 'amsaynā' (we have entered the evening) for 'aṣbaḥnā'" },

  'blessing-from-you':{ title:"Every Blessing Is From You Alone", subtitle:"A short acknowledgement of Allah's favour", icon:'star',
    arabic:"اللَّهُمَّ مَا أَصْبَحَ بِي مِنْ نِعْمَةٍ أَوْ بِأَحَدٍ مِنْ خَلْقِكَ، فَمِنْكَ وَحْدَكَ لَا شَرِيكَ لَكَ، فَلَكَ الْحَمْدُ وَلَكَ الشُّكْرُ",
    translit:"Allāhumma mā aṣbaḥa bī min niʿmatin aw bi-aḥadin min khalqik, fa-minka waḥdaka lā sharīka lak, fa-lakal-ḥamdu wa lakash-shukr.",
    translation:"O Allah, whatever blessing I or any of Your creation have risen upon this morning is from You alone, without partner. So to You belongs all praise and to You belongs all thanks.",
    reference:"Hisn al-Muslim 81 (Abu Dawud, Ibn As-Sunni) — whoever says this has fulfilled their thanks for that day" },

  'afw-afiyah':{ title:"Pardon and Well-Being in Every Direction", subtitle:"Comprehensive protection for the day ahead", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي الدُّنْيَا وَالْآخِرَةِ، اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَفْوَ وَالْعَافِيَةَ فِي دِينِي وَدُنْيَايَ وَأَهْلِي وَمَالِي، اللَّهُمَّ اسْتُرْ عَوْرَاتِي وَآمِنْ رَوْعَاتِي، اللَّهُمَّ احْفَظْنِي مِنْ بَيْنِ يَدَيَّ وَمِنْ خَلْفِي وَعَنْ يَمِينِي وَعَنْ شِمَالِي وَمِنْ فَوْقِي، وَأَعُوذُ بِعَظَمَتِكَ أَنْ أُغْتَالَ مِنْ تَحْتِي",
    translit:"Allāhumma innī asʾalukal-ʿafwa wal-ʿāfiyata fid-dunyā wal-ākhirah. Allāhumma innī asʾalukal-ʿafwa wal-ʿāfiyata fī dīnī wa dunyāya wa ahlī wa mālī. Allāhummastur ʿawrātī wa āmin rawʿātī. Allāhumma ḥfaẓnī min bayni yadayya wa min khalfī wa ʿan yamīnī wa ʿan shimālī wa min fawqī, wa aʿūdhu biʿaẓamatika an ughtāla min taḥtī.",
    translation:"O Allah, I ask You for pardon and well-being in this life and the next. O Allah, I ask You for pardon and well-being in my religious and worldly affairs, and my family and my wealth. O Allah, veil my weaknesses and ease my fears. O Allah, protect me from in front of me, from behind me, from my right, from my left, and from above me, and I take refuge in Your greatness from being seized from beneath me.",
    reference:"Hisn al-Muslim 84 (Abu Dawud, Ibn Majah)" },

  'witness-unseen-seen':{ title:"Bearing Witness to the Knower of the Unseen", subtitle:"Refuge from the evil of one's own soul", icon:'shield',
    arabic:"اللَّهُمَّ عَالِمَ الْغَيْبِ وَالشَّهَادَةِ فَاطِرَ السَّمَاوَاتِ وَالْأَرْضِ، رَبَّ كُلِّ شَيْءٍ وَمَلِيكَهُ، أَشْهَدُ أَنْ لَا إِلَٰهَ إِلَّا أَنْتَ، أَعُوذُ بِكَ مِنْ شَرِّ نَفْسِي وَمِنْ شَرِّ الشَّيْطَانِ وَشِرْكِهِ",
    translit:"Allāhumma ʿālimal-ghaybi wash-shahādah, fāṭiras-samāwāti wal-arḍ, Rabba kulli shayʾin wa malīkah, ash-hadu an lā ilāha illā ant, aʿūdhu bika min sharri nafsī wa min sharrish-shayṭāni wa shirkih.",
    translation:"O Allah, Knower of the unseen and the seen, Creator of the heavens and the earth, Lord and Sovereign of all things — I bear witness that none has the right to be worshipped but You. I take refuge in You from the evil of my own soul and from the evil of Shaytan and his shirk.",
    reference:"Hisn al-Muslim 85 (At-Tirmidhi, Abu Dawud)" },

  'bismillah-protection':{ title:"Nothing Can Cause Harm With This Name", subtitle:"Recite three times", icon:'shield',
    arabic:"بِسْمِ اللَّهِ الَّذِي لَا يَضُرُّ مَعَ اسْمِهِ شَيْءٌ فِي الْأَرْضِ وَلَا فِي السَّمَاءِ وَهُوَ السَّمِيعُ الْعَلِيمُ",
    translit:"Bismillāhil-ladhī lā yaḍurru maʿa smihi shayʾun fil-arḍi wa lā fis-samāʾi wa huwas-Samīʿul-ʿAlīm. (×3)",
    translation:"In the name of Allah, with whose name nothing on earth or in the heavens can cause harm, and He is the All-Hearing, the All-Knowing.",
    reference:"Hisn al-Muslim 86 (Abu Dawud, At-Tirmidhi) — whoever recites this three times will not be struck by sudden affliction until the next morning or evening" },

  'ya-hayyu-ya-qayyum':{ title:"O Ever-Living, O Sustainer", subtitle:"Seeking Allah's mercy for every affair", icon:'star',
    arabic:"يَا حَيُّ يَا قَيُّومُ بِرَحْمَتِكَ أَسْتَغِيثُ، أَصْلِحْ لِي شَأْنِي كُلَّهُ، وَلَا تَكِلْنِي إِلَىٰ نَفْسِي طَرْفَةَ عَيْنٍ",
    translit:"Yā Ḥayyu yā Qayyūmu bi-raḥmatika astaghīth, aṣliḥ lī shaʾnī kullah, wa lā takilnī ilā nafsī ṭarfata ʿayn.",
    translation:"O Ever-Living, O Self-Subsisting Sustainer of all, by Your mercy I seek relief. Set right all of my affairs, and do not leave me to myself even for the blink of an eye.",
    reference:"Hisn al-Muslim 88 (An-Nasa'i, Al-Hakim)" },

  'khayra-hadhal-yawm':{ title:"The Good of This Day", subtitle:"Asking for its triumphs and guidance", icon:'sun',
    arabic:"أَصْبَحْنَا وَأَصْبَحَ الْمُلْكُ لِلَّهِ رَبِّ الْعَالَمِينَ، اللَّهُمَّ إِنِّي أَسْأَلُكَ خَيْرَ هَٰذَا الْيَوْمِ فَتْحَهُ وَنَصْرَهُ وَنُورَهُ وَبَرَكَتَهُ وَهُدَاهُ، وَأَعُوذُ بِكَ مِنْ شَرِّ مَا فِيهِ وَشَرِّ مَا بَعْدَهُ",
    translit:"Aṣbaḥnā wa aṣbaḥal-mulku lillāhi Rabbil-ʿālamīn. Allāhumma innī asʾaluka khayra hādhal-yawm: fatḥahu wa naṣrahu wa nūrahu wa barakatahu wa hudāh, wa aʿūdhu bika min sharri mā fīhi wa sharri mā baʿdah.",
    translation:"We have entered the morning, and with us the whole dominion of Allah, Lord of all the worlds. O Allah, I ask You for the good of this day: its triumphs, its help, its light, its blessing, and its guidance, and I take refuge in You from the evil in it and the evil that follows it.",
    reference:"Hisn al-Muslim 89 (Abu Dawud) — evening form substitutes 'this night' for 'this day'" },

  'subhanallahi-hundred':{ title:"Subhanallahi wa Bihamdihi", subtitle:"Recite one hundred times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
    translit:"Subḥānallāhi wa biḥamdih. (×100)",
    translation:"How perfect Allah is, and I praise Him.",
    reference:"Hisn al-Muslim 91 (Muslim) — whoever says this one hundred times a day will have their sins forgiven, even if they are like the foam of the sea" },

  'subhanallahi-extended':{ title:"By the Weight of His Throne", subtitle:"Recite three times", icon:'star',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ عَدَدَ خَلْقِهِ، وَرِضَا نَفْسِهِ، وَزِنَةَ عَرْشِهِ، وَمِدَادَ كَلِمَاتِهِ",
    translit:"Subḥānallāhi wa biḥamdih, ʿadada khalqih, wa riḍā nafsih, wa zinata ʿarshih, wa midāda kalimātih. (×3)",
    translation:"How perfect Allah is, and I praise Him, by the number of His creation, by His pleasure, by the weight of His Throne, and by the extent of His words.",
    reference:"Hisn al-Muslim 94 (Muslim)" },

  // ============ EVENING ============
  'evening-dhikr':{ title:"Evening Remembrance", subtitle:"Amsayna wa amsal-mulku lillah", icon:'moon',
    arabic:"أَمْسَيْنَا وَأَمْسَى الْمُلْكُ لِلَّهِ، وَالْحَمْدُ لِلَّهِ، لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ",
    translit:"Amsaynā wa amsal-mulku lillāh, wal-ḥamdu lillāh, lā ilāha illallāhu waḥdahū lā sharīka lah.",
    translation:"We have entered the evening, and with us the whole dominion belongs to Allah. All praise is for Allah. There is no god but Allah alone, without any partner.",
    reference:"Hisn al-Muslim 77 (evening form) — Muslim 4/2088" },

  'evening-protection':{ title:"Refuge in Allah's Perfect Words", subtitle:"Recite three times in the evening", icon:'shield',
    arabic:"أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ مِنْ شَرِّ مَا خَلَقَ",
    translit:"Aʿūdhu bikalimāti-llāhit-tāmmāti min sharri mā khalaq. (×3)",
    translation:"I seek refuge in the Perfect Words of Allah from the evil of what He has created.",
    reference:"Hisn al-Muslim 97 (Ahmad 2/290, At-Tirmidhi 3/187) — protects from insect stings and harm through the night" },

  'evening-pleased':{ title:"Pleased with Allah as Lord", subtitle:"Recite three times", icon:'star',
    arabic:"رَضِيتُ بِاللَّهِ رَبًّا، وَبِالْإِسْلَامِ دِينًا، وَبِمُحَمَّدٍ ﷺ نَبِيًّا",
    translit:"Raḍītu billāhi Rabban, wa bil-Islāmi dīnan, wa bi-Muḥammadin (ṣallallāhu ʿalayhi wa sallam) nabiyyan. (×3)",
    translation:"I am pleased with Allah as my Lord, with Islam as my religion, and with Muhammad ﷺ as my Prophet.",
    reference:"Hisn al-Muslim 87 (Ahmad 4/337, At-Tirmidhi 5/465) — Allah has promised whoever says this three times every morning or evening will be pleased on the Day of Resurrection" },

  // ============ SALAH & AFTER SALAH ============
  'tasbih-33':{ title:"Tasbih, Tahmid and Takbir", subtitle:"33, 33 and 34 times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ (×٣٣) — الْحَمْدُ لِلَّهِ (×٣٣) — اللَّهُ أَكْبَرُ (×٣٤)",
    translit:"Subḥān Allāh (×33) — Alḥamdu lillāh (×33) — Allāhu akbar (×34)",
    translation:"Glory be to Allah (33 times). Praise be to Allah (33 times). Allah is the greatest (34 times).",
    reference:"Hisn al-Muslim 69 (Muslim 1/418) — whoever says this after every prayer will be forgiven, even if his sins are like the foam of the sea" },

  'dua-after-salah':{ title:"Remembrance After Salam", subtitle:"None has the right to be worshipped but Allah", icon:'star',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ وَحْدَهُ لَا شَرِيكَ لَهُ، لَهُ الْمُلْكُ وَلَهُ الْحَمْدُ، وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ، اللَّهُمَّ لَا مَانِعَ لِمَا أَعْطَيْتَ، وَلَا مُعْطِيَ لِمَا مَنَعْتَ، وَلَا يَنْفَعُ ذَا الْجَدِّ مِنْكَ الْجَدُّ",
    translit:"Lā ilāha illallāh, waḥdahu lā sharīka lah, lahu l-mulku wa lahu l-ḥamd, wa huwa ʿalā kulli shayʾin qadīr. Allāhumma lā māniʿa limā aʿṭayt, wa lā muʿṭiya limā manaʿt, wa lā yanfaʿu dhal-jaddi minkal-jadd.",
    translation:"None has the right to be worshipped but Allah alone, He has no partner, His is the dominion and His is the praise, and He is able to do all things. O Allah, there is none who can withhold what You give, and none may give what You have withheld, and the might of the mighty person cannot benefit him against You.",
    reference:"Hisn al-Muslim 67 (Al-Bukhari 1/255, Muslim 1/414)" },

  'ayat-al-kursi-salah':{ title:"Ayat al-Kursi After Prayer", subtitle:"Recite after each obligatory prayer", icon:'star',
    arabic:"اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ ۚ لَا تَأْخُذُهُ سِنَةٌ وَلَا نَوْمٌ...",
    translit:"Allāhu lā ilāha illā huwa l-ḥayyu l-qayyūm... (full verse — see Ayat al-Kursi card)",
    translation:"See the full translation under Ayat al-Kursi. Reciting it after every obligatory prayer is one of the most emphasized daily practices in the Sunnah.",
    reference:"Hisn al-Muslim 71 (An-Nasa'i, 'Amal al-Yawm wal-Laylah, no. 100) — to be recited in Arabic after each prayer",
    isPointer:true, pointerNote:"This is the same Ayat al-Kursi (Qur'an 2:255) found in the Morning card — recited again here specifically after each of the five daily prayers." },

  'three-quls':{ title:"The Three Quls", subtitle:"Al-Ikhlas, Al-Falaq, An-Nas", icon:'shield',
    reference:"Hisn al-Muslim 70 & 76 (Qur'an 112, 113 & 114) — recited after each prayer (3× after Fajr and Maghrib), and morning, evening and before sleep for protection.",
    parts:[
      {label:"Al-Ikhlas (112)",
        arabic:"قُلْ هُوَ اللَّهُ أَحَدٌ. اللَّهُ الصَّمَدُ. لَمْ يَلِدْ وَلَمْ يُولَدْ. وَلَمْ يَكُنْ لَهُ كُفُوًا أَحَدٌ",
        translit:"Qul huwa llāhu aḥad, Allāhu ṣ-ṣamad, lam yalid wa lam yūlad, wa lam yakul lahū kufuwan aḥad.",
        translation:"Say: He is Allah, the One. Allah, the Eternal Refuge. He does not give birth, nor was He born. And there is none comparable to Him."},
      {label:"Al-Falaq (113)",
        arabic:"قُلْ أَعُوذُ بِرَبِّ الْفَلَقِ. مِنْ شَرِّ مَا خَلَقَ. وَمِنْ شَرِّ غَاسِقٍ إِذَا وَقَبَ. وَمِنْ شَرِّ النَّفَّاثَاتِ فِي الْعُقَدِ. وَمِنْ شَرِّ حَاسِدٍ إِذَا حَسَدَ",
        translit:"Qul aʿūdhu bi-rabbi l-falaq, min sharri mā khalaq, wa min sharri ghāsiqin idhā waqab, wa min sharri n-naffāthāti fī l-ʿuqad, wa min sharri ḥāsidin idhā ḥasad.",
        translation:"Say: I seek refuge in the Lord of the daybreak, from the evil of what He has created, from the evil of darkness as it settles, from the evil of those who blow on knots, and from the evil of an envier when he envies."},
      {label:"An-Nas (114)",
        arabic:"قُلْ أَعُوذُ بِرَبِّ النَّاسِ. مَلِكِ النَّاسِ. إِلَٰهِ النَّاسِ. مِنْ شَرِّ الْوَسْوَاسِ الْخَنَّاسِ. الَّذِي يُوَسْوِسُ فِي صُدُورِ النَّاسِ. مِنَ الْجِنَّةِ وَالنَّاسِ",
        translit:"Qul aʿūdhu bi-rabbi n-nās, maliki n-nās, ilāhi n-nās, min sharri l-waswāsi l-khannās, alladhī yuwaswisu fī ṣudūri n-nās, mina l-jinnati wa n-nās.",
        translation:"Say: I seek refuge in the Lord of mankind, the King of mankind, the God of mankind, from the evil of the retreating whisperer, who whispers in the hearts of people, from among the jinn and mankind."}
    ] },

  'istikhara':{ title:"Prayer of Guidance (Istikhara)", subtitle:"For seeking Allah's counsel in a decision", icon:'star',
    arabic:"اللَّهُمَّ إِنِّي أَسْتَخِيرُكَ بِعِلْمِكَ، وَأَسْتَقْدِرُكَ بِقُدْرَتِكَ، وَأَسْأَلُكَ مِنْ فَضْلِكَ الْعَظِيمِ، فَإِنَّكَ تَقْدِرُ وَلَا أَقْدِرُ، وَتَعْلَمُ وَلَا أَعْلَمُ، وَأَنْتَ عَلَّامُ الْغُيُوبِ",
    translit:"Allāhumma innī astakhīruka biʿilmik, wa astaqdiruka biqudratik, wa asʾaluka min faḍlika l-ʿaẓīm, fa-innaka taqdiru wa lā aqdir, wa taʿlamu wa lā aʿlam, wa anta ʿallāmu l-ghuyūb.",
    translation:"O Allah, I seek Your counsel through Your knowledge, and I seek ability through Your power, and I ask You from Your immense favour. You are able and I am not, You know and I do not, and You are the Knower of the unseen. [Continue: 'O Allah, if You know that this matter is good for me in my religion, my livelihood, and the outcome of my affairs, then decree it for me, make it easy for me, and bless me in it...']",
    reference:"Hisn al-Muslim 74 (Al-Bukhari 7/162) — pray two rak'ahs other than the obligatory prayer, then recite this in full" },

  // ============ BEFORE SLEEP & TAHAJJUD ============
  'sajdah-mulk':{ title:"Surah al-Sajdah & Surah al-Mulk", subtitle:"Recite both Surahs", icon:'book',
    isPointer:true, pointerNote:"These are two full Surahs (32 and 67), recited by the Prophet ﷺ before sleep. Read them in full in the Qur'an section — this card will link straight there once the two sections are connected.",
    reference:"At-Tirmidhi 5/159, authenticated by Al-Albani — the Prophet ﷺ would not sleep until he had recited Alif Lam Mim Tanzil (as-Sajdah) and Tabarakalladhi (al-Mulk)" },

  'ayat-al-kursi-sleep':{ title:"Ayat al-Kursi Before Sleep", subtitle:"Al-Baqarah 2:255", icon:'star',
    isPointer:true, pointerNote:"The same Ayat al-Kursi found in the Morning card. Whoever recites it before sleeping will have a guardian from Allah remain with them through the night.",
    reference:"Hisn al-Muslim 100 (Al-Bukhari, Fath al-Bari 4/487)" },

  'last-two-baqarah':{ title:"Last Two Ayahs of Surah al-Baqarah", subtitle:"2:285-286", icon:'book',
    arabic:"آمَنَ الرَّسُولُ بِمَا أُنْزِلَ إِلَيْهِ مِنْ رَبِّهِ وَالْمُؤْمِنُونَ ۚ كُلٌّ آمَنَ بِاللَّهِ وَمَلَائِكَتِهِ وَكُتُبِهِ وَرُسُلِهِ لَا نُفَرِّقُ بَيْنَ أَحَدٍ مِنْ رُسُلِهِ ۚ وَقَالُوا سَمِعْنَا وَأَطَعْنَا ۖ غُفْرَانَكَ رَبَّنَا وَإِلَيْكَ الْمَصِيرُ. لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا ۚ لَهَا مَا كَسَبَتْ وَعَلَيْهَا مَا اكْتَسَبَتْ ۗ رَبَّنَا لَا تُؤَاخِذْنَا إِنْ نَسِينَا أَوْ أَخْطَأْنَا ۚ رَبَّنَا وَلَا تَحْمِلْ عَلَيْنَا إِصْرًا كَمَا حَمَلْتَهُ عَلَى الَّذِينَ مِنْ قَبْلِنَا ۚ رَبَّنَا وَلَا تُحَمِّلْنَا مَا لَا طَاقَةَ لَنَا بِهِ ۖ وَاعْفُ عَنَّا وَاغْفِرْ لَنَا وَارْحَمْنَا ۚ أَنْتَ مَوْلَانَا فَانْصُرْنَا عَلَى الْقَوْمِ الْكَافِرِينَ",
    translit:"Āmana r-rasūlu bimā unzila ilayhi mir rabbihī wal-muʾminūn... Rabbanā lā tuʾākhidhnā in nasīnā aw akhṭaʾnā, rabbanā wa lā taḥmil ʿalaynā iṣran kamā ḥamaltahū ʿalā lladhīna min qablinā, rabbanā wa lā tuḥammilnā mā lā ṭāqata lanā bih, waʿfu ʿannā waghfir lanā warḥamnā, anta mawlānā fanṣurnā ʿalā l-qawmi l-kāfirīn.",
    translation:"The Messenger believes in what has been sent down to him from his Lord, and so do the believers. Each one believes in Allah, His angels, His books, and His messengers — 'We make no distinction between any of His messengers.' And they say: 'We hear and we obey; grant us Your forgiveness, our Lord, for to You is the return.' Allah does not burden a soul beyond what it can bear... 'Our Lord, do not take us to task if we forget or make a mistake. Our Lord, do not place upon us a burden like the one You placed on those before us. Our Lord, do not burden us with more than we have strength to bear. Pardon us, forgive us, and have mercy on us — You are our Protector, so grant us victory over the disbelieving people.'",
    reference:"Qur'an 2:285-286 — Hisn al-Muslim 101 (Al-Bukhari 9/94, Muslim 1/554), sufficient for anyone who recites it at night before sleeping" },

  'al-kafirun':{ title:"Surah al-Kafirun", subtitle:"Recite before sleep", icon:'book',
    arabic:"قُلْ يَا أَيُّهَا الْكَافِرُونَ. لَا أَعْبُدُ مَا تَعْبُدُونَ. وَلَا أَنْتُمْ عَابِدُونَ مَا أَعْبُدُ. وَلَا أَنَا عَابِدٌ مَا عَبَدْتُمْ. وَلَا أَنْتُمْ عَابِدُونَ مَا أَعْبُدُ. وَلَا لَكُمْ دِينِ",
    translit:"Qul yā ayyuhā l-kāfirūn, lā aʿbudu mā taʿbudūn, wa lā antum ʿābidūna mā aʿbud, wa lā ana ʿābidun mā ʿabadtum, wa lā antum ʿābidūna mā aʿbud, lakum dīnukum wa liya dīn.",
    translation:"Say: O disbelievers — I do not worship what you worship, nor do you worship what I worship. I will not worship what you worship, nor will you worship what I worship. You have your way, and I have mine.",
    reference:"Qur'an 109:1-6 — reported as recited by the Prophet ﷺ before sleep, described as 'freedom from shirk'" },

  'tasbih-fatima':{ title:"Tasbih Fatimah (before sleep)", subtitle:"33, 33 and 34 times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ (×٣٣) — الْحَمْدُ لِلَّهِ (×٣٣) — اللَّهُ أَكْبَرُ (×٣٤)",
    translit:"Subḥān Allāh (×33) — Alḥamdu lillāh (×33) — Allāhu akbar (×34)",
    translation:"Glory be to Allah (33 times). Praise be to Allah (33 times). Allah is the greatest (34 times).",
    reference:"Al-Bukhari 7/71, Muslim 4/2091 — taught by the Prophet ﷺ to Fatimah (RA) instead of a servant, described as better than what she had asked for" },

  'mercy-protection':{ title:"By Your Name I Die and Live", subtitle:"Upon lying down to sleep", icon:'shield',
    arabic:"بِاسْمِكَ اللَّهُمَّ أَمُوتُ وَأَحْيَا",
    translit:"Bismika Allāhumma amūtu wa aḥyā.",
    translation:"In Your name, O Allah, I die and I live.",
    reference:"Hisn al-Muslim 105 (Al-Bukhari, Fath al-Bari 11/113; Muslim 4/2083)" },

  'sleep-soul':{ title:"You Created My Soul", subtitle:"Comprehensive night supplication", icon:'shield',
    arabic:"اللَّهُمَّ إِنَّكَ خَلَقْتَ نَفْسِي وَأَنْتَ تَوَفَّاهَا، لَكَ مَمَاتُهَا وَمَحْيَاهَا، إِنْ أَحْيَيْتَهَا فَاحْفَظْهَا، وَإِنْ أَمَتَّهَا فَاغْفِرْ لَهَا. اللَّهُمَّ إِنِّي أَسْأَلُكَ الْعَافِيَةَ",
    translit:"Allāhumma innaka khalaqta nafsī wa anta tawaffāhā, laka mamātuhā wa maḥyāhā, in aḥyaytahā faḥfaẓhā, wa in amattahā faghfir lahā. Allāhumma innī asʾaluka l-ʿāfiyah.",
    translation:"O Allah, You have created my soul and You take it back. Unto You is its death and its life. If You give it life then protect it, and if You cause it to die then forgive it. O Allah, I ask You for well-being.",
    reference:"Hisn al-Muslim 103 (Muslim 4/2083, Ahmad 2/79)" },

  'sleep-punishment':{ title:"Save Me From Your Punishment", subtitle:"Upon lying down, hand under cheek", icon:'shield',
    arabic:"اللَّهُمَّ قِنِي عَذَابَكَ يَوْمَ تَبْعَثُ عِبَادَكَ",
    translit:"Allāhumma qinī ʿadhābaka yawma tabʿathu ʿibādak.",
    translation:"O Allah, save me from Your punishment on the Day that You resurrect Your slaves.",
    reference:"Hisn al-Muslim 104 (Abu Dawud 4/311) — the Prophet ﷺ would place his right hand under his cheek and say this before sleeping" },

  // ============ PRAISE OF ALLAH & SALAWAT ============
  'salawat':{ title:"The Ibrahimi Prayer", subtitle:"Blessings upon the Prophet ﷺ (after tashahhud)", icon:'star',
    arabic:"اللَّهُمَّ صَلِّ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ، كَمَا صَلَّيْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ، إِنَّكَ حَمِيدٌ مَجِيدٌ. اللَّهُمَّ بَارِكْ عَلَىٰ مُحَمَّدٍ وَعَلَىٰ آلِ مُحَمَّدٍ، كَمَا بَارَكْتَ عَلَىٰ إِبْرَاهِيمَ وَعَلَىٰ آلِ إِبْرَاهِيمَ، إِنَّكَ حَمِيدٌ مَجِيدٌ",
    translit:"Allāhumma ṣalli ʿalā Muḥammadin wa ʿalā āli Muḥammadin, kamā ṣallayta ʿalā Ibrāhīma wa ʿalā āli Ibrāhīma, innaka ḥamīdum-majīd. Allāhumma bārik ʿalā Muḥammadin wa ʿalā āli Muḥammadin, kamā bārakta ʿalā Ibrāhīma wa ʿalā āli Ibrāhīma, innaka ḥamīdum-majīd.",
    translation:"O Allah, bestow Your favour on Muhammad and on the family of Muhammad as You have bestowed Your favour on Ibrahim and on the family of Ibrahim, You are Praiseworthy, Most Glorious. O Allah, bless Muhammad and the family of Muhammad as You have blessed Ibrahim and the family of Ibrahim, You are Praiseworthy, Most Glorious.",
    reference:"Hisn al-Muslim 53 (Al-Bukhari, Fath al-Bari 6/408) — the standard form of salawat recited in every prayer" },

  'salawat-short':{ title:"Short Salawat", subtitle:"Recite ten times, morning and evening", icon:'star',
    arabic:"اللَّهُمَّ صَلِّ وَسَلِّمْ عَلَىٰ نَبِيِّنَا مُحَمَّدٍ",
    translit:"Allāhumma ṣalli wa sallim ʿalā nabiyyinā Muḥammad. (×10)",
    translation:"O Allah, send Your blessings and peace upon our Prophet Muhammad.",
    reference:"Hisn al-Muslim 98 — the Prophet ﷺ said: 'Whoever sends blessings upon me ten times in the morning and ten times in the evening will obtain my intercession on the Day of Resurrection.' (At-Tabarani, graded good by Al-Albani)" },

  'salawat-tenfold':{ title:"The Reward of a Single Salawat", subtitle:"Sending blessings once", icon:'star',
    isPointer:true, pointerNote:"There is no fixed wording required — any authentic form of salawat (such as the Ibrahimi prayer above) fulfils this.",
    reference:"Sunan an-Nasa'i 1297 — the Prophet ﷺ said: 'Whoever sends salah upon me once, Allah will send salah upon him tenfold, will erase ten sins from him, and will raise him ten degrees in status.'" },

  'subhanallah-bihamdihi':{ title:"Glory and Praise be to Allah", subtitle:"Recite one hundred times", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ",
    translit:"Subḥānallāhi wa biḥamdih. (×100)",
    translation:"Glory is to Allah and praise is to Him.",
    reference:"Hisn al-Muslim 91 (Al-Bukhari 4/2071) — whoever recites this one hundred times a day will have their sins forgiven even if as much as the foam of the sea" },

  'subhanallah-adad':{ title:"By the Multitude of His Creation", subtitle:"Recite three times, upon rising", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، عَدَدَ خَلْقِهِ، وَرِضَا نَفْسِهِ، وَزِنَةَ عَرْشِهِ، وَمِدَادَ كَلِمَاتِهِ",
    translit:"Subḥānallāhi wa biḥamdih: ʿadada khalqih, wa riḍā nafsih, wa zinata ʿarshih, wa midāda kalimātih. (×3)",
    translation:"Glory is to Allah and praise is to Him, by the multitude of His creation, by His Pleasure, by the weight of His Throne, and by the extent of His Words.",
    reference:"Hisn al-Muslim 94 (Muslim 4/2090)" },

  // ============ QUR'ANIC DU'A & SUNNAH DU'A ============
  'rabbana-atina':{ title:"Rabbana Atina", subtitle:"Al-Baqarah 2:201", icon:'book',
    arabic:"رَبَّنَا آتِنَا فِي الدُّنْيَا حَسَنَةً وَفِي الْآخِرَةِ حَسَنَةً وَقِنَا عَذَابَ النَّارِ",
    translit:"Rabbanā ātinā fid-dunyā ḥasanatan wa fil-ākhirati ḥasanatan wa qinā ʿadhāban-nār.",
    translation:"Our Lord, grant us goodness in this world, goodness in the Hereafter, and protect us from the torment of the Fire.",
    reference:"Qur'an 2:201 — the supplication most often recited by the Prophet ﷺ (Al-Bukhari and Muslim)" },

  'rabbi-zidni-ilma':{ title:"Rabbi Zidni Ilma", subtitle:"Ta-Ha 20:114", icon:'book',
    arabic:"رَبِّ زِدْنِي عِلْمًا",
    translit:"Rabbi zidnī ʿilmā.",
    translation:"My Lord, increase me in knowledge.",
    reference:"Qur'an 20:114 — the only supplication Allah specifically instructed the Prophet ﷺ to make in the Qur'an" },

  'rabbana-la-tuzigh':{ title:"Rabbana La Tuzigh", subtitle:"Aal-Imran 3:8", icon:'book',
    arabic:"رَبَّنَا لَا تُزِغْ قُلُوبَنَا بَعْدَ إِذْ هَدَيْتَنَا وَهَبْ لَنَا مِنْ لَدُنْكَ رَحْمَةً إِنَّكَ أَنْتَ الْوَهَّابُ",
    translit:"Rabbanā lā tuzigh qulūbanā baʿda idh hadaytanā wa hab lanā min ladunka raḥmatan innaka anta l-Wahhāb.",
    translation:"Our Lord, do not let our hearts turn away after You have guided us. Grant us mercy from You. Truly, You are the Bestower.",
    reference:"Qur'an 3:8" },

  'rabbana-zulm':{ title:"Rabbana Zalamna", subtitle:"Al-A'raf 7:23 — the du'a of Adam and Hawwa", icon:'book',
    arabic:"رَبَّنَا ظَلَمْنَا أَنْفُسَنَا وَإِنْ لَمْ تَغْفِرْ لَنَا وَتَرْحَمْنَا لَنَكُونَنَّ مِنَ الْخَاسِرِينَ",
    translit:"Rabbanā ẓalamnā anfusanā wa in lam taghfir lanā wa tarḥamnā lanakūnanna mina l-khāsirīn.",
    translation:"Our Lord, we have wronged ourselves. If You do not forgive us and show us mercy, we will surely be among the losers.",
    reference:"Qur'an 7:23 — the words of repentance of Adam and Hawwa after the forbidden tree" },

  'rabbana-afrigh':{ title:"Rabbana Afrigh", subtitle:"Al-Baqarah 2:250 — the du'a of Dawud's army", icon:'book',
    arabic:"رَبَّنَا أَفْرِغْ عَلَيْنَا صَبْرًا وَثَبِّتْ أَقْدَامَنَا وَانْصُرْنَا عَلَى الْقَوْمِ الْكَافِرِينَ",
    translit:"Rabbanā afrigh ʿalaynā ṣabran wa thabbit aqdāmanā wa-nṣurnā ʿalā l-qawmi l-kāfirīn.",
    translation:"Our Lord, pour patience upon us, make our steps firm, and grant us victory over those who reject faith.",
    reference:"Qur'an 2:250 — recited by the believers facing Jalut (Goliath)" },

  'rabbi-ishrah':{ title:"Rabbi Ishrah Li Sadri", subtitle:"Ta-Ha 20:25-28 — the du'a of Musa", icon:'book',
    arabic:"رَبِّ اشْرَحْ لِي صَدْرِي، وَيَسِّرْ لِي أَمْرِي، وَاحْلُلْ عُقْدَةً مِنْ لِسَانِي، يَفْقَهُوا قَوْلِي",
    translit:"Rabbi shraḥ lī ṣadrī, wa yassir lī amrī, wa ḥlul ʿuqdatan min lisānī, yafqahū qawlī.",
    translation:"My Lord, expand for me my chest, ease my task for me, and remove the knot from my tongue, so they may understand my speech.",
    reference:"Qur'an 20:25-28 — Musa's du'a before speaking to Pharaoh" },

  'rabbi-inni-lima':{ title:"Rabbi Inni Lima Anzalta", subtitle:"Al-Qasas 28:24 — the du'a of Musa at Madyan", icon:'book',
    arabic:"رَبِّ إِنِّي لِمَا أَنْزَلْتَ إِلَيَّ مِنْ خَيْرٍ فَقِيرٌ",
    translit:"Rabbi innī limā anzalta ilayya min khayrin faqīr.",
    translation:"My Lord, indeed I am, for whatever good You would send down to me, in need.",
    reference:"Qur'an 28:24 — Musa's du'a after fleeing Egypt, having nothing but reliance on Allah" },

  'yunus-la-ilaha':{ title:"La ilaha illa Anta", subtitle:"Al-Anbiya 21:87 — the du'a of Yunus", icon:'book',
    arabic:"لَا إِلَٰهَ إِلَّا أَنْتَ سُبْحَانَكَ إِنِّي كُنْتُ مِنَ الظَّالِمِينَ",
    translit:"Lā ilāha illā anta subḥānaka innī kuntu mina ẓ-ẓālimīn.",
    translation:"There is no god but You, glory be to You. Indeed, I was among the wrongdoers.",
    reference:"Qur'an 21:87 — the du'a of Yunus (Jonah) in the belly of the whale. The Prophet ﷺ said whoever supplicates with it will be answered (At-Tirmidhi)" },

  // ============ ISTIGHFAR & DHIKR FOR ALL TIMES ============
  'astaghfirullah':{ title:"Astaghfirullah", subtitle:"I seek the forgiveness of Allah", icon:'repeat',
    arabic:"أَسْتَغْفِرُ اللَّهَ",
    translit:"Astaghfirullāh.",
    translation:"I seek the forgiveness of Allah.",
    reference:"A short, easily repeated form of istighfar recited throughout the day and after prayer" },

  'la-ilaha-illallah':{ title:"La ilaha illallah", subtitle:"The best of what has been said", icon:'star',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ",
    translit:"Lā ilāha illallāh.",
    translation:"There is no god but Allah.",
    reference:"At-Tirmidhi — the Prophet ﷺ said the best that he and the prophets before him have said is this declaration" },

  'rabbighfir-tub':{ title:"Rabbighfir li wa Tub Alayya", subtitle:"Recited by the Prophet ﷺ 100 times in one sitting", icon:'repeat',
    arabic:"رَبِّ اغْفِرْ لِي وَتُبْ عَلَيَّ إِنَّكَ أَنْتَ التَّوَّابُ الرَّحِيمُ",
    translit:"Rabbighfir lī wa tub ʿalayya, innaka Antat-Tawwābur-Raḥīm.",
    translation:"My Lord, forgive me and accept my repentance. Indeed, You are the Accepter of repentance, the Most Merciful.",
    reference:"Sunan Abi Dawud 1516, Jami' at-Tirmidhi 3434, Sunan Ibn Majah 3814 — Ibn Umar (RA) counted the Prophet ﷺ saying this a hundred times in a single sitting" },

  'astaghfirullah-full':{ title:"The Fuller Istighfar", subtitle:"I seek forgiveness of Allah, besides Whom there is no god", icon:'repeat',
    arabic:"أَسْتَغْفِرُ اللَّهَ الَّذِي لَا إِلَٰهَ إِلَّا هُوَ الْحَيُّ الْقَيُّومُ وَأَتُوبُ إِلَيْهِ",
    translit:"Astaghfirullāh alladhī lā ilāha illā huwal-Ḥayyul-Qayyūmu wa atūbu ilayh.",
    translation:"I seek the forgiveness of Allah, besides Whom there is no god, the Ever-Living, the Self-Subsisting, and I turn to Him in repentance.",
    reference:"Abu Dawud, At-Tirmidhi, and Al-Hakim — whoever says this will be forgiven even if they had fled the battlefield" },

  'subhanallah-general':{ title:"Subhanallah wa Bihamdihi", subtitle:"The most beloved words to Allah", icon:'repeat',
    arabic:"سُبْحَانَ اللَّهِ وَبِحَمْدِهِ، سُبْحَانَ اللَّهِ الْعَظِيمِ",
    translit:"Subḥānallāhi wa biḥamdih, Subḥānallāhil-ʿAẓīm.",
    translation:"Glory be to Allah and praise is to Him. Glory be to Allah, the Magnificent.",
    reference:"Al-Bukhari 7/168, Muslim 4/2072 — two phrases described by the Prophet ﷺ as light on the tongue, heavy on the scale, and beloved to the Most Merciful" },

  // ============ DU'AS FOR THE UMMAH ============
  'dua-ummah':{ title:"Allahumma Aslih Ummata Muhammad", subtitle:"For the wellbeing of the Ummah", icon:'people',
    arabic:"اللَّهُمَّ أَصْلِحْ أُمَّةَ مُحَمَّدٍ. اللَّهُمَّ فَرِّجْ عَنْ أُمَّةِ مُحَمَّدٍ. اللَّهُمَّ ارْحَمْ أُمَّةَ مُحَمَّدٍ",
    translit:"Allāhumma aṣliḥ Ummata Muḥammad. Allāhumma farrij ʿan Ummati Muḥammad. Allāhumma rḥam Ummata Muḥammad ﷺ.",
    translation:"O Allah, set right the affairs of the Ummah of Muhammad. O Allah, grant relief to the Ummah of Muhammad. O Allah, have mercy on the Ummah of Muhammad.",
    reference:"A widely-used supplication for the Muslim community, especially recited during Dhul Hijjah and times of collective hardship" },

  'dua-ibrahim-descendants':{ title:"Rabbi Ij'alni Muqim as-Salah", subtitle:"Ibrahim 14:37-41 — Ibrahim's du'a for his descendants", icon:'people',
    arabic:"رَبَّنَا إِنِّي أَسْكَنْتُ مِنْ ذُرِّيَّتِي بِوَادٍ غَيْرِ ذِي زَرْعٍ عِنْدَ بَيْتِكَ الْمُحَرَّمِ رَبَّنَا لِيُقِيمُوا الصَّلَاةَ فَاجْعَلْ أَفْئِدَةً مِنَ النَّاسِ تَهْوِي إِلَيْهِمْ وَارْزُقْهُمْ مِنَ الثَّمَرَاتِ لَعَلَّهُمْ يَشْكُرُونَ",
    translit:"Rabbanā innī askantu min dhurriyyatī bi-wādin ghayri dhī zarʿin ʿinda baytika l-muḥarram, rabbanā li-yuqīmū ṣ-ṣalāta fa-jʿal afʾidatan mina n-nāsi tahwī ilayhim wa rzuqhum mina ṯ-ṯamarāti laʿallahum yashkurūn.",
    translation:"Our Lord, I have settled some of my descendants in a barren valley near Your Sacred House, our Lord, that they may establish prayer. So make hearts among the people incline toward them, and provide for them from the fruits that they might be grateful.",
    reference:"Qur'an 14:37 — Ibrahim's supplication for the Muslim community he left at the Ka'bah, before it was ever inhabited" },

  'rabbana-ighfir-lana':{ title:"Rabbana Ighfir Lana wa li Ikhwanina", subtitle:"Al-Hashr 59:10 — du'a for fellow believers", icon:'people',
    arabic:"رَبَّنَا اغْفِرْ لَنَا وَلِإِخْوَانِنَا الَّذِينَ سَبَقُونَا بِالْإِيمَانِ وَلَا تَجْعَلْ فِي قُلُوبِنَا غِلًّا لِلَّذِينَ آمَنُوا رَبَّنَا إِنَّكَ رَءُوفٌ رَحِيمٌ",
    translit:"Rabbanā ighfir lanā wa li-ikhwāninā lladhīna sabaqūnā bil-īmāni wa lā tajʿal fī qulūbinā ghillan lilladhīna āmanū rabbanā innaka Raʾūfur-Raḥīm.",
    translation:"Our Lord, forgive us and our brothers who preceded us in faith, and do not let there be resentment in our hearts toward those who believe. Our Lord, indeed You are Kind and Merciful.",
    reference:"Qur'an 59:10 — a du'a made on behalf of the wider community of believers, past and present" },

  'dua-victory-islam':{ title:"For the Aid of Islam and the Muslims", subtitle:"A call for strength and unity", icon:'people',
    arabic:"اللَّهُمَّ أَعِزَّ الْإِسْلَامَ وَالْمُسْلِمِينَ",
    translit:"Allāhumma aʿizza al-Islāma wal-Muslimīn.",
    translation:"O Allah, grant honour and strength to Islam and the Muslims.",
    reference:"Musnad Ahmad, narrated from Anas ibn Malik (RA) — hadith no. 12695" },

  // ============ THE 99 NAMES OF ALLAH ============
  'name-ar-rahman':{ title:"Ar-Rahman", subtitle:"The Entirely Merciful", icon:'star', arabic:"الرَّحْمَٰن", translit:"Ar-Raḥmān", translation:"The Entirely Merciful — whose mercy encompasses all creation.", reference:"Qur'an 1:1, and throughout the Qur'an" },
  'name-ar-raheem':{ title:"Ar-Raheem", subtitle:"The Especially Merciful", icon:'star', arabic:"الرَّحِيم", translit:"Ar-Raḥīm", translation:"The Especially Merciful — whose mercy is directed particularly toward the believers.", reference:"Qur'an 1:1, and throughout the Qur'an" },
  'name-al-malik':{ title:"Al-Malik", subtitle:"The Sovereign King", icon:'star', arabic:"الْمَلِك", translit:"Al-Malik", translation:"The Sovereign King, the true Owner of all dominion.", reference:"Qur'an 59:23" },
  'name-al-quddus':{ title:"Al-Quddus", subtitle:"The Absolutely Pure", icon:'star', arabic:"الْقُدُّوس", translit:"Al-Quddūs", translation:"The Absolutely Pure, free from any imperfection.", reference:"Qur'an 59:23" },
  'name-as-salam':{ title:"As-Salam", subtitle:"The Giver of Peace", icon:'star', arabic:"السَّلَام", translit:"As-Salām", translation:"The Source of Peace and Safety, free from every defect.", reference:"Qur'an 59:23" },
  'name-al-mumin':{ title:"Al-Mu'min", subtitle:"The Granter of Security", icon:'star', arabic:"الْمُؤْمِن", translit:"Al-Muʾmin", translation:"The Granter of security and faith to His creation.", reference:"Qur'an 59:23" },
  'name-al-muhaymin':{ title:"Al-Muhaymin", subtitle:"The Guardian Overseer", icon:'star', arabic:"الْمُهَيْمِن", translit:"Al-Muhaymin", translation:"The Guardian and Overseer of all things.", reference:"Qur'an 59:23" },
  'name-al-aziz':{ title:"Al-Aziz", subtitle:"The All-Mighty", icon:'star', arabic:"الْعَزِيز", translit:"Al-ʿAzīz", translation:"The Almighty, whose might is never overcome.", reference:"Qur'an 59:23" },
  'name-al-jabbar':{ title:"Al-Jabbar", subtitle:"The Restorer & Compeller", icon:'star', arabic:"الْجَبَّار", translit:"Al-Jabbār", translation:"The Compeller, who restores and repairs the affairs of His creation.", reference:"Qur'an 59:23" },
  'name-al-mutakabbir':{ title:"Al-Mutakabbir", subtitle:"The Supremely Great", icon:'star', arabic:"الْمُتَكَبِّر", translit:"Al-Mutakabbir", translation:"The Supremely Great, above every imperfection ascribed to Him.", reference:"Qur'an 59:23" },
  'name-al-khaliq':{ title:"Al-Khaliq", subtitle:"The Creator of All", icon:'star', arabic:"الْخَالِق", translit:"Al-Khāliq", translation:"The Creator, who brings all things into being from nothing.", reference:"Qur'an 59:24" },
  'name-al-bari':{ title:"Al-Bari'", subtitle:"The Evolver", icon:'star', arabic:"الْبَارِئ", translit:"Al-Bāriʾ", translation:"The Evolver, who shapes creation free from any flaw.", reference:"Qur'an 59:24" },
  'name-al-musawwir':{ title:"Al-Musawwir", subtitle:"The Fashioner of Forms", icon:'star', arabic:"الْمُصَوِّر", translit:"Al-Muṣawwir", translation:"The Fashioner, who gives every creation its unique form.", reference:"Qur'an 59:24" },
  'name-al-ghaffar':{ title:"Al-Ghaffar", subtitle:"The Oft-Forgiving", icon:'star', arabic:"الْغَفَّار", translit:"Al-Ghaffār", translation:"The Repeatedly Forgiving, who forgives sins again and again.", reference:"Qur'an 20:82" },
  'name-al-qahhar':{ title:"Al-Qahhar", subtitle:"The Subduer of All", icon:'star', arabic:"الْقَهَّار", translit:"Al-Qahhār", translation:"The Subduer, before whom all creation is powerless.", reference:"Qur'an 13:16" },
  'name-al-wahhab':{ title:"Al-Wahhab", subtitle:"The Bestower of Gifts", icon:'star', arabic:"الْوَهَّاب", translit:"Al-Wahhāb", translation:"The Bestower, who gives freely and without limit.", reference:"Qur'an 3:8" },
  'name-ar-razzaq':{ title:"Ar-Razzaq", subtitle:"The Provider of Sustenance", icon:'star', arabic:"الرَّزَّاق", translit:"Ar-Razzāq", translation:"The Provider, who sustains every creature.", reference:"Qur'an 51:58" },
  'name-al-fattah':{ title:"Al-Fattah", subtitle:"The Opener of Ways", icon:'star', arabic:"الْفَتَّاح", translit:"Al-Fattāḥ", translation:"The Opener, who opens the way to mercy, provision and judgement.", reference:"Qur'an 34:26" },
  'name-al-alim':{ title:"Al-Alim", subtitle:"The All-Knowing", icon:'star', arabic:"الْعَلِيم", translit:"Al-ʿAlīm", translation:"The All-Knowing, whose knowledge encompasses everything.", reference:"Qur'an 2:29" },
  'name-al-qabid':{ title:"Al-Qabid", subtitle:"The Withholder of Provision", icon:'star', arabic:"الْقَابِض", translit:"Al-Qābiḍ", translation:"The One who withholds provision by His wisdom.", reference:"Derived from Qur'an 2:245" },
  'name-al-basit':{ title:"Al-Basit", subtitle:"The Expander of Provision", icon:'star', arabic:"الْبَاسِط", translit:"Al-Bāsiṭ", translation:"The One who expands provision by His generosity.", reference:"Derived from Qur'an 2:245" },
  'name-al-khafid':{ title:"Al-Khafid", subtitle:"The Abaser", icon:'star', arabic:"الْخَافِض", translit:"Al-Khāfiḍ", translation:"The Abaser, who humbles whom He wills.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-ar-rafi':{ title:"Ar-Rafi'", subtitle:"The Exalter", icon:'star', arabic:"الرَّافِع", translit:"Ar-Rāfiʿ", translation:"The Exalter, who raises whom He wills in honour.", reference:"Derived from Qur'an 6:83" },
  'name-al-muizz':{ title:"Al-Mu'izz", subtitle:"The Giver of Honour", icon:'star', arabic:"الْمُعِزّ", translit:"Al-Muʿizz", translation:"The One who gives honour to whom He wills.", reference:"Qur'an 3:26" },
  'name-al-mudhill':{ title:"Al-Mudhill", subtitle:"The Humiliator", icon:'star', arabic:"الْمُذِلّ", translit:"Al-Mudhill", translation:"The One who humbles whom He wills.", reference:"Qur'an 3:26" },
  'name-as-sami':{ title:"As-Sami'", subtitle:"The All-Hearing", icon:'star', arabic:"السَّمِيع", translit:"As-Samīʿ", translation:"The All-Hearing, who hears every sound, spoken or silent.", reference:"Qur'an 2:127" },
  'name-al-basir':{ title:"Al-Basir", subtitle:"The All-Seeing", icon:'star', arabic:"الْبَصِير", translit:"Al-Baṣīr", translation:"The All-Seeing, who sees all things, however hidden.", reference:"Qur'an 4:58" },
  'name-al-hakam':{ title:"Al-Hakam", subtitle:"The Perfect Judge", icon:'star', arabic:"الْحَكَم", translit:"Al-Ḥakam", translation:"The Perfect Judge, whose ruling is always just.", reference:"Traditional enumeration (Abu Dawud)" },
  'name-al-adl':{ title:"Al-Adl", subtitle:"The Utterly Just", icon:'star', arabic:"الْعَدْل", translit:"Al-ʿAdl", translation:"The Utterly Just, free from any trace of unfairness.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-al-latif':{ title:"Al-Latif", subtitle:"The Subtle, Most Kind", icon:'star', arabic:"اللَّطِيف", translit:"Al-Laṭīf", translation:"The Subtle and Most Kind, aware of the finest details of His creation's needs.", reference:"Qur'an 6:103" },
  'name-al-khabir':{ title:"Al-Khabir", subtitle:"The All-Aware", icon:'star', arabic:"الْخَبِير", translit:"Al-Khabīr", translation:"The All-Aware, fully acquainted with the reality of all things.", reference:"Qur'an 6:103" },
  'name-al-halim':{ title:"Al-Halim", subtitle:"The Forbearing", icon:'star', arabic:"الْحَلِيم", translit:"Al-Ḥalīm", translation:"The Forbearing, who delays punishment out of mercy.", reference:"Qur'an 2:225" },
  'name-al-azim':{ title:"Al-Azim", subtitle:"The Magnificent", icon:'star', arabic:"الْعَظِيم", translit:"Al-ʿAẓīm", translation:"The Magnificent, whose greatness has no bound.", reference:"Qur'an 2:255" },
  'name-al-ghafur':{ title:"Al-Ghafur", subtitle:"The All-Forgiving", icon:'star', arabic:"الْغَفُور", translit:"Al-Ghafūr", translation:"The All-Forgiving, who covers and pardons sin.", reference:"Qur'an 2:173" },
  'name-ash-shakur':{ title:"Ash-Shakur", subtitle:"The Most Appreciative", icon:'star', arabic:"الشَّكُور", translit:"Ash-Shakūr", translation:"The Most Appreciative, who rewards even small acts of good generously.", reference:"Qur'an 35:30" },
  'name-al-aliyy':{ title:"Al-Aliyy", subtitle:"The Most High", icon:'star', arabic:"الْعَلِيّ", translit:"Al-ʿAliyy", translation:"The Most High, exalted above all creation.", reference:"Qur'an 2:255" },
  'name-al-kabir':{ title:"Al-Kabir", subtitle:"The Most Great", icon:'star', arabic:"الْكَبِير", translit:"Al-Kabīr", translation:"The Most Great, greater than anything that can be imagined.", reference:"Qur'an 13:9" },
  'name-al-hafiz':{ title:"Al-Hafiz", subtitle:"The Preserver & Protector", icon:'star', arabic:"الْحَفِيظ", translit:"Al-Ḥafīẓ", translation:"The Preserver, who protects His creation and their deeds.", reference:"Qur'an 11:57" },
  'name-al-muqit':{ title:"Al-Muqit", subtitle:"The Nourisher", icon:'star', arabic:"الْمُقِيت", translit:"Al-Muqīt", translation:"The Nourisher, who sustains every soul with what it needs.", reference:"Qur'an 4:85" },
  'name-al-hasib':{ title:"Al-Hasib", subtitle:"The Reckoner", icon:'star', arabic:"الْحَسِيب", translit:"Al-Ḥasīb", translation:"The Reckoner, sufficient as a keeper of account.", reference:"Qur'an 4:6" },
  'name-al-jalil':{ title:"Al-Jalil", subtitle:"The Majestic", icon:'star', arabic:"الْجَلِيل", translit:"Al-Jalīl", translation:"The Majestic, possessor of greatness and honour.", reference:"Derived from Qur'an 55:27" },
  'name-al-karim':{ title:"Al-Karim", subtitle:"The Generous & Noble", icon:'star', arabic:"الْكَرِيم", translit:"Al-Karīm", translation:"The Generous and Noble, giving abundantly without being asked.", reference:"Qur'an 27:40" },
  'name-ar-raqib':{ title:"Ar-Raqib", subtitle:"The Ever-Watchful", icon:'star', arabic:"الرَّقِيب", translit:"Ar-Raqīb", translation:"The Ever-Watchful, observing all things at all times.", reference:"Qur'an 4:1" },
  'name-al-mujib':{ title:"Al-Mujib", subtitle:"The Responsive One", icon:'star', arabic:"الْمُجِيب", translit:"Al-Mujīb", translation:"The Responsive One, who answers the call of those who supplicate.", reference:"Qur'an 11:61" },
  'name-al-wasi':{ title:"Al-Wasi'", subtitle:"The All-Encompassing", icon:'star', arabic:"الْوَاسِع", translit:"Al-Wāsiʿ", translation:"The All-Encompassing, whose mercy and knowledge embrace everything.", reference:"Qur'an 2:268" },
  'name-al-hakim':{ title:"Al-Hakim", subtitle:"The All-Wise", icon:'star', arabic:"الْحَكِيم", translit:"Al-Ḥakīm", translation:"The All-Wise, whose every decree carries perfect wisdom.", reference:"Qur'an 2:32" },
  'name-al-wadud':{ title:"Al-Wadud", subtitle:"The Loving One", icon:'star', arabic:"الْوَدُود", translit:"Al-Wadūd", translation:"The Loving One, who loves and is beloved by the righteous.", reference:"Qur'an 11:90" },
  'name-al-majid':{ title:"Al-Majid", subtitle:"The Most Glorious", icon:'star', arabic:"الْمَجِيد", translit:"Al-Majīd", translation:"The Most Glorious, possessor of perfect majesty.", reference:"Qur'an 11:73" },
  'name-al-baith':{ title:"Al-Ba'ith", subtitle:"The Resurrector", icon:'star', arabic:"الْبَاعِث", translit:"Al-Bāʿith", translation:"The Resurrector, who will raise all creation on the Day of Judgement.", reference:"Derived from Qur'an 22:7" },
  'name-ash-shahid':{ title:"Ash-Shahid", subtitle:"The Witness", icon:'star', arabic:"الشَّهِيد", translit:"Ash-Shahīd", translation:"The Witness, present and aware of everything without exception.", reference:"Qur'an 4:79" },
  'name-al-haqq':{ title:"Al-Haqq", subtitle:"The Truth", icon:'star', arabic:"الْحَقّ", translit:"Al-Ḥaqq", translation:"The Truth, whose existence and promise are absolute.", reference:"Qur'an 22:6" },
  'name-al-wakil':{ title:"Al-Wakil", subtitle:"The Trusted Guardian", icon:'star', arabic:"الْوَكِيل", translit:"Al-Wakīl", translation:"The Trusted Guardian, sufficient for those who rely on Him.", reference:"Qur'an 3:173" },
  'name-al-qawiyy':{ title:"Al-Qawiyy", subtitle:"The All-Strong", icon:'star', arabic:"الْقَوِيّ", translit:"Al-Qawiyy", translation:"The All-Strong, whose strength never fails.", reference:"Qur'an 22:40" },
  'name-al-matin':{ title:"Al-Matin", subtitle:"The Firm & Steadfast", icon:'star', arabic:"الْمَتِين", translit:"Al-Matīn", translation:"The Firm, whose power is unshakeable.", reference:"Qur'an 51:58" },
  'name-al-waliyy':{ title:"Al-Waliyy", subtitle:"The Protecting Ally", icon:'star', arabic:"الْوَلِيّ", translit:"Al-Waliyy", translation:"The Protecting Ally and Friend of the believers.", reference:"Qur'an 42:28" },
  'name-al-hamid':{ title:"Al-Hamid", subtitle:"The Praiseworthy", icon:'star', arabic:"الْحَمِيد", translit:"Al-Ḥamīd", translation:"The Praiseworthy, deserving of all praise in every state.", reference:"Qur'an 14:8" },
  'name-al-muhsi':{ title:"Al-Muhsi", subtitle:"The Reckoner of All", icon:'star', arabic:"الْمُحْصِي", translit:"Al-Muḥṣī", translation:"The One who has counted and encompassed all things in knowledge.", reference:"Derived from Qur'an 72:28" },
  'name-al-mubdi':{ title:"Al-Mubdi'", subtitle:"The Originator", icon:'star', arabic:"الْمُبْدِئ", translit:"Al-Mubdiʾ", translation:"The Originator, who began creation without precedent.", reference:"Qur'an 29:19" },
  'name-al-muid':{ title:"Al-Mu'id", subtitle:"The Restorer", icon:'star', arabic:"الْمُعِيد", translit:"Al-Muʿīd", translation:"The Restorer, who will bring creation back after death.", reference:"Qur'an 29:19" },
  'name-al-muhyi':{ title:"Al-Muhyi", subtitle:"The Giver of Life", icon:'star', arabic:"الْمُحْيِي", translit:"Al-Muḥyī", translation:"The Giver of Life to all that lives.", reference:"Qur'an 30:50" },
  'name-al-mumit':{ title:"Al-Mumit", subtitle:"The Taker of Life", icon:'star', arabic:"الْمُمِيت", translit:"Al-Mumīt", translation:"The One who causes death at the appointed time.", reference:"Derived from Qur'an 15:23" },
  'name-al-hayy':{ title:"Al-Hayy", subtitle:"The Ever-Living", icon:'star', arabic:"الْحَيّ", translit:"Al-Ḥayy", translation:"The Ever-Living, whose life has no beginning and no end.", reference:"Qur'an 2:255" },
  'name-al-qayyum':{ title:"Al-Qayyum", subtitle:"The Sustainer of All", icon:'star', arabic:"الْقَيُّوم", translit:"Al-Qayyūm", translation:"The Sustainer, upon whom all creation depends for its existence.", reference:"Qur'an 2:255" },
  'name-al-wajid':{ title:"Al-Wajid", subtitle:"The Finder", icon:'star', arabic:"الْوَاجِد", translit:"Al-Wājid", translation:"The Finder, who lacks nothing and finds all that He wills.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-al-majid-2':{ title:"Al-Majid", subtitle:"The Noble", icon:'star', arabic:"الْمَاجِد", translit:"Al-Mājid", translation:"The Noble, of perfect and abundant glory.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-al-wahid':{ title:"Al-Wahid", subtitle:"The One", icon:'star', arabic:"الْوَاحِد", translit:"Al-Wāḥid", translation:"The One, singular in His essence, attributes and actions.", reference:"Qur'an 13:16" },
  'name-as-samad':{ title:"As-Samad", subtitle:"The Eternal Refuge", icon:'star', arabic:"الصَّمَد", translit:"Aṣ-Ṣamad", translation:"The Eternal Refuge, upon whom all creation depends while He depends on none.", reference:"Qur'an 112:2" },
  'name-al-qadir':{ title:"Al-Qadir", subtitle:"The Able", icon:'star', arabic:"الْقَادِر", translit:"Al-Qādir", translation:"The Able, capable of all things.", reference:"Qur'an 6:65" },
  'name-al-muqtadir':{ title:"Al-Muqtadir", subtitle:"The Omnipotent", icon:'star', arabic:"الْمُقْتَدِر", translit:"Al-Muqtadir", translation:"The Omnipotent, whose power overwhelms every obstacle.", reference:"Qur'an 54:42" },
  'name-al-muqaddim':{ title:"Al-Muqaddim", subtitle:"The Expediter", icon:'star', arabic:"الْمُقَدِّم", translit:"Al-Muqaddim", translation:"The Expediter, who advances whom and what He wills.", reference:"Traditional enumeration, derived from prophetic supplication (Muslim 1/534)" },
  'name-al-muakhkhir':{ title:"Al-Mu'akhkhir", subtitle:"The Delayer", icon:'star', arabic:"الْمُؤَخِّر", translit:"Al-Muʾakhkhir", translation:"The Delayer, who defers whom and what He wills.", reference:"Traditional enumeration, derived from prophetic supplication (Muslim 1/534)" },
  'name-al-awwal':{ title:"Al-Awwal", subtitle:"The First", icon:'star', arabic:"الْأَوَّل", translit:"Al-Awwal", translation:"The First, before whom nothing existed.", reference:"Qur'an 57:3" },
  'name-al-akhir':{ title:"Al-Akhir", subtitle:"The Last", icon:'star', arabic:"الْآخِر", translit:"Al-Ākhir", translation:"The Last, after whom nothing remains.", reference:"Qur'an 57:3" },
  'name-az-zahir':{ title:"Az-Zahir", subtitle:"The Manifest", icon:'star', arabic:"الظَّاهِر", translit:"Aẓ-Ẓāhir", translation:"The Manifest, evident through the signs of His creation.", reference:"Qur'an 57:3" },
  'name-al-batin':{ title:"Al-Batin", subtitle:"The Hidden", icon:'star', arabic:"الْبَاطِن", translit:"Al-Bāṭin", translation:"The Hidden, whose true essence cannot be perceived.", reference:"Qur'an 57:3" },
  'name-al-wali':{ title:"Al-Wali", subtitle:"The Patron", icon:'star', arabic:"الْوَالِي", translit:"Al-Wālī", translation:"The Patron, who governs and manages all affairs.", reference:"Qur'an 13:11" },
  'name-al-mutaali':{ title:"Al-Muta'ali", subtitle:"The Most High", icon:'star', arabic:"الْمُتَعَالِي", translit:"Al-Mutaʿālī", translation:"The Most High, transcendent above every limitation.", reference:"Qur'an 13:9" },
  'name-al-barr':{ title:"Al-Barr", subtitle:"The Most Kind", icon:'star', arabic:"الْبَرّ", translit:"Al-Barr", translation:"The Most Kind, generous and gentle to His servants.", reference:"Qur'an 52:28" },
  'name-at-tawwab':{ title:"At-Tawwab", subtitle:"The Accepter of Repentance", icon:'star', arabic:"التَّوَّاب", translit:"At-Tawwāb", translation:"The Accepter of Repentance, who repeatedly turns to His servants in forgiveness.", reference:"Qur'an 2:37" },
  'name-al-muntaqim':{ title:"Al-Muntaqim", subtitle:"The Avenger", icon:'star', arabic:"الْمُنْتَقِم", translit:"Al-Muntaqim", translation:"The Avenger, who requites the wrongdoer with justice.", reference:"Qur'an 32:22" },
  'name-al-afuw':{ title:"Al-Afuw", subtitle:"The Pardoner", icon:'star', arabic:"الْعَفُوّ", translit:"Al-ʿAfuww", translation:"The Pardoner, who erases sin entirely.", reference:"Qur'an 4:99" },
  'name-ar-rauf':{ title:"Ar-Ra'uf", subtitle:"The Most Compassionate", icon:'star', arabic:"الرَّؤُوف", translit:"Ar-Raʾūf", translation:"The Most Compassionate, gentle with His creation.", reference:"Qur'an 2:143" },
  'name-al-muqsit':{ title:"Al-Muqsit", subtitle:"The Just in Fairness", icon:'star', arabic:"الْمُقْسِط", translit:"Al-Muqsiṭ", translation:"The Just, who deals with absolute fairness.", reference:"Qur'an 21:47 (concept); traditional enumeration" },
  'name-al-jami':{ title:"Al-Jami'", subtitle:"The Gatherer", icon:'star', arabic:"الْجَامِع", translit:"Al-Jāmiʿ", translation:"The Gatherer, who will assemble all creation on the Day of Judgement.", reference:"Qur'an 3:9" },
  'name-al-ghaniyy':{ title:"Al-Ghaniyy", subtitle:"The Self-Sufficient", icon:'star', arabic:"الْغَنِيّ", translit:"Al-Ghaniyy", translation:"The Self-Sufficient, in need of nothing from His creation.", reference:"Qur'an 2:263" },
  'name-al-mughni':{ title:"Al-Mughni", subtitle:"The Enricher", icon:'star', arabic:"الْمُغْنِي", translit:"Al-Mughnī", translation:"The Enricher, who grants sufficiency to whom He wills.", reference:"Qur'an 9:28" },
  'name-al-mani':{ title:"Al-Mani'", subtitle:"The Preventer of Harm", icon:'star', arabic:"الْمَانِع", translit:"Al-Māniʿ", translation:"The Preventer, who withholds harm from His servants.", reference:"Traditional enumeration (Al-Bukhari, Muslim)" },
  'name-ad-darr':{ title:"Ad-Darr", subtitle:"The Bringer of Harm", icon:'star', arabic:"الضَّارّ", translit:"Aḍ-Ḍārr", translation:"The One from whom harm proceeds only by His wise decree.", reference:"Traditional enumeration, paired with An-Nafi'" },
  'name-an-nafi':{ title:"An-Nafi'", subtitle:"The Giver of Benefit", icon:'star', arabic:"النَّافِع", translit:"An-Nāfiʿ", translation:"The Giver of benefit to whomever He wills.", reference:"Traditional enumeration, paired with Ad-Darr" },
  'name-an-nur':{ title:"An-Nur", subtitle:"The Light", icon:'star', arabic:"النُّور", translit:"An-Nūr", translation:"The Light of the heavens and the earth.", reference:"Qur'an 24:35" },
  'name-al-hadi':{ title:"Al-Hadi", subtitle:"The Guide", icon:'star', arabic:"الْهَادِي", translit:"Al-Hādī", translation:"The Guide, who leads His servants to the straight path.", reference:"Qur'an 25:31" },
  'name-al-badi':{ title:"Al-Badi'", subtitle:"The Incomparable Originator", icon:'star', arabic:"الْبَدِيع", translit:"Al-Badīʿ", translation:"The Incomparable Originator, who created without precedent or model.", reference:"Qur'an 2:117" },
  'name-al-baqi':{ title:"Al-Baqi", subtitle:"The Everlasting", icon:'star', arabic:"الْبَاقِي", translit:"Al-Bāqī", translation:"The Everlasting, who remains after all creation perishes.", reference:"Derived from Qur'an 55:27" },
  'name-al-warith':{ title:"Al-Warith", subtitle:"The Inheritor", icon:'star', arabic:"الْوَارِث", translit:"Al-Wārith", translation:"The Inheritor, to whom all things return.", reference:"Qur'an 15:23" },
  'name-ar-rashid':{ title:"Ar-Rashid", subtitle:"The Guide to the Right Way", icon:'star', arabic:"الرَّشِيد", translit:"Ar-Rashīd", translation:"The Guide, whose wisdom directs all things to their proper end.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-as-sabur':{ title:"As-Sabur", subtitle:"The Most Patient", icon:'star', arabic:"الصَّبُور", translit:"Aṣ-Ṣabūr", translation:"The Most Patient, who does not hasten in punishing.", reference:"Traditional enumeration (At-Tirmidhi)" },
  'name-malik-ul-mulk':{ title:"Malik-ul-Mulk", subtitle:"The Owner of All Sovereignty", icon:'star', arabic:"مَالِكُ الْمُلْك", translit:"Mālik-ul-Mulk", translation:"The Owner of all sovereignty, giving dominion to whom He wills.", reference:"Qur'an 3:26" },
  'name-dhul-jalal':{ title:"Dhul-Jalali wal-Ikram", subtitle:"Lord of Glory and Honour", icon:'star', arabic:"ذُو الْجَلَالِ وَالْإِكْرَام", translit:"Dhul-Jalāli wal-Ikrām", translation:"The Lord of Majesty and Generosity.", reference:"Qur'an 55:27" },
  'name-al-muhsin':{ title:"Al-Muhsin", subtitle:"The Doer of Good", icon:'star', arabic:"الْمُحْسِن", translit:"Al-Muḥsin", translation:"The Doer of Good, perfect in every action toward His creation.", reference:"Traditional enumeration" },

  // ============ OTHER BENEFICIAL SUPPLICATIONS — Protection & Ruqyah ============
  'other-expel-devil':{ title:"Seeking Refuge from Satan", subtitle:"To expel the devil and his whisperings", icon:'shield',
    arabic:"أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ",
    translit:"A'ūdhu billāhi minash-shayṭānir-rajīm.",
    translation:"I seek refuge in Allah from Satan, the accursed.",
    reference:"Hisn al-Muslim 141 (Abu Dawud 1/206, At-Tirmidhi) — recited to expel whispers and distractions, especially in prayer" },

  'other-fear-shirk':{ title:"Refuge from Shirk", subtitle:"For fear of associating partners with Allah, knowingly or not", icon:'shield',
    arabic:"اللَّهُمَّ إِنِّي أَعُوذُ بِكَ أَنْ أُشْرِكَ بِكَ وَأَنَا أَعْلَمُ، وَأَسْتَغْفِرُكَ لِمَا لَا أَعْلَمُ",
    translit:"Allāhumma innī a'ūdhu bika an ushrika bika wa anā a'lam, wa astaghfiruka limā lā a'lam.",
    translation:"O Allah, I seek refuge in You lest I associate anything with You knowingly, and I seek Your forgiveness for what I know not.",
    reference:"Hisn al-Muslim 203 (Ahmad 4/403) — graded good by Al-Albani" },

  'other-childrens-protection':{ title:"Protection for Children", subtitle:"Placing children under Allah's protection", icon:'shield',
    arabic:"أُعِيذُكُمَا بِكَلِمَاتِ اللَّهِ التَّامَّةِ مِنْ كُلِّ شَيْطَانٍ وَهَامَّةٍ، وَمِنْ كُلِّ عَيْنٍ لَامَّةٍ",
    translit:"U'īdhukumā bikalimāti-llāhit-tāmmati min kulli shayṭānin wa hāmmah, wa min kulli 'aynin lāmmah.",
    translation:"I seek protection for you both in the Perfect Words of Allah, from every devil and every beast, and from every envious, harmful eye.",
    reference:"Hisn al-Muslim 146 (Al-Bukhari 4/119) — the Prophet ﷺ would say this over Al-Hasan and Al-Husain" },

  'other-ward-off-devils':{ title:"Warding off the Rebellious Devils", subtitle:"To ward off the plot of the rebellious devils", icon:'shield',
    arabic:"أَعُوذُ بِكَلِمَاتِ اللَّهِ التَّامَّاتِ الَّتِي لَا يُجَاوِزُهُنَّ بَرٌّ وَلَا فَاجِرٌ مِنْ شَرِّ مَا خَلَقَ، وَبَرَأَ وَذَرَأَ، وَمِنْ شَرِّ مَا يَنْزِلُ مِنَ السَّمَاءِ، وَمِنْ شَرِّ مَا يَعْرُجُ فِيهَا، وَمِنْ شَرِّ مَا ذَرَأَ فِي الْأَرْضِ، وَمِنْ شَرِّ مَا يَخْرُجُ مِنْهَا، وَمِنْ شَرِّ فِتَنِ اللَّيْلِ وَالنَّهَارِ، وَمِنْ شَرِّ كُلِّ طَارِقٍ إِلَّا طَارِقًا يَطْرُقُ بِخَيْرٍ يَا رَحْمَٰنُ",
    translit:"A'ūdhu bikalimāti-llāhit-tāmmāti llatī lā yujāwizuhunna barrun wa lā fājirun min sharri mā khalaq, wa bara'a wa dhara', wa min sharri mā yanzilu minas-samā', wa min sharri mā ya'ruju fīhā, wa min sharri mā dhara'a fil-arḍ, wa min sharri mā yakhruju minhā, wa min sharri fitani l-layli wan-nahār, wa min sharri kulli ṭāriqin illā ṭāriqan yaṭruqu bikhayr yā Raḥmān.",
    translation:"I seek refuge in the Perfect Words of Allah — which neither the upright nor the corrupt may overcome — from the evil of what He created, of what He made and scattered, from the evil of what descends from the sky and what rises to it, from the evil of what He scattered in the earth and what emerges from it, from the evil trials of night and day, and from the evil of every visitor by night, except the visitor who brings good. O Most Merciful.",
    reference:"Hisn al-Muslim 247 (Ahmad 3/419, Ibn As-Sunni 637) — chain graded authentic by Al-Arna'ut" },

  // ============ Distress & Difficult Times ============
  'other-distress-1':{ title:"None Worthy of Worship but Allah", subtitle:"For one in distress", icon:'star',
    arabic:"لَا إِلَٰهَ إِلَّا اللَّهُ الْعَظِيمُ الْحَلِيمُ، لَا إِلَٰهَ إِلَّا اللَّهُ رَبُّ الْعَرْشِ الْعَظِيمِ، لَا إِلَٰهَ إِلَّا اللَّهُ رَبُّ السَّمَاوَاتِ وَرَبُّ الْأَرْضِ وَرَبُّ الْعَرْشِ الْكَرِيمِ",
    translit:"Lā ilāha illallāhu l-'Aẓīmu l-Ḥalīm, lā ilāha illallāhu Rabbu l-'Arshi l-'Aẓīm, lā ilāha illallāhu Rabbu s-samāwāti wa Rabbu l-arḍi wa Rabbu l-'Arshi l-Karīm.",
    translation:"There is none worthy of worship but Allah, the Mighty, the Forbearing. There is none worthy of worship but Allah, Lord of the Magnificent Throne. There is none worthy of worship but Allah, Lord of the heavens, Lord of the earth, and Lord of the Noble Throne.",
    reference:"Hisn al-Muslim 122 (Al-Bukhari 8/154, Muslim 4/2092)" },

  'other-distress-2':{ title:"Do Not Leave Me to Myself", subtitle:"For one in distress", icon:'star',
    arabic:"اللَّهُمَّ رَحْمَتَكَ أَرْجُو فَلَا تَكِلْنِي إِلَى نَفْسِي طَرْفَةَ عَيْنٍ، وَأَصْلِحْ لِي شَأْنِي كُلَّهُ لَا إِلَٰهَ إِلَّا أَنْتَ",
    translit:"Allāhumma raḥmataka arjū falā takilnī ilā nafsī ṭarfata 'ayn, wa aṣliḥ lī sha'nī kullah, lā ilāha illā ant.",
    translation:"O Allah, I hope for Your mercy. Do not leave me to myself even for the blink of an eye. Correct all of my affairs for me. There is none worthy of worship but You.",
    reference:"Hisn al-Muslim 123 (Abu Dawud 4/324, Ahmad 5/42) — graded good by Al-Albani" },

  'other-distress-3':{ title:"Glory Be to You, I Was of the Wrongdoers", subtitle:"For one in distress — the du'a of Yunus", icon:'star',
    isPointer:true, pointerNote:"This is the same du'a of Yunus (peace be upon him) found in the Qur'anic Du'a section — recited here specifically at a moment of personal distress or hardship.",
    reference:"Hisn al-Muslim 124 (At-Tirmidhi 5/529, Al-Hakim, graded authentic by Adh-Dhahabi)" },

  'other-distress-4':{ title:"Allah is My Lord", subtitle:"For one in distress", icon:'star',
    arabic:"اللَّهُ اللَّهُ رَبِّي لَا أُشْرِكُ بِهِ شَيْئًا",
    translit:"Allāh, Allāhu Rabbī lā ushriku bihi shay'ā.",
    translation:"Allah, Allah is my Lord. I do not associate anything with Him.",
    reference:"Hisn al-Muslim 125 (Abu Dawud 2/87) — graded authentic by Al-Albani" },

  'other-enemy-1':{ title:"Restrain Them by Their Necks", subtitle:"Upon encountering an enemy or authority", icon:'shield',
    arabic:"اللَّهُمَّ إِنَّا نَجْعَلُكَ فِي نُحُورِهِمْ، وَنَعُوذُ بِكَ مِنْ شُرُورِهِمْ",
    translit:"Allāhumma innā naj'aluka fī nuḥūrihim, wa na'ūdhu bika min shurūrihim.",
    translation:"O Allah, we ask You to restrain them by their necks, and we seek refuge in You from their evil.",
    reference:"Hisn al-Muslim 126 (Abu Dawud 2/89) — graded authentic by Al-Hakim and Adh-Dhahabi" },

  'other-enemy-2':{ title:"You Are My Strength", subtitle:"Upon encountering an enemy or authority", icon:'shield',
    arabic:"اللَّهُمَّ أَنْتَ عَضُدِي وَأَنْتَ نَصِيرِي، بِكَ أَجُولُ وَبِكَ أَصُولُ وَبِكَ أُقَاتِلُ",
    translit:"Allāhumma anta 'aḍudī, wa anta naṣīrī, bika ajūlu, wa bika aṣūlu, wa bika uqātil.",
    translation:"O Allah, You are my strength and You are my support. For Your sake I go forth, for Your sake I advance, and for Your sake I fight.",
    reference:"Hisn al-Muslim 127 (Abu Dawud 3/42, At-Tirmidhi 5/572) — graded authentic by Al-Albani" },

  'other-enemy-3':{ title:"Allah is Sufficient for Us", subtitle:"Upon encountering an enemy or authority", icon:'shield',
    arabic:"حَسْبُنَا اللَّهُ وَنِعْمَ الْوَكِيلُ",
    translit:"Ḥasbunallāhu wa ni'ma l-wakīl.",
    translation:"Allah is sufficient for us, and He is the best Disposer of affairs.",
    reference:"Hisn al-Muslim 128 (Al-Bukhari 5/172) — the words of Ibrahim (peace be upon him) when cast into the fire" },

  'other-affairs-difficult':{ title:"There is No Ease Except What You Make Easy", subtitle:"When affairs become difficult", icon:'star',
    arabic:"اللَّهُمَّ لَا سَهْلَ إِلَّا مَا جَعَلْتَهُ سَهْلًا، وَأَنْتَ تَجْعَلُ الْحَزْنَ إِذَا شِئْتَ سَهْلًا",
    translit:"Allāhumma lā sahla illā mā ja'altahu sahlā, wa anta taj'alu l-ḥazna idhā shi'ta sahlā.",
    translation:"O Allah, there is no ease except in what You have made easy, and You make sorrow easy if You wish.",
    reference:"Hisn al-Muslim 139 (Ibn Hibban 2427, Ibn As-Sunni 351) — graded authentic by Ibn Hajar" },

  // ============ Travel ============
  'other-travel':{ title:"Du'a for Travel", subtitle:"Recited when setting out, and upon returning", icon:'clouds',
    arabic:"اللَّهُ أَكْبَرُ، اللَّهُ أَكْبَرُ، اللَّهُ أَكْبَرُ. سُبْحَانَ الَّذِي سَخَّرَ لَنَا هَذَا وَمَا كُنَّا لَهُ مُقْرِنِينَ، وَإِنَّا إِلَى رَبِّنَا لَمُنْقَلِبُونَ. اللَّهُمَّ إِنَّا نَسْأَلُكَ فِي سَفَرِنَا هَذَا الْبِرَّ وَالتَّقْوَى، وَمِنَ الْعَمَلِ مَا تَرْضَى. اللَّهُمَّ هَوِّنْ عَلَيْنَا سَفَرَنَا هَذَا وَاطْوِ عَنَّا بُعْدَهُ. اللَّهُمَّ أَنْتَ الصَّاحِبُ فِي السَّفَرِ، وَالْخَلِيفَةُ فِي الْأَهْلِ. اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنْ وَعْثَاءِ السَّفَرِ، وَكَآبَةِ الْمَنْظَرِ، وَسُوءِ الْمُنْقَلَبِ فِي الْمَالِ وَالْأَهْلِ",
    translit:"Allāhu Akbar, Allāhu Akbar, Allāhu Akbar. Subḥāna lladhī sakhkhara lanā hādhā wa mā kunnā lahu muqrinīn, wa innā ilā Rabbinā lamunqalibūn. Allāhumma innā nas'aluka fī safarinā hādha l-birra wat-taqwā, wa mina l-'amali mā tarḍā. Allāhumma hawwin 'alaynā safaranā hādhā waṭwi 'annā bu'dah. Allāhumma anta ṣ-ṣāḥibu fis-safar, wal-khalīfatu fil-ahl. Allāhumma innī a'ūdhu bika min wa'thā'is-safar, wa ka'ābati l-manẓar, wa sū'il-munqalabi fil-māli wal-ahl.",
    translation:"Allah is the Greatest, Allah is the Greatest, Allah is the Greatest. Glory to Him who has subjected this to us, for we could never have accomplished it by ourselves. Surely to our Lord we are returning. O Allah, we ask You for righteousness and piety on this journey of ours, and for deeds that please You. O Allah, lighten this journey for us and make its distance easy. O Allah, You are our Companion on the road and the Guardian of our family. O Allah, I seek refuge in You from the hardships of travel, from a distressing sight, and from finding our family and property in misfortune upon returning. (Upon returning, repeat the same, adding: We return, repentant, worshipping, and praising our Lord.)",
    reference:"Hisn al-Muslim 207 (Muslim 2/978)" },

  // ============ Daily Life & Nature ============
  'other-thunder':{ title:"Upon Hearing Thunder", subtitle:"Glorifying Allah, Whom thunder and angels glorify", icon:'clouds',
    arabic:"سُبْحَانَ الَّذِي يُسَبِّحُ الرَّعْدُ بِحَمْدِهِ وَالْمَلَائِكَةُ مِنْ خِيفَتِهِ",
    translit:"Subḥāna lladhī yusabbiḥu r-ra'du biḥamdihi wal-malā'ikatu min khīfatih.",
    translation:"Glory is to Him Whom thunder glorifies with praise, and the angels too, out of fear of Him.",
    reference:"Al-Muwatta 2/992 — the practice of Abdullah ibn az-Zubayr (RA), who would pause his conversation upon hearing thunder to recite this" },

  'other-rain-beneficial':{ title:"A Beneficial Downpour", subtitle:"When it begins to rain", icon:'clouds',
    arabic:"اللَّهُمَّ صَيِّبًا نَافِعًا",
    translit:"Allāhumma ṣayyiban nāfi'ā.",
    translation:"O Allah, (let it be) a beneficial rain cloud.",
    reference:"Hisn al-Muslim (Al-Bukhari 1/205, Muslim 1/83)" },

  'other-crescent-moon':{ title:"Upon Sighting the Crescent Moon", subtitle:"At the start of a new month", icon:'moon',
    arabic:"اللَّهُ أَكْبَرُ. اللَّهُمَّ أَهِلَّهُ عَلَيْنَا بِالْأَمْنِ وَالْإِيمَانِ، وَالسَّلَامَةِ وَالْإِسْلَامِ، وَالتَّوْفِيقِ لِمَا تُحِبُّ رَبَّنَا وَتَرْضَى. رَبُّنَا وَرَبُّكَ اللَّهُ",
    translit:"Allāhu Akbar. Allāhumma ahillahu 'alaynā bil-amni wal-īmān, was-salāmati wal-Islām, wat-tawfīqi limā tuḥibbu Rabbanā wa tarḍā. Rabbunā wa Rabbukallāh.",
    translation:"Allah is the Greatest. O Allah, bring this new moon upon us with security and faith, with peace and in Islam, and with guidance to that which You love and are pleased with. Our Lord and your Lord is Allah.",
    reference:"Hisn al-Muslim 175 (At-Tirmidhi 5/504, Ad-Darimi 1/336) — graded authentic by Al-Albani" },

  'other-sneezing':{ title:"Upon Sneezing", subtitle:"The exchange between the one who sneezes and those nearby", icon:'star',
    arabic:"الْحَمْدُ لِلَّهِ ← يَرْحَمُكَ اللَّهُ ← يَهْدِيكُمُ اللَّهُ وَيُصْلِحُ بَالَكُمْ",
    translit:"[Sneezer says:] Alḥamdulillāh. [Others reply:] Yarḥamukallāh. [Sneezer then says:] Yahdīkumullāhu wa yuṣliḥu bālakum.",
    translation:"[Sneezer:] Praise be to Allah. [Others:] May Allah have mercy on you. [Sneezer replies:] May Allah guide you and set right your affairs.",
    reference:"Al-Bukhari 6224, and Hisn al-Muslim Ch. 77 — an etiquette of mutual remembrance among Muslims" },

  'other-anger':{ title:"When Angry", subtitle:"Seeking refuge from Satan's provocation", icon:'shield',
    isPointer:true, pointerNote:"The same 'A'udhu billahi minash-shaytanir-rajim' found under Protection above — recited specifically to calm anger.",
    reference:"Hisn al-Muslim 193 (Al-Bukhari 7/99, Muslim 4/2015)" },

  'other-qunoot-witr':{ title:"Qunoot al-Witr", subtitle:"Recited in the third rak'ah of Witr prayer", icon:'mosque',
    arabic:"اللَّهُمَّ اهْدِنِي فِيمَنْ هَدَيْتَ، وَعَافِنِي فِيمَنْ عَافَيْتَ، وَتَوَلَّنِي فِيمَنْ تَوَلَّيْتَ، وَبَارِكْ لِي فِيمَا أَعْطَيْتَ، وَقِنِي شَرَّ مَا قَضَيْتَ، إِنَّكَ تَقْضِي وَلَا يُقْضَى عَلَيْكَ، وَإِنَّهُ لَا يَذِلُّ مَنْ وَالَيْتَ وَلَا يَعِزُّ مَنْ عَادَيْتَ، تَبَارَكْتَ رَبَّنَا وَتَعَالَيْتَ",
    translit:"Allāhumma-hdinī fīman hadayt, wa 'āfinī fīman 'āfayt, wa tawallanī fīman tawallayt, wa bārik lī fīmā a'ṭayt, wa qinī sharra mā qaḍayt, innaka taqḍī wa lā yuqḍā 'alayk, wa innahu lā yadhillu man wālayt, wa lā ya'izzu man 'ādayt, tabārakta Rabbanā wa ta'ālayt.",
    translation:"O Allah, guide me among those You have guided, pardon me among those You have pardoned, take me into Your care among those You have taken into Your care, bless me in what You have granted, and protect me from the evil You have decreed. Indeed You decree, and none decrees over You. He whom You befriend is not humiliated, nor is he honoured whom You oppose. Blessed are You, our Lord, and Exalted.",
    reference:"Hisn al-Muslim (Sunan Abi Dawud 1425) — taught by the Prophet ﷺ to his grandson Al-Hasan ibn Ali" },

  // ============ Family & Life Events ============
  'other-visiting-sick-1':{ title:"It Will Be a Purification", subtitle:"When visiting the sick", icon:'star',
    arabic:"لَا بَأْسَ طَهُورٌ إِنْ شَاءَ اللَّهُ",
    translit:"Lā ba'sa ṭahūrun in shā'allāh.",
    translation:"Do not worry, it will be a purification for you, Allah willing.",
    reference:"Hisn al-Muslim 147 (Al-Bukhari 10/118)" },

  'other-visiting-sick-2':{ title:"I Ask Allah to Heal You", subtitle:"When visiting the sick — recite seven times", icon:'star',
    arabic:"أَسْأَلُ اللَّهَ الْعَظِيمَ رَبَّ الْعَرْشِ الْعَظِيمِ أَنْ يَشْفِيَكَ",
    translit:"As'alullāha l-'Aẓīma Rabba l-'Arshi l-'Aẓīmi an yashfiyak. (×7)",
    translation:"I ask Almighty Allah, Lord of the Magnificent Throne, to heal you.",
    reference:"Hisn al-Muslim 148 (At-Tirmidhi, Abu Dawud) — recite seven times, graded authentic by Al-Albani" },

  'other-condolence':{ title:"Words of Condolence", subtitle:"To offer comfort after a loss", icon:'people',
    arabic:"إِنَّ لِلَّهِ مَا أَخَذَ، وَلَهُ مَا أَعْطَى، وَكُلُّ شَيْءٍ عِنْدَهُ بِأَجَلٍ مُسَمًّى، فَلْتَصْبِرْ وَلْتَحْتَسِبْ",
    translit:"Inna lillāhi mā akhadh, wa lahu mā a'ṭā, wa kullu shay'in 'indahu bi-ajalin musammā, faltaṣbir wal-taḥtasib.",
    translation:"Surely to Allah belongs what He takes, and to Him belongs what He gives; everything with Him has an appointed time. So be patient and seek reward.",
    reference:"Hisn al-Muslim 162 (Al-Bukhari 2/80, Muslim 2/636)" },

  // ============ PRAYER BENEFITS & PROTECTIONS ============
  // ==> CONNECT: starter set of fully-verified hadith (Arabic checked
  // directly against sunnah.com). Scoped to the entries the site owner
  // asked to prioritise per prayer, plus the universal one. Continuable
  // to 20-30 per prayer in a future data-build session using the same
  // sourcing method (Tier 1/2 sources only, grade always shown).
  'pb-fajr-protection':{ title:"Fajr: Under Allah's Protection", subtitle:"Sahih Muslim 657a", icon:'shield',
    arabic:"مَنْ صَلَّى الصُّبْحَ فَهُوَ فِي ذِمَّةِ اللَّهِ فَلاَ يَطْلُبَنَّكُمُ اللَّهُ مِنْ ذِمَّتِهِ بِشَىْءٍ فَيُدْرِكَهُ فَيَكُبَّهُ فِي نَارِ جَهَنَّمَ",
    translit:"Man ṣallā aṣ-ṣubḥa fahuwa fī dhimmatillāh, falā yaṭlubannakumullāhu min dhimmatihī bishay'in fayudrikahū fayakubbahū fī nāri jahannam.",
    translation:"Whoever prays the morning (Fajr) prayer is under the protection of Allah — so do not violate that protection in any way, for whoever does, Allah will seize him and throw him down on his face into the Fire of Hell.",
    reference:"Sahih Muslim 657a — Grade: Sahih (authentic)" },

  'pb-fajr-asr-jannah':{ title:"Fajr + Asr → Paradise", subtitle:"Sahih al-Bukhari 574", icon:'star',
    arabic:"مَنْ صَلَّى الْبَرْدَيْنِ دَخَلَ الْجَنَّةَ",
    translit:"Man ṣallā al-bardayni dakhala al-jannah.",
    translation:"Whoever prays the two cool prayers (Fajr and Asr) will enter Paradise.",
    reference:"Sahih al-Bukhari 574 — Grade: Sahih (agreed upon)" },

  'pb-fajr-angels':{ title:"Fajr & Asr: Witnessed by Angels", subtitle:"Sahih al-Bukhari 555", icon:'people',
    arabic:"يَتَعَاقَبُونَ فِيكُمْ مَلاَئِكَةٌ بِاللَّيْلِ وَمَلاَئِكَةٌ بِالنَّهَارِ، وَيَجْتَمِعُونَ فِي صَلاَةِ الْفَجْرِ وَصَلاَةِ الْعَصْرِ",
    translit:"Yata'āqabūna fīkum malā'ikatun bil-layli wa malā'ikatun bin-nahār, wa yajtami'ūna fī ṣalāti al-fajri wa ṣalāti al-'aṣr.",
    translation:"Angels come to you in succession by night and by day, and they gather together at the Fajr and Asr prayers.",
    reference:"Sahih al-Bukhari 555 — Grade: Sahih" },

  'pb-dhuhr-fire':{ title:"Dhuhr: 4 Before + 4 After → Protection from the Fire", subtitle:"Sunan at-Tirmidhi 428", icon:'shield',
    arabic:"مَنْ حَافَظَ عَلَى أَرْبَعِ رَكَعَاتٍ قَبْلَ الظُّهْرِ وَأَرْبَعٍ بَعْدَهَا حَرَّمَهُ اللَّهُ عَلَى النَّارِ",
    translit:"Man ḥāfaẓa 'alā arba'i raka'ātin qabla aẓ-ẓuhri wa arba'in ba'dahā ḥarramahullāhu 'alan-nār.",
    translation:"Whoever preserves four rak'ahs before Dhuhr and four after it, Allah will forbid him from the Fire.",
    reference:"Sunan at-Tirmidhi 428 — Grade: Hasan Sahih" },

  'pb-asr-warning':{ title:"Asr: Severe Warning Against Abandoning It", subtitle:"Sahih al-Bukhari 553", icon:'shield',
    arabic:"مَنْ تَرَكَ صَلاَةَ الْعَصْرِ فَقَدْ حَبِطَ عَمَلُهُ",
    translit:"Man taraka ṣalāta al-'aṣri faqad ḥabiṭa 'amaluh.",
    translation:"Whoever leaves the Asr prayer, his deeds are nullified.",
    reference:"Sahih al-Bukhari 553 — Grade: Sahih" },

  'pb-maghrib-house':{ title:"Maghrib: Part of the Twelve Sunnah Rak'ahs", subtitle:"Jami' at-Tirmidhi 415", icon:'mosque',
    arabic:"مَنْ صَلَّى فِي يَوْمٍ وَلَيْلَةٍ ثِنْتَىْ عَشْرَةَ رَكْعَةً بُنِيَ لَهُ بَيْتٌ فِي الْجَنَّةِ أَرْبَعًا قَبْلَ الظُّهْرِ وَرَكْعَتَيْنِ بَعْدَهَا وَرَكْعَتَيْنِ بَعْدَ الْمَغْرِبِ وَرَكْعَتَيْنِ بَعْدَ الْعِشَاءِ وَرَكْعَتَيْنِ قَبْلَ صَلاَةِ الْفَجْرِ",
    translit:"Man ṣallā fī yawmin wa laylatin thintay 'ashrata rak'atan buniya lahu baytun fī al-jannah...",
    translation:"Whoever prays twelve rak'ahs in a day and night — four before Dhuhr and two after, two after Maghrib, two after Isha, and two before Fajr — a house will be built for him in Paradise.",
    reference:"Jami' at-Tirmidhi 415 — Grade: Hasan Sahih" },

  'pb-isha-half-night':{ title:"Isha in Congregation → Half a Night's Worship", subtitle:"Sahih Muslim 656 / Tirmidhi 221", icon:'moon',
    arabic:"مَنْ شَهِدَ الْعِشَاءَ فِي جَمَاعَةٍ كَانَ لَهُ قِيَامُ نِصْفِ لَيْلَةٍ",
    translit:"Man shahida al-'ishā'a fī jamā'atin kāna lahu qiyāmu niṣfi laylah.",
    translation:"Whoever attends Isha in congregation, it is as if he had stood half the night in prayer.",
    reference:"Sahih Muslim 656 / Jami' at-Tirmidhi 221 — Grade: Sahih" },

  'pb-isha-fajr-whole-night':{ title:"Isha + Fajr in Congregation → a Whole Night's Worship", subtitle:"Sahih Muslim 656 / Tirmidhi 221", icon:'moonstars',
    arabic:"وَمَنْ صَلَّى الْعِشَاءَ وَالْفَجْرَ فِي جَمَاعَةٍ كَانَ لَهُ كَقِيَامِ لَيْلَةٍ",
    translit:"Wa man ṣallā al-'ishā'a wal-fajra fī jamā'atin kāna lahu ka qiyāmi laylah.",
    translation:"And whoever prays Isha and Fajr in congregation, it is as if he had stood the whole night in prayer.",
    reference:"Sahih Muslim 656 / Jami' at-Tirmidhi 221 — Grade: Sahih" },

  'pb-isha-hypocrites':{ title:"Isha & Fajr: Immense Reward Despite the Difficulty", subtitle:"Sahih al-Bukhari 657 / Muslim 651", icon:'star',
    arabic:"لَيْسَ صَلاَةٌ أَثْقَلَ عَلَى الْمُنَافِقِينَ مِنَ الْفَجْرِ وَالْعِشَاءِ، وَلَوْ يَعْلَمُونَ مَا فِيهِمَا لأَتَوْهُمَا وَلَوْ حَبْوًا",
    translit:"Laysa ṣalātun athqalu 'alal-munāfiqīna minal-fajri wal-'ishā'i, wa law ya'lamūna mā fīhimā la'atawhumā wa law ḥabwā.",
    translation:"No prayer is heavier upon the hypocrites than Fajr and Isha; if they knew what reward is in them, they would come to them even if they had to crawl.",
    reference:"Sahih al-Bukhari 657 / Sahih Muslim 651 — Grade: Muttafaqun Alayhi (agreed upon)" },

  'pb-universal-expiate':{ title:"All Five Prayers Erase Sins Between Them", subtitle:"Sahih Muslim 233a", icon:'shield',
    arabic:"الصَّلَوَاتُ الْخَمْسُ، وَالْجُمُعَةُ إِلَى الْجُمُعَةِ، وَرَمَضَانُ إِلَى رَمَضَانَ، مُكَفِّرَاتٌ مَا بَيْنَهُنَّ إِذَا اجْتَنَبَ الْكَبَائِرَ",
    translit:"Aṣ-ṣalawātu al-khamsu, wal-jumu'atu ilā al-jumu'ah, wa ramaḍānu ilā ramaḍān, mukaffirātun mā baynahunna idhā ijtanaba al-kabā'ir.",
    translation:"The five daily prayers, one Friday prayer to the next, and one Ramadan to the next, are expiation for whatever comes between them, so long as major sins are avoided.",
    reference:"Sahih Muslim 233a — Grade: Sahih" },

  // ---- continued data-build (batch 2) ----
  'pb-fajr-two-rakat':{ title:"Fajr: The Two Sunnah Rak'ahs Are Better Than the World", subtitle:"Sahih Muslim 725a", icon:'star',
    arabic:"رَكْعَتَا الْفَجْرِ خَيْرٌ مِنْ الدُّنْيَا وَمَا فِيهَا",
    translit:"Rak'atā al-fajri khayrun min ad-dunyā wa mā fīhā.",
    translation:"The two rak'ahs before Fajr are better than this world and everything in it.",
    reference:"Sahih Muslim 725a — Grade: Sahih" },

  'pb-dhuhr-gates-heaven':{ title:"Dhuhr: An Hour When the Gates of Heaven Open", subtitle:"Sunan Ibn Majah 1157", icon:'shield',
    arabic:"إِنَّ أَبْوَابَ السَّمَاءِ تُفْتَحُ إِذَا زَالَتِ الشَّمْسُ",
    translit:"Inna abwāba as-samā'i tuftaḥu idhā zālati ash-shams.",
    translation:"The gates of heaven are opened when the sun passes its zenith — the Prophet ﷺ used this time before Dhuhr, saying he loved for his good deeds to rise up in that hour.",
    reference:"Sunan Ibn Majah 1157 — Grade: Hasan (Al-Albani, Sahih al-Jami)" },

  'pb-asr-lost-family':{ title:"Asr: Missing It Is Like Losing Family and Wealth", subtitle:"Sahih al-Bukhari 552 / Muslim 626", icon:'shield',
    arabic:"الَّذِي تَفُوتُهُ صَلاَةُ الْعَصْرِ كَأَنَّمَا وُتِرَ أَهْلَهُ وَمَالَهُ",
    translit:"Alladhī tafūtuhu ṣalātu al-'aṣri ka'annamā wutira ahlahu wa mālah.",
    translation:"Whoever misses the Asr prayer, it is as if he had lost his family and his wealth.",
    reference:"Sahih al-Bukhari 552 / Sahih Muslim 626 — Grade: Muttafaqun Alayhi (agreed upon)" },

  'pb-asr-four-before':{ title:"Asr: A Prophetic Supplication for Whoever Prays Four Before It", subtitle:"Jami' at-Tirmidhi 430", icon:'star',
    arabic:"رَحِمَ اللَّهُ امْرَأً صَلَّى قَبْلَ الْعَصْرِ أَرْبَعًا",
    translit:"Raḥima Allāhu imra'an ṣallā qabla al-'aṣri arba'an.",
    translation:"May Allah have mercy on a person who prays four rak'ahs before Asr.",
    reference:"Jami' at-Tirmidhi 430 — Grade: Hasan" }

};

/* ============================================================
   OFFLINE SYNC :: Cache categories and guides to IndexedDB
   for offline access to Dua/Dhikr and Guides
   ============================================================ */
window.OfflineSync = (function(){
  const syncCategories = async (categories) => {
    try{
      await OfflineData.set('metadata', { key:'categories_timestamp', value: Date.now() });
      for(const cat of categories){
        await OfflineData.set('dua_dhikr', cat);
      }
    }catch(e){ console.log('Offline sync for categories failed:', e); }
  };
  
  const syncGuides = async (guides) => {
    try{
      await OfflineData.set('metadata', { key:'guides_timestamp', value: Date.now() });
      for(const guide of guides){
        await OfflineData.set('guides', guide);
      }
    }catch(e){ console.log('Offline sync for guides failed:', e); }
  };
  
  return { syncCategories, syncGuides };
})();


window.CATEGORIES = [
  {id:'morning', title:"Morning", icon:'sun', theme:'theme-morning', light:false,
    desc:"Adhkar to start your day with light and protection.",
    items:['morning-dhikr','ayat-al-kursi','sayyidul-istighfar','morning-wellbeing','morning-sufficient','three-quls','hundred-hasanat','two-light-words','four-witnesses-morning','fitrah-morning','blessing-from-you','afw-afiyah','witness-unseen-seen','bismillah-protection','ya-hayyu-ya-qayyum','khayra-hadhal-yawm','subhanallahi-hundred','subhanallahi-extended']},
  {id:'evening', title:"Evening", icon:'moon', theme:'theme-evening', light:true,
    desc:"Adhkar to close the day and seek Allah's protection through the night.",
    items:['evening-dhikr','evening-protection','evening-pleased','ayat-al-kursi','three-quls','hundred-hasanat','two-light-words','four-witnesses-evening','afw-afiyah','witness-unseen-seen','bismillah-protection','ya-hayyu-ya-qayyum','subhanallahi-hundred','subhanallahi-extended']},
  {id:'salah', title:"Salah and After Salah", icon:'mosque', theme:'theme-salah', light:false,
    desc:"Remembrance to say after completing each obligatory prayer.",
    items:['tasbih-33','dua-after-salah','ayat-al-kursi-salah','three-quls','istikhara',
      'pb-fajr-protection','pb-fajr-asr-jannah','pb-fajr-angels','pb-fajr-two-rakat',
      'pb-dhuhr-fire','pb-dhuhr-gates-heaven',
      'pb-asr-warning','pb-asr-lost-family','pb-asr-four-before',
      'pb-maghrib-house','pb-isha-half-night','pb-isha-fajr-whole-night','pb-isha-hypocrites','pb-universal-expiate']},
  {id:'sleep', title:"Before Sleep and Tahajjud", icon:'moonstars', theme:'theme-sleep', light:true,
    desc:"Du'as and Surahs to recite before sleep and during the blessed hours of the night.",
    items:['sajdah-mulk','ayat-al-kursi-sleep','last-two-baqarah','al-kafirun','three-quls','tasbih-fatima','mercy-protection','sleep-soul','sleep-punishment']},
  {id:'praise', title:"Praise of Allah and Salawat", icon:'allah', theme:'theme-praise', light:false,
    desc:"Words that magnify and praise Allah, and blessings upon the Prophet ﷺ.",
    items:['salawat','salawat-short','salawat-tenfold','subhanallah-bihamdihi','subhanallah-adad']},
  {id:'qurandua', title:"Qur'anic Du'a and Sunnah Du'a", icon:'bookstand', theme:'theme-qurandua', light:false,
    desc:"Supplications drawn directly from the Qur'an and the Sunnah.",
    items:['rabbana-atina','rabbi-zidni-ilma','rabbana-la-tuzigh','rabbana-zulm','rabbana-afrigh','rabbi-ishrah','rabbi-inni-lima','yunus-la-ilaha']},
  {id:'istighfar', title:"Istighfar and Dhikr for All Times", icon:'tasbih', theme:'theme-istighfar', light:false,
    desc:"Short remembrance to keep your tongue moist with the mention of Allah.",
    items:['astaghfirullah','la-ilaha-illallah','sayyidul-istighfar','rabbighfir-tub','astaghfirullah-full','subhanallah-general']},
  {id:'ummah', title:"Du'as for the Ummah", icon:'people', theme:'theme-ummah', light:false,
    desc:"Supplications for the wellbeing and unity of the Muslim community.",
    items:['dua-ummah','dua-ibrahim-descendants','rabbana-ighfir-lana','dua-victory-islam']},
  {id:'names', title:"The 99 Names of Allah", icon:'clouds', theme:'theme-names', light:false, wide:true,
    desc:"The complete 99 beautiful names of Allah, with meaning and reflection.",
    items:['name-ar-rahman','name-ar-raheem','name-al-malik','name-al-quddus','name-as-salam','name-al-mumin','name-al-muhaymin','name-al-aziz','name-al-jabbar','name-al-mutakabbir','name-al-khaliq','name-al-bari','name-al-musawwir','name-al-ghaffar','name-al-qahhar','name-al-wahhab','name-ar-razzaq','name-al-fattah','name-al-alim','name-al-qabid','name-al-basit','name-al-khafid','name-ar-rafi','name-al-muizz','name-al-mudhill','name-as-sami','name-al-basir','name-al-hakam','name-al-adl','name-al-latif','name-al-khabir','name-al-halim','name-al-azim','name-al-ghafur','name-ash-shakur','name-al-aliyy','name-al-kabir','name-al-hafiz','name-al-muqit','name-al-hasib','name-al-jalil','name-al-karim','name-ar-raqib','name-al-mujib','name-al-wasi','name-al-hakim','name-al-wadud','name-al-majid','name-al-baith','name-ash-shahid','name-al-haqq','name-al-wakil','name-al-qawiyy','name-al-matin','name-al-waliyy','name-al-hamid','name-al-muhsi','name-al-mubdi','name-al-muid','name-al-muhyi','name-al-mumit','name-al-hayy','name-al-qayyum','name-al-wajid','name-al-majid-2','name-al-wahid','name-as-samad','name-al-qadir','name-al-muqtadir','name-al-muqaddim','name-al-muakhkhir','name-al-awwal','name-al-akhir','name-az-zahir','name-al-batin','name-al-wali','name-al-mutaali','name-al-barr','name-at-tawwab','name-al-muntaqim','name-al-afuw','name-ar-rauf','name-al-muqsit','name-al-jami','name-al-ghaniyy','name-al-mughni','name-al-mani','name-ad-darr','name-an-nafi','name-an-nur','name-al-hadi','name-al-badi','name-al-baqi','name-al-warith','name-ar-rashid','name-as-sabur','name-malik-ul-mulk','name-dhul-jalal','name-al-muhsin']},
  {id:'other', title:"Other Beneficial Supplications", icon:'clouds', theme:'theme-other', light:false, wide:true,
    desc:"Du'as and dhikr for situations outside the categories above — including protection, travel, and life events.",
    items:['other-expel-devil','other-fear-shirk','other-childrens-protection','other-ward-off-devils','other-distress-1','other-distress-2','other-distress-3','other-distress-4','other-enemy-1','other-enemy-2','other-enemy-3','other-affairs-difficult','other-travel','other-thunder','other-rain-beneficial','other-crescent-moon','other-sneezing','other-anger','other-qunoot-witr','other-visiting-sick-1','other-visiting-sick-2','other-condolence'],
    subGroups:[
      {label:"Protection & Ruqyah", items:['other-expel-devil','other-fear-shirk','other-childrens-protection','other-ward-off-devils']},
      {label:"Distress & Difficult Times", items:['other-distress-1','other-distress-2','other-distress-3','other-distress-4','other-enemy-1','other-enemy-2','other-enemy-3','other-affairs-difficult']},
      {label:"Travel", items:['other-travel']},
      {label:"Daily Life & Nature", items:['other-thunder','other-rain-beneficial','other-crescent-moon','other-sneezing','other-anger','other-qunoot-witr']},
      {label:"Family & Life Events", items:['other-visiting-sick-1','other-visiting-sick-2','other-condolence']}
    ]}
];


const TIPS = {
  morning:"Even one short dhikr said with presence outweighs many said in a rush.",
  evening:"Closing the day with remembrance settles the heart before rest.",
  salah:"A minute of tasbih after salah carries reward well beyond its length.",
  sleep:"Even a few minutes before sleep can be a source of immense reward.",
  praise:"Salawat upon the Prophet ﷺ is answered with ten blessings in return.",
  qurandua:"Praying in the Qur'an's own words is a Sunnah in itself.",
  istighfar:"A tongue busy with istighfar is rarely idle in heedlessness.",
  ummah:"Du'a for others is answered for the one who makes it too.",
  names:"Reflecting on a single Name slowly often reaches the heart more than reciting all 99 quickly."
};

/* ============================================================
   STATE
   ============================================================ */
const state = {
  selectedCategory:'sleep',
  selectedItem:'ayat-al-kursi',
  hasUserSelectedCategory:false,  // true once the user actually taps a category — used to suppress the active-border on the default pre-selected card
  favoritesMode:false,
  bookmarks:new Set(),           // fresh device starts empty; loaded from backend below
  audioPlaying:false,
  audioSpeed:1.0,
  muted:false,
  mobilePane:'categories'
};

function persistDua(){
  WWP.save('dua', { bookmarks: Array.from(state.bookmarks) });
}
async function loadDuaFromBackend(){
  const saved = await WWP.get('dua');
  if(saved && Array.isArray(saved.bookmarks)) state.bookmarks = new Set(saved.bookmarks);
}

/* ============================================================
   UI :: render
   ============================================================ */
function getCategory(id){ return CATEGORIES.find(c=>c.id===id); }

const DUA_TILE_ASPECT = {
  morning:700/574, evening:700/574, salah:700/574, sleep:700/574,
  praise:700/574, qurandua:700/574, istighfar:700/573, ummah:700/574,
  names:1689/453, other:1709/609
};
function renderCategories(){
  const grid = $('#catGrid'); grid.innerHTML='';
  CATEGORIES.forEach((cat,i)=>{
    const card = document.createElement('div');
    const isFull = !!cat.wide;
    card.className = `cat-card cat-card-art ${state.hasUserSelectedCategory && state.selectedCategory===cat.id && !state.favoritesMode?'active':''} ${isFull?'full':''}`;
    // Tile art has its title baked into the image at a fixed spot, so the
    // card box must match that image's aspect ratio or object-fit:cover
    // crops straight through the words. Wide tiles also have their title
    // anchored to the left, so bias the crop to eat into the empty right
    // side of the art rather than the text.
    const ratio = DUA_TILE_ASPECT[cat.id];
    if(ratio) card.style.aspectRatio = String(ratio);
    card.innerHTML = `
      <div class="cat-scene-wrap"><img src="${DUA_TILE_IMAGES[cat.id]}" alt="${cat.title}" loading="lazy" style="${isFull?'object-position:left center;':''}"></div>
    `;
    card.addEventListener('click', ()=> selectCategory(cat.id));
    grid.appendChild(card);
  });
}

function renderItemsPane(){
  const fav = state.favoritesMode;
  const cat = getCategory(state.selectedCategory);
  $('#itemsHeadTitle').textContent = fav ? 'My Favourites' : "Du'a & Dhikr";
  $('#catFavToggle').classList.toggle('saved', fav);

  const banner = $('#catBanner');
  if(fav){
    banner.innerHTML = `
      <div class="cat-banner">
        <div class="banner-scene">${sceneSvg('praise')}</div>
        <div class="banner-scrim"></div>
        <div class="banner-content">
          <h2>My Favourites</h2>
          <p>Everything you've bookmarked, in one place.</p>
          <span class="item-count">${state.bookmarks.size} item${state.bookmarks.size===1?'':'s'}</span>
        </div>
      </div>`;
  } else {
    banner.innerHTML = `
      <div class="cat-banner cat-banner-art">
        <div class="banner-scene"><img src="${DUA_BANNER_IMAGES[cat.id]}" alt="${cat.title}"></div>
        <div class="banner-content banner-content-art">
          <p>${cat.desc}</p>
          <span class="item-count">${cat.items.length} item${cat.items.length===1?'':'s'}</span>
        </div>
      </div>`;
  }

  const list = $('#itemList'); list.innerHTML='';
  const ids = fav ? Array.from(state.bookmarks) : cat.items;
  if(ids.length===0){
    list.innerHTML = `<div class="empty-state">${iconSvg('heart',30)}<div>No favourites yet — tap the bookmark icon on any du'a to save it here.</div></div>`;
  }
  if(!fav && cat.subGroups && cat.subGroups.length){
    cat.subGroups.forEach(group=>{
      const header = document.createElement('div');
      header.className = 'item-subheader';
      header.textContent = group.label;
      list.appendChild(header);
      group.items.forEach(id=>{
        const item = ITEMS[id]; if(!item) return;
        list.appendChild(buildItemRow(id, item));
      });
    });
  } else {
    ids.forEach(id=>{
      const item = ITEMS[id]; if(!item) return;
      list.appendChild(buildItemRow(id, item));
    });
  }

  const tip = $('#tipCard');
  const tipText = TIPS[fav ? 'sleep' : cat.id] || "Consistency is key.";
  tip.innerHTML = `<span class="tip-icon">${iconSvg('shield',18)}</span><div><strong>Consistency is key</strong><p>${tipText}</p></div>`;
}

function buildItemRow(id, item){
  const row = document.createElement('div');
  row.className = 'item-row'+(state.selectedItem===id?' active':'');
  const isBm = state.bookmarks.has(id);
  row.innerHTML = `
    <span class="item-icon">${iconSvg(item.icon,16)}</span>
    <div class="item-body"><div class="item-title">${item.title}</div><div class="item-sub">${item.subtitle}</div></div>
    <div class="item-actions">
      <span class="item-bm ${isBm?'saved':''}" data-id="${id}">${iconSvg('star',0)}</span>
      <span class="item-chev"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 18l6-6-6-6"/></svg></span>
    </div>
  `;
  row.querySelector('.item-bm').innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="${isBm?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M6 3h12v18l-6-4-6 4V3Z"/></svg>`;
  row.querySelector('.item-bm').addEventListener('click', e=>{ e.stopPropagation(); toggleBookmark(id); });
  row.addEventListener('click', ()=> selectItem(id));
  return row;
}

function renderDetailPane(){
  const item = ITEMS[state.selectedItem];
  const body = $('#detailBody');
  const audioBar = $('#audioBar');
  const tipCallout = $('#tipCallout');

  if(!item){
    $('#detailHeadTitle').textContent = '—';
    body.innerHTML = `<div class="empty-state">${iconSvg('heart',30)}<div>Select a du'a or dhikr to read it here.</div></div>`;
    audioBar.innerHTML=''; tipCallout.innerHTML='';
    return;
  }

  $('#detailHeadTitle').textContent = item.title;
  const isBm = state.bookmarks.has(state.selectedItem);
  $('#detailBmBtn').classList.toggle('saved', isBm);

  if(item.isPointer){
    body.innerHTML = `
      <div class="detail-title">${item.title}</div>
      <div class="detail-ref">${item.subtitle}</div>
      <div class="detail-orn"></div>
      <div class="pointer-box">
        ${iconSvg('book',26)}
        <p style="margin-top:10px;">${item.pointerNote}</p>
      </div>
    `;
  } else if(item.parts){
    body.innerHTML = `
      <div class="detail-title">${item.title}</div>
      <div class="detail-ref">${item.subtitle}</div>
      <div class="detail-orn"></div>
      ${item.parts.map(p=>`
        <div class="dd-part">
          <div class="dd-part-label">${p.label}</div>
          <div class="dd-arabic" style="margin-bottom:10px;">${p.arabic}</div>
          <div class="dd-translit" style="margin-bottom:8px;">${p.translit}</div>
          <div class="dd-translation">${p.translation}</div>
        </div>
      `).join('')}
      <div class="ref-box"><span class="ref-icon">${iconSvg('bookstand',15)}</span><p>${item.reference}</p></div>
    `;
  } else {
    body.innerHTML = `
      <div class="detail-title">${item.title}</div>
      <div class="detail-ref">${item.subtitle}</div>
      <div class="detail-orn"></div>
      <div class="dd-section"><div class="dd-section-label">Arabic</div><div class="dd-arabic">${item.arabic}</div></div>
      <div class="dd-section"><div class="dd-section-label">Transliteration</div><div class="dd-translit">${item.translit}</div></div>
      <div class="dd-section"><div class="dd-section-label">Translation</div><div class="dd-translation">${item.translation}</div></div>
      <div class="dd-section-label">Reference &amp; Source</div>
      <div class="ref-box"><span class="ref-icon">${iconSvg('bookstand',15)}</span><p>${item.reference}</p></div>
    `;
  }

  audioBar.innerHTML = '';
  tipCallout.innerHTML = '';
}

function renderAll(){
  renderCategories();
  renderItemsPane();
  renderDetailPane();
}

/* ============================================================
   Actions
   ============================================================ */
function selectCategory(id){
  state.selectedCategory = id;
  state.hasUserSelectedCategory = true;
  state.favoritesMode = false;
  const cat = getCategory(id);
  state.selectedItem = cat.items[0] || null;
  state.mobilePane = 'items';
  document.body.dataset.mobilePane = 'items';
  renderAll();
}

function selectItem(id){
  state.selectedItem = id;
  state.mobilePane = 'detail';
  document.body.dataset.mobilePane = 'detail';
  renderAll();
}

function stepItem(dir){
  const ids = state.favoritesMode ? Array.from(state.bookmarks) : getCategory(state.selectedCategory).items;
  const idx = ids.indexOf(state.selectedItem);
  if(idx===-1) return;
  const next = ids[idx+dir];
  if(next){ state.selectedItem = next; renderAll(); }
  else showToast(dir>0 ? "That's the last item in this list." : "That's the first item in this list.");
}

function toggleBookmark(id){
  if(state.bookmarks.has(id)){ state.bookmarks.delete(id); showToast('Removed from favourites'); }
  else { state.bookmarks.add(id); showToast('Saved to favourites'); }
  persistDua();
  renderAll();
}

function showFavorites(){
  state.favoritesMode = true;
  state.selectedItem = state.bookmarks.size ? Array.from(state.bookmarks)[0] : null;
  state.mobilePane = 'items';
  document.body.dataset.mobilePane = 'items';
  renderAll();
}

function setTheme(mode){
  const order=['light','sepia','dark'];
  const next = mode || order[(order.indexOf(document.body.getAttribute('data-theme'))+1)%order.length];
  document.body.setAttribute('data-theme', next);
}

/* ============================================================
   PAGE :: wire up + init
   ============================================================ */
// Auto-opens whichever of the first four categories (Morning, Evening,
// Salah and After Salah, Before Sleep and Tahajjud) best matches the
// time of day at the signed-in user's saved location — only runs for
// signed-in users with a saved location; everyone else keeps the
// existing static default.
async function applyTimeBasedCategory(){
  try{
    // Reuse the already-loaded Prayer Times store. The old implementation
    // made a second Aladhan request just to choose a Du'a category, even
    // though PrayerTimes had already fetched the same day's timings.
    let t = window.PrayerTimesAPI?.getState?.().timings || null;
    if(!t) return;

    const parse = (hhmm)=>{
      if(!hhmm) return null;
      const [h,m] = hhmm.split(' ')[0].split(':').map(Number);
      const dd = new Date(); dd.setHours(h,m,0,0); return dd;
    };

    const times = {
      Fajr: parse(t.Fajr), Dhuhr: parse(t.Dhuhr),
      Asr: parse(t.Asr), Maghrib: parse(t.Maghrib), Isha: parse(t.Isha)
    };

    const now = new Date();
    const WINDOW_MS = 30*60*1000; // within 30 min of a prayer counts as "at salah"

    const nearAnyPrayer = ['Fajr','Dhuhr','Asr','Maghrib','Isha'].some(p=>{
      const pt = times[p];
      return pt && Math.abs(now - pt) <= WINDOW_MS;
    });

    let category;
    if(nearAnyPrayer){
      category = 'salah';
    } else if(times.Isha && times.Fajr && (now >= times.Isha || now < times.Fajr)){
      category = 'sleep';
    } else if(times.Fajr && times.Dhuhr && now >= times.Fajr && now < times.Dhuhr){
      category = 'morning';
    } else if(times.Asr && times.Isha && now >= times.Asr && now < times.Isha){
      category = 'evening';
    } else if(times.Dhuhr && times.Asr && now >= times.Dhuhr && now < times.Asr){
      // Between Dhuhr and Asr — no dedicated midday category, lean
      // toward whichever adjacent window is closer in time.
      category = (times.Asr - now) < (now - times.Dhuhr) ? 'evening' : 'morning';
    }

    if(category){
      state.selectedCategory = category;
      const cat = getCategory(category);
      if(cat) state.selectedItem = cat.items[0] || null;
    }
  }catch(e){
    // Silent — keeps the existing static default category on any failure.
  }
}

async function init(){
  // Paint immediately with local defaults. Backend bookmarks hydrate after
  // the first frame, and the category resolver only runs when Du'a is the
  // page the user is actually viewing.
  renderAll();
  loadDuaFromBackend().then(renderAll).catch(()=>0);
  const hydrateCategory = ()=>applyTimeBasedCategory().then(()=>renderAll()).catch(()=>0);
  const duaPage = document.getElementById('page-dua');
  if(duaPage && !duaPage.classList.contains('hidden')) setTimeout(hydrateCategory, 0);
  document.addEventListener('wwp-page-shown', function(e){
    if(e.detail && e.detail.id === 'dua') setTimeout(hydrateCategory, 0);
  });

  $('#viewFavoritesBtn').addEventListener('click', showFavorites);
  $('#catFavToggle').addEventListener('click', showFavorites);

  $('#backToCategories').addEventListener('click', ()=>{ state.mobilePane='categories'; document.body.dataset.mobilePane='categories'; });
  $('#backToItems').addEventListener('click', ()=>{ state.mobilePane='items'; document.body.dataset.mobilePane='items'; });

  $('#detailBmBtn').addEventListener('click', ()=> toggleBookmark(state.selectedItem));
  $('#detailShareBtn').addEventListener('click', ()=>{
    const item = ITEMS[state.selectedItem];
    const text = `${item.title} — WhereWePraying?`;
    Platform.share({title:"Du'a & Dhikr", text}, ()=>{
      navigator.clipboard?.writeText(text).then(()=>showToast('Link copied — share it with others')).catch(()=>showToast('Sharing is not available on this device'));
    });
  });
  $('#detailMoreBtn').addEventListener('click', ()=> showToast('More options — coming soon'));


  // ==> CONNECT: swap ITEMS/CATEGORIES for a verified, sourced content
  // API; wire the audio bar to a real reciter/audio source; link the
  // "Surah al-Sajdah & Surah al-Mulk" pointer through to the Qur'an
  // section once both are part of the same app shell.
}

// Cross-page deep link: lets other pages (e.g. the Qur'an page's
// "Explore more" shortcuts) jump straight to a specific category/item.
window.WWP_openDua = function(categoryId, itemId){
  if(categoryId) selectCategory(categoryId);
  if(itemId) selectItem(itemId);
  window.switchPage('dua');
};

init();

})();

