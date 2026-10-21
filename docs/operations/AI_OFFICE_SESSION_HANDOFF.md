# AI-ОФИС — текущая точка остановки

> Обновлять в конце каждой рабочей сессии и после существенного теста. Это источник правды для продолжения в новом чате. Проверено: 2026-10-21 (UTC).

## 1. Сначала сверять версии

- Репозиторий: [esv1312-crypto/Office](https://github.com/esv1312-crypto/Office)
- Основная ветка: `main`
- Последний проверенный SHA в GitHub `main`: `eb7a5bf0cc493bef3de4e3df348b2dce93559e75`
- Сообщение коммита: `Respect explicit role constraints in planner recovery`
- Последний подтверждённый production deploy Render: `dep-dbc7evl9fdbs73c4jjag`
- SHA этого deploy: `93d43b30193caf8bd4ed81399eb453019fb9995a`
- **Важно:** GitHub `main` опережает подтверждённый production deploy. Не считать новый код установленным на production, пока свежая проверка Render не подтвердит SHA/деплой.

## 2. Текущее состояние по доказательствам

### Подтверждено
- Production health endpoint ранее вернул `ok: true`, `status: online`, persistence `ready: true`.
- Последний подтверждённый Render deploy `93d43b3` завершился успешно 2026-10-21 в 08:28:13 UTC.
- На GitHub SHA `eb7a5bf` успешно завершились:
  - [Runtime smoke integration — run 39584716712](https://github.com/esv1312-crypto/Office/actions/runs/39584716712)
  - [Unit tests — run 39584716730](https://github.com/esv1312-crypto/Office/actions/runs/39584716730)
  - [PostgreSQL integration — run 39584716745](https://github.com/esv1312-crypto/Office/actions/runs/39584716745)
- Ранее live-тест четырёх сотрудников завершился успешно: все четыре задачи завершены без ошибок, но все использовали одну и ту же модель. Реальное переключение модели этим тестом не доказано.

### Ещё не доказано
- Что Render уже развернул текущий `main` SHA `eb7a5bf`.
- Живое поведение provider fallback и recovery в production.
- Фактическое переключение сотрудника на другую модель при отказе основной.
- Сквозная проверка evidence и office audit именно после свежего production deploy.

## 3. Что было последним препятствием

- Workflow `.github/workflows/office-live-runtime-smoke.yml` называется **AI-OFFICE authorized live runtime audit** и запускается вручную через `workflow_dispatch`.
- Он проверяет provider fallback, root recovery, evidence pipeline и office audit. Это не обычный локальный smoke-тест: он обращается к production и запускает диагностические сценарии.
- Платный браузерный инструмент TinyFish не был запущен из-за нулевого баланса. Ничего через него не изменялось.
- Доступный GitHub read-only fetch позволяет читать workflow/runs, но не запускает workflow вручную. Не утверждать, что live audit запущен, пока нет конкретного run ID и результата.
- Не обходить ограничение случайными тестами и не подменять live audit обычным smoke-тестом.

## 4. Следующие шаги — строго по порядку

1. **Read-only:** повторно проверить текущий SHA `main`, последние Actions runs и последний production deploy в Render.
2. Сверить SHA GitHub и Render. Если Render отстаёт, проверить события/автодеплой и определить безопасный путь синхронизации; не запускать второй deploy вслепую.
3. Когда Render подтверждённо работает на актуальном SHA, запустить именно `AI-OFFICE authorized live runtime audit` авторизованным способом.
4. Сохранить run ID, SHA, время, итог каждого check, ссылки на логи и артефакты.
5. Только после этого делать вывод о fallback/recovery. Если тест не запускался или нет evidence — статус **NOT VERIFIED**, а не PASS и не FAIL.
6. Отдельно проверить model routing: assigned model vs actual model; смену модели подтверждать только если evidence показывает, что модель действительно изменилась.

## 5. Обязательный протокол каждой рабочей сессии

Перед действиями:
- Прочитать этот файл.
- Получить свежие GitHub `main` SHA и последние workflow runs.
- Получить свежий Render deploy/SHA/status.
- Сначала выбрать актуальную версию и только затем тестировать.
- Различать локальные тесты, тесты ветки, тесты `main` и production live tests.

После каждого теста или существенного действия записать:
- UTC timestamp;
- цель и тип проверки (unit / integration / branch / main / production);
- commit SHA и ветку;
- Render deploy ID/SHA, если тест затрагивает production;
- команды/workflow и run ID;
- PASS / FAIL / NOT VERIFIED;
- конкретное evidence: ссылка на run, job logs, artifact, task ID и важные фактические поля;
- ошибки и что они означают;
- следующий конкретный шаг;
- какие изменения реально были сделаны. Не записывать намерение как выполненное действие.

Никаких секретов, токенов или их значений в журнал не помещать.

## 6. Правило продолжения в новом чате

Первое действие нового чата — перечитать этот handoff и выполнить read-only сверку GitHub ↔ Render. Не повторять тест, пока не проверены последние run ID и evidence. После работы обновить этот файл и, где возможно, приложить машинно-читаемые результаты теста как GitHub Actions artifacts. Этот документ является краткой точкой восстановления контекста, а не заменой оригинальных логов.

## Краткий итог на момент записи

**Состояние:** production ранее отвечал и последний подтверждённый deploy успешен; GitHub `main` уже новее production SHA. Unit, runtime smoke и PostgreSQL тесты на текущем `main` прошли. Production fallback/recovery audit пока не подтверждён. Следующее действие — свежая сверка SHA/деплоя, затем авторизованный live audit.
