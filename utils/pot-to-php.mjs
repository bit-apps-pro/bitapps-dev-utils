#!/usr/bin/env node

import fs from 'node:fs'
// This file is from wp-i18n tools
import gettextParser from 'gettext-parser'
import _ from 'lodash'

const TAB = '    '
const NEWLINE = '\n'

const fileHeader = [
  '<?php',
  '',
  "if ( ! defined( 'ABSPATH' ) ) {",
  `${TAB}exit;`,
  '}',
  '',
  '/* THIS IS A GENERATED FILE. DO NOT EDIT DIRECTLY. */',
  'return [',
].join(NEWLINE) + NEWLINE

const fileFooter
  = NEWLINE + ['];', '/* THIS IS THE END OF THE GENERATED FILE */'].join(NEWLINE) + NEWLINE

/**
 * Escapes single quotes.
 *
 * @param {string} input The string to be escaped.
 * @return {string} The escaped string.
 */
function escapeSingleQuotes(input) {
  return input.replaceAll('\'', String.raw`\'`)
}

/**
 * Converts a translation parsed from the POT file to lines of WP PHP.
 *
 * @param {object} translation The translation to convert.
 * @param {string} textdomain The text domain to use in the WordPress translation function call.
 * @param {string} context The context for the translation.
 * @return {string} Lines of PHP that match the translation.
 */
function convertTranslationToPHP(translation, textdomain, context = '') {
  let php = ''

  // The format of gettext-js matches the terminology in gettext itself.
  let original = translation.msgid

  if (original !== '') {
    original = escapeSingleQuotes(original)

    if (_.isEmpty(translation.msgid_plural)) {
      php += _.isEmpty(context)
        ? `${TAB}'${original}' => __('${original}', '${textdomain}')`
        : `${TAB}'${original}' => _x('${original}', '${translation.msgctxt}', '${textdomain}')`
    }
    else {
      const plural = escapeSingleQuotes(translation.msgid_plural)

      php += _.isEmpty(context)
        ? `${TAB}'${original}' => _n_noop('${original}', '${plural}', '${textdomain}')`
        : `${TAB}'${original}' => _nx_noop('${original}',  '${plural}', '${translation.msgctxt}', '${textdomain}')`
    }
  }

  return php
}

export function convertPOTToPHP(potFile, phpFile, textDomain) {
  const poContents = fs.readFileSync(potFile)
  const parsedPO = gettextParser.po.parse(poContents)

  let output = []

  for (const context of Object.keys(parsedPO.translations)) {
    const translations = parsedPO.translations[context]

    const newOutput = Object.values(translations)
      .map(translation => convertTranslationToPHP(translation, textDomain, context))
      .filter(php => php !== '')

    output = [...output, ...newOutput]
  }

  const fileOutput = fileHeader + output.join(`,${NEWLINE}${NEWLINE}`) + fileFooter

  fs.writeFileSync(phpFile, fileOutput)
}
