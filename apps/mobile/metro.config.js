// Metro needs to watch the monorepo root and resolve hoisted node_modules.
// See https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
// Let Metro resolve packages from the project first, then the workspace root.
//config.resolver.disableHierarchicalLookup = true
getDefaultConfig(__dirname)

module.exports = config
