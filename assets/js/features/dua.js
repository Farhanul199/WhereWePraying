
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
const ITEMS = {}; // populated async from /assets/data/dua.json — see loadDuaData() below

// OfflineSync (IndexedDB sync for Dua/Dhikr + Guides categories) lives in
// wwp-core.js alongside OfflineData, which it wraps — it's used by both
// this file and guides.js, so it doesn't belong owned by either feature.

window.CATEGORIES = []; // populated async from /assets/data/dua.json — see loadDuaData() below


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
  // Guard for the rare case content couldn't load at all (first-ever
  // visit with no network and nothing cached yet) — avoids a hard
  // crash; a retry (reopening the page) will fetch normally.
  if(!fav && !cat){
    $('#itemsHeadTitle').textContent = "Du'a & Dhikr";
    $('#catBanner').innerHTML = '';
    $('#itemList').innerHTML = `<div class="empty-state">${iconSvg('heart',30)}<div>Couldn't load content — check your connection and reopen this page.</div></div>`;
    return;
  }
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
  // Fix: was listening on `document`, but wwp-core.js dispatches this
  // event on `window` — different EventTarget objects, so this never
  // fired at all, meaning Du'a's time-based category never refreshed
  // when navigating here after visiting another tab first.
  window.addEventListener('wwp-page-shown', function(e){
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
      Platform.copyToClipboard(text, {onSuccess:()=>showToast('Link copied — share it with others'), onFail:()=>showToast('Sharing is not available on this device')});
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

// Fetches the Du'a & Dhikr content (previously a 144KB literal baked
// into this file) from a static JSON file instead, caching it in
// IndexedDB via WWP_fetchCached (see wwp-core.js) so it still works
// offline after the first successful load. Runs before init() — unlike
// guides.js, renderItemsPane() here has no "empty category" guard, so
// painting before CATEGORIES/ITEMS exist would throw.
async function loadDuaData(){
  try{
    const data = await window.WWP_fetchCached('/assets/data/dua.json', 'dua_data');
    if(data && data.items) Object.assign(ITEMS, data.items);
    if(data && Array.isArray(data.categories)) window.CATEGORIES.push(...data.categories);
    OfflineSync.syncCategories(window.CATEGORIES).catch(()=>0);
  }catch(err){
    console.log("Du'a content failed to load:", err);
    showToast("Couldn't load Du'a & Dhikr content — check your connection and try again");
  }
  init();
}
loadDuaData();

})();

