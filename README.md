# Phinias

Eine minimalistische Schach-Analysewebsite mit React, chess.js und Stockfish.

## Lokal starten

```bash
npm install
npm run dev
```

Der Build kopiert die Stockfish-Browserdateien aus dem npm-Paket nach `public/engine`:

```bash
npm run build
npm run preview
```

## GitHub Pages

Das Projekt ist für die Veröffentlichung unter `https://<username>.github.io/phinias/` konfiguriert. Unter **Settings → Pages** muss als Quelle **GitHub Actions** ausgewählt sein. Danach wird die Website bei jedem Push auf `main` automatisch gebaut und veröffentlicht.

## Spielstärke

Phinias nutzt Stockfish Skill Level und UCI-Elo. Für niedrigere Stufen werden zusätzlich mehrere Kandidatenzüge analysiert und mit einer stufenabhängigen Gewichtung ausgewählt. Dadurch können schwächere Stufen bewusst ungenauere Züge spielen. Die tatsächliche Spielstärke bleibt abhängig von Gerät und Bedenkzeit.

## Hinweis

Stockfish wird lokal im Browser ausgeführt. Die erste Engine-Initialisierung kann je nach Gerät einen Moment dauern.
