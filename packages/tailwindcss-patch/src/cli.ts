import type { LegacyTailwindcssPatcherOptions } from './options/legacy'
import type {
  TailwindcssPatchOptions,
  TailwindTokenByFileMap,
  TailwindTokenLocation,
} from './types'
import process from 'node:process'

import { CONFIG_NAME, getConfig, initConfig } from '@tailwindcss-mangle/config'
import { defu } from '@tailwindcss-mangle/shared'
import cac from 'cac'
import fs from 'fs-extra'
import path from 'pathe'

import { TailwindcssPatcher } from './api/tailwindcss-patcher'
import { groupTokensByFile } from './extraction/candidate-extractor'
import logger from './logger'
import { fromLegacyOptions, fromUnifiedConfig } from './options/legacy'

const cli = cac('tw-patch')

async function loadPatchOptions(cwd: string, overrides?: TailwindcssPatchOptions) {
  const { config } = await getConfig(cwd)
  const legacyConfig = config as (typeof config) & { patch?: LegacyTailwindcssPatcherOptions['patch'] }
  const base = config?.registry
    ? fromUnifiedConfig(config.registry)
    : legacyConfig?.patch
      ? fromLegacyOptions({ patch: legacyConfig.patch })
      : {}
  const merged = defu<TailwindcssPatchOptions, TailwindcssPatchOptions[]>(overrides ?? {}, base)
  return merged
}

cli
  .command('install', 'Apply Tailwind CSS runtime patches')
  .option('--cwd <dir>', 'Working directory', { default: process.cwd() })
  .action(async (args: { cwd: string }) => {
    const options = await loadPatchOptions(args.cwd)
    const patcher = new TailwindcssPatcher(options)
    await patcher.patch()
    logger.success('Tailwind CSS runtime patched successfully.')
  })

cli
  .command('extract', 'Collect generated class names into a cache file')
  .option('--cwd <dir>', 'Working directory', { default: process.cwd() })
  .option('--output <file>', 'Override output file path')
  .option('--format <format>', 'Output format (json|lines)')
  .option('--css <file>', 'Tailwind CSS entry CSS when using v4')
  .option('--no-write', 'Skip writing to disk')
  .action(async (args: { cwd: string, output?: string, format?: 'json' | 'lines', css?: string, write?: boolean }) => {
    const overrides: TailwindcssPatchOptions = {}

    if (args.output || args.format) {
      overrides.output = {
        file: args.output,
        format: args.format,
      }
    }

    if (args.css) {
      overrides.tailwind = {
        v4: {
          cssEntries: [args.css],
        },
      }
    }

    const options = await loadPatchOptions(args.cwd, overrides)
    const patcher = new TailwindcssPatcher(options)
    const result = await patcher.extract({ write: args.write })

    if (result.filename) {
      logger.success(`Collected ${result.classList.length} classes → ${result.filename}`)
    }
    else {
      logger.success(`Collected ${result.classList.length} classes.`)
    }
  })

type TokenOutputFormat = 'json' | 'lines' | 'grouped-json'
type TokenGroupKey = 'relative' | 'absolute'
const TOKEN_FORMATS: TokenOutputFormat[] = ['json', 'lines', 'grouped-json']

cli
  .command('tokens', 'Extract Tailwind tokens with file/position metadata')
  .option('--cwd <dir>', 'Working directory', { default: process.cwd() })
  .option('--output <file>', 'Override output file path', { default: '.tw-patch/tw-token-report.json' })
  .option('--format <format>', 'Output format (json|lines|grouped-json)', { default: 'json' })
  .option('--group-key <key>', 'Grouping key for grouped-json output (relative|absolute)', { default: 'relative' })
  .option('--no-write', 'Skip writing to disk')
  .action(async (args: {
    cwd: string
    output?: string
    format?: TokenOutputFormat
    groupKey?: TokenGroupKey
    write?: boolean
  }) => {
    const options = await loadPatchOptions(args.cwd)
    const patcher = new TailwindcssPatcher(options)
    const report = await patcher.collectContentTokens()

    const shouldWrite = args.write ?? true
    let format: TokenOutputFormat = args.format ?? 'json'
    if (!TOKEN_FORMATS.includes(format)) {
      format = 'json'
    }
    const targetFile = args.output ?? '.tw-patch/tw-token-report.json'
    const groupKey: TokenGroupKey = args.groupKey === 'absolute' ? 'absolute' : 'relative'
    const buildGrouped = () =>
      groupTokensByFile(report, {
        key: groupKey,
        stripAbsolutePaths: groupKey !== 'absolute',
      })
    const grouped = format === 'grouped-json' ? buildGrouped() : null
    const resolveGrouped = () => grouped ?? buildGrouped()

    if (shouldWrite) {
      const target = path.resolve(targetFile)
      await fs.ensureDir(path.dirname(target))
      if (format === 'json') {
        await fs.writeJSON(target, report, { spaces: 2 })
      }
      else if (format === 'grouped-json') {
        await fs.writeJSON(target, resolveGrouped(), { spaces: 2 })
      }
      else {
        const lines = report.entries.map(formatTokenLine)
        await fs.writeFile(target, `${lines.join('\n')}\n`, 'utf8')
      }
      logger.success(
        `Collected ${report.entries.length} tokens (${format}) → ${target.replace(process.cwd(), '.')}`,
      )
    }
    else {
      logger.success(`Collected ${report.entries.length} tokens from ${report.filesScanned} files.`)
      if (format === 'lines') {
        const preview = report.entries.slice(0, 5).map(formatTokenLine).join('\n')
        if (preview) {
          logger.log('')
          logger.info(preview)
          if (report.entries.length > 5) {
            logger.info(`…and ${report.entries.length - 5} more.`)
          }
        }
      }
      else if (format === 'grouped-json') {
        const map = resolveGrouped()
        const { preview, moreFiles } = formatGroupedPreview(map)
        if (preview) {
          logger.log('')
          logger.info(preview)
          if (moreFiles > 0) {
            logger.info(`…and ${moreFiles} more files.`)
          }
        }
      }
      else {
        const previewEntries = report.entries.slice(0, 3)
        if (previewEntries.length) {
          logger.log('')
          logger.info(JSON.stringify(previewEntries, null, 2))
        }
      }
    }

    if (report.skippedFiles.length) {
      logger.warn('Skipped files:')
      for (const skipped of report.skippedFiles) {
        logger.warn(`  • ${skipped.file} (${skipped.reason})`)
      }
    }
  })

cli
  .command('init', 'Generate a tailwindcss-patch config file')
  .option('--cwd <dir>', 'Working directory', { default: process.cwd() })
  .action(async (args: { cwd: string }) => {
    await initConfig(args.cwd)
    logger.success(`✨ ${CONFIG_NAME}.config.ts initialized!`)
  })

cli.help()
cli.parse()

function formatTokenLine(entry: TailwindTokenLocation) {
  return `${entry.relativeFile}:${entry.line}:${entry.column} ${entry.rawCandidate} (${entry.start}-${entry.end})`
}

function formatGroupedPreview(map: TailwindTokenByFileMap, limit: number = 3) {
  const files = Object.keys(map)
  if (!files.length) {
    return { preview: '', moreFiles: 0 }
  }

  const lines = files.slice(0, limit).map((file) => {
    const tokens = map[file]
    const sample = tokens.slice(0, 3).map(token => token.rawCandidate).join(', ')
    const suffix = tokens.length > 3 ? ', …' : ''
    return `${file}: ${tokens.length} tokens (${sample}${suffix})`
  })

  return {
    preview: lines.join('\n'),
    moreFiles: Math.max(0, files.length - limit),
  }
}
