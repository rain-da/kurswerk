# Kurswerk

Kurswerk ist eine Börsen-App mit echten Kursen und einem Auto-Trader, der mit 100.000 € Spielgeld handelt.
Sie läuft **komplett kostenlos** und braucht kein Claude-Kontingent:

- **GitHub Actions** holt etwa alle 15 Minuten die Kurse (Yahoo Finance, CoinGecko) und lässt den Bot handeln, rund um die Uhr.
- **GitHub Pages** zeigt die App unter **https://rain-da.github.io/kurswerk/** an, auf Handy und PC mit demselben Stand.

**Aufs Handy:** Adresse im Browser öffnen → Teilen → **Zum Home-Bildschirm**. Dann startet Kurswerk wie eine App.

---

## Der Auto-Trader (Version 2)

- **Sechs Kaufmuster:** Momentum, Ausbruch (20-Tage-Hoch), Rücksetzer im Aufwärtstrend, Trend, Rebound und Marktführer (stärker als der Markt).
- **Lernt laufend:** Jedes Signal wird als „Schatten-Trade“ verfolgt, auch wenn der Bot es nicht kauft. Sobald klar ist, wie es ausgegangen wäre, passt ein lernendes Modell seine Einschätzung an. Echte Trades zählen doppelt.
- **Vortraining:** Beim Start lädt er ein Jahr Tageskurse aller Werte und rechnet daraus tausende historische Situationen durch.
- **Bessere Ausstiege:** Für jedes Muster testet er parallel mehrere Gewinnziele und nachgezogene Stopps und nimmt das, was am meisten bringt.
- **Schutz:** Stopp für jeden Trade, Stopp auf Einstand nach +1 R, Tagesverlust-Grenze, Risikostufe sinkt bei Rückgängen automatisch, Obergrenzen je Branche und für Krypto.
- **Kapitaleinsatz:** In der App unter Optionen → Auto-Trader einstellbar (50 %, 75 %, 90 % oder **Alles**). Bei „Alles“ verteilt der Bot das komplette Geld auf die besten Chancen. Das **Startkapital** (10.000 € bis 1 Mio. €) gilt ab dem nächsten Neustart.

Der Code der App liegt in `src/`; `python3 tools/build.py` baut daraus `index.html`.

---

## Optional: Geräte verbinden (Einstellungen, eigenes Depot, Design synchronisieren)

Den Bot, seine Gewinnkurve und alle Kurse siehst du auf jedem Gerät automatisch.
Damit auch **deine Änderungen** (Bot-Einstellungen, dein eigenes Depot, Farben) überall gleich sind und den Bot erreichen, braucht die App einen GitHub-Schlüssel:

1. GitHub → Profilbild → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name z. B. `kurswerk`, Ablauf nach Wunsch (z. B. 1 Jahr).
3. **Repository access → Only select repositories →** `kurswerk`.
4. **Permissions → Repository permissions:**
   - **Contents:** Read and write
   - **Actions:** Read and write (für den Knopf „Kurse holen“)
5. **Generate token** und den Schlüssel kopieren (beginnt mit `github_pat_`).
6. In Kurswerk unter **Optionen → Geräte verbinden** Repository (`rain-da/kurswerk`) und Schlüssel eintragen → **Speichern**. Einmal pro Gerät.

Der Schlüssel bleibt nur in deinem Browser gespeichert und landet nie im Repository.

---

## Gut zu wissen

- **Kosten:** 0 €. Öffentliche Repositories haben unbegrenzte Actions-Minuten, Pages ist gratis.
- **Kurse:** Echte Kurse, Aktien bis zu 15 Minuten verzögert. Echtes Live-Streaming gibt es kostenlos nicht verlässlich.
- **Zeitplan:** GitHub startet geplante Läufe manchmal ein paar Minuten später, zu Stoßzeiten auch mal 20–30 Minuten.
- **Öffentlich:** Weil das Repository öffentlich ist, kann jeder die Spielgeld-Trades des Bots sehen. Persönliche Daten enthält es nicht.
- **Pause nach 60 Tagen:** Wenn in einem öffentlichen Repository 60 Tage lang nichts passiert, pausiert GitHub geplante Läufe. Dann unter **Actions → Kurswerk Bot → Enable workflow** wieder einschalten.
- **Bot zurücksetzen:** In der App unter Optionen → „Auto-Trader neu starten“ (braucht den Schlüssel von oben).
- **Falls keine Kurse kommen:** Unter Actions die letzte Runde öffnen. Dort steht, welche Quelle geantwortet hat.

## Was wo liegt

| Datei/Ordner | Inhalt |
|---|---|
| `index.html` | die App |
| `engine.js` | Rechenkern: Kurse einlesen, Strategien, Risiko, Selbstanpassung |
| `bot/run.mjs` | eine Bot-Runde: Kurse holen, handeln, Daten schreiben |
| `.github/workflows/bot.yml` | Zeitplan und Veröffentlichung |
| `user/` | deine Einstellungen und dein eigenes Depot (schreibt die App) |
| Zweig `state` | aktueller Stand des Bots (schreibt der Bot) |
