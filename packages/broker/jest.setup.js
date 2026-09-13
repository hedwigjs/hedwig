// tsup bakes the package version into the bundle via `define`; under
// ts-jest the identifier would fall back to '0.0.0-dev', which the SDK's
// version gate would (correctly) refuse. Define it the same way here.
globalThis.__HEDWIG_VERSION__ = require('./package.json').version;
