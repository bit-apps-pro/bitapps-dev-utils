#!/usr/bin/env node

/* eslint-disable no-console */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { exit } from 'node:process'
import { program } from 'commander'

import fse from 'fs-extra'
import { globSync, hasMagic } from 'glob'
import { commandExistsSync, copyFilesAndFolders, exitIfNotLinux } from '../utils/build-helpers.mjs'

program
  .name('generate-free-build')
  .description('Generate a free build for the plugin')
  .option('-o, --outdir <char>', 'specify output directory, where the build will be generated')
  .option('-z --zip', 'specify if you want to generate zip file', false)
  .option(
    '-cb --cleanbuild',
    'specify if you want to delete the directory after generating the build',
    false,
  )
  .option('-ni --noi18n', 'specify if you do not want to generate i18n files', false)
  .option('-nb --nobuild', 'specify if you do not want to build frontend', false)
  .option(
    '-d, --delete <pattern>',
    'remove from build output before zip (repeatable): a path, a glob (without a "/" it matches at any depth, e.g. *.map) or a /regex/flags tested against the whole relative path',
    (v, a) => a.concat(v),
    [],
  )
  .requiredOption('-s --slug <char>', 'specify the plugin slug')
  .requiredOption('-pr --pro', 'specify if you want to generate pro build', false)
  .parse()

const { outdir, slug: pluginSlug, zip, cleanbuild, pro, noi18n, nobuild, delete: deletePaths } = program.opts()

if (!noi18n || zip) {
  exitIfNotLinux()
}

const outputDirectory = outdir ? `${outdir}/${pluginSlug}` : pluginSlug

console.log('options passed :', {
  outdir,
  pluginSlug,
  zip,
  outputDirectory,
  cleanbuild,
  pro,
  nobuild,
  noi18n,
  deletePaths,
})

// validate --delete patterns up front so a typo fails before the slow build, not after it
const deleteRules = deletePaths.map((pattern) => {
  const regex = pattern.match(/^\/(.+)\/([dgimsuvy]*)$/)
  if (regex) {
    try {
      // drop g and y: both make test() stateful via lastIndex, so matches would depend on the previous path
      return { pattern, regex: new RegExp(regex[1], regex[2].replace(/[gy]/g, '')) }
    }
    catch (error) {
      console.error(`❌ Invalid --delete regex "${pattern}": ${error.message}`)
      exit(1)
    }
  }
  if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..')) {
    console.error(`❌ Invalid --delete pattern "${pattern}": must be relative to the build output and not contain ".."`)
    exit(1)
  }
  return { pattern }
})

if (nobuild || noi18n) {
  console.log(
    '⚠️ Skipping build or i18n generation ? Be sure to have the latest build and i18n files in the assets folder',
  )
}

let filesAndFolders = [
  'assets',
  'backend',
  'languages',
  `${pluginSlug}.php`,
  'readme.txt',
  'composer.json',
]
if (pro) {
  filesAndFolders = [
    'pro/assets',
    'pro/backend',
    `pro/${pluginSlug}.php`,
    'pro/readme.txt',
    'pro/composer.json',
  ]
}

console.log('🚀🚀🚀 Generating free build...')

if (
  !commandExistsSync('composer --version')
  || !commandExistsSync('php --version')
  || (zip && !commandExistsSync('zip --version'))
) {
  exit()
}

// create and empty the output directory and zip file
await Promise.all([fse.emptyDir(outputDirectory), fse.remove(`${outputDirectory}.zip`)]).catch((error) => {
  console.error(error)
  exit()
})

// generate i18n files
if (!noi18n)
  execSync('pnpm i18n', { stdio: 'inherit' })

const proPluginSlug = pro ? pluginSlug : `${pluginSlug}-pro`

// check pro symlink exists or create it
if (!fs.existsSync(path.resolve('../', proPluginSlug))) {
  console.log('Creating symlink for pro plugin', path.resolve('pro'))
  fs.symlinkSync(path.resolve('pro'), path.resolve('../', proPluginSlug))
}

// build frontend
if (!nobuild)
  execSync('pnpm run build:silent', { stdio: 'inherit' })

await copyFilesAndFolders(filesAndFolders, outputDirectory)

// execute command inside bit-pi folder
execSync('composer install --no-dev', { cwd: outputDirectory, stdio: 'inherit' })
execSync('composer dump-autoload -o', { cwd: outputDirectory, stdio: 'inherit' })

// remove composer.lock
fse.remove(`${outputDirectory}/composer.lock`)

const realOutputDirectory = fs.realpathSync(outputDirectory)

// `**` alone does not descend into symlinked folders, but `a/**/b` follows one level,
// so every match is checked against the real (symlink-resolved) location of its parent
function isInsideOutputDirectory(p) {
  const realParent = fs.realpathSync(path.dirname(path.resolve(realOutputDirectory, p)))
  return realParent === realOutputDirectory || realParent.startsWith(`${realOutputDirectory}${path.sep}`)
}

function findDeleteMatches({ pattern, regex }) {
  const options = { cwd: realOutputDirectory, dot: true, posix: true }
  const matches = regex
    ? globSync('**', options).filter(p => regex.test(p))
    : globSync(pattern, { ...options, matchBase: !pattern.includes('/') && hasMagic(pattern) })
  return matches.filter(p => p !== '.')
}

// match and check everything before deleting anything, so a bad match never leaves a half-cleaned build
const pathsToDelete = new Set()
for (const rule of deleteRules) {
  const matches = findDeleteMatches(rule)
  if (!matches.length)
    console.warn(`⚠️  --delete "${rule.pattern}" matched nothing, it will stay in the build`)
  for (const p of matches) {
    if (isInsideOutputDirectory(p))
      pathsToDelete.add(p)
    else
      console.warn(`⚠️  --delete "${rule.pattern}": skipping ${p}, it is a symlink target outside the build`)
  }
}

// drop paths inside a folder that is already being removed, so parallel removes never race on the same tree
const topLevelPathsToDelete = [...pathsToDelete].filter((p) => {
  const segments = p.split('/')
  return !segments.slice(1).some((_, i) => pathsToDelete.has(segments.slice(0, i + 1).join('/')))
})

if (topLevelPathsToDelete.length)
  console.log('🗑️  Removing from build:', topLevelPathsToDelete)

await Promise.all(topLevelPathsToDelete.map(p => fse.remove(path.resolve(realOutputDirectory, p))))

// create zip file
if (zip)
  execSync(`zip -r ${pluginSlug}.zip ${pluginSlug}`, { stdio: 'inherit', cwd: outdir })

// remove bit-pi folder
if (cleanbuild)
  fse.removeSync(outputDirectory)
