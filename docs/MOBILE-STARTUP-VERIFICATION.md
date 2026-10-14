# Mobile Oberfläche und Startzustand — 7. Oktober 2026

## Bestätigte Ursache

GitHub-, Contact- und Entwurfshinweise wurden in Overview nachträglich oberhalb der Aufgaben eingefügt. Mit zurückgehaltenen Quellenantworten verschob sich eine bereits sichtbare Cache-Aufgabe von y=379 auf y=483: 104 px. Nach der Änderung bleibt dieselbe Aufgabe an derselben Position (0 px Verschiebung).

Die Arbeitskopie zeigte vorhandene Graph-Daten bereits während der ersten Hintergrundprüfung. Ein generelles Warten auf diesen Request hätte den Cache-Start wieder verzögert. Der zusätzliche Nachrückeffekt lag in der Zusammenstellung der Ansicht und der Vorbereitung von Geräteentwürfen und Konfiguration, nicht in einer notwendigen Cache-Löschung.

## Änderungen

- `page.tsx`, `queries.ts`, `app-shell.tsx`: öffentliche Konfiguration serverseitig mitgeben; Geräteentwürfe vor dem ersten sichtbaren Workspace zusammenführen; Hydrierung abwarten. Vorhandene Graph-Daten sofort nutzen. Ohne notwendige Daten der Startansicht bis zum Ergebnis oder Fehler warten. Danach bleibt der Shell geöffnet.
- `app-shell.tsx`: nachgeladene Overview-Hinweise und Notion-Fehlerstatus unterhalb der Aufgaben anzeigen. Kein Eingangsversatz beim ersten Workspace; nur spätere Inhaltswechsel erhalten eine kurze Bewegung. History und bestehende Suche bleiben erhalten.
- `theme.tsx`: gespeichertes Theme vor dem sichtbaren Paint anwenden.
- `globals.css`: zusätzliche mobile Glasreserve von 16 auf 8 px und Overview-Innenabstand von 23 auf 16 px reduzieren. Safe-Area-Werte bleiben additiv erhalten. Header-Suche bleibt sichtbar; mobile Header-Schaltflächen mindestens 40 px.
- Listenansicht: dauerhaft montiertes Panel mit 220 ms Öffnen/200 ms Schließen, passend zum Task-Drawer. Bewegung von links, unterbrechbare CSS-Transitions, Fokusführung und inaktiver Hintergrund.
- `command-palette.tsx`, `primitives.tsx`, `globals.css`: größere Palette, scrollende Ergebnisse und feste Eingabe/Kopf-/Fußbereiche. Die mobile Höhe folgt dem Visual Viewport; Safe Area bleibt frei.
- `navigation.tsx`, `capture.tsx`, `globals.css`: Shortcut-Hinweise und Hilfeeintrag auf Mobilgeräten verbergen. Desktop-Hilfe und Tastaturfunktionen bleiben bestehen. Reduced Motion deaktiviert die Bewegungen.

## Durchgeführte Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| Regulärer Produktionsbuild mit ursprünglicher Next-Konfiguration | bestanden |
| TypeScript und ESLint der geänderten TS/TSX-Dateien | bestanden |
| Gezielte Unit-Tests: Start, PWA, Service Worker, Ansichten, Navigation, optimistische Zustände | 60 bestanden |
| Browserprüfungen am Produktionsbuild: Desktop und Smartphone | 17 bestanden; 1 ausschließlich mobiler Fall am Desktop übersprungen |
| Vollständige Unit-Suite | 456 bestanden; 4 fehlgeschlagen |

Die vier Fehler liegen in unveränderten Adaptertests: `notion.test.ts:282` (RELATION_UNAVAILABLE statt RELATION_CONFLICT), `notion.test.ts:295` (completionEnabled), `contact.test.ts:12` und `github.test.ts:60` (Cache-Status ok statt error). Diese Pfade wurden nicht verändert.

Browserfälle prüfen sichtbare Cache-Aufgaben bei verzögerter und fehlgeschlagener Aktualisierung, Hintergrund-Polling ohne neuen Splash, Start ohne Graph-Cache, Contact-Start mit Erfolg/Fehler sowie einen Geräteentwurf im ersten sichtbaren Offline-Inbox-Zustand. Dazu kommen Suche auf sechs Ansichten, erhaltener Header, Back/Forward, Launcher-Grenzen, schnelle Richtungsumkehr der Listenansicht, Escape, inaktiver Hintergrund und Reduced Motion.

Screenshots wurden in Edge/Chromium bei 320×568, 390×664, 430×932 und 1280×720 geprüft. Zusätzlich: simulierte Safe Area mit 47 px oben/34 px unten; Header-Abstand 55 px (=47+8). Eine auf 320×300 verkleinerte Sichtfläche prüft den verfügbaren Tastaturbereich mit sichtbarer Eingabe und Fußzeile.

## Grenzen und Datenerhalt

Keine echte iOS-Safari- oder installierte-PWA-Prüfung verfügbar. Der iOS-Systemblur und die echte Bildschirmtastatur sind durch Chromium-Simulation nicht belegt. Der erwähnte Referenz-Screenshot lag der Unterhaltung nicht als sichtbarer Anhang bei; ein direkter Vergleich war daher nicht möglich.

Alle Serverprüfungen verwendeten einen separaten temporären Datenordner und deaktivierte externe Integrationen; Browserfälle verwendeten Fixtures. Temporäre Testkonfigurationen wurden wiederhergestellt. Keine bestehenden API-/PWA-Caches, SQLite-Daten oder Geräteentwürfe gelöscht, keine API-/Schema-/Integrationsänderungen, keine neuen Dependencies und kein Deployment.
