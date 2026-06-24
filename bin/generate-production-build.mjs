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
  .option('-d, --delete <path>', 'remove from build output before zip', (v, a) => a.concat(v), [])
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
await Promise.all(
  deletePaths.map(async (p) => {
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
