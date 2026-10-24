// Metro config: bundle .tflite models as assets and resolve the shared @lulu/core package.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const corePath = path.resolve(projectRoot, '../../packages/core');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders ?? []), corePath];
config.resolver.assetExts = [...config.resolver.assetExts, 'tflite'];
config.resolver.extraNodeModules = { ...config.resolver.extraNodeModules, '@lulu/core': corePath };
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
