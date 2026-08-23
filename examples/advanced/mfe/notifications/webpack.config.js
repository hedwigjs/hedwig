const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const { ModuleFederationPlugin } = require('webpack').container;

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
      name: 'notifications',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/bootstrap.tsx',
      },
      shared: {
        react: { singleton: true, requiredVersion: '19.1.1' },
        'react-dom': { singleton: true, requiredVersion: '19.1.1' },
      },
    }),
    new HtmlWebpackPlugin({
      template: './public/index.html',
    }),
  ],
  devServer: {
    port: 3004,
    historyApiFallback: true,
    static: path.join(__dirname, 'dist'),
    hot: true,
    headers: {
      'Access-Control-Allow-Origin': '*',
    },
    client: { logging: 'warn' },
  },
};
