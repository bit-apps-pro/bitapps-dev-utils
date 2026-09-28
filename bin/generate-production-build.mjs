#!/usr/bin/env node

/* eslint-disable no-console */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { exit } from 'node:process'
import { program } from 'commander'

import fse from 'fs-extra'
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
    'remove from build output before zip (repeatable): a path, a glob or a /regex/flags, relative to the build output',
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

const resolvedOutputDirectory = path.resolve(outputDirectory)

// `*` and `?` match within one path segment, `**` across segments; everything else is literal
function globToRegExp(glob) {
  const source = glob
    .replace(/^\.\//, '')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\/|\*\*|\*|\?/g, token => ({ '**/': '(?:.*/)?', '**': '.*', '*': '[^/]*', '?': '[^/]' })[token])
  return new RegExp(`^${source}$`)
}

// an existing path is used as-is; otherwise `/regex/flags` or a glob is tested
// against every path in the build output (posix separators)
function matchDeletePattern(pattern) {
  if (fs.existsSync(path.resolve(resolvedOutputDirectory, pattern)))
    return [pattern]
  const regex = pattern.match(/^\/(.+)\/([dgimsuvy]*)$/)
  const re = regex ? new RegExp(regex[1], regex[2].replace('g', '')) : globToRegExp(pattern)
  return fs.readdirSync(resolvedOutputDirectory, { recursive: true })
    .map(p => p.split(path.sep).join('/'))
    .filter(p => re.test(p))
}

const matchedDeletePaths = [...new Set(deletePaths.flatMap(matchDeletePattern))]
if (matchedDeletePaths.length)
  console.log('🗑️  Removing from build:', matchedDeletePaths)

await Promise.all(
  matchedDeletePaths.map(async (p) => {
    const resolvedPath = path.resolve(resolvedOutputDirectory, p)
    if (!resolvedPath.startsWith(`${resolvedOutputDirectory}${path.sep}`)) {
      throw new Error(`Safety check failed: Attempted to delete path outside of output directory: ${p}`)
    }
    await fse.remove(resolvedPath)
  }),
)

// create zip file
if (zip)
  execSync(`zip -r ${pluginSlug}.zip ${pluginSlug}`, { stdio: 'inherit', cwd: outdir })

// remove bit-pi folder
if (cleanbuild)
  fse.removeSync(outputDirectory)
