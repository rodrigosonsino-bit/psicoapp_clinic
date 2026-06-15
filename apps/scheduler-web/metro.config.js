const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
    path.resolve(projectRoot, 'node_modules'),
    path.resolve(monorepoRoot, 'node_modules'),
];

// Deduplicate react packages by forcing all resolutions of react/react-dom/react-native/react-native-web
// to resolve relative to the app's index.ts, pointing to the local node_modules.
const duplicatePackages = ['react', 'react-dom', 'react-native', 'react-native-web'];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    duplicatePackages.some(
      (pkg) => moduleName === pkg || moduleName.startsWith(pkg + '/')
    )
  ) {
    return context.resolveRequest(
      {
        ...context,
        originModulePath: path.join(projectRoot, 'index.ts'),
      },
      moduleName,
      platform
    );
  }
  return context.resolveRequest(context, moduleName, platform);
};

config.resolver.extraNodeModules = {
    react: path.resolve(projectRoot, 'node_modules/react'),
    'react-dom': path.resolve(projectRoot, 'node_modules/react-dom'),
    'react-native': path.resolve(projectRoot, 'node_modules/react-native'),
};

module.exports = config;
