import { Icon, type IconName } from "./Icon.tsx";

/**
 * DS-12@PoC item 13: an icon with its label under it. The icon keeps its 24 px; a long label wraps onto the next
 * line under the icon and never runs over it. The label is the name: the icon is decorative (item 6). The consumer
 * wraps the tile in the link or button that acts.
 */
export function IconTile({ icon, label }: { icon: IconName; label: string }) {
  return (
    <span className="ws-icon-tile">
      <Icon name={icon} size={24} />
      <span className="ws-icon-tile-label">{label}</span>
    </span>
  );
}
