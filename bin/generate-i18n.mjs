#!/usr/bin/env node

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { exitIfNotLinux, exitIfWpCliNotInstalled } from '../utils/build-helpers.mjs'

import { convertPOTToPHP } from '../utils/pot-to-php.mjs'
/**
 * Translation (i18n) Generation Commands
 *
 * How it Works:
 *  - Step 1: Extract translatable strings from .ts and .tsx files using react-gettext-parser to generate a .pot file.
 *  - Step 2: Convert the .pot file into a PHP array that contains the extracted strings.
 *  - Step 3: Extract translatable strings from PHP files, merge them with frontend strings, and generate the final .pot file using the plugin slug.
 *
 * Contributors: Script originally written by @anisurov, refactored by @arif-un.
 */
import 'dotenv/config'

const { PLUGIN_SLUG } = process.env
const execOptions = { stdio: 'inherit' }

const FRONTEND_POT_FILE = 'languages/frontend.pot'
const GETTEXT_PARSER_CONFIG = './.config/_plugin-commons/.gettext-parser.config.cjs'
const GETTEXT_PARSER_FILES_GLOB =
  './frontend/**/{*.js,*.jsx,*.ts,*.tsx} ./pro/frontend-pro/pro-module/src/**/{*.js,*.jsx,*.ts,*.tsx}'
const FRONTEND_EXTRACTED_STRINGS_PHP_FILE = 'languages/frontend-extracted-strings.php'

const POT_FILE_HEADER = JSON.stringify({
  'Last-Translator': 'Bit Apps <developer@bitapps.pro>',
  'Language-Team': 'Bit Apps <support@bitapps.pro>',
  'PO-Revision-Date': '',
})

exitIfNotLinux()
exitIfWpCliNotInstalled()

const languagesDir = resolve(process.cwd(), 'languages')
if (!existsSync(languagesDir)) mkdirSync(languagesDir)

const freePotPath = resolve(languagesDir, `${PLUGIN_SLUG}-free.pot`)
const finalPotPath = resolve(languagesDir, `${PLUGIN_SLUG}.pot`)

// Step 1: Generate POT for free (backend, assets)
execSync(
  `wp i18n make-pot  .  ${freePotPath}  --slug='${PLUGIN_SLUG}'  --ignore-domain  --include='backend,assets'  --exclude='build,dist,pro'  --headers='${POT_FILE_HEADER}'`,
  execOptions,
)

// Step 2: Generate POT for pro (source=pro so paths are backend/..., assets/... without pro/ prefix) and merge with free
execSync(
  `wp i18n make-pot  pro  ${finalPotPath}  --slug='${PLUGIN_SLUG}'  --ignore-domain  --include='backend,assets'  --exclude='build,dist'  --merge='${freePotPath}'  --headers='${POT_FILE_HEADER}'`,
  execOptions,
)
