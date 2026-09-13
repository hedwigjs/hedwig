import { defineConfig } from 'vitepress';

const REPO = 'https://github.com/hedwigjs/hedwig';
const BLOB = `${REPO}/blob/main/`;

/**
 * Pages under `content/` also live on GitHub, where they link to files
 * outside the site (`../../../packages/broker/README.md`). On the site those
 * paths lead nowhere, so they are rewritten to GitHub URLs at render time.
 * The same patterns are listed in `ignoreDeadLinks` — VitePress checks links
 * before this rule runs.
 */
const ESCAPES_SITE = /^(\.\.\/)+(packages|examples|README\.md|CONTRIBUTING\.md|SECURITY\.md|CHANGELOG\.md)/;

export default defineConfig({
  title: 'Hedwig',
  description: 'Contract-first messaging for the modules that make up a web application.',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', href: '/hedwig-owl.png' }],
    ['meta', { property: 'og:title', content: 'Hedwig — contract-first messaging for web modules' }],
    ['meta', { property: 'og:description', content: 'One typed API across every transport: microfrontends, iframes, workers, tabs, backends.' }],
  ],

  // Files keep their place in the repository (READMEs link to them); the
  // site serves them under readable paths.
  rewrites: {
    'content/spec/README.md': 'spec/index.md',
    'content/spec/:page': 'spec/:page',
    // Only the `content/` prefix is dropped — folder names stay, so the
    // relative links these pages use between each other keep resolving.
    'content/guides/:page': 'guides/:page',
  },
  srcExclude: [
    'content/guides/README.md',      // the sidebar is the index now
    'content/rfcs/**',              // design history: read it in the repository
    'content/guides/demo-architecture.md', // retired; RFC 0002 in the repo points at it
    'content/api/README.md',         // reference comes from the package READMEs
    'content/introduction/README.md',
    '**/node_modules/**',
  ],
  ignoreDeadLinks: [ESCAPES_SITE],

  markdown: {
    config(md) {
      md.core.ruler.push('externalize_repo_links', (state) => {
        for (const token of state.tokens) {
          for (const child of token.children ?? []) {
            if (child.type !== 'link_open') continue;
            const i = child.attrIndex('href');
            if (i < 0) continue;
            const href = child.attrs![i][1];
            if (!ESCAPES_SITE.test(href)) continue;
            child.attrs![i][1] = BLOB + href.replace(/^(\.\.\/)+/, '');
          }
        }
      });
    },
  },

  // `docs/assets/` is the site's public dir: the owl keeps the path the root
  // README links to, and is served at `/hedwig-owl.png`.
  vite: { publicDir: 'assets' },

  themeConfig: {
    logo: '/hedwig-owl.png',
    nav: [
      { text: 'Guide', link: '/guides/getting-started' },
      { text: 'Spec', link: '/spec/' },
      // Straight to the running app, in its own tab — the annotated page
      // with the walkthrough stays in the sidebar and on the landing.
      { text: 'Demo', link: 'https://hedwigjs.com/demo/advanced/', target: '_blank', rel: 'noreferrer' },
      {
        text: 'Packages',
        items: [
          { text: '@hedwigjs/client', link: `${BLOB}packages/client/README.md` },
          { text: '@hedwigjs/broker', link: `${BLOB}packages/broker/README.md` },
          { text: '@hedwigjs/devtools', link: `${BLOB}packages/devtools/README.md` },
          { text: '@hedwigjs/react', link: `${BLOB}packages/react/README.md` },
          { text: '@hedwigjs/vue', link: `${BLOB}packages/vue/README.md` },
          { text: '@hedwigjs/create-registry', link: `${BLOB}packages/create-registry/README.md` },
        ],
      },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Getting started', link: '/guides/getting-started' },
          { text: 'Topic kinds and retention', link: '/guides/contract-based-topics' },
          { text: 'Bring your own contracts', link: '/guides/bring-your-own-contracts' },
        ],
      },
      {
        text: 'The wire',
        items: [
          { text: 'Overview', link: '/spec/' },
          { text: 'Envelope v1', link: '/spec/envelope-v1' },
          { text: 'Delivery semantics', link: '/spec/delivery-semantics' },
          { text: 'Threat model', link: '/spec/threat-model' },
          { text: 'Support matrix', link: '/spec/support-matrix' },
        ],
      },
      {
        text: 'Reference stand',
        items: [{ text: 'Live demo ↗', link: 'https://hedwigjs.com/demo/advanced/', target: '_blank', rel: 'noreferrer' }],
      },
    ],
    search: { provider: 'local' },
    socialLinks: [
      { icon: 'github', link: REPO },
      { icon: 'npm', link: 'https://www.npmjs.com/org/hedwigjs' },
    ],
    editLink: {
      pattern: `${REPO}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    footer: {
      message: 'MIT licensed. Built with VitePress.',
      copyright: `© ${new Date().getFullYear()} Hedwig`,
    },
  },
});
