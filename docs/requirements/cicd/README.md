# CICD — module requirements

Scope: CI/CD and operations requirements. Source: tab 13 of the Willowsum product specification.

## Text from the specification tab (outside individual requirements)

<!-- spec-text:begin -->
### 13.2 Вимоги до CI/CD і експлуатації

<!-- spec-text:end -->

## Requirements

| ID | Title | Release | Priority |
| --- | --- | --- | --- |
| [CICD-01](CICD-01.md) | Гілки, PR і захист основної гілки | PoC | M |
| [CICD-02](CICD-02.md) | Обов'язкові перевірки PR | PoC (E2E-тести лише на ширині 1280 px, без перевірки доступності axe); PoC v2 (E2E-тести адмін-панелі); MVP (ширини 390 і 768 px, перевірка доступності axe) | M |
| [CICD-03](CICD-03.md) | Збірка і ланцюг постачання | PoC | M |
| [CICD-04](CICD-04.md) | Середовища | PoC (одне розгорнуте середовище — production, без staging); PoC v2 (тимчасове середовище форми production для навантажувальних тестів і репетицій переходу); MVP (staging) | M |
| [CICD-05](CICD-05.md) | Розгортання в production і відкат | PoC (smoke-тести без Головної); PoC v2 (розгортання без простою, автовідкат, репетиції); MVP (smoke-тест Головної) | M |
| [CICD-06](CICD-06.md) | Прапорці функцій і поступовий випуск | PoC | M |
| [CICD-07](CICD-07.md) | Інфраструктура як код і резервні копії | PoC; PoC v2 (щоденна перевірка розбіжностей інфраструктури) | M |
| [CICD-08](CICD-08.md) | Доступ AI-агентів до середовищ | PoC; PoC v2 (дії агента в production через конвеєр) | M |
| [CICD-09](CICD-09.md) | Інциденти | MVP | M |
| [CICD-10](CICD-10.md) | Мобільні застосунки | v1-mobile | M |
| [CICD-11](CICD-11.md) | Метрики поставки | MVP | S |
| [CICD-12](CICD-12.md) | Зберігання секретів і доступів | PoC | M |
