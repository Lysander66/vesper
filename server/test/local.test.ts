import { expect, test } from 'bun:test'

import { loudnessGain } from '../src/local/ffmpeg'

test('过轻的抬到下限，过响的压到上限，限内不动', () => {
  expect(loudnessGain({ integrated: -22.4, truePeak: -11.45 }, true)).toBeCloseTo(2.4)
  expect(loudnessGain({ integrated: -9.9, truePeak: -0.34 }, true)).toBeCloseTo(-4.1)
  expect(loudnessGain({ integrated: -17, truePeak: -5 }, true)).toBe(0)
})
