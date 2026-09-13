const path = require("path");

/**
 * Сборка библиотеки: один CJS-файл, стили через style-loader (в рантайме), без копирования .css.
 * Peers: react, react-dom, @hedwigjs/broker — не попадают в бандл.
 */
module.exports = {
  entry: path.resolve(__dirname, "src/index.ts"),
  target: "web",
  mode: "production",
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "index.js",
    clean: true,
    library: { type: "commonjs2" },
  },
  // Peers stay outside the bundle — INCLUDING their subpaths. Listing only
  // `react` used to let webpack inline `react/jsx-runtime` from the React
  // that happened to be installed here (19), whose element factory a
  // React 18 host rejects. Any request under react/ or react-dom/ is the
  // host's copy.
  externals: [
    { "@hedwigjs/broker": "commonjs2 @hedwigjs/broker" },
    ({ request }, callback) => {
      if (/^react(-dom)?(\/.*)?$/.test(request)) return callback(null, `commonjs2 ${request}`);
      callback();
    },
  ],
  resolve: {
    extensions: [".ts", ".tsx", ".js"],
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: "ts-loader",
        exclude: /node_modules/,
        options: { transpileOnly: true },
      },
      {
        test: /\.module\.css$/i,
        use: [
          "style-loader",
          {
            loader: "css-loader",
            options: {
              esModule: true,
              modules: {
                localIdentName: "[name]__[local]--[contenthash:base64:5]",
                namedExport: false,
                exportLocalsConvention: "camelCase",
              },
            },
          },
        ],
      },
      {
        test: /\.css$/i,
        exclude: /\.module\.css$/i,
        use: ["style-loader", "css-loader"],
      },
      {
        test: /\.(png|jpg|jpeg|gif|svg|webp)$/i,
        type: "asset",
        parser: {
          // Маскот и др. встраиваем в `dist/index.js` (data: URL), иначе отдельный
          // `*.png` в dist не окажется в `public` хоста и ссылка бьёт в корень 3000.
          dataUrlCondition: { maxSize: 512 * 1024 },
        },
      },
    ],
  },
  optimization: {
    minimize: true,
  },
};
