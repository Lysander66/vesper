/** 测试的数据目录指向临时目录，必须在 `config` 加载前设置。 */

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.VESPER_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'vesper-test-'))
