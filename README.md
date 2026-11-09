# Kurswerk

Kurswerk ist eine Börsen-App mit echten Kursen und einem Auto-Trader, der mit 100.000 € Spielgeld handelt.
Sie läuft **komplett kostenlos** und braucht kein Claude-Kontingent:

- **GitHub Actions** holt etwa alle 15 Minuten die Kurse (Yahoo Finance, CoinGecko) und lässt den Bot handeln, rund um die Uhr.
- **GitHub Pages** zeigt die App unter **https://rain-da.github.io/kurswerk/** an, auf Handy und PC mit demselben Stand.

**Aufs Handy:** Adresse im Browser öffnen → Teilen → **Zum Home-Bildschirm**. Dann startet Kurswerk wie eine App.

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
