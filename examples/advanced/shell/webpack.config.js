const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

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
        // Add new MFEs here as they come online. Each remote is a separate
        // dev-server on its own port.
        menu: 'menu@http://localhost:3001/remoteEntry.js',
        cart: 'cart@http://localhost:3002/remoteEntry.js',
        ai_chat: 'ai_chat@http://localhost:3003/remoteEntry.js',
        notifications: 'notifications@http://localhost:3004/remoteEntry.js',
        checkout: 'checkout@http://localhost:3005/remoteEntry.js',
        analytics: 'analytics@http://localhost:3006/remoteEntry.js',
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
