Du bist der Lead Engineer und Product Designer für ein neues Projekt namens:

TÆSKS

Du startest in einem vollständig leeren Ordner.

Deine Aufgabe ist NICHT, mir nur Beispielcode, ein Mockup oder ein teilweise funktionierendes Grundgerüst zu erstellen.

Du sollst die vollständige Anwendung von Grund auf planen, implementieren, testen, dockerisieren und bis zu einem tatsächlich lauffähigen Zustand bringen.

Am Ende muss aus diesem leeren Ordner eine produktionsnahe Web-App entstehen, die als EIN Docker-Image gebaut und als EIN Docker-Container betrieben werden kann.

==================================================
0. WICHTIGE ARBEITSWEISE: SUBAGENTEN
==================================================

Du sollst die Arbeit in sinnvolle Teilbereiche zerlegen und dafür Subagenten verwenden.

SEHR WICHTIG:

Subagenten dürfen NICHT parallel arbeiten.

Arbeite strikt sequenziell:

1. Subagent starten
2. Warten, bis dieser vollständig fertig ist
3. Ergebnis prüfen
4. Ergebnis in das Hauptprojekt integrieren
5. Erst danach den nächsten Subagenten starten

Kein zweiter Subagent darf arbeiten, während ein vorheriger Subagent noch aktiv ist.

Empfohlene Reihenfolge:

1. Architecture / Data Model Agent
2. Design System / UI Agent
3. Notion Integration Agent
4. Natural Language Parser Agent
5. Core Task UX Agent
6. GitHub Integration Agent
7. Contact Inbox Integration Agent
8. Local Persistence / Notes / Attachments Agent
9. PWA / Responsive / Mobile Agent
10. Security / Reliability Agent
11. Docker / Deployment Agent
12. Final QA / Testing Agent

Du bist als Hauptagent dafür verantwortlich, dass die Ergebnisse zusammenpassen.

Nach jedem Subagenten:
- Änderungen prüfen
- TypeScript-Fehler prüfen
- Architektur gegen diese Spezifikation prüfen
- bestehende Funktionen nicht regressieren lassen
- erst danach fortfahren

Die Spezifikation in diesem Prompt hat Vorrang vor Vermutungen der Subagenten.

==================================================
1. PRODUKTIDEE
==================================================

TÆSKS ist meine persönliche zentrale Task- und Productivity-App.

Der Name ist absichtlich:

TÆSKS

Das Æ soll ein Bestandteil des Brandings sein.

Die App ist stark von der Bedienphilosophie und Informationsdichte von init.Tasks inspiriert.

Ich werde dir zusätzlich Referenzbilder und ggf. Videos von init.Tasks geben.

Diese Referenzen sind sehr wichtig.

Analysiere sie sorgfältig hinsichtlich:

- Informationsarchitektur
- Typografie
- Dichte
- Tree Views
- Task-Darstellung
- Inline Metadata
- Farben
- Quick Add
- Mobile Navigation
- Projektansichten
- Notes
- Attachments
- Sidebar
- Tastaturbedienung

ABER:

Baue KEINEN pixelgenauen Klon von init.Tasks.

TÆSKS soll eine eigene visuelle Identität erhalten.

Übernimm das Interaction Model und die Informationsdichte, nicht die exakte Markenidentität.

TÆSKS soll wirken wie eine Mischung aus:

- init.Tasks
- Linear
- Things
- einer modernen Terminal-Oberfläche

NICHT wie ein typisches SaaS-Admin-Dashboard.

==================================================
2. GRUNDPRINZIPIEN DES DESIGNS
==================================================

Design Language:

- terminal-inspired
- monospace-first
- content over chrome
- sehr kompakt
- sehr geringe visuelle Verschwendung
- keyboard-first
- hierarchisch
- schnell
- ruhig
- technisch
- modern
- sehr wenige klassische Cards
- minimale Borders
- möglichst wenig unnötige Container
- Inline Metadata statt großer Info-Boxen
- starke Informationsdichte ohne unübersichtlich zu werden
- Light und Dark Mode vollwertig
- Responsive Design
- PWA-fähig
- Desktop und Mobile gleichwertig nutzbar

Vermeide insbesondere:

- Dashboard-Kachelwüsten
- riesige Stat-Cards
- unnötig große Buttons
- übermäßige Border-Radii
- Glassmorphism überall
- generische shadcn-Demo-Optik
- Marketing-SaaS-Design
- unnötige Icons
- riesige Abstände

Primitives von Radix oder shadcn dürfen technisch verwendet werden, aber die visuelle Gestaltung muss vollständig TÆSKS entsprechen.

==================================================
3. BRANDING
==================================================

Name:

TÆSKS

Das Æ soll ein wiederkehrendes Brand-Element sein.

Entwickle ein minimalistisches Text-/Symbolbranding.

Keine komplizierte Illustration.

Vorgeschlagene Grundrichtung:

Accent:
Mint / Türkis / Terminal-Grün

Semantische Farben:

- Mint/Türkis = primäre Aktion / TÆSKS Accent
- Rot = Overdue / Fehler
- Orange/Gelb = Deadline / Warnung
- Blau = Links / Metadata
- Lila = GitHub / optionale Sekundärinformation
- Grau = Notes / Kommentare / sekundäre Informationen

Alle Farben müssen für Dark und Light Mode angepasst werden.

Nutze bevorzugt eine hochwertige Monospace-Schrift.

Keine proprietäre Schrift voraussetzen.

Geeignete freie/bundlebare Font verwenden oder einen robusten Monospace-Stack einsetzen.

==================================================
4. TECHNISCHER STACK
==================================================

Nutze einen modernen stabilen Fullstack-Web-Stack.

Bevorzugt:

- Next.js
- TypeScript
- App Router
- React
- Tailwind CSS
- Radix UI nur für zugängliche Primitives
- Zod
- TanStack Query oder vergleichbare saubere Query-Abstraktion
- official Notion SDK
- Octokit für GitHub
- chrono-node für Datumsparsing
- date-fns für Datumsberechnungen
- Drizzle ORM
- SQLite für TÆSKS-interne Persistenz

Kein Edge Runtime für Serverfunktionen, die SQLite oder Node APIs benötigen.

Die App läuft als normaler Node.js-Server.

==================================================
5. DOCKER-ARCHITEKTUR
==================================================

TÆSKS selbst besteht aus:

EINEM Docker-Image
EINEM Docker-Container

KEIN Docker-in-Docker.

KEIN zusätzlicher PostgreSQL-Container.

KEIN zusätzlicher Redis-Container, sofern nicht zwingend technisch erforderlich.

Nutze für TÆSKS-eigene Persistenz SQLite.

Persistente Daten:

/app/data

Darin z.B.:

/app/data/taesks.db
/app/data/uploads/

Erstelle ein Docker Volume bzw. Bind Mount.

Container intern:

Port 3000

Extern:

Port 2015

Warum 2015:

T = 20
A = 1
E = 5

Beispiel:

ports:
  - "2015:3000"

Erstelle:

- Dockerfile
- docker-compose.yml
- .dockerignore
- .env.example
- Healthcheck

Nutze bevorzugt einen Multi-Stage Build.

Am Ende muss funktionieren:

docker compose build

docker compose up -d

Danach:

http://HOST:2015

==================================================
6. KEIN LOGIN
==================================================

TÆSKS braucht KEIN eigenes Login-System.

Die Anwendung wird außerhalb von TÆSKS geschützt.

Gehe davon aus, dass beispielsweise Reverse Proxy, VPN oder interne Infrastruktur den Zugriff beschränkt.

Implementiere deshalb:

KEIN:
- Benutzerkonto
- Registration
- OAuth Login
- Passwortscreen

Trotzdem:

- Secrets niemals an den Client senden
- API Tokens ausschließlich serverseitig
- sichere Server Routes
- Input Validation
- CSRF-sinnvolle Architektur
- sichere HTTP Header
- XSS-Schutz
- keine unsicheren HTML-Injections

==================================================
7. DATENQUELLEN
==================================================

TÆSKS verbindet mehrere Datenquellen.

Sie haben unterschiedliche Aufgaben.

SOURCE OF TRUTH FÜR TASKS:

NOTION

Weitere Quellen:

GITHUB
CONTACT POSTGREST API
TÆSKS LOCAL SQLITE

Wichtig:

GitHub Issues sind NICHT automatisch Tasks.

Contact Submissions sind NICHT automatisch Tasks.

Nur Notion enthält die eigentlichen Tasks.

Aus externen Items kann der Nutzer aber einen Notion Task erzeugen.

==================================================
8. NOTION DATENMODELL
==================================================

Es existieren drei wichtige Notion-Datenbanken:

TASKS
PROJECTS
AREAS

Ich werde dir Screenshots dieser Datenbanken geben.

Analysiere die Screenshots.

Grundstruktur:

Area
└── Project
    └── Task

JEDER normale Task gehört zu:

genau einer Area
und
genau einem Project

Ein Project ist mit einer Area verbunden.

Eine Area kann mehrere Projects enthalten.

Beispiel Schule:

Area:
Hausaufgaben

Project:
Physik

Task:
Lorentzkraft berechnen

oder:

Area:
Hausaufgaben

Project:
Englisch

Task:
Make Presentation

Das bedeutet:

Area = Kategorie / übergeordnete Organisation
Project = konkretes Projekt oder im Schulkontext Fach
Task = eigentliche Aufgabe

==================================================
9. NOTION TASK DATABASE
==================================================

Aus dem aktuellen Schema sind insbesondere vorhanden:

Name
Due Date
Area
Project
Highlight

Die Screenshots sind die visuelle Referenz des tatsächlichen Schemas.

"Due Date" ist ein Notion Date Property und kann ein Datumsintervall besitzen:

start
end

Beispiel:

October 3, 2026 → October 18, 2026

Area ist eine Relation zur Areas Database.

Project ist eine Relation zur Projects Database.

Highlight ist eine Checkbox.

Baue NICHT blind weitere Notion Properties hinzu.

Lies das Datenbankschema über die Notion API.

Mache Property-Namen konfigurierbar.

.env.example soll sinnvolle Defaults besitzen, z.B.:

NOTION_TASK_TITLE_PROPERTY=Name
NOTION_TASK_DATE_PROPERTY=Due Date
NOTION_TASK_AREA_PROPERTY=Area
NOTION_TASK_PROJECT_PROPERTY=Project
NOTION_TASK_HIGHLIGHT_PROPERTY=Highlight

Zusätzlich:

NOTION_TASKS_DATABASE_ID=
NOTION_PROJECTS_DATABASE_ID=
NOTION_AREAS_DATABASE_ID=
NOTION_TOKEN=

Falls eine Completion-/Status-Property existiert:

automatisch erkennen.

Suche z.B. nach:

Done
Completed
Complete
Status
State

oder einem anderen Checkbox-/Status-Feld.

Falls genau ein plausibles Property gefunden wird:
verwenden.

Falls mehrere Kandidaten existieren:
nicht raten.

Dann soll TÆSKS über eine Diagnostics/Settings-Ansicht die Zuordnung ermöglichen.

Keine Notion-Datenbankschemata automatisch verändern, außer dies wurde ausdrücklich konfiguriert.

==================================================
10. PROJECT DATABASE
==================================================

Aus den Referenzbildern sind u.a. sichtbar:

Name
Status
Priority
Areas
Tasks
Date / Deadline, sofern vorhanden

Beispiele:

GYM
Habit Tracker
HealthSync
Notion
Paperless Chat
Portfolio
SchulPlaner
Shoply
TÆSKS
Bildende Kunst
usw.

Statuswerte beispielsweise:

In Progress
Done

Priorität beispielsweise:

High
Medium
Low

Projects können mit Areas verknüpft sein.

Nutze diese Informationen in TÆSKS.

==================================================
11. AREA DATABASE
==================================================

Aus den Referenzbildern sind u.a. sichtbar:

Name
Type
Open Projects
Projects
Tasks
Database

Beispiele:

Private
Web Development
Homelab

Type beispielsweise:

Work
Personal

Wieder:

Schema zur Laufzeit validieren.
Nicht unnötig hartkodieren.

==================================================
12. NOTION CRUD
==================================================

TÆSKS muss Notion Tasks vollständig verwalten können:

- erstellen
- lesen
- bearbeiten
- abschließen
- wieder öffnen
- Area ändern
- Project ändern
- Datum ändern
- Highlight ändern
- verschieben
- löschen

Löschen benötigt eine Bestätigung.

Nutze Optimistic UI nur dort, wo ein sicherer Rollback existiert.

Bei Fehlern:

- verständliche Meldung
- lokale Anzeige zurückrollen
- keine inkonsistenten Zustände vortäuschen

==================================================
13. AREA / PROJECT VALIDIERUNG
==================================================

Ein Task darf nicht mit einer ungültigen Area/Project-Kombination gespeichert werden.

Regeln:

Wenn Project genau einer Area zugeordnet ist:

Project auswählen
→ Area automatisch auswählen

Beispiel:

Project = Englisch
Project gehört zu Area = Hausaufgaben

Dann:

Area automatisch Hausaufgaben

Wenn ein Project mehreren Areas zugeordnet sein kann:

User muss passende Area wählen.

Wenn Natural Language Parser sowohl Area als auch Project erkennt:

Relation validieren.

Falls sie nicht zusammenpassen:

NICHT stillschweigend speichern.

Zeige Konflikt:

Project "Englisch" gehört nicht zu Area "Web Development"

und verlange eine Korrektur.

==================================================
14. TÆSKS LOCAL PERSISTENCE
==================================================

Notion bleibt Source of Truth für Kern-Taskdaten.

TÆSKS darf eigene Zusatzinformationen in SQLite speichern.

SQLite liegt persistent unter:

/app/data/taesks.db

Nutze Migrationen.

Speichere dort beispielsweise:

task_metadata
notes
attachments
links
tags
task_tags
saved_filters
parser_aliases
project_integrations
external_item_links
inbox_drafts
app_preferences
web_push_subscriptions

Beispiel task_metadata:

- notion_task_id
- priority
- recurrence_rule
- reminder_at
- someday
- created_at
- updated_at

Notes und Attachments können sich beziehen auf:

- Task
- Project
- Area

Nutze ein generisches Entity-Konzept, wenn sinnvoll.

==================================================
15. NOTES
==================================================

Notes sind ein wichtiger Bestandteil.

Orientiere dich an den init.Tasks Referenzen.

Notes sollen:

- Full Markdown unterstützen
- Code Blocks unterstützen
- Links unterstützen
- Listen unterstützen
- Überschriften unterstützen
- Inline Code unterstützen
- editierbar sein
- schön gerendert werden

Notes liegen lokal in SQLite.

Beispiel:

## Architecture

Notion stays the source of truth.

### GitHub
- PRs
- Issues
- Actions

### Contact API
- unread submissions
- create task

Projektseiten dürfen umfangreiche Notes enthalten.

==================================================
16. ATTACHMENTS UND LINKS
==================================================

TÆSKS unterstützt:

- Dateien
- Bilder
- PDFs
- normale Links

Uploads liegen persistent:

/app/data/uploads

Metadaten liegen in SQLite.

UI soll Dateien ähnlich kompakt anzeigen wie init.Tasks:

attachments 5

🔗 docs.example.com
📄 specification.pdf 1.2 MB
📄 notes.txt 3 KB
🖼 screenshot.png 207 KB

Keine riesigen File Cards.

==================================================
17. TASK DETAILS
==================================================

Ein Task kann zusätzlich zu seinen Notion-Feldern besitzen:

- Markdown Note
- Links
- Attachments
- Reminder
- Recurrence
- Priority
- Tags
- Someday Flag

Diese zusätzlichen Daten dürfen lokal in TÆSKS gespeichert werden.

Task Detail Ansicht:

Task Name

Area
Project

Start
Deadline

Highlight

Priority
Tags

Reminder
Repeat

Notes

Links
Attachments

External references

Delete

==================================================
18. QUICK ADD IST DIE WICHTIGSTE INTERAKTION
==================================================

Das Quick Add Input ist eines der zentralen Features der gesamten Anwendung.

Es soll sich stark an der Philosophie von init.Tasks orientieren.

Der User tippt natürliche Sprache.

Beispiel:

Make Presentation in English as Homework until the 03/10/2026

TÆSKS erkennt:

Title:
Make Presentation

Project:
Englisch

Area:
Hausaufgaben

Start:
Today

Deadline:
03.10.2026

==================================================
19. NATURAL LANGUAGE PARSER
==================================================

Der Parser muss Deutsch UND Englisch verstehen.

Beispiele:

Make Presentation in English as Homework until Friday

Präsentation in Englisch als Hausaufgabe bis Freitag

Math homework tomorrow

Geschichte Präsentation bis 12.10.

Finish API in TÆSKS until next Monday

Physik Hausaufgabe morgen

Der Parser soll KEIN LLM als Standard verwenden.

Pipeline:

1. Normalize
2. Explicit Tokens
3. Date Parser
4. Project Matching
5. Area Matching
6. Tag Matching
7. Context Defaults
8. Relation Validation
9. Confidence Score
10. NUR falls wirklich nötig optionaler LLM Fallback

==================================================
20. EXPLICIT QUICK ADD SYNTAX
==================================================

Unterstütze zusätzlich Power-User-Syntax.

Empfehlung:

#Project
@Area
[tag]

Beispiel:

Make Presentation #English @Homework [school] tomorrow

Auch Kurzformen dürfen unterstützt werden.

Projekt- und Area-Namen müssen aus Notion geladen werden.

Alias-System lokal speichern.

Beispiel:

Notion Project:
Englisch

Aliases:
English
Eng
english class

Area:
Hausaufgaben

Aliases:
Homework
HW
Hausi

==================================================
21. DATUMSPARSING
==================================================

Verwende chrono-node als Grundlage und erweitere es sinnvoll.

Unterstütze mindestens:

Deutsch:
heute
morgen
übermorgen
Freitag
nächsten Freitag
bis Freitag
am 12.10.
12.10.2026
12/10/2026
in 2 Wochen
in drei Tagen
von Montag bis Freitag
vom 3.10. bis 18.10.
alle 2 Wochen

Englisch:
today
tomorrow
Friday
next Friday
until Friday
7 Oct
03/10/2026
in 2 weeks
in three days
from Monday to Friday
from 3 Oct to 18 Oct
every 2 weeks

WICHTIGE DATUMSREGEL:

Standard:

Start Date = HEUTE

Wenn der User nur ein Datum nennt:

dieses Datum ist die DEADLINE / das End Date.

Beispiel:

"Make Presentation until Friday"

Start:
Today

End:
Friday

AUSNAHME:

Wenn der User explizit einen Zeitraum nennt:

From X to Y
Von X bis Y

dann:

Start = X
End = Y

Beispiel:

Study Physics from Monday to Friday

Start:
Monday

End:
Friday

oder:

Physik lernen von 5.10. bis 10.10.

Start:
05.10.
End:
10.10.

Bei europäischen numerischen Datumsformaten standardmäßig:

DD/MM/YYYY
DD.MM.YYYY

NICHT MM/DD/YYYY.

==================================================
22. QUICK ADD LIVE PREVIEW
==================================================

Während der User tippt, soll TÆSKS LIVE anzeigen, was erkannt wurde.

Beispiel:

> Make Presentation in English as Homework until Friday

darunter kompakt:

[today] [English] [Homework] [due Fri]

oder semantisch hervorgehoben.

Die Preview darf NICHT wie ein großes Formular aussehen.

Sie soll kompakt bleiben.

Der User muss vor Enter erkennen können, wie TÆSKS den Satz interpretiert.

Falls Project oder Area fehlen:

NICHT direkt einen ungültigen Notion Task erzeugen.

Stattdessen:

- passenden Inline Picker anzeigen
- oder Draft in TÆSKS Inbox halten

Erst wenn Area + Project gültig sind:
in Notion speichern.

==================================================
23. PARSER CONTEXT
==================================================

Der aktuelle View darf als Default verwendet werden.

Wenn der Nutzer innerhalb des Projects "Englisch" ist und schreibt:

Make Presentation until Friday

dann:

Project = Englisch

Wenn Englisch genau einer Area zugeordnet ist:

Area automatisch setzen.

Dasselbe gilt für einen Area-Kontext.

==================================================
24. FUZZY MATCHING
==================================================

Nutze:

- Normalisierung
- Case-insensitive Match
- Aliases
- Wortgrenzen
- Fuzzy Matching
- Relation Context
- aktuelle View
- eindeutige Relation Project -> Area

Confidence Score verwenden.

Nur hohe Confidence automatisch übernehmen.

Nicht aggressiv raten.

==================================================
25. LLM FALLBACK
==================================================

KI darf NUR im Notfall eingesetzt werden.

LLM ist optional.

Die App muss ohne AI API Key funktionieren.

Optional env:

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite

Der LLM Fallback darf nur verwendet werden, wenn der deterministische Parser keinen ausreichend sicheren Parse erzeugen kann.

Beispiel schwieriger Input:

Need to finally get that English presentation done for homework before school on Monday

LLM bekommt NUR:

- Task Input
- erlaubte Areas
- erlaubte Projects
- erlaubte Tags
- heutiges Datum

Kein unnötiger Kontext.

LLM muss strict structured JSON liefern.

Es darf KEINE neuen Areas oder Projects erfinden.

Beispiel:

{
  "title": "Finish presentation",
  "projectId": "...",
  "areaId": "...",
  "startDate": "...",
  "endDate": "...",
  "confidence": 0.92
}

Response mit Zod validieren.

Wenn ungültig:

nicht speichern.

Zeige stattdessen manuelle Auswahl.

==================================================
26. HAUPTNAVIGATION
==================================================

Desktop Sidebar ungefähr:

TÆSKS                          [+]

Search...

Inbox                         3
Overview
Today                         7
Next 7 Days                  12
Upcoming                      5
Anytime                       4
Someday                       7

AREAS

▾ Hausaufgaben
   Englisch                   3
   Mathematik                 4
   Physik                     2

▾ Web Development
   TÆSKS                      7
   Portfolio                  3
   HealthSync                 2

▾ Homelab
   SchulPlaner                4
   Paperless Chat             2

TAGS

[bug]
[school]
[calls]
[waiting]

FILTERS

Urgent
High Priority
Waiting

EXTERNAL

GitHub
Contact

Die Sidebar soll Counts anzeigen.

Areas und Projects auf- und zuklappbar.

Datenmodell bleibt:

Area
└── Project
    └── Task

Tasks müssen nicht dauerhaft alle in der Sidebar sichtbar sein.

Optional darf ein Project expandiert werden.

Haupt-Taskliste bleibt im Content-Bereich.

==================================================
27. OVERVIEW
==================================================

Overview ist KEIN KPI-Dashboard.

Keine großen Statistik-Karten.

Es ist eine dichte Arbeitsansicht.

Zeige beispielsweise:

overdue

[ ] Aufgabe A
[ ] Aufgabe B

today

[ ] Make Presentation
    // English · Homework
    // today → fri

daily highlight

[*] Finish TÆSKS Parser

inbox

● Contact Request
● GitHub Review
● Draft

upcoming

...

==================================================
28. TODAY LOGIK
==================================================

Notion Due Date kann ein Intervall sein.

Ein Task gehört zu Today, wenn sein Zeitraum heute enthält:

start <= today
UND
(end ist null ODER end >= today)

Overdue Tasks sollen NICHT verschwinden.

Unvollständige Tasks mit:

end < today

werden oben als Overdue angezeigt.

==================================================
29. NEXT 7 DAYS LOGIK
==================================================

Nicht nur prüfen, ob Start oder Enddatum innerhalb der nächsten sieben Tage liegen.

Prüfe, ob sich die Zeiträume überschneiden.

Task Range:

taskStart → taskEnd

View Range:

today → today + 7 days

Task gehört hinein, wenn sich beide Intervalle überschneiden.

Das ist wichtig.

Ein Task kann den gesamten Zeitraum umfassen, auch wenn weder Start- noch Enddatum exakt darin beginnen.

==================================================
30. UPCOMING
==================================================

Zeige zukünftige Tasks nach Next 7 Days.

Sinnvoll gruppieren nach:

Woche
Monat
oder konkreten Daten

Kompakte Darstellung.

==================================================
31. ANYTIME
==================================================

Anytime enthält aktive Tasks ohne echte Deadline.

Beispiel:

Start vorhanden
End fehlt

oder entsprechend der tatsächlichen Notion-Daten.

==================================================
32. SOMEDAY
==================================================

Someday ist eine explizite TÆSKS-Funktion.

Sie darf über lokale Metadata umgesetzt werden.

Someday Tasks sollen aus normalen aktiven Views herausfallen.

Sie bleiben weiterhin mit ihrem Notion Task verbunden.

==================================================
33. HIGHLIGHT
==================================================

Notion besitzt ein Highlight Checkbox Property.

Nutze es.

Today / Overview soll Daily Highlight sichtbar hervorheben.

Nicht als riesige Karte.

Beispiel:

highlight

[*] Finish TÆSKS parser
    TÆSKS · Web Development

==================================================
34. PROJECT VIEW
==================================================

Orientiere dich stark an der Projektansicht aus den Referenzbildern.

Beispiel:

< Web Development       $ TÆSKS                   [edit]

[ ] Build parser
    // due Oct 8

[ ] Add GitHub integration

[ ] Contact Inbox
    // due Oct 12

API
    [ ] PostgREST integration
    [ ] Health route

[+ task]

someday 3 >

note

┌──────────────────────────────────────┐
│ Markdown content...                  │
└──────────────────────────────────────┘

github

PR #18 Quick Add parser
Issue #7 Mobile navigation

attachments 4

🔗 Notion API docs
📄 architecture.md
🖼 parser-reference.png

Project View soll NICHT wie Notion aussehen.

Es soll die reduzierte TÆSKS Sprache verwenden.

==================================================
35. AREA VIEW
==================================================

Area View zeigt:

Area Name
Type
Projects
offene Tasks
Progress

Beispiel:

$ Hausaufgaben

projects

English               3
Physics               2
Mathematics           4

tasks

...

Area kann mehrere Projects enthalten.

==================================================
36. SEARCH
==================================================

Global Search:

Ctrl/Cmd + K

Suche über:

- Notion Tasks
- Projects
- Areas
- TÆSKS Notes
- Tags
- Attachments Metadata
- GitHub Repositories
- GitHub Issues
- Pull Requests
- Contact Submissions

Suchergebnisse nach Source gruppieren.

Keyboard Navigation.

==================================================
37. KEYBOARD-FIRST
==================================================

Implementiere sinnvolle Shortcuts.

Mindestens:

Cmd/Ctrl + K
Global Search

N
New Task / Quick Add

Escape
Close current overlay

Enter
Confirm

Arrow Up / Down oder J/K
Navigation in Listen

Space oder X
Task Complete Toggle, sofern Fokus eindeutig ist

E
Edit current item

?

Keyboard Shortcut Help

Keine Shortcuts verwenden, die normales Tippen in Inputs stören.

==================================================
38. COMMON INBOX
==================================================

TÆSKS besitzt eine gemeinsame Inbox.

Die Inbox vereinigt mehrere Quellen, aber unterscheidet klar deren Typ.

Mögliche Items:

- lokale Quick Add Drafts
- Parser-Fälle, die noch Area/Project brauchen
- ungelesene Contact Submissions
- GitHub Review Requests
- relevante GitHub Issues
- andere externe actionable Items

Wichtig:

GitHub Items bleiben GitHub Items.

Contact Submissions bleiben Contact Submissions.

Sie werden NICHT automatisch zu Tasks.

==================================================
39. EXTERNAL ITEM -> NOTION TASK
==================================================

Externe Items können mit:

Create Task

in einen Notion Task umgewandelt werden.

Dann zeige kompakten Task Composer:

Title
Area
Project
Start
Deadline

Optional Tags etc.

Nach Erstellung:

local external_item_links:

source
external_id
notion_task_id

speichern.

Dann kann UI anzeigen:

Task created ✓

==================================================
40. GITHUB
==================================================

GitHub Integration ist READ ONLY.

Authentifizierung:

Fine-grained Personal Access Token

Environment:

GITHUB_TOKEN=

Optional:

GITHUB_USERNAME=

Token ausschließlich serverseitig.

NIE an Browser liefern.

Zeige:

- Repositories
- Issues
- Pull Requests
- Review Requests
- Actions / Workflow Runs
- Commits

Keine GitHub Mutations.

Also NICHT:

- Issue schließen
- PR mergen
- Kommentar schreiben
- Branch ändern

Aus GitHub Item darf lediglich ein Notion Task erstellt werden.

==================================================
41. GITHUB VIEW
==================================================

GitHub UI soll der TÆSKS Sprache folgen.

Beispiel:

$ github

repositories

TÆSKS
SchulPlaner
Portfolio
Paperless Chat

reviews

● PR #42
  Fix mobile parser
  TÆSKS

issues

○ #18
  Contact Inbox errors

actions

✓ deploy
✕ test
● build

Kompakt.

Keine GitHub-Website kopieren.

==================================================
42. GITHUB PROJECT MAPPING
==================================================

Erlaube lokal:

Notion Project
↔
GitHub Repository

zu verbinden.

Speichere das Mapping in SQLite.

Beispiel:

Notion Project:
TÆSKS

GitHub:
username/taesks

Dann kann Project View automatisch:

github

PR ...
Issue ...
Action ...

anzeigen.

==================================================
43. CONTACT API
==================================================

Es existiert bereits ein separater Docker Compose Stack.

NICHT verändern.

NICHT in TÆSKS Docker Compose integrieren.

NICHT dasselbe Docker Network voraussetzen.

Der vorhandene Service ist erreichbar unter:

http://192.168.2.173:1917

Das muss als Environment Variable konfigurierbar sein:

CONTACT_API_BASE_URL=http://192.168.2.173:1917

Der Service ist PostgREST vor PostgreSQL.

Endpoint:

/contact_submissions

Beispieldatensatz:

{
  "id": 1,
  "site_origin": "itsmarian.dev",
  "name": "Example",
  "email": "example@example.com",
  "message": "Example message",
  "created_at": "2026-08-20T16:43:03.341348+00:00",
  "is_read": false
}

==================================================
44. CONTACT API ARCHITEKTUR
==================================================

Browser darf NICHT direkt:

192.168.2.173:1917

aufrufen.

Richtig:

Browser
↓
TÆSKS Server
↓
PostgREST API
↓
Postgres

Nur serverseitige Requests.

Kein CORS Workaround im Browser.

==================================================
45. CONTACT FUNKTIONEN
==================================================

Implementiere, sofern PostgREST es zulässt:

- Submissions laden
- sortieren
- filtern
- unread anzeigen
- read markieren
- unread markieren
- löschen
- aus Submission Notion Task erstellen

Beispiel GET:

/contact_submissions?order=created_at.desc

Unread:

/contact_submissions?is_read=eq.false&order=created_at.desc

Read:

PATCH
/contact_submissions?id=eq.1

Body:

{
  "is_read": true
}

Unread:

{
  "is_read": false
}

Delete:

DELETE
/contact_submissions?id=eq.1

Vor DELETE:

Bestätigungsdialog.

Falls API Operation nicht erlaubt:

sauberer Fehler.

Nicht vortäuschen, dass Aktion funktioniert hat.

==================================================
46. CONTACT VIEW
==================================================

Desktop:

links kompakte Liste
rechts Detail

Beispiel:

$ contact

3 unread

● Example Person
  itsmarian.dev
  5 min

○ Another Person
  itsmarian.dev
  yesterday

Detail:

Example Person
example@example.com

itsmarian.dev

Oct 3, 18:32

Message:
...

[create task]
[mark read]
[delete]

Optional:

mailto Link

Keine E-Mail-Funktion implementieren, sofern keine Mailintegration konfiguriert ist.

==================================================
47. CONTACT SECURITY
==================================================

Alle Contact Inhalte sind UNTRUSTED USER INPUT.

Deshalb:

- HTML escapen
- niemals raw HTML rendern
- URLs validieren
- Message als Text behandeln
- keine Scripts
- keine unsafe dangerouslySetInnerHTML

Unterstütze optional für später:

CONTACT_API_AUTH_HEADER=

aber funktioniere auch ohne.

Dokumentiere im README, dass die vorhandene PostgREST-Konfiguration serverseitig separat abgesichert werden sollte.

TÆSKS darf den externen Contact Stack NICHT automatisch verändern.

==================================================
48. TAGS
==================================================

Tags werden lokal in TÆSKS verwaltet.

Beispiele:

[bug]
[calls]
[prep]
[school]
[waiting]
[research]

Task kann mehrere Tags besitzen.

Tags müssen:

- gefiltert
- gesucht
- hinzugefügt
- entfernt

werden können.

==================================================
49. PRIORITY
==================================================

Task Priority lokal:

None
Low
Medium
High
Urgent

Quick Add darf optional Syntax unterstützen:

!
!!
!!!

oder Wörter:

urgent
high priority
dringend

Achte darauf, dass Parser nicht aggressiv falsch interpretiert.

==================================================
50. SAVED FILTERS
==================================================

User kann Filter speichern.

Beispiel:

Urgent
High Priority
Waiting
School
Development

Filter können kombinieren:

Area
Project
Tag
Priority
Date
Highlight
Someday
Completion

In SQLite speichern.

==================================================
51. REMINDERS
==================================================

Task kann einen lokalen Reminder haben.

Implementiere zunächst zuverlässig:

- Reminder Metadata
- in-app Reminder
- Browser Notification, wenn Berechtigung vorhanden

Wenn du Web Push zuverlässig self-hosted implementieren kannst:

- Service Worker
- VAPID
- Push Subscription
- SQLite Speicherung

Dann umsetzen.

Keine Fake-Funktion.

Falls bestimmte Browser systembedingt keine zuverlässigen Background Notifications erlauben:

im README transparent dokumentieren.

==================================================
52. RECURRENCE
==================================================

Task kann lokale Recurrence Rules besitzen.

Beispiele:

daily
weekly
every 2 weeks
monthly

Natural Language:

every 2 weeks
alle 2 Wochen

Beim Abschließen eines wiederkehrenden Tasks kann TÆSKS die nächste Notion Task Instanz erzeugen.

Dabei:

- Area übernehmen
- Project übernehmen
- lokale Tags übernehmen
- Priority übernehmen
- Datum korrekt fortschreiben

Doppelerstellung verhindern.

==================================================
53. MOBILE UX
==================================================

Die Referenzbilder zeigen eine sehr kompakte iPhone UI.

Orientiere dich daran.

Mobile Navigation NICHT als klassische riesige 5-Tab Bottom Bar erzwingen.

Bevorzuge hierarchische Navigation.

Beispiel Header:

< lists          $ TÆSKS              [edit]

oder:

< overview       $ English            [...]

Listen sollen den Bildschirm gut ausnutzen.

Keine Card-basierte Mobile UI.

==================================================
54. DESKTOP UX
==================================================

Desktop:

persistente Sidebar

Hauptcontent

optional rechter Inspector bei Task Detail

Beispiel:

┌───────────────┬──────────────────────┬──────────────┐
│ Sidebar       │ Main                 │ Inspector    │
│               │                      │ optional     │
└───────────────┴──────────────────────┴──────────────┘

Inspector nur öffnen, wenn sinnvoll.

Nicht permanent Bildschirm verschwenden.

==================================================
55. RESPONSIVE BEHAVIOR
==================================================

Desktop:
Sidebar permanent.

Tablet:
Sidebar einklappbar.

Mobile:
Sidebar wird eigene List View / Drawer.

Task Details:
eigene Seite oder Sheet.

Quick Add:
immer schnell erreichbar.

==================================================
56. PWA
==================================================

TÆSKS soll installierbar sein.

Implementiere:

- manifest
- icons / placeholders mit TÆSKS Branding
- theme colors
- standalone mode
- responsive viewport
- service worker, sofern Architektur geeignet

Offline:

Mindestens:

- App Shell
- zuletzt geladene Inhalte lesbar, sofern sinnvoll
- Quick Add Draft lokal zwischenspeichern

Externe Mutations dürfen bei Offline-Zustand NICHT als erfolgreich dargestellt werden.

==================================================
57. COMMAND PALETTE
==================================================

Cmd/Ctrl + K öffnet eine Command Palette.

Actions:

New Task
Search
Go to Inbox
Go to Today
Go to Project
Go to Area
Go to GitHub
Go to Contact
Toggle Theme
Open Settings
Refresh Data

Suchergebnisse und Commands dürfen kombiniert werden.

==================================================
58. SETTINGS / DIAGNOSTICS
==================================================

Keine klassische riesige Settings App.

Eine kompakte Settings/Diagnostics View reicht.

Zeige:

Notion
✓ connected

GitHub
✓ connected

Contact API
✓ reachable

Local Database
✓ healthy

Falls Fehler:

klar beschreiben.

Secrets niemals anzeigen.

Zusätzlich:

- Property Mapping
- Parser Aliases
- Project ↔ GitHub Mapping
- Theme
- optional LLM Status

==================================================
59. NOTION SCHEMA DIAGNOSTICS
==================================================

Beim Start oder manuell:

prüfen:

Tasks DB erreichbar?
Projects DB erreichbar?
Areas DB erreichbar?

Benötigte Properties vorhanden?

Relations korrekt?

Wenn nicht:

konkrete Fehlermeldung.

Beispiel:

Task property "Due Date" was not found.

Found:
- Name
- Date
- Project
- Area

Keine kryptischen API Errors an Enduser.

==================================================
60. DATA REFRESH
==================================================

Externe Daten sinnvoll cachen.

Nicht bei jedem Tastendruck komplette Notion Database laden.

Nutze:

- server-side cache
- query invalidation
- manual refresh
- reasonable stale times

Nach einer Mutation:
relevante Daten invalidieren.

==================================================
61. LOADING STATES
==================================================

Keine riesigen Spinner.

Verwende:

- dezente Skeletons
- Inline Status
- Text Placeholder

Design passend zur Terminal-Ästhetik.

==================================================
62. ERROR STATES
==================================================

Fehler sollen aussehen wie Teil von TÆSKS.

Beispiel:

! notion unavailable
  last successful sync 4 min ago

[retry]

oder:

! contact api unreachable
  http://192.168.2.173:1917

Nicht technische Stack Traces an Nutzer anzeigen.

==================================================
63. EMPTY STATES
==================================================

Minimal.

Beispiel:

today

// nothing here.

oder:

inbox 0

// you're clear.

Keine großen Illustrationen.

==================================================
64. ACCESSIBILITY
==================================================

Trotz Terminal-Look:

- semantisches HTML
- Keyboard Navigation
- Focus States
- ARIA wo notwendig
- ausreichende Farbkontraste
- Screen Reader Labels
- Reduced Motion berücksichtigen

==================================================
65. PERFORMANCE
==================================================

Ziel:

sehr schnelles UI.

Quick Add muss sich sofort anfühlen.

Parser zuerst lokal/deterministisch.

Kein LLM Request während normalen Tippens.

Debounce nur bei extern nötigen Operationen.

Keine unnötigen Re-Renders.

Große Task-Listen ggf. virtualisieren.

==================================================
66. ANIMATIONEN
==================================================

Sehr subtil.

Geeignet:

- 120–200ms
- opacity
- slight translate
- height transitions
- focus changes

Keine:
- bounce animations
- große spring effects
- übertriebene page transitions

Die App soll sich präzise anfühlen.

==================================================
67. SECURITY
==================================================

Server-only Secrets:

NOTION_TOKEN
GITHUB_TOKEN
GEMINI_API_KEY
CONTACT credentials, falls später nötig
VAPID private key

Nie:

NEXT_PUBLIC_*

für Secrets.

Alle Mutations validieren.

Zod Schemas.

Dateiuploads:

- Größe begrenzen
- MIME prüfen
- Dateiname sanitizen
- Pfad-Traversal verhindern

==================================================
68. ENVIRONMENT VARIABLES
==================================================

Erstelle eine vollständige .env.example.

Mindestens:

# APP

PORT=3000
DATA_DIR=/app/data

# NOTION

NOTION_TOKEN=
NOTION_TASKS_DATABASE_ID=
NOTION_PROJECTS_DATABASE_ID=
NOTION_AREAS_DATABASE_ID=

NOTION_TASK_TITLE_PROPERTY=Name
NOTION_TASK_DATE_PROPERTY=Due Date
NOTION_TASK_AREA_PROPERTY=Area
NOTION_TASK_PROJECT_PROPERTY=Project
NOTION_TASK_HIGHLIGHT_PROPERTY=Highlight

# GITHUB

GITHUB_TOKEN=
GITHUB_USERNAME=

# CONTACT

CONTACT_API_BASE_URL=http://192.168.2.173:1917
CONTACT_API_AUTH_HEADER=

# OPTIONAL AI FALLBACK

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.5-flash-lite

# OPTIONAL WEB PUSH

VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=

==================================================
69. DOCKER COMPOSE
==================================================

Beispielziel:

services:
  taesks:
    build:
      context: .
    container_name: taesks
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "2015:3000"
    volumes:
      - ./data:/app/data
    healthcheck:
      ...

KEINE dependencies auf:

contact_api
postgres
redis

Der Contact Stack läuft separat.

==================================================
70. HEALTH ENDPOINT
==================================================

Implementiere:

GET /api/health

Antwort ungefähr:

{
  "status": "ok",
  "services": {
    "localDatabase": "ok",
    "notion": "ok",
    "github": "ok",
    "contact": "ok"
  }
}

Optional Integrationen dürfen "disabled" sein.

Healthcheck des Containers darf nicht dauerhaft unhealthy werden, nur weil eine optionale Integration temporär down ist.

App selbst + lokale DB entscheiden über Container Health.

==================================================
71. TESTING
==================================================

Implementiere sinnvolle Tests.

Mindestens:

UNIT:

- date parser
- German dates
- English dates
- DD/MM ambiguity
- From X to Y
- Von X bis Y
- aliases
- project matching
- area matching
- relation validation
- interval overlap
- today logic
- next 7 days logic

INTEGRATION:

- Quick Add parse
- Notion adapter with mocks
- Contact PostgREST adapter
- GitHub adapter

E2E:

mindestens zentrale Happy Paths.

==================================================
72. WICHTIGE PARSER TESTS
==================================================

Tests müssen mindestens enthalten:

Input:

Make Presentation in English as Homework until the 10/10/2026

Expected:

title = Make Presentation
project = Englisch, sofern Alias vorhanden
area = Hausaufgaben, sofern Alias vorhanden
start = current date
end = 2026-10-10

Input:

Präsentation in Englisch als Hausaufgabe bis Freitag

Input:

Physics homework tomorrow

Input:

Physik lernen von Montag bis Freitag

Input:

Study physics from 5 Oct to 10 Oct

Input:

Fix API #TÆSKS @WebDevelopment until next Monday

==================================================
73. TIMEZONE
==================================================

Datumslogik muss timezone-safe sein.

User befindet sich in Deutschland.

Default App Timezone:

Europe/Berlin

Konfigurierbar:

APP_TIMEZONE=Europe/Berlin

"today" und "heute" müssen sich auf diese Timezone beziehen.

Keine UTC-Off-by-one Fehler.

==================================================
74. DATE DISPLAY
==================================================

UI darf kompakte englische/terminalartige Datumsdarstellung verwenden.

Beispielsweise:

sat oct 3
fri oct 9

oder lokalisiert.

Aber intern ISO Dates.

Der Parser versteht Deutsch und Englisch unabhängig von der UI-Sprache.

==================================================
75. LOCALIZATION
==================================================

Primäre UI darf zunächst Englisch sein, passend zum Stil der Referenz.

Parser versteht Deutsch + Englisch.

Architektur sollte spätere UI-Lokalisierung nicht verhindern.

==================================================
76. DETAIL: INBOX UX
==================================================

Beispiel:

$ inbox 4

CONTACT
● Website problem report
  itsmarian.dev · 12m

GITHUB
● review requested
  TÆSKS #42 · parser refactor

DRAFT
● Make Presentation
  missing project

Jedes Item mit passenden Aktionen.

Contact:

[open] [create task] [read]

GitHub:

[open] [create task]

Draft:

[complete fields] [delete]

==================================================
77. DETAIL: TASK ROW
==================================================

Task Row soll kompakt sein.

Beispiel:

[ ] Make Presentation [school]
    // English · Homework · today → fri

oder bei Deadline:

[ ] Pay the water bill
    // ⚑ thu oct 8

Overdue:

[ ] Finish parser
    // ⚑ oct 1 · 2 days late

Completion:

[x] ...

Completed Items dezent ausgrauen.

==================================================
78. DETAIL: PROJECT TREE
==================================================

Tree Lines wie Referenzen können verwendet werden:

Hausaufgaben
├── Englisch
├── Physik
└── Mathematik

Homelab
├── SchulPlaner
├── Paperless Chat
└── Habit Tracker

Use CSS, keine Bildassets für Tree Lines.

==================================================
79. DETAIL: COUNTS
==================================================

Counts rechtsbündig.

Beispiel:

inbox              3
today              7
next 7 days       12

Web Development
├── TÆSKS          7
└── Portfolio      3

Counts nur für offene/relevante Items, sofern sinnvoll.

==================================================
80. DELETE BEHAVIOR
==================================================

Notion Task Delete:

confirmation required.

Contact Submission Delete:

confirmation required.

Local Attachment Delete:

confirmation required.

Keine browser-native confirm() Dialoge.

Nutze konsistent gestaltete minimalistische Dialoge.

==================================================
81. REFRESH / SYNC
==================================================

Biete manuelles Refresh.

Zum Beispiel:

R

oder Command Palette:

Refresh Data

Sync-Indikator kompakt:

synced 12s ago

Nicht ständig dominante Spinner anzeigen.

==================================================
82. LOGGING
==================================================

Server Logs strukturiert.

Keine Secrets.

Bei Integration Errors:

source
operation
status
correlation id

Keine kompletten Auth Header loggen.

==================================================
83. README
==================================================

Erstelle vollständige README.

Enthalten:

- Was ist TÆSKS?
- Architektur
- Screenshots/Design-Prinzipien
- Requirements
- Environment Setup
- Notion Integration
- erwartete DB Relations
- GitHub PAT Setup
- Contact API
- Docker Build
- Docker Compose
- Port 2015
- persistent volume
- Backup von /app/data
- Troubleshooting
- Security Notes
- Optional LLM fallback
- Health endpoint

==================================================
84. CONTACT STACK NICHT VERÄNDERN
==================================================

Sehr wichtig:

Der bestehende Contact/Postgres Compose Stack ist NICHT Teil dieses Repositories.

Er läuft separat.

Die bestehende Architektur ungefähr:

contact_db
PostgreSQL 16

contact_api
PostgREST

Host-Port:
1917

TÆSKS greift lediglich serverseitig über:

CONTACT_API_BASE_URL

darauf zu.

Keine neuen Docker Networks verlangen.

Keine Änderung des bestehenden Compose voraussetzen.

==================================================
85. DEFINITION OF DONE
==================================================

Das Projekt gilt erst als fertig, wenn ALLES Folgende erfüllt ist:

[ ] Next.js App läuft
[ ] TypeScript ohne Errors
[ ] Lint erfolgreich
[ ] Production Build erfolgreich
[ ] Docker Image erfolgreich gebaut
[ ] Container erfolgreich gestartet
[ ] Port 2015 erreichbar
[ ] Healthcheck funktioniert
[ ] SQLite Migration funktioniert
[ ] Daten bleiben nach Container Restart erhalten
[ ] Dark Mode funktioniert
[ ] Light Mode funktioniert
[ ] Mobile funktioniert
[ ] Desktop funktioniert
[ ] Sidebar funktioniert
[ ] Area Tree funktioniert
[ ] Project View funktioniert
[ ] Notion lesen funktioniert
[ ] Notion Task erstellen funktioniert
[ ] Notion Task bearbeiten funktioniert
[ ] Notion Task abschließen funktioniert
[ ] Notion Task löschen funktioniert
[ ] Project/Area Relations validiert
[ ] Quick Add funktioniert
[ ] deutscher Parser funktioniert
[ ] englischer Parser funktioniert
[ ] Date Ranges funktionieren
[ ] Live Parse Preview funktioniert
[ ] Parser benötigt normalerweise kein LLM
[ ] optionaler LLM Fallback funktioniert oder ist sauber deaktiviert
[ ] Today View funktioniert
[ ] Overdue funktioniert
[ ] Next 7 Days Interval Logic funktioniert
[ ] Upcoming funktioniert
[ ] Anytime funktioniert
[ ] Someday funktioniert
[ ] Highlight funktioniert
[ ] Tags funktionieren
[ ] Priority funktioniert
[ ] Notes funktionieren
[ ] Attachments funktionieren
[ ] Saved Filters funktionieren
[ ] Search funktioniert
[ ] Command Palette funktioniert
[ ] GitHub read-only Integration funktioniert
[ ] GitHub Token bleibt serverseitig
[ ] Contact API wird serverseitig angesprochen
[ ] Contact Liste funktioniert
[ ] read/unread funktioniert, sofern API erlaubt
[ ] delete funktioniert, sofern API erlaubt
[ ] Contact -> Task funktioniert
[ ] GitHub -> Task funktioniert
[ ] Project ↔ Repo Mapping funktioniert
[ ] README vollständig
[ ] .env.example vollständig
[ ] keine Secrets committed
[ ] zentrale Parser Tests vorhanden
[ ] relevante Integration Tests vorhanden

==================================================
86. WENN API KEYS NOCH FEHLEN
==================================================

Du darfst nicht blockieren, nur weil beim initialen Build noch keine echten API Keys vorhanden sind.

Die Anwendung muss trotzdem:

- builden
- starten
- Health Endpoint liefern
- Setup/Diagnostics anzeigen

Integrationen dürfen dann z.B. anzeigen:

notion
// not configured

github
// not configured

contact
// unavailable

Aber:

Keine Fake-Daten verwenden, sobald echte Integrationen konfiguriert sind.

Für Entwicklung darfst du gezielte Fixtures für Tests verwenden.

==================================================
87. KEINE PLACEHOLDER-APP ALS ENDERGEBNIS
==================================================

Nicht akzeptabel:

- TODO-Kommentare statt Implementierung
- Fake Buttons
- statische Demo-Daten als Hauptfunktion
- "Implement this later"
- nicht verdrahtete UI
- nur Mockups
- API Funktionen, die niemals aufgerufen werden
- Dockerfile, das nicht getestet wurde

Wenn etwas wegen einer externen API technisch nicht möglich ist:

1. überprüfen
2. sauber behandeln
3. dokumentieren
4. UI entsprechend deaktivieren

Nicht simulieren.

==================================================
88. REIHENFOLGE DER IMPLEMENTIERUNG
==================================================

Arbeite ungefähr so:

PHASE 1
Repository und Architektur

PHASE 2
Design System + Shell

PHASE 3
SQLite + Persistence

PHASE 4
Notion Integration

PHASE 5
Area / Project / Task Tree

PHASE 6
Task CRUD

PHASE 7
Natural Language Parser

PHASE 8
Quick Add UI

PHASE 9
Views:
Inbox
Overview
Today
Next 7 Days
Upcoming
Anytime
Someday

PHASE 10
Notes / Tags / Attachments / Filters

PHASE 11
GitHub

PHASE 12
Contact API

PHASE 13
Search / Command Palette / Shortcuts

PHASE 14
PWA / Mobile

PHASE 15
Docker

PHASE 16
Tests / QA

Jede Phase muss abgeschlossen und geprüft sein, bevor die nächste beginnt.

==================================================
89. REFERENZBILDER
==================================================

Ich werde dir gemeinsam mit diesem Prompt mehrere Bilder und ggf. Videos geben.

Sie zeigen insbesondere:

- init.Tasks Feature Overview
- Markdown Notes
- Mobile Overview
- Someday View
- Sidebar / Lists
- Project Detail
- meine tatsächliche Notion Tasks Database
- meine tatsächliche Notion Projects Database
- meine tatsächliche Notion Areas Database

Nutze sie aktiv.

Analysiere:

- Spacing
- Hierarchie
- Tree Layout
- Font Sizing
- Inline Comments
- Date Presentation
- Colors
- Sidebar density
- Mobile Header
- Task Rows
- Project UI
- Note UI
- Attachments
- Quick Add Interaktion

TÆSKS soll sich visuell und in seiner Informationsdichte klar an diesen Referenzen orientieren.

Aber:

Es muss als eigenständiges Produkt TÆSKS erkennbar bleiben.

==================================================
90. ENDZIEL
==================================================

Das Endprodukt soll sich NICHT anfühlen wie:

"ein Dashboard, das Notion, GitHub und SQL nebeneinander anzeigt."

Es soll sich anfühlen wie:

MEIN persönliches Task Operating System.

Notion bildet die Task-Struktur.

TÆSKS bildet die Arbeitsoberfläche.

GitHub liefert Development Context.

Contact liefert externe Inputs.

SQLite erweitert Notion um TÆSKS-spezifische Funktionen.

Das zentrale mentale Modell lautet:

CAPTURE
↓
UNDERSTAND
↓
AREA
↓
PROJECT
↓
TASK
↓
ACT

TÆSKS soll extrem schnell sein.

Ich soll einen Gedanken eingeben können:

Make Presentation in English as Homework until Friday

Enter drücken

und TÆSKS versteht:

Make Presentation
→ Englisch
→ Hausaufgaben
→ today → Friday

Gleichzeitig soll ich:

- meine Projects sehen
- meine Areas sehen
- Notes speichern
- Attachments verwalten
- GitHub-Kontext sehen
- Contact Submissions bearbeiten
- Tasks daraus erzeugen
- alle Tasks über Today / Upcoming etc. planen

ohne die Anwendung verlassen zu müssen.

Das ist die Vision.

==================================================
91. DEINE AUFGABE JETZT
==================================================

Beginne aus dem leeren Ordner.

Erstelle zuerst einen konkreten internen Implementierungsplan.

Danach arbeite die Phasen mit den sequenziellen Subagenten ab.

Frage mich nur dann nach Informationen, wenn eine Entscheidung wirklich nicht aus:

- diesem Prompt
- den bereitgestellten Referenzbildern
- dem tatsächlichen Repository-Zustand
- den APIs/Schemas

abgeleitet werden kann.

Treffe kleine technische Entscheidungen selbstständig.

Ändere aber keine fundamentalen Produktanforderungen.

Teste das Ergebnis tatsächlich.

Beende deine Arbeit erst, wenn das Docker-Image gebaut wurde und die Anwendung in einem Container erfolgreich läuft oder ein konkret nachgewiesener externer Blocker besteht.

Liefere am Ende eine kurze Abschlussübersicht mit:

- Architektur
- implementierten Features
- Docker Start Command
- Port
- benötigten Environment Variables
- eventuell verbleibenden externen Voraussetzungen
- durchgeführten Tests

Das finale Ziel ist eine wirklich benutzbare erste Version von TÆSKS.