# 长庚界面设计约定

token 的取值在 `src/styles/theme.css`，骨架组件在 `src/components/layout/page.tsx`。本文只写用法。

## 颜色

只提供浅色主题。业务代码只写语义 token，不写 hex，也不写 Tailwind 调色板色（`amber-500` 之类）。

| token | 用在 |
| --- | --- |
| `background` | 页面底 |
| `card` / `popover` | 卡片、浮层 |
| `foreground` / `muted-foreground` / `ink3` | 正文 / 次要文字 / 元数据与占位 |
| `line2` | 中性浅底、hover |
| `border` | 描边 |
| `primary` / `brand` | 实心主按钮、logo、选中、焦点环 |
| `accent` / `accent-foreground` | 选中项的浅橙底与文字 |
| `destructive` | 删除确认 |

**状态六档**：`ok`、`warn`、`stale`、`fail`、`idle`、`busy`，前景色与 `-bg` 底色成对使用。状态到颜色的对应只在 `src/lib/status.ts` 里写。失败一律用 `fail`，不用橙。

**主按钮**：每个区块最多一个实心按钮，给这一块的主动作，排在工具栏最前，其余用描边。会覆盖已有产物的动作（重拆、重写）不做实心。hover 一律用中性的 `line2`，不用橙。

## 字体与字号

- 正文 Inter，中文回落到 PingFang SC 或系统黑体。全局开了 `tnum`，不再逐处写 `tabular-nums`。
- `font-mono` 用于 ID、时长、计数这类元数据。
- `font-serif` 只用于首页的诗句题头，`font-cormorant` 只用于 logo。
- 字号档：`text-2xs` 元数据与状态标签，`text-xs` 辅助说明与表单标签，`text-sm` 正文、按钮、分区标题，`text-base` 弹窗标题，`text-lg` 页面 h1。
- 不写 `text-[..px]` 任意值，首页题头和 logo 除外。弹窗标题用 `DialogTitle` 的默认字号，不在调用处改。

## 圆角与阴影

- 控件 `rounded-md`，卡片和分区 `rounded-lg`，大浮层 `rounded-xl`。不写裸 `rounded`，也不写任意值。
- 卡片 `shadow-xs`，以描边为主；下拉和小浮层 `shadow-md`；弹窗、抽屉、大浮层 `shadow-lg`。

## 骨架

| 组件 | 用在 |
| --- | --- |
| `PageHeader` | 每页的页头：`lead` 放面包屑，`title` 是 h1，`meta` 放一行元数据，`actions` 靠右 |
| `Section` | 带标题栏的内容块 |
| `EmptyState` | 一整块区域为空，文案用「暂无…」；行内空态只写一行 `text-xs text-muted-foreground` |
| `LoadingState` / `Skeleton` | 首次加载。刷新时保留旧数据，不闪回骨架 |

## 控件

- **Button**：变体按分量从重到轻为 `default`、`outline`、`secondary`、`ghost`。按钮自带图标间距，图标不再加 `mr-*`。纯图标按钮要给 `title` 与 `aria-label`。
- **删除**：走 `src/components/ui/confirm.tsx` 的两档确认，要边框时传 `variant='outline'`，不用 `className='border'`。
- **状态标签**：用 `StatusChip` 或 `Badge` 的语义 variant，不手拼 `rounded-full bg-… px-…`。叠在视频画面上的角标除外。
- **开关胶囊**：用 `ToggleChip`；表单的文本字段用 `TextField`；复制用 `CopyButton`。
- **图标**：lucide，一律 `h-3.5 w-3.5`；盖在画面上的用 `h-4 w-4`。
- **低频操作**：收进卡头的「更多」菜单，hover 工具条上只留高频的三四个。

## 布局

- 顶栏 52px（`h-13`），侧栏展开 236px、收起 56px。
- 按视口算高度时写 px，如 `calc(100vh-52px)`，不用 rem：根字号是 14px，rem 换算出来的数与写下的数对不上。
- 主区内边距 `px-5 pt-4`，页内纵向间距 16px，分集页 12px。
