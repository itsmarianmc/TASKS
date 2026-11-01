# TÆSKS

TÆSKS ist eine persönliche, kompakte Task-Oberfläche: Notion hält die Aufgaben und ihre Area-/Project-Struktur, GitHub liefert Entwicklungskontext und Contact externe Nachrichten. SQLite ergänzt Notion um Notizen, Dateien, Tags, Prioritäten, Entwürfe, Erinnerungen, Filter und Zuordnungen. Die Oberfläche verwendet Monospace, Mint, kleine Abstände und hierarchische Listen; Desktop und Mobile bieten Light und Dark Mode.

## Start mit Docker

Voraussetzung: Docker mit Linux-Containern und modernem Compose (ab 2.24 für optionales `env_file`). Ein Image, ein Container, ein persistentes Volume; kein weiterer Datenbankdienst und kein neues Docker-Netzwerk nötig.

```powershell
# Nur bei der ersten Einrichtung, vorhandene .env erhalten:
Copy-Item .env.example .env
# .env lokal bearbeiten, dann:
docker compose build
docker compose up -d
```

Öffnen: **http://localhost:2015** oder `http://HOST:2015`. Intern läuft Node auf `0.0.0.0:3000`, als UID/GID **1001:1001**. Compose setzt `DATA_DIR=/app/data` und `PORT=3000` verbindlich; das Volume **taesks_data** speichert SQLite und Uploads. Das Image enthält Standalone-Server, öffentliche Icons/Worker und statische Assets, aber keine `.env`, Entwicklungsdaten oder Testfixtures. `.env` wird ausschließlich beim Containerstart gelesen. Nach Änderungen: `docker compose up -d --force-recreate`.

Ohne `.env` startet die App ebenfalls und zeigt Setup/Diagnostics. Ohne Notion-Zugang gibt es keine künstlichen Aufgaben. `GET /api/health` meldet HTTP 200, wenn SQLite nutzbar ist; `configured` bedeutet bei externen Quellen nur vorhandene Konfiguration. Die tatsächliche Verbindung steht in Settings bzw. den jeweiligen Quell-Diagnostics. Externe Ausfälle machen den Container nicht unhealthy.

## Funktionen und Architektur

Next.js 16 App Router, React, TypeScript, TanStack Query, Zod, offizielles Notion SDK und Octokit laufen in einem Node-24-Standalone-Server. Node SQLite mit Drizzle und versionierten Migrationen benötigt keinen nativen Datenbankcontainer. Notion ist ausschließlich für die Kernfelder zuständig: Titel, Area, Project, Datumsintervall, Highlight und Completion. Kein lokaler Ersatz der Notion-Aufgaben.

Quick Add versteht deutsche und englische Datumsangaben, Intervalle, Projekt-/Area-Aliase und wiederkehrende Aufgaben. Die Vorschau lässt mehrdeutige Zuweisungen korrigieren. Inbox, Overview, Today, Overdue, Next 7 Days, Upcoming, Anytime, Someday und Highlight nutzen echte Daten und Intervallüberschneidung. Suche und Command Palette öffnen Aufgaben und tatsächlich geladene externe Datensätze. Projekte zeigen optionale GitHub-Zuordnung, Issues, Pull Requests, Reviews, Runs und Commits; Contact bietet Suche, Pagination, read/unread und bestätigtes Löschen, soweit der externe Dienst dies erlaubt. Externe Items werden nur nach ausdrücklicher Aktion zu Notion-Aufgaben.

Markdown-Notizen, Links und tatsächliche Uploads gehören zu Tasks, Projects oder Areas. Uploads sind auf 20 MB begrenzt und Downloads werden als Anhänge ausgeliefert. Entwürfe und Zusatzdaten bleiben unabhängig von einem Notion-Ausfall verfügbar. Unsichere Create-Antworten werden nicht automatisch wiederholt; nach eigener Prüfung kann ein bestehender Notion-Task über seine ID verknüpft werden.

Die PWA kann nach einem erfolgreichen Onlinebesuch die Oberfläche und zuvor geladene Daten offline anzeigen. Offline Capture speichert lokale Entwürfe und überträgt sie nach bestätigtem Server-ACK; es erstellt dabei niemals automatisch Notion-Aufgaben. Erinnerungen bleiben in der geöffneten App verfügbar. Optional versendet der Produktionsserver Web Push auch bei geschlossener PWA: HTTPS, VAPID-Konfiguration, bestätigte Notion-Completion-Zuordnung und ein Geräte-Abo sind erforderlich. Auf iOS wird die Home-Bildschirm-Installation benötigt. Einrichtung, Cloudflare-Access-Grenze und Zustellungsgrenzen: [Web Push](docs/WEB-PUSH.md).

Task-, Contact- und lokale Änderungen reagieren sofort und werden im Hintergrund gespeichert. Fehler nehmen nur die betroffene Änderung zurück. Notizen behalten ungespeicherten Text; Dateien erscheinen sofort mit Upload-Status. Offline-Änderungen bleiben sichtbar unsynchronisiert und können bei Verbindung wiederholt werden. Details und vollständiger Mutationsaudit: [Optimistic UI](docs/OPTIMISTIC.md).

## AI fallback

TÆSKS verarbeitet Quick Add zuerst mit dem deterministischen DE/EN-Parser. Bei unsicherer freier Sprache kann optional Gemini helfen: erst nach **Understand input** oder Enter, niemals beim Tippen. Das Ergebnis erscheint zur Prüfung in der Vorschau; eine weitere Bestätigung erstellt den Task. Ohne Key, offline oder bei AI-Fehlern bleiben Parser, manuelle Auswahl und Entwürfe verfügbar.

Nur für den optionalen Fallback: `GEMINI_API_KEY` aus [Google AI Studio](https://aistudio.google.com/apikey) serverseitig setzen. `GEMINI_MODEL` ist standardmäßig `gemini-3.5-flash-lite`; `GEMINI_FALLBACK_ENABLED=true`, `GEMINI_TIMEOUT_MS=5000`, `GEMINI_CONFIDENCE_THRESHOLD=0.75`. Keine Secrets mit `NEXT_PUBLIC_`. Build und Start benötigen keinen Key. Settings zeigt Provider, Modell und Konfigurationsstatus, ohne einen Verbindungstest auszulösen.

Der Adapter nutzt das offizielle `@google/genai` SDK und die [Interactions API](https://ai.google.dev/gemini-api/docs/interactions-overview) mit Structured Output und `store=false`. Nur Eingabe, erlaubte Namen/IDs/Aliase/Tags, gültige Relationen, Kalenderdatum und Ansichtskontext werden übertragen. Zod, ID-, Relations- und Datumsprüfung prüfen jede Antwort. Keine Tools, Websuche, direkten Mutationen oder automatischen Retries.

Migration und ausgeführte Prüfungen: [docs/GEMINI.md](docs/GEMINI.md).

## Environment und Notion

Alle Variablen stehen in [.env.example](.env.example). Geheimnisse bleiben serverseitig; keine Tokens mit `NEXT_PUBLIC_` versehen.

Erforderlich für Notion: `NOTION_TOKEN`, `NOTION_TASKS_DATABASE_ID`, `NOTION_PROJECTS_DATABASE_ID`, `NOTION_AREAS_DATABASE_ID`. Alle drei Datenbanken für dieselbe Notion-Integration freigeben; Lesen, Einfügen und Aktualisieren von Seiten erlauben. Ein Task gehört zu genau einem Project und einer Area; das Project muss mit dieser Area verknüpft sein. TÆSKS validiert Typen und Relationstargets und verändert keine Datenbankschemata.

Erwartete Task-Properties und konfigurierbare Defaults:

| Variable | Default | Notion-Typ |
| --- | --- | --- |
| `NOTION_TASK_TITLE_PROPERTY` | `Name` | Title |
| `NOTION_TASK_DATE_PROPERTY` | `Due Date` | Date mit start/end |
| `NOTION_TASK_AREA_PROPERTY` | `Area` | Relation zur Areas-Datenquelle |
| `NOTION_TASK_PROJECT_PROPERTY` | `Project` | Relation zur Projects-Datenquelle |
| `NOTION_TASK_HIGHLIGHT_PROPERTY` | `Highlight` | Checkbox |

Project-/Area-Titel und die Project→Area-Relation werden konservativ automatisch erkannt; `NOTION_PROJECT_TITLE_PROPERTY`, `NOTION_PROJECT_AREA_PROPERTY`, `NOTION_AREA_TITLE_PROPERTY` bleiben dafür leer. Optional lassen sich `Status`, `Priority`, Date/Deadline und Area Type über die entsprechenden Variablen zuordnen. Enthält eine Datenbank mehrere Datenquellen, ist ihre `NOTION_*_DATA_SOURCE_ID` ausdrücklich erforderlich.

Completion erkennt eine eindeutige Checkbox oder Status-Property, außer Highlight. Mehrere Kandidaten oder mehrdeutige Statuswerte erfordern eine Auswahl in **Settings → Notion diagnostics**. Alternativ: `NOTION_TASK_COMPLETION_PROPERTY`, `NOTION_TASK_COMPLETION_VALUE`, `NOTION_TASK_REOPEN_VALUE`. Fehlende Completion-Zuordnung deaktiviert Abschließen; die App erfindet kein Property. Datenbereiche sind ISO-Tage, Standardzeitzone `APP_TIMEZONE=Europe/Berlin`.

## GitHub und Contact

`GITHUB_TOKEN`: Fine-grained PAT mit ausgewähltem Resource Owner und benötigten Repositories. Metadata read für Discovery; **Issues read**, **Pull requests read**, **Actions read**, **Contents read** für die entsprechenden Bereiche. `GITHUB_USERNAME` ist optional, sonst verwendet die App den authentifizierten Account. Organisationsfreigaben und Tokenablauf können einzelne Bereiche sperren. Repository-Discovery ist kein Beweis für alle Berechtigungen; Teilfehler bleiben sichtbar. Alle GitHub-Zugriffe sind read-only. Suche umfasst geladenen Kontext; ältere ungeladene Aktivität erfordert Pagination oder GitHub.

`CONTACT_API_BASE_URL` ist die serverseitig erreichbare Basis-URL, standardmäßig `http://192.168.2.173:1917`. Bei einem Basepath wie `/default` bleibt dieser erhalten; angefragt wird `<base>/contact_submissions`. Erwartet werden `id`, `site_origin`, `name`, `email`, `message`, `created_at`, `is_read` und exakte Count-Header. `CONTACT_API_AUTH_HEADER` bleibt für anonymen Zugriff leer oder enthält exakt **eine komplette Headerzeile**, z. B. `Authorization: Bearer YOUR_TOKEN`; kein JSON und kein Token allein. Der bestehende Contact/Postgres/PostgREST-Stack wird separat betrieben und durch TÆSKS nicht verändert. Der konfigurierte externe Role/RLS bestimmt die tatsächlichen Schreibrechte.

## Entwicklung und Prüfung

Node 24+, npm und installierter Browser für E2E:

```powershell
npm ci
# Wichtig bei Windows-.env mit Docker-Pfad: lokalen Datenpfad explizit setzen.
$env:DATA_DIR = Join-Path (Get-Location) 'data'
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
```

Die Entwicklung läuft standardmäßig auf Port 3000. `DATA_DIR` im Prozess hat Vorrang vor `.env`; den Docker-Pfad `/app/data` unter Windows nicht unbemerkt verwenden. Browserprüfungen gegen einen vorhandenen Server verwenden `E2E_BASE_URL` und gegebenenfalls `PLAYWRIGHT_CHANNEL=msedge`. Tests müssen eigene Daten und ausdrücklich deaktivierte externe Credentials verwenden. [VERIFICATION.md](docs/VERIFICATION.md) dokumentiert ausgeführte Prüfungen und ihre Grenzen; [DEPLOYMENT.md](docs/DEPLOYMENT.md) dokumentiert den tatsächlichen Container-Nachweis.

## Betrieb, Backup und Wiederherstellung

`docker compose logs --tail=100`, `docker compose ps`, `http://HOST:2015/api/health`. `docker compose stop` stoppt ohne Datenverlust; `docker compose down` entfernt den Container, aber nicht das Volume. **`docker compose down -v` löscht lokale Daten** und ist kein normaler Update-Schritt.

Vor einem konsistenten Backup den Container stoppen. Das **gesamte `/app/data`** sichern: `taesks.db`, vorhandene `taesks.db-wal`/`taesks.db-shm` und `uploads/` zusammen. Beispiel für Windows; das Ziel außerhalb des Repositories vorher anlegen und je Sicherung einen neuen Ordner verwenden:

```powershell
docker compose stop
docker cp taesks:/app/data C:\Backups\taesks-2026-10-04
docker compose start
```

Den Kopiererfolg vor dem erneuten Start prüfen. Alternativ den Volume-Backupmechanismus oder einen gestoppten, überprüften Bind-Mount nutzen. `.env` separat geschützt sichern; Notion/GitHub/Contact-Daten gehören nicht zu dieser lokalen Sicherung. Wiederherstellung nur bei gestoppter App: kompletten Datenordner wiederherstellen, UID/GID 1001:1001 und Schreibrechte herstellen, dann starten und Health/Notizen/Downloads prüfen. Bei Bind-Mounts den Hostordner vorher für UID 1001 beschreibbar machen. Nicht mehrere Serverprozesse auf dasselbe Volume starten.

## Troubleshooting und Sicherheit

- Port belegt: vorhandenen Dienst prüfen; externen Port bewusst anpassen. Interner Port bleibt 3000.
- SQLite/Uploads permission denied: Volume/Bind-Mount muss UID 1001 gehören; nicht mit Root als Dauerlösung starten.
- Notion read/write deaktiviert: alle Datenbanken teilen, IDs, tatsächliche Typen/Targets und Completion-Auswahl in Settings prüfen. Mehrere Datenquellen brauchen explizite IDs.
- GitHub Teilfehler: PAT-Scope, ausgewählte Repositories, Organisationsfreigabe und Ablauf prüfen. Kein Schreibzugriff erforderlich.
- Contact unavailable: Basis-URL inklusive möglichem Basepath aus dem Container erreichbar machen; Headerformat und Count-/Row-Policy prüfen. `localhost` bezeichnet im Container den Container selbst.
- PWA/Benachrichtigungen auf dem Smartphone: Browser benötigen **HTTPS oder localhost** als sicheren Kontext. `http://LAN-IP:2015` genügt zum normalen Aufrufen, aber nicht zuverlässig zur Installation/Offline/Benachrichtigung. Einen extern geschützten HTTPS-Reverse-Proxy nutzen und `APP_ORIGIN=https://dein-host` setzen. Ohne Proxy darf `APP_ORIGIN` leer bleiben; der direkte Request-Host bestimmt den Same-Origin-Vergleich. Bei gesetztem Origin müssen Host/Protokoll genau passen.
- Kein eigenes Login: Zugriff durch VPN, Reverse-Proxy-Authentifizierung oder interne Infrastruktur beschränken. TLS und externe Zugangskontrolle liegen außerhalb dieses einzelnen Appcontainers. JSON-Mutationen prüfen Origin, Uploads und Markdown sind validiert. Production-CSP erlaubt Next-Inline-Bootstrap, aber kein unsafe-eval.

Nicht nachgewiesen sind echtes Safari/iOS, installierte Geräte-PWA, OS-Benachrichtigung und Hintergrund-Push; Contact-Schreibrechte werden durch die getrennte API vergeben. Kein Backup-Versprechen für externe Daten. Weitere Verträge: [ARCHITECTURE](docs/ARCHITECTURE.md), [NOTION](docs/NOTION.md), [GITHUB](docs/GITHUB.md), [CONTACT](docs/CONTACT.md), [LOCAL](docs/LOCAL.md), [PWA](docs/PWA.md), [RELIABILITY](docs/RELIABILITY.md).

## Language catalogs and task interaction settings

Optional server-only `LANGUAGE_JSON_URL` and `SHORT_DATES_JSON_URL` accept comma-separated direct JSON URLs. Whitespace is trimmed; commas inside URLs must be encoded as `%2C`. Settings includes a persisted language selector and a quoted-text parsing preference. See [catalog schemas, matching, fallback and interaction behavior](docs/language-catalogs.md) and `.env.example`.
