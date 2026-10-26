const fs = require('fs');
const path = require('path');

const fontsDir = path.join(__dirname, '..', 'public', 'fonts');
if (!fs.existsSync(fontsDir)) {
  fs.mkdirSync(fontsDir, { recursive: true });
}

const copyFont = (srcPath, destFilename) => {
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(fontsDir, destFilename));
    return true;
  }
  console.warn(`Font not found: ${srcPath}`);
  return false;
};

// 1. Fraunces Variable
const frauncesBasePath = path.join(__dirname, '..', 'node_modules', '@fontsource-variable', 'fraunces', 'files');
copyFont(path.join(frauncesBasePath, 'fraunces-latin-wght-normal.woff2'), 'fraunces-latin-wght-normal.woff2');
copyFont(path.join(frauncesBasePath, 'fraunces-latin-ext-wght-normal.woff2'), 'fraunces-latin-ext-wght-normal.woff2');

// 2. Noto Serif Tamil
const notoBasePath = path.join(__dirname, '..', 'node_modules', '@fontsource', 'noto-serif-tamil', 'files');
const notoWeights = [400, 600, 700];
for (const w of notoWeights) {
  copyFont(path.join(notoBasePath, `noto-serif-tamil-tamil-${w}-normal.woff2`), `noto-serif-tamil-tamil-${w}-normal.woff2`);
  copyFont(path.join(notoBasePath, `noto-serif-tamil-latin-${w}-normal.woff2`), `noto-serif-tamil-latin-${w}-normal.woff2`);
  copyFont(path.join(notoBasePath, `noto-serif-tamil-latin-ext-${w}-normal.woff2`), `noto-serif-tamil-latin-ext-${w}-normal.woff2`);
}

// 3. Hind Madurai
const hindBasePath = path.join(__dirname, '..', 'node_modules', '@fontsource', 'hind-madurai', 'files');
const hindWeights = [400, 500, 600, 700];
for (const w of hindWeights) {
  copyFont(path.join(hindBasePath, `hind-madurai-tamil-${w}-normal.woff2`), `hind-madurai-tamil-${w}-normal.woff2`);
  copyFont(path.join(hindBasePath, `hind-madurai-latin-${w}-normal.woff2`), `hind-madurai-latin-${w}-normal.woff2`);
  copyFont(path.join(hindBasePath, `hind-madurai-latin-ext-${w}-normal.woff2`), `hind-madurai-latin-ext-${w}-normal.woff2`);
}

// Unicode ranges
const UNICODE_TAMIL = 'U+0964-0965, U+0B82-0BFA, U+200C-200D, U+20B9, U+25CC';
const UNICODE_LATIN = 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';
const UNICODE_LATIN_EXT = 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF';

let css = `/* Self-hosted fonts for Digital Menu */

/* Fraunces Variable (Headings - Latin) */
@font-face {
  font-family: 'Fraunces Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url('/fonts/fraunces-latin-wght-normal.woff2') format('woff2-variations');
  unicode-range: ${UNICODE_LATIN};
}
@font-face {
  font-family: 'Fraunces Variable';
  font-style: normal;
  font-display: swap;
  font-weight: 100 900;
  src: url('/fonts/fraunces-latin-ext-wght-normal.woff2') format('woff2-variations');
  unicode-range: ${UNICODE_LATIN_EXT};
}
`;

// Noto Serif Tamil
for (const w of notoWeights) {
  css += `
/* Noto Serif Tamil (Headings - Tamil & fallback Latin) weight ${w} */
@font-face {
  font-family: 'Noto Serif Tamil';
  font-style: normal;
  font-display: swap;
  font-weight: ${w};
  src: url('/fonts/noto-serif-tamil-tamil-${w}-normal.woff2') format('woff2');
  unicode-range: ${UNICODE_TAMIL};
}
@font-face {
  font-family: 'Noto Serif Tamil';
  font-style: normal;
  font-display: swap;
  font-weight: ${w};
  src: url('/fonts/noto-serif-tamil-latin-${w}-normal.woff2') format('woff2');
  unicode-range: ${UNICODE_LATIN};
}
@font-face {
  font-family: 'Noto Serif Tamil';
  font-style: normal;
  font-display: swap;
  font-weight: ${w};
  src: url('/fonts/noto-serif-tamil-latin-ext-${w}-normal.woff2') format('woff2');
  unicode-range: ${UNICODE_LATIN_EXT};
}
`;
}

// Hind Madurai
for (const w of hindWeights) {
  css += `
/* Hind Madurai (Body & Prices - Tamil & Latin) weight ${w} */
@font-face {
  font-family: 'Hind Madurai';
  font-style: normal;
  font-display: swap;
  font-weight: ${w};
  src: url('/fonts/hind-madurai-tamil-${w}-normal.woff2') format('woff2');
  unicode-range: ${UNICODE_TAMIL};
}
@font-face {
  font-family: 'Hind Madurai';
  font-style: normal;
  font-display: swap;
  font-weight: ${w};
  src: url('/fonts/hind-madurai-latin-${w}-normal.woff2') format('woff2');
  unicode-range: ${UNICODE_LATIN};
}
@font-face {
  font-family: 'Hind Madurai';
  font-style: normal;
  font-display: swap;
  font-weight: ${w};
  src: url('/fonts/hind-madurai-latin-ext-${w}-normal.woff2') format('woff2');
  unicode-range: ${UNICODE_LATIN_EXT};
}
`;
}

fs.writeFileSync(path.join(fontsDir, 'fonts.css'), css.trim() + '\n', 'utf8');
console.log('Fonts setup complete! Generated public/fonts/fonts.css');
