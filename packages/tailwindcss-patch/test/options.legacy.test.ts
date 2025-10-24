import { describe, expect, it } from 'vitest'
import { fromLegacyOptions, fromUnifiedConfig } from '@/options/legacy'

describe('fromLegacyOptions', () => {
  it('converts legacy patcher options to the new format', () => {
    const converted = fromLegacyOptions({
      cache: {
        dir: '.cache',
        file: 'classes.json',
      },
      patch: {
        packageName: 'tailwindcss',
        overwrite: false,
        output: {
          filename: 'classes.json',
          loose: true,
          removeUniversalSelector: false,
        },
        applyPatches: {
          exportContext: true,
          extendLengthUnits: {
            units: ['rpx'],
          },
        },
        tailwindcss: {
          version: 3,
          v3: {
            cwd: './fixtures/apps/basic',
            config: './fixtures/apps/basic/tailwind.config.js',
          },
        },
      },
    })

    expect(converted.output?.file).toBe('classes.json')
    expect(converted.output?.format).toBeUndefined()
    expect(converted.output?.removeUniversalSelector).toBe(false)
    expect(converted.cache).toMatchObject({
      enabled: true,
      dir: '.cache',
    })
    expect(converted.features?.extendLengthUnits).toMatchObject({
      units: ['rpx'],
    })
    expect(converted.tailwind?.version).toBe(3)
    expect(converted.tailwind?.v3?.cwd).toBe('./fixtures/apps/basic')
  })
})

describe('fromUnifiedConfig', () => {
  it('maps unified registry options to patcher options', () => {
    const converted = fromUnifiedConfig({
      output: {
        file: 'classes.json',
        pretty: false,
        stripUniversalSelector: false,
      },
      tailwind: {
        version: 4,
        package: 'tailwindcss',
        resolve: {
          paths: ['node_modules'],
        },
        next: {
          cssEntries: ['src/styles.css'],
        },
      },
    })

    expect(converted.output).toEqual({
      file: 'classes.json',
      pretty: false,
      removeUniversalSelector: false,
    })
    expect(converted.tailwind).toEqual({
      version: 4,
      packageName: 'tailwindcss',
      resolve: {
        paths: ['node_modules'],
      },
      config: undefined,
      cwd: undefined,
      v2: undefined,
      v3: undefined,
      v4: {
        cssEntries: ['src/styles.css'],
      },
    })
  })
})
