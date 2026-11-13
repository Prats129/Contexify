const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// The applications remain separate packages; watch only this reviewed local core.
config.watchFolders = [
  ...(config.watchFolders ?? []),
  path.resolve(__dirname, "../packages/assistant-core"),
];
module.exports = config;
