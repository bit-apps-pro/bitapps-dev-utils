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
 * Extracts printf-style placeholders from a string.
 *
 * Matches %s, %d, %f, %1$s, %2$d, etc. but not %% (literal percent).
 *
 * @param {string} str The string to extract placeholders from.
 * @return {string[]} An array of matched placeholders.
 */
function extractPlaceholders(str) {
  return str.match(/%(?:\d+\$)?[sdfeEgGbBoxXcu]/g) || []
}

/**
 * Converts unnumbered placeholders to numbered ones when a string has multiple placeholders.
 *
 * @param {string} str The string to process.
 * @return {string} The string with numbered placeholders.
 */
function numberPlaceholders(str) {
  const placeholders = extractPlaceholders(str)
  if (placeholders.length < 2) {
    return str
  }

  const hasNumbered = placeholders.some(p => /^%\d+\$/.test(p))
  if (hasNumbered) {
    return str
  }

  let counter = 0
  return str.replace(/%([sdfeEgGbBoxXcu])/g, (_match, type) => {
    counter++
    return `%${counter}$${type}`
  })
}

/**
 * Generates a translators comment for a translation entry containing placeholders.
 *
 * Uses extracted comments from the POT file if available, otherwise auto-generates
 * a comment describing each placeholder.
 *
 * @param {object} translation The translation entry from gettext-parser.
 * @return {string} The translators comment line (with TAB indent), or empty string if no placeholders.
 */
function generateTranslatorsComment(translation) {
  const extractedComment = translation.comments?.extracted
  if (extractedComment) {
    const comment = extractedComment.startsWith('translators:')
      ? extractedComment
      : `translators: ${extractedComment}`
    return `${TAB}/* ${comment} */`
  }

  const numberedMsgid = numberPlaceholders(translation.msgid || '')
  const numberedPlural = numberPlaceholders(translation.msgid_plural || '')
  const msgidPlaceholders = extractPlaceholders(numberedMsgid)
  const pluralPlaceholders = extractPlaceholders(numberedPlural)
  const allPlaceholders = [...new Set([...msgidPlaceholders, ...pluralPlaceholders])]

  if (allPlaceholders.length === 0) {
    return ''
  }

  const hasNumbered = allPlaceholders.some(p => /^%\d+\$/.test(p))

  let descriptions
  if (hasNumbered) {
    descriptions = allPlaceholders
      .map(p => {
        const num = p.match(/^%(\d+)\$/)?.[1]
        return num ? `${num}: placeholder value` : `${p}: placeholder value`
      })
      .join(', ')
  } else {
    descriptions = allPlaceholders
      .map(p => `${p}: placeholder value`)
      .join(', ')
  }

  return `${TAB}/* translators: ${descriptions} */`
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

    const translatorsComment = generateTranslatorsComment(translation)
    if (translatorsComment) {
      php += translatorsComment + NEWLINE
    }

    const numberedOriginal = numberPlaceholders(original)

    if (_.isEmpty(translation.msgid_plural)) {
      php += _.isEmpty(context)
        ? `${TAB}'${numberedOriginal}' => __('${numberedOriginal}', '${textdomain}')`
        : `${TAB}'${numberedOriginal}' => _x('${numberedOriginal}', '${translation.msgctxt}', '${textdomain}')`
    }
    else {
      const plural = numberPlaceholders(escapeSingleQuotes(translation.msgid_plural))

      php += _.isEmpty(context)
        ? `${TAB}'${numberedOriginal}' => _n_noop('${numberedOriginal}', '${plural}', '${textdomain}')`
        : `${TAB}'${numberedOriginal}' => _nx_noop('${numberedOriginal}',  '${plural}', '${translation.msgctxt}', '${textdomain}')`
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
