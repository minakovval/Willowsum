/**
 * Roles and permissions of a space (00-general, «Ролі і права», «Область доступу»; П-5, П-24). One
 * point of permission checks for every module: a route names a permission, and this table says which
 * roles hold it. A member restricted by scope only reads, whatever the role.
 *
 * PoC has one user per space (its Owner); the full matrix is here from the start (П-24).
 */
export const ROLES = ["owner", "admin", "editor", "viewer", "advisor"] as const;
export type Role = (typeof ROLES)[number];

const ALL: readonly Role[] = ROLES;
const OWNER_ADMIN_EDITOR: readonly Role[] = ["owner", "admin", "editor"];
const OWNER_ADMIN: readonly Role[] = ["owner", "admin"];
const OWNER: readonly Role[] = ["owner"];

/**
 * Permission key → roles that hold it (matrix rows of 00-general §0.3). Advisor rights granted by a client
 * (v2) are not modelled yet: the advisor reads only.
 */
export const PERMISSIONS = {
  /** Перегляд даних простору (a scoped member: within scope). */
  "household.data.read": ALL,
  /** Створення і редагування записів. */
  "household.data.write": OWNER_ADMIN_EDITOR,
  /** Вибуття активу. */
  "assets.dispose": OWNER_ADMIN_EDITOR,
  /** Видалення активу в кошик. */
  "assets.trash": OWNER_ADMIN,
  /** Керування групами активів. */
  "assets.groups.manage": OWNER_ADMIN,
  /** Точна адреса і координати локацій. */
  "locations.exact.read": OWNER_ADMIN,
  /** Запрошення і зміна ролей (Admin: not Owner or Admin). */
  "members.manage": OWNER_ADMIN,
  /** Призначення ролей Owner і Admin. */
  "members.assign-privileged": OWNER,
  /** Налаштування scope інших учасників і політики видимості. */
  "scope.manage": OWNER_ADMIN,
  /** Підписка і білінг. */
  "billing.manage": OWNER,
  /** Передача власності, видалення простору. */
  "household.transfer": OWNER,
  /** Повний експорт простору. */
  "export.full": OWNER_ADMIN,
  /** Експорт звітів. */
  "export.reports": OWNER_ADMIN,
  /** Журнал аудиту простору. */
  "audit.read": OWNER_ADMIN,
  /** Скасування звірки з банком. */
  "bank.reconciliation.undo": OWNER_ADMIN_EDITOR,
  /** Погодження доступу підтримки (break-glass). */
  "support.access.approve": OWNER_ADMIN,
  /** Налаштування тайм-ауту сесій простору. */
  "session.timeout.manage": OWNER,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** What a scoped member may do: read within the scope (areas closed by the visibility policy come later). */
const SCOPED_ALLOWED: ReadonlySet<Permission> = new Set<Permission>(["household.data.read"]);

export interface Member {
  readonly role: string;
  readonly scoped: boolean;
}

function isRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

function isPermission(permission: string): permission is Permission {
  return Object.hasOwn(PERMISSIONS, permission);
}

/** Does this member hold the permission? An unknown role or permission holds nothing. */
export function can(member: Member, permission: string): boolean {
  if (!isRole(member.role) || !isPermission(permission)) return false;
  if (member.scoped && !SCOPED_ALLOWED.has(permission)) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(member.role);
}

/** Every permission the member holds, in catalogue order. */
export function permissionsOf(member: Member): Permission[] {
  return PERMISSION_KEYS.filter((p) => can(member, p));
}
