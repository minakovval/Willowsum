import {
  ArrowLeftRight,
  Award,
  Baby,
  BadgePercent,
  Bike,
  Building,
  Bus,
  CarFront,
  CircleEllipsis,
  CirclePlus,
  Coffee,
  Dumbbell,
  Fuel,
  Gavel,
  Gift,
  GraduationCap,
  Hammer,
  HandCoins,
  HandHeart,
  HeartHandshake,
  KeyRound,
  Landmark,
  Laptop,
  Milestone,
  PackageOpen,
  Palette,
  PawPrint,
  Percent,
  Pill,
  Plane,
  Receipt,
  Repeat,
  Scale,
  Scissors,
  Shapes,
  Shield,
  ShieldPlus,
  Shirt,
  ShoppingCart,
  Smartphone,
  Sofa,
  SprayCan,
  Sprout,
  Stethoscope,
  Store,
  Tag,
  Ticket,
  TrendingUp,
  Wallet,
  Wifi,
  Wrench,
  Zap,
  type IconNode,
} from "lucide";
import { NodeSvg } from "./Icon.tsx";

/**
 * BUD-01@PoC FR 10: the category icons — the Lucide glyphs the system tree uses (one per system category,
 * `apps/api/src/modules/categories/domain/catalogue.ts`) and `shapes`, the icon of a new custom category. The API
 * stores the Lucide name; a name outside this set is drawn as `shapes`.
 */
export const CATEGORY_ICONS = {
  "key-round": KeyRound,
  zap: Zap,
  hammer: Hammer,
  sofa: Sofa,
  "spray-can": SprayCan,
  sprout: Sprout,
  shield: Shield,
  "shopping-cart": ShoppingCart,
  coffee: Coffee,
  bike: Bike,
  bus: Bus,
  fuel: Fuel,
  wrench: Wrench,
  "car-front": CarFront,
  milestone: Milestone,
  smartphone: Smartphone,
  wifi: Wifi,
  repeat: Repeat,
  stethoscope: Stethoscope,
  pill: Pill,
  "shield-plus": ShieldPlus,
  dumbbell: Dumbbell,
  scissors: Scissors,
  "graduation-cap": GraduationCap,
  baby: Baby,
  shirt: Shirt,
  "paw-print": PawPrint,
  gift: Gift,
  "hand-heart": HandHeart,
  ticket: Ticket,
  plane: Plane,
  palette: Palette,
  receipt: Receipt,
  landmark: Landmark,
  percent: Percent,
  "heart-handshake": HeartHandshake,
  gavel: Gavel,
  "circle-ellipsis": CircleEllipsis,
  wallet: Wallet,
  award: Award,
  store: Store,
  laptop: Laptop,
  building: Building,
  "trending-up": TrendingUp,
  "badge-percent": BadgePercent,
  "package-open": PackageOpen,
  "hand-coins": HandCoins,
  tag: Tag,
  "circle-plus": CirclePlus,
  "arrow-left-right": ArrowLeftRight,
  scale: Scale,
  shapes: Shapes,
} as const satisfies Record<string, IconNode>;

export type CategoryIconName = keyof typeof CATEGORY_ICONS;
export const CATEGORY_ICON_NAMES = Object.keys(CATEGORY_ICONS) as CategoryIconName[];

export const isCategoryIcon = (v: unknown): v is CategoryIconName =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(CATEGORY_ICONS, v);

/** `#RRGGBB` as the API sends a category colour; anything else is not put into the style. */
const RGB = /^#[0-9A-Fa-f]{6}$/;

/**
 * BUD-01@PoC FR 10, AC17: a category's icon on its coloured circle — the colour is the category's (data from the API,
 * not a design token), the icon white or dark `ink` as the API decided by the 3 : 1 contrast (`iconTone`). Decorative:
 * the category's name is always next to it.
 */
export function CategoryDisc({
  color,
  icon,
  iconTone,
  size = 24,
}: {
  color: string;
  icon: string;
  iconTone: "white" | "ink";
  /** The circle in px: 24 in rows, 32 in the icon choice. */
  size?: 24 | 32;
}) {
  const node = isCategoryIcon(icon) ? CATEGORY_ICONS[icon] : CATEGORY_ICONS.shapes;
  return (
    <span
      className="ws-category-disc"
      data-size={size}
      data-icon-tone={iconTone}
      data-icon={isCategoryIcon(icon) ? icon : "shapes"}
      style={RGB.test(color) ? { backgroundColor: color } : undefined}
      aria-hidden="true"
    >
      <NodeSvg node={node} px={size === 32 ? 20 : 16} />
    </span>
  );
}
