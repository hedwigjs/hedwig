const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;
// Shared React version = the one this workspace installs; a literal drifted
// out of sync with Dependabot's bumps and MF warned on every page load.
const pkg = require('./package.json');

module.exports = {
  mode: 'development',
  // Standalone-режим для отдельного просмотра больше не поддерживается —
  // cart живёт только внутри shell'а через MF-экспозы.
  entry: './src/bootstrap.panel.tsx',
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
      name: 'cart',
      filename: 'remoteEntry.js',
      exposes: {
        './Panel': './src/bootstrap.panel.tsx',
        './HeaderTrigger': './src/bootstrap.headerTrigger.tsx',
        './LateMount': './src/bootstrap.lateMount.tsx',
        './RemoteRequest': './src/bootstrap.remoteRequest.tsx',
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
    port: 3002,
    historyApiFallback: true,
    static: path.join(__dirname, 'dist'),
    hot: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    client: { logging: 'warn' },
  },
};
