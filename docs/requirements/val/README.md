# VAL — module requirements

Scope: Valuation: observations, current-value policy, FX, ownership shares, net worth, map. Source: tab 2 of the Willowsum product specification.

## Module intro (from the specification tab)

Модуль описує облік фізичних активів (ядро і схеми типів, форма, життєвий цикл, номери, лоти, локації, групи, медіа, список бажаних покупок), зобов'язань і їхнього забезпечення, а також оцінку вартості: спостереження, політику поточної вартості, валюти й фіди, частки власності, головний огляд net worth, історію, прибуток, автоматичні оцінки та мапу портфеля.

Shared text of this tab (title, intro, common sections) is kept in [../ast/README.md](../ast/README.md).

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [VAL-01](VAL-01.md) | Спостереження вартості | MVP | M |
| [VAL-02](VAL-02.md) | Політика поточної вартості | MVP | M |
| [VAL-03](VAL-03.md) | Свіжість оцінки | MVP (нормативи за замовчуванням за типом активу, позначка «застаріла», пункт у списку дій і в щотижневому підсумку); v1 (налаштування нормативу для окремого активу, автоматичний фід) | S |
| [VAL-04](VAL-04.md) | Валюти та конвертація | MVP | M |
| [VAL-05](VAL-05.md) | Фіди курсів і цін | MVP (раз на добу для всіх планів); v1 (щогодини для Plus і Family) | M |
| [VAL-06](VAL-06.md) | Автоматичні ринкові оцінки | v1 | S |
| [VAL-07](VAL-07.md) | Частки володіння та власницькі структури | MVP | M |
| [VAL-08](VAL-08.md) | Історія net worth і розклад змін | v1 | S |
| [VAL-09](VAL-09.md) | Головний огляд net worth і список дій | MVP | M |
| [VAL-10](VAL-10.md) | Нереалізований прибуток | v1 | S |
| [VAL-11](VAL-11.md) | Мапа портфеля | MVP | S |
