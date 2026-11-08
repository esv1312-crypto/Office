# AI-ОФИС — мастер-блокнот проекта

> Постоянный журнал состояния. Обновлять после каждого существенного действия, теста, изменения конфигурации и перед завершением рабочей сессии. В новом чате сначала читать этот файл, затем сверять фактическое состояние GitHub, Neon и Render.  
> Последний фактический снимок: 2026-11-08; данные Neon обновлялись до 12:56:16 UTC. Это не утверждение, что состояние осталось неизменным после указанного времени.

## 0. Правило восстановления контекста

**Не начинать разработку с нуля и не повторять уже выполненное.**

Порядок при каждом возобновлении:
1. Прочитать этот мастер-блокнот и текущий handoff.
2. Проверить актуальные ветки/коммиты и PR в GitHub.
3. Проверить Neon: активные проекты, планы, задачи, executions, artifacts, QA reviews и истёкшие leases.
4. Проверить Render: какой сервис запущен, какой commit SHA развёрнут, статус последнего deploy и последние runtime logs.
5. Сопоставить три источника. Не считать код из ветки production-кодом, а написанные тесты — пройденными.
6. Продолжать с уже существующего plan/task ID. Не создавать дубликат плана, если текущий ещё не завершён.
7. После любого существенного шага обновить раздел «Журнал сессий» и «Текущая точка остановки».

Статусы:
- **PASS** — действие действительно выполнено, есть проверяемое evidence.
- **FAIL** — действие выполнено, критерий не пройден; указать конкретную ошибку.
- **NOT VERIFIED** — действие не выполнялось или доказательств недостаточно.
- **STALE** — evidence относится к старому SHA, старому deploy или старому состоянию базы.
- **IN PROGRESS** — процесс запущен и имеет актуальную execution/heartbeat.

Секреты, токены, пароли и значения environment variables в этот файл не записывать.

## 1. Репозитории и ветки

Репозиторий: [esv1312-crypto/Office](https://github.com/esv1312-crypto/Office).

### Подтверждённые сведения GitHub на 2026-11-08

- `main` — основной репозиторий. Последний полученный commit SHA: `985b9f2714d51fe9d1b9cee55e16666f8f74d095` (commit от 2026-11-06: “Use task-appropriate evidence requirements for workers (#64)”).
- `feat/autonomous-roblox-product-pilot` — отдельная крупная ветка Universal AI Studio. GitHub compare показал: **283 commits ahead of main, 0 behind** на момент проверки. Не считать её слитой в `main` или развёрнутой в production без отдельной проверки.
- `studio-v1-foundation` — ветка основы Studio.
- `studio-ai-agent-workspace` — изолированная рабочая ветка с результатами создания Roblox-исходников. Compare с `studio-v1-foundation` показал divergent history (22 commits ahead / 43 behind от точки сравнения). Это не основная ветка и не production.
- `fix/roblox-qa-workspace-access` — ветка исправления доступа Roblox QA; её состояние относительно рабочей ветки и merge status нужно перепроверять перед следующими изменениями.

### Важные ограничения GitHub workspace

Worker-инструменты предназначены для безопасной работы с репозиторием:
- исходный код читается из разрешённой source branch;
- новые продуктовые файлы пишутся только в изолированную ветку `studio-ai-agent-workspace`;
- разрешённый write prefix: `studio/agent-workspace/`;
- обход каталогов, абсолютные пути, секреты, production source и GitHub workflows запрещены;
- QA должен иметь read-only доступ к фактическим файлам продукта и проверять содержимое, а не только текстовый отчёт работника.

## 2. Архитектура AI-ОФИСА

Основной принцип проекта: универсальная агентная организация, а не фиксированный набор ботов и не система только для Roblox.

Рабочий цикл:
`INTAKE → RECON → PLAN → DELEGATE → EXECUTE → VERIFY → FIX → RETEST → EVIDENCE`.

Подтверждённые архитектурные направления в репозитории:
- Director / Chief of Staff: разбор запроса, планирование и делегирование.
- Dynamic specialists: специалисты с ролями, компетенциями, разрешёнными инструментами и model profile.
- Worker Runtime / Worker Pool: исполнение назначенных задач, ограничение параллелизма, execution leases и fencing.
- Independent QA: отдельный reviewer, который не может проверять собственный результат.
- Model gateways: provider-neutral интерфейсы, OpenAI-compatible adapter, OpenRouter routing, free-model fallback и управляемый доступ к платным моделям.
- GitHub workspace tools: list/read/write/patch с allowlist, ограничениями размера и SHA guard.
- PostgreSQL persistence: проекты, планы, специалисты, задачи, executions, artifacts, QA reviews, events и outbox.
- Governance: owner approval, organization/project scope, deny-by-default permissions.
- Evidence: runtime-verified tool traces, blob/commit SHAs, exact bounded read-back и отдельные QA findings.

Наличие кода в ветке не доказывает, что весь этот код включён в production. Версию production устанавливать только по Render deploy SHA.

## 3. Neon — фактическое состояние базы

Neon project:
- Name: `ai-office`
- Project ID: `curly-lake-89933498`
- Region: `aws-eu-central-1`
- PostgreSQL: 17
- Branch: `main`
- Branch ID: `br-lingering-sea-ba372y8i`
- Снимок: branch был `ready`; project updated at `2026-11-08T12:56:16Z`.

В schema `studio` фактически существуют таблицы:
`organizations`, `organization_memberships`, `projects`, `specialists`, `plans`, `tasks`, `executions`, `artifacts`, `qa_reviews`, `events`, `outbox_events`.

### Организация и проекты

- Organization ID: `67ae686f-fc54-40f0-988b-9b8f5a8a1dc9`.
- Project **AI Office Self-Development**: `d8a125e7-bacb-41a5-854a-cc34fe97e516`, profile `ai-office-platform`, active.
- Project **Roblox Football Fans District**: `df2f0007-199c-4619-a67b-cb5de7bb082a`, profile `roblox`, active.

### Существующие специалисты

В Neon найдены активные роли:
- Product Director
- Implementation Specialist
- Quality Engineer
- Solution Architect
- Roblox Technical Director
- Roblox Gameplay Engineer
- Roblox World Builder
- Roblox UI and UX Designer
- Roblox QA Engineer
- Game Product Designer

Фактические разрешения на момент снимка:
- Implementation Specialist: `list_repo_directory`, `read_repo_file`, `write_repo_file`.
- Solution Architect: `list_repo_directory`, `read_repo_file` (read-only).
- Roblox QA Engineer: `list_repo_directory`, `read_repo_file` (read-only; specialist version 2, обновлён 12:49:03 UTC).
- Остальные перечисленные специалисты в сохранённой конфигурации имели пустой allow-list.

Это состояние Neon, а не предположение по шаблонам в исходниках.

## 4. Roblox Fan District — текущий производственный план

Активный целевой план:
- Plan ID: `b45ca5c0-714f-42e8-9a70-c527dc5b4ab9`
- Project: AI Office Self-Development (`d8a125e7-bacb-41a5-854a-cc34fe97e516`)
- Title: **Roblox Fan District — First Playable Vertical Slice v1**
- Status: `approved`
- Создан: `2026-11-08T12:18:51Z`
- Planner snapshot: `openrouter/free`, `fallbackUsed: true`. Не утверждать, что план был сгенерирован DeepSeek: фактический snapshot указывает OpenRouter free fallback.

Цель вертикального среза:
- spawn игрока в fan plaza;
- центральная fan plaza;
- server-authoritative points;
- короткий повторяемый challenge;
- score/leaderboard UI;
- исходники в изолированной папке `studio/agent-workspace/roblox-fan-district/`.

### Пять задач плана

| Задача | Task ID | Последнее состояние в Neon |
|---|---|---|
| Create Fan Plaza Environment and Player Spawn System | `b7338cad-cb28-4903-aa43-5a1a6de0f53a` | `running`, execution attempt 4 |
| Implement Server-Authoritative Points System | `48184b26-1e69-4b36-b028-9190f49e9be9` | `running`, attempt 4; previous QA requested revision |
| Build Repeatable Challenge Mechanic | `62ca2fd6-bd84-46d2-badc-ca82ff53ca21` | `running`, attempt 4 |
| Develop Score Display and Leaderboard UI | `f44e1a30-4513-4712-bfce-4832f0248311` | `running`, attempt 4; previous QA requested revision |
| Integration Testing and QA Verification | `468a76af-242c-4a86-9761-afb352d89eea` | `running`, QA attempt 10; last recorded verdict `revision_required` |

### Самое важное: точка остановки

Последний прочитанный Neon snapshot показал, что все пять последних executions имеют статус `running`, но их leases уже истекли:
- Points System: lease expired at `12:51:56Z`.
- Challenge Mechanic: lease expired at `12:52:13Z`.
- Fan Plaza/Spawn: lease expired at `12:53:27Z`.
- Score UI: lease expired at `12:52:33Z`.
- QA: lease expired at `12:54:03Z`.

Heartbeat у четырёх worker executions не обновлялся после старта, кроме одного heartbeat у Fan Plaza в `12:48:27Z`. У QA attempt 10 heartbeat совпадал со временем старта `12:49:03Z`. У этих executions не было `finished_at`; model snapshots у последних активных executions были null.

**Следовательно, на момент последнего DB-снимка это не завершённые задачи и не успешный QA. Это зависшие/не завершившиеся executions с истёкшими leases.** Не создавать новый Roblox plan. Сначала проверить Render runtime и затем безопасно восстановить существующие задачи через предусмотренный owner-scoped recovery path.

### Последний QA verdict и фактические проблемы

Последний QA review для Integration Testing and QA Verification:
- verdict: `revision_required`
- reviewed at: `2026-11-08T12:49:03.425Z`.

QA указал:
1. Нет доказательства, что все пять файлов перечислены и закоммичены; нужны directory listing, commit hashes или workspace snapshots.
2. Нет Roblox Studio playtest logs/video/Output window, подтверждающих spawn → challenge → points → score update.
3. Не подтверждены RemoteEvent wiring, input validation, rate limiting и security.
4. Нет git diff/file-tree evidence, подтверждающего, что изменения ограничены изолированной папкой.
5. QA sign-off невозможен без реального playtest; Roblox Studio playtesting не проводился.

Предыдущий QA review Points System также указал, что очки хранятся только в in-memory таблице и не реализовано постоянное сохранение через DataStore. Это противоречит критерию плана о persistence per player. Это нужно исправить, если требование остаётся в актуальном плане.

PR #95 исправлял права Roblox QA: специалисту добавлены только list/read tools. Neon подтверждает, что Roblox QA Engineer получил эти права (version 2). После этого QA attempt 10 стартовал в 12:49:03Z, но на последнем снимке его lease уже истёк. Нужно проверить, появился ли более новый execution/review, прежде чем что-либо перезапускать.

## 5. Файлы Roblox, обнаруженные в GitHub workspace branch

В ветке `studio-ai-agent-workspace` compare показал следующие добавленные исходники:

- `studio/agent-workspace/roblox-fan-district/ReplicatedStorage/ChallengeRemotes.shared.lua`
- `studio/agent-workspace/roblox-fan-district/ReplicatedStorage/PointsRemotes.server.lua`
- `studio/agent-workspace/roblox-fan-district/Server/ChallengeManager.server.lua`
- `studio/agent-workspace/roblox-fan-district/Server/FanPlaza.server.lua`
- `studio/agent-workspace/roblox-fan-district/Server/PlazaEnvironment.server.lua`
- `studio/agent-workspace/roblox-fan-district/Server/PlazaSetup.lua`
- `studio/agent-workspace/roblox-fan-district/Server/PointsSystem.server.lua`
- `studio/agent-workspace/roblox-fan-district/Server/SpawnHandler.lua`
- `studio/agent-workspace/roblox-fan-district/Server/SpawnHandler.server.lua`
- `studio/agent-workspace/roblox-fan-district/Server/SpawnSystem.server.lua`
- `studio/agent-workspace/roblox-fan-district/StarterPlayerScripts/PlayerSetup.lua`
- `studio/agent-workspace/roblox-fan-district/StarterPlayerScripts/PointsUI.local.lua`
- `studio/agent-workspace/roblox-fan-district/StarterPlayerScripts/SpawnController.lua`

Это подтверждает наличие исходников в ветке, но не подтверждает, что они все успешно прошли QA или запускались в Roblox Studio. Содержимое нескольких файлов прочитано; полный статический аудит всех файлов ещё не завершён.

## 6. GitHub PRs — важная история последних исправлений

PRs #66–#69:
- #66: управляемый gate для paid OpenRouter models; paid mode требует явного `STUDIO_ALLOW_PAID_MODELS=true`.
- #67: governed GitHub tools и bounded OpenAI-compatible tool loop для Worker.
- #68/#69: context/token efficiency, bounded reads, SHA-guarded patch writes, tool-call/output budgets и usage/cost metadata.

Self-development / recovery:
- #72–#78: запуск self-development внутри существующей организации, startup gate, идемпотентность, fallback plan и восстановление существующего плана после restart.
- #79–#81: read-only repository tools для Solution Architect и разделение source reads от workspace writes.
- #82–#89: source verification, точные line ranges, tool evidence, QA evidence read-back, bounded worker calls, QA retry/free fallbacks.

Roblox product pilot:
- #90: Director-driven Roblox product pilot.
- #91: competency normalization.
- #92: partial competency coverage for cross-functional tasks.
- #93: self-scoping workspace paths.
- #94: exact product source read-backs attached to QA evidence.
- #95: read-only workspace access for Roblox QA Engineer.

Эти PR были найдены как closed. Их точный merge status и целевые base branches необходимо сверять через PR details/compare; закрытый PR сам по себе не означает, что его изменения попали в production.

На момент проверки были открыты PR #65, #70, #43 и #18. Проверить актуальный статус перед использованием; не объединять их автоматически.

## 7. Следующий рабочий шаг — строго по порядку

1. **Проверить Render.** Сверить сервис, branch, deployed commit SHA, последний deploy и логи около 12:46–12:56 UTC. Не считать Neon updated timestamp доказательством успешного исполнения.
2. **Проверить Neon повторно.** Убедиться, что не появился более новый QA execution/review и что leases всё ещё истекли.
3. Если текущие executions действительно зависли, вызвать существующий защищённый recovery/resume path для того же plan ID `b45ca5c0-714f-42e8-9a70-c527dc5b4ab9`, не создавать новый план и не сбрасывать результаты.
4. Убедиться, что workers действительно возобновились: новые execution IDs, обновлённые heartbeat/lease, непустые model snapshots после завершения, новые artifacts.
5. После завершения implementation workers проверить реальные файлы в `studio-ai-agent-workspace`, их SHA и read-back. Исправить DataStore persistence и найденные интеграционные несоответствия.
6. Запустить независимый QA с read-only workspace access и требовать фактические source snippets/read-back evidence.
7. Roblox Studio playtest — отдельный обязательный ручной/внешний этап. До него нельзя называть вертикальный срез playable или QA-approved.

## 8. Render — что ещё нужно проверить

Список Render workspaces показал один доступный workspace:
- `Стас's workspace`
- workspace ID: `tea-d61lnoq4d50c73ac3hgg`.

До явного подтверждения пользователя не выбирать workspace и не выполнять действия в Render. После подтверждения — только read-only проверка service/deploy/logs вначале. Никаких deploy, restart, env changes или provisioning без отдельного обоснования и согласования.

## 9. Журнал сессий

### 2026-11-08 — восстановление контекста и аудит фактического состояния

- GitHub: прочитаны README, branches, PR list, commits, Studio README, product pilot code и Roblox workspace source files.
- GitHub main SHA: `985b9f2714d51fe9d1b9cee55e16666f8f74d095`.
- Feature branch `feat/autonomous-roblox-product-pilot`: 283 commits ahead of main, not assumed merged.
- Neon: найден проект `ai-office`, branch `main` ready; подтверждены таблицы Studio, два проекта, специалисты и approved Roblox plan.
- Neon: обнаружены пять задач текущего Roblox plan; последние executions running с истёкшими leases; QA последний verdict revision_required; QA tools permissions обновлены до list/read.
- GitHub workspace: обнаружены Luau source files для Fan Plaza, points, challenge, spawn и UI.
- Render: workspace list прочитан; выбранный workspace ещё не подтверждён пользователем, service/deploy/logs не проверялись.
- Изменения production/Render/Neon не выполнялись в рамках этого аудита. SQL-запросы были только SELECT.
- **Текущая точка остановки:** проверить Render runtime, затем безопасно восстановить существующий Roblox plan и продолжить исправление/QA. Не повторять создание плана.

## 10. Правило обновления блокнота

Каждая рабочая сессия заканчивается новой записью в журнале:
- дата/время UTC;
- что именно сделано;
- GitHub branch + commit SHA;
- Neon project/branch + plan/task/execution IDs, если применимо;
- Render deploy ID + SHA, если применимо;
- тесты и реальные результаты;
- ссылки на PR/run/artifact;
- ошибки и нерешённые риски;
- точное следующее действие.

**Нельзя записывать намерение как выполненную работу. Нельзя стирать старые записи — только добавлять новые, чтобы история решений сохранялась.**
