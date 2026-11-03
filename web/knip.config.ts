import type { KnipConfig } from 'knip'

const config: KnipConfig = {
  // shadcn 生成的组件原样保留，未用到的导出不裁剪。
  ignore: ['badge', 'button', 'dialog', 'select', 'table'].map((name) => `src/components/ui/${name}.tsx`),
  // knip 只扫 web/，@vesper/shared 的源码在目录外，用到了也统计不到。
  ignoreDependencies: ['@vesper/shared'],
}

export default config
