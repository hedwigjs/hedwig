const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

// When deploying to a single-origin host (nginx serving shell + all MFEs
// under one domain), pass MFE_REMOTES_BASE=/mfe to point every remote at
// the shared origin instead of the per-MFE dev-server ports.
const REMOTES_BASE = process.env.MFE_REMOTES_BASE ?? null;

const remoteUrl = (name, devPort) =>
  REMOTES_BASE
    ? `${name}@${REMOTES_BASE}/${name.replace('_', '-')}/remoteEntry.js`
    : `${name}@http://localhost:${devPort}/remoteEntry.js`;

module.exports = {
  mode: 'development',
  entry: './src/index.ts',
  output: {
    publicPath: 'auto',
    clean: true,
    path: path.resolve(__dirname, 'dist'),
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    // Allow ESM-style `.js` imports inside TS source (`@hedwig-demo/contracts`
    // uses them for nodenext compatibility) to resolve to the actual `.ts`
    // sibling. Only affects source imports; built artifacts stay `.js`.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        exclude: /node_modules/,
        options: { transpileOnly: true },
      },
      {
        test: /\.css$/i,
        use: [
          'style-loader',
          {
            loader: 'css-loader',
            options: {
              modules: {
                auto: /\.module\.\w+$/i,
                namedExport: false,
                exportLocalsConvention: 'camelCase',
                localIdentName: '[name]__[local]--[hash:base64:6]',
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'shell',
      remotes: {
        // Dev: each MFE is its own dev-server on a distinct port.
        // Prod: set MFE_REMOTES_BASE=/mfe (or an absolute URL) so remotes
        // resolve against a single origin — see remoteUrl() above.
        menu:          remoteUrl('menu',          3001),
        cart:          remoteUrl('cart',          3002),
        ai_chat:       remoteUrl('ai_chat',       3003),
        notifications: remoteUrl('notifications', 3004),
        checkout:      remoteUrl('checkout',      3005),
        analytics:     remoteUrl('analytics',     3006),
      },
      shared: {
        react: { singleton: true, eager: true, requiredVersion: '19.1.1' },
        'react-dom': { singleton: true, eager: true, requiredVersion: '19.1.1' },
        'single-spa': { singleton: true, eager: true, requiredVersion: '^6.0.3' },
        '@hedwigjs/broker': { singleton: true, eager: true, requiredVersion: '^0.1.0' },
        // DevTools is host-only (mounted from the shell) — no MFE consumes
        // it, but sharing keeps a single React tree in scope if anyone
        // does later.
        '@hedwigjs/devtools': { singleton: true, eager: true, requiredVersion: '^0.1.0' },
      },
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
      favicon: './public/favicon.png',
    }),
    // Bake runtime env into the bundle. EnvironmentPlugin substitutes
    // `process.env.KEY` with a literal string at build time; when the env
    // var is absent it inlines the default here, so browser bundles never
    // touch a missing `process` global at runtime.
    new (require('webpack').EnvironmentPlugin)({
      NOTIFICATIONS_WS_URL: 'ws://localhost:4000/ws/notifications',
    }),
  ],
  devServer: {
    port: 3000,
    historyApiFallback: true,
    static: [path.join(__dirname, 'dist'), path.join(__dirname, 'public')],
    hot: false,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    client: { logging: 'warn' },
  },
};
