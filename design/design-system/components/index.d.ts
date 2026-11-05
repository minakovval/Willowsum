export interface ButtonProps { label: string; variant?: "primary" | "secondary" | "quiet"; size?: "md" | "sm"; disabled?: boolean; loading?: boolean; /** Forces a state for previews */ state?: "hover" | "pressed" | "focus" | "disabled"; }
export interface FieldProps { label: string; value?: string; placeholder?: string; hint?: string; error?: string; disabled?: boolean; readOnly?: boolean; type?: string; inputMode?: "decimal" | "numeric" | "text"; id?: string; state?: "hover" | "focus"; }
export interface CardProps { title?: string; tone?: "flat" | "raised" | "sunken"; children?: unknown; }
export interface AmountProps { value: string; currency?: string; size?: "xl" | "l" | "m"; negative?: boolean; hidden?: boolean; /** auto (default): abbreviate only when the value does not fit; always */ compact?: "auto" | "always"; /** Your own short form, e.g. "€ 12,3 bn"; the full value stays in the tooltip and the accessible name */ short?: string; }
export interface DeltaProps { value: string; dir?: "up" | "down" | "flat"; period?: string; }
export interface GoalProgressProps { name: string; pct: number; caption?: string; }
export interface CheckboxProps { label: string; checked?: boolean; indeterminate?: boolean; disabled?: boolean; hint?: string; state?: "hover" | "focus"; }
export interface SwitchProps { label: string; checked?: boolean; disabled?: boolean; state?: "focus"; }
export interface SelectProps { label: string; options: { value: string; label: string }[]; value?: string; hint?: string; error?: string; disabled?: boolean; state?: "hover" | "focus"; }
export interface TabsProps { /** "pill" is a quiet row for the views of one list */ variant?: "underline" | "pill"; items: { id: string; label: string; count?: number; disabled?: boolean; state?: "hover" | "focus"; onClick?: () => void }[]; active: string; }
export interface SegmentedProps { items: { id: string; label: string; disabled?: boolean; state?: "hover" | "focus" }[]; active: string; label?: string; }
export interface BadgeProps { label: string; tone?: "positive" | "negative" | "attention" | "info" | "neutral"; }
export interface BannerProps { tone?: "info" | "warning" | "error" | "success"; title?: string; text?: string; action?: string; }
export interface ToastProps { text: string; tone?: "success" | "error" | "info"; action?: string; onAction?: () => void; /** Auto-dismiss after this many ms; the close button is always there */ duration?: number; onDismiss?: () => void; }
export interface DialogProps { title: string; text?: string; primary?: string; secondary?: string; children?: unknown; }
export interface SkeletonProps { variant?: "text" | "row" | "block"; /** Show the "still loading" line after 3 seconds */ slow?: boolean; }
export interface EmptyStateProps { title: string; text?: string; action?: string; }
export interface ErrorStateProps { title: string; text?: string; code?: string; /** After three failed retries */ contact?: boolean; }
export interface TooltipProps { text: string; }
export interface PageHeaderProps { title: string; subtitle?: string; actions?: unknown; }
export interface PaginationProps { page: number; total: number; pageSize?: 25 | 50 | 100; }
export interface StepperProps { steps: { label: string; state: "done" | "current" | "todo" }[]; label?: string; }
export interface ChecklistProps { items: { label: string; state: "done" | "todo" }[]; }
export interface CommandPaletteProps { query?: string; groups: { title: string; items: { label: string; hint?: string; active?: boolean }[] }[]; empty?: boolean; askAI?: boolean; }
export interface AvatarProps { name: string; color?: string; size?: "s" | "m" | "l"; }
export interface TableProps { columns: { key: string; label: string; align?: "left" | "right"; type?: "text" | "amount" | "badge"; /** CSS width, e.g. "30%" */ width?: string; /** Hide the column (the Columns menu) */ hidden?: boolean }[]; rows: Record<string, unknown>[]; sort?: { key: string; dir: "asc" | "desc" }; summary?: string; /** Keep rows as rows in a narrow container (inside widgets) */ flat?: boolean; }
export interface ListRowProps { title: string; meta?: string; amount?: string; negative?: boolean; delta?: DeltaProps; badge?: BadgeProps; leading?: unknown; state?: "hover" | "focus"; }
export interface TransactionRowProps { merchant: string; date?: string; category?: string; amount: string; negative?: boolean; review?: boolean; }
export interface BudgetRowProps { name: string; spent: number; limit: number; spentText?: string; limitText?: string; leftText?: string; overText?: string; }
export interface ConnectionCardProps { name: string; status: "active" | "action" | "error" | "off"; detail?: string; action?: string; }
export interface NotificationItemProps { title: string; text?: string; action?: string; time?: string; unread?: boolean; }
export interface PlanCardProps { name: string; price: string; period?: "month" | "year"; currency?: string; features: string[]; cta?: string; current?: boolean; recommended?: boolean; }
export interface DropzoneProps { state?: "idle" | "hover" | "uploading" | "error"; filename?: string; pct?: number; hint?: string; error?: string; }
export interface TreeNode { name: string; count?: number; open?: boolean; active?: boolean; children?: TreeNode[]; }
export interface TreeProps { nodes: TreeNode[]; }
export interface TimelineProps { items: { date: string; title: string; text?: string }[]; }
export interface FilterBarProps { conditions: string[]; count: number; total?: string; unsaved?: boolean; }
export interface WidgetProps { title: string; state?: "ready" | "loading" | "empty" | "error" | "upsell"; badge?: BadgeProps; children?: unknown; emptyTitle?: string; emptyText?: string; emptyAction?: string; upsellTitle?: string; upsellText?: string; code?: string; }
export interface LineChartProps { points?: number[]; series?: { name: string; points: number[]; value?: string }[]; labels?: string[]; yLabels?: string[]; min?: number; max?: number; area?: boolean; /** Series add up; layers */ stacked?: boolean; /** With more than 3 series: index of the highlighted one */ focus?: number; target?: { value: number; label?: string }; summary?: string; height?: number; }
export interface SmallMultiplesProps { items: { name: string; value?: string; points: number[]; delta?: { dir: "up" | "down" | "flat"; value: string } }[]; height?: number; }
export interface TreemapProps { items: { label: string; value: number; group?: string }[]; ratio?: number; currency?: string; summary?: string; }
export interface InvestmentChartProps { values: number[]; /** Net money in (+) or out (-) in each period */ flows: number[]; startInvested?: number; labels?: string[]; currency?: string; height?: number; flowHeight?: number; flowLabel?: string; summary?: string; }
export interface SparklineProps { points: number[]; summary?: string; height?: number; }
export interface BarChartProps { categories: { label: string; value?: number; values?: number[] }[]; series?: string[]; mode?: "grouped" | "stacked" | "percent"; orientation?: "vertical" | "horizontal"; currency?: string; showValues?: boolean; height?: number; summary?: string; }
export interface DonutChartProps { segments?: { label: string; pct: number }[]; /** Several concentric rings, outside to inside */ rings?: { name: string; segments: { label: string; pct: number }[] }[]; total?: string; centerLabel?: string; summary?: string; }
export interface RingProgressProps { pct: number; label?: string; tone?: "brand" | "accent"; size?: number; }
export interface WaterfallProps { items: { label: string; value?: number; total?: boolean }[]; currency?: string; height?: number; summary?: string; }
export interface HeatmapProps { columns: string[]; rows: { label: string; values: number[] }[]; lessLabel?: string; moreLabel?: string; summary?: string; }
export interface AllocationBarProps { segments: { label: string; pct: number }[]; }

export interface IconProps { name: string; size?: 16 | 20 | 24 | 32 | 40; tone?: "muted" | "brand" | "on-brand"; /** Needed when the icon alone carries meaning */ label?: string; }
export type AssetType = "property" | "art" | "wine" | "collectable" | "watch" | "vehicle" | "boat" | "company" | "cash" | "crypto" | "pension" | "metals";
export interface MapPoint { id: string; name: string; type: AssetType; lat: number; lng: number; value: string; address?: string; /** Exact address hidden for this viewer */ approx?: boolean; }
export interface AssetMapProps { points: MapPoint[]; selected?: string; bounds?: [number, number, number, number]; height?: number; emptyAction?: string; onSelect?: (p: MapPoint) => void; onOpen?: (p: MapPoint) => void; summary?: string; }
export interface GalleryItem { name: string; type: AssetType; value?: string; photo?: string; alt?: string; count?: number; badge?: { tone: "positive" | "negative" | "attention" | "info" | "neutral"; label: string }; }
export interface AssetGalleryProps { items: GalleryItem[]; variant?: "grid" | "featured" | "carousel"; label?: string; emptyAction?: string; onSelect?: (i: GalleryItem) => void; }
export interface PhotoGalleryProps { photos: { src?: string; alt?: string; video?: boolean }[]; name?: string; type?: AssetType; cover?: number; editable?: boolean; onExpand?: (index: number) => void; }
export interface AssetMapWidgetProps extends AssetMapProps { title?: string; badge?: { tone: string; label: string }; action?: string; state?: "ready" | "loading" | "empty" | "error" | "upsell"; }
export interface AssetGalleryWidgetProps extends AssetGalleryProps { title?: string; badge?: { tone: string; label: string }; action?: string; state?: "ready" | "loading" | "empty" | "error" | "upsell"; }

export type SummaryView = "donut" | "bars" | "treemap" | "table" | "trend";
export interface SummaryWidgetProps { title?: string; totalLabel?: string; total: string; currency?: string; delta?: { dir: "up" | "down" | "flat"; value: string; period?: string }; items: { label: string; value: number; group?: string }[]; views?: SummaryView[]; view?: SummaryView; trend?: { series: { name: string; points: number[] }[]; labels?: string[]; min?: number; max?: number; yLabels?: string[]; summary?: string }; note?: string; badge?: { tone: string; label: string }; action?: string; state?: "ready" | "loading" | "empty" | "error" | "upsell"; emptyAction?: string; onViewChange?: (view: SummaryView) => void; }
export interface AssetTypeWidgetProps { type: AssetType; title?: string; value?: string; currency?: string; delta?: { dir: "up" | "down" | "flat"; value: string; period?: string }; points?: number[]; facts?: { label: string; value?: string; badge?: { tone: "positive" | "negative" | "attention" | "info" | "neutral"; label: string } }[]; /** Type-specific data for the signature view; see the README for each type */ data?: Record<string, unknown>; items?: { name: string; note?: string; value: string }[]; count?: string; noteLabel?: string; view?: "overview" | "list"; action?: string; state?: "ready" | "loading" | "empty" | "error" | "upsell"; }


export type ProductType = "account" | "card" | "loan" | "mortgage" | "insurance-health" | "insurance-life" | "insurance-home" | "insurance-vehicle" | "insurance-travel" | "investment-public" | "investment-private" | "insurance" | "investment" | "goal" | "document" | "vault" | "wishlist" | "other";
export interface AssetPlaceholderProps { type: AssetType | ProductType; size?: "thumb" | "tile" | "large"; }

export type MenuItem = { type: "radio" | "check" | "switch" | "action" | "heading" | "sep"; id?: string; label?: string; icon?: string; checked?: boolean; on?: boolean; disabled?: boolean };
export interface MenuProps { items: MenuItem[]; label?: string; onSelect?: (item: MenuItem, items: MenuItem[]) => void; }
export interface ToolbarProps { search?: { placeholder?: string; value?: string }; sort?: { options: { id: string; label: string }[]; value: string; onChange?: (id: string) => void; open?: boolean }; view?: { items: { id: string; icon: string; label: string }[]; active: string; onChange?: (id: string) => void }; options?: { items: MenuItem[]; label?: string; onSelect?: MenuProps["onSelect"]; open?: boolean }; primary?: { label: string; menu?: { label: string; icon?: string }[]; open?: boolean }; }
export interface GroupHeaderProps { title: string; type?: AssetType | ProductType; cover?: string; currency?: string; net?: string; assets: string; liabilities: string; actions?: { label: string; icon?: string }[]; map?: { caption?: string; action?: string; x?: number; y?: number }; }
export interface FolderCardProps { name: string; counts?: { icon: string; label: string; value: number }[]; total?: string; currency?: string; state?: "default" | "selected" | "drop"; }
export interface MiniMapProps { x?: number; y?: number; action?: string; }
