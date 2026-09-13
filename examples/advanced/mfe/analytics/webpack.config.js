const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;
// Shared React version = the one this workspace installs; a literal drifted
// out of sync with Dependabot's bumps and MF warned on every page load.
const pkg = require('./package.json');

module.exports = {
  mode: 'development',
  entry: './src/bootstrap.tsx',
  output: {
    publicPath: 'auto',
    clean: true,
    path: path.resolve(__dirname, 'dist'),
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
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
                // MFE-scoped prefix — different MFE workspaces have same
                // `App.module.css` filenames and same class names (`.title`),
                // and a 6-char hash of the module ident can collide across
                // remotes. Scoping the identifier by MFE name eliminates the
                // ambiguity — global styles no longer leak between remotes.
                localIdentName: 'analytics__[name]__[local]--[hash:base64:8]',
              },
            },
          },
        ],
      },
    ],
  },
  plugins: [
    new ModuleFederationPlugin({
      name: 'analytics',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/bootstrap.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: pkg.dependencies.react },
        'react-dom': { singleton: true, requiredVersion: pkg.dependencies['react-dom'] },
        // `@hedwigjs/broker` is NOT shared: the runtime is private to the
        // host. This module bundles `@hedwigjs/client` (stateless, tiny).
      },
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
  ],
  devServer: {
    port: 3006,
    historyApiFallback: true,
    static: path.join(__dirname, 'dist'),
    hot: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    client: { logging: 'warn' },
  },
};
