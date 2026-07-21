// ─── ESLint config — GM3 conformance rules ────────────────────────────────────
//
// Written as .cjs rather than .json so the selector list below can be defined
// once and re-used in the `overrides` section, instead of being duplicated.
//
// The GM3 rules are WARNINGS, not errors, on purpose: the 2026-07-21 audit found
// ~1580 pre-existing violations, so turning them to errors would break the build
// on day one. `scripts/gm3-ratchet.mjs` is what gives them teeth — it counts the
// warnings and fails the build if the count goes UP. See CLAUDE.md § GM3.
//
// NOTE for anyone running eslint by hand: ESLint 8 walks UP from the working
// directory looking for an `eslint.config.js`, and switches the whole run to
// flat-config mode if it finds one anywhere — including outside the repo, e.g. a
// stray starter config in the user's home directory. That silently discards this
// file and makes every source file report "no matching configuration" (i.e. a
// clean sweep of zero problems). Always run through `npm run lint`, which pins
// ESLINT_USE_FLAT_CONFIG=false.

// Design-token rules: values that must come from ui-tokens.jsx rather than being
// typed inline at a call site.
const TOKEN_RULES = [
  {
    selector: "Property[key.name='fontSize'][value.type='Literal']",
    message: 'GM3: no literal font sizes. Use an M3 typescale role from NC_TYPE / ui-tokens.jsx.',
  },
  {
    // `inherit` is excluded: it names no typeface, it defers to the token already
    // set higher up, and flagging it would push callers toward hardcoding a stack
    // — the opposite of the point.
    selector: "Property[key.name='fontFamily'][value.type='Literal'][value.value!='inherit']",
    message: 'GM3: no hardcoded font stacks. Use NC_FONT_STACK / NC_MONO_STACK from ui-tokens.jsx.',
  },
  {
    selector: "Property[key.name='borderRadius'][value.type='Literal'][value.value>2]",
    message: 'GM3: no literal corner radii above 2px. Use the RADIUS scale from ui-tokens.jsx.',
  },
  {
    selector: "Property[key.name='transition'][value.type='Literal'][value.value=/^all\\b/]",
    message: "GM3: never 'transition: all'. Use the TRANSITION token or name the properties explicitly.",
  },
];

// Colour is split out because the palette-definition files below are allowed to
// contain raw hex — they are the declared source of truth that everything else
// is supposed to reference.
const COLOR_RULE = {
  selector: 'Literal[value=/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?([0-9a-fA-F]{2})?$/]',
  message: 'GM3: no hex color literals. Use a theme value (C.*) or an M3 semantic role.',
};

// The M3 component rule from CLAUDE.md, as enforceable selectors.
const COMPONENT_RULES = [
  {
    selector: "JSXOpeningElement[name.name='button']",
    message: 'GM3 component rule: use ActionBtn / IconBtn from m3.jsx, never a hand-coded <button>.',
  },
  {
    selector: "JSXOpeningElement[name.name='input']",
    message: 'GM3 component rule: use TextField / Checkbox / Switch / Slider from m3.jsx, never a raw <input>.',
  },
  {
    selector: "JSXOpeningElement[name.name='select']",
    message: 'GM3 component rule: use OutlinedSelect + SelectOption from m3.jsx, never a raw <select>.',
  },
  {
    selector: "JSXOpeningElement[name.name='textarea']",
    message: 'GM3 component rule: use TextField from m3.jsx, never a raw <textarea>.',
  },
];

const ALL_RULES = [...TOKEN_RULES, COLOR_RULE, ...COMPONENT_RULES];
const RULES_WITHOUT_COLOR = [...TOKEN_RULES, ...COMPONENT_RULES];

module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  plugins: ['react', 'react-hooks'],
  rules: {
    'no-undef': 'off',
    'no-unused-vars': 'warn',
    // Without these two, ESLint has no idea that `<IconBtn/>` counts as using the
    // `IconBtn` binding, so no-unused-vars reports every imported component and
    // every locally-defined component as dead. That produced ~60 false positives
    // in NerveCenter.jsx alone — enough noise to make the whole lint run
    // untrustworthy, which is a large part of how the GM3 drift went unnoticed.
    // Enabled individually rather than via plugin:react/recommended, which would
    // also switch on prop-types and a long tail of unrelated rules.
    'react/jsx-uses-vars': 'error',
    'react/jsx-uses-react': 'error',
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    'no-restricted-syntax': ['warn', ...ALL_RULES],
  },
  overrides: [
    {
      // The palette / theme definition files. Raw hex is CORRECT here — these are
      // what every other file is meant to import from, and hexToRgba() needs real
      // hex values to parse. Every other GM3 rule still applies.
      files: ['src/08-app-split/ui-tokens.jsx', 'src/01-core.js'],
      rules: { 'no-restricted-syntax': ['warn', ...RULES_WITHOUT_COLOR] },
    },
  ],
  parserOptions: {
    ecmaVersion: 2021,
    sourceType: 'module',
    ecmaFeatures: { jsx: true },
  },
  ignorePatterns: ['dist/', 'node_modules/', 'src/dev/'],
};
