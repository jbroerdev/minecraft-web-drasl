# Minecraft Web + Drasl

[![Docker validation](https://github.com/jbroerdev/minecraft-web-drasl/actions/workflows/docker.yml/badge.svg)](https://github.com/jbroerdev/minecraft-web-drasl/actions/workflows/docker.yml)

JavaScript-Client für Minecraft 1.8.8/1.8.9 mit Drasl-Login, WebSocket-Gateway und Online-Bridge in einem Docker-Container. Kein WASM. Der Minecraft-Spielserver läuft separat.

## Auf dem VPS installieren

Voraussetzungen: Docker Engine mit Compose-Plugin und ein HTTPS-Reverse-Proxy auf dem VPS.

```sh
git clone https://github.com/jbroerdev/minecraft-web-drasl.git
cd minecraft-web-drasl
cp .env.example .env
# .env prüfen: Domain, erlaubte iframe-Eltern und Minecraft-Spielserver
nano .env
docker compose up -d --build
docker compose logs -f
```

Vorkonfiguriert für **https://explorer.xserverx.app/minecraft/** mit **wss://explorer.xserverx.app/minecraft/ws**. Drasl: https://drasl.xserverx.app. Spielserver: 193.181.217.200:25565.

Die Locations aus **nginx-explorer.conf** in den bestehenden HTTPS-VirtualHost von Explorer übernehmen. Dessen übrige Konfiguration beibehalten. Mit `nginx -t` prüfen und Nginx neu laden. Im Explorer-Programmfenster **https://explorer.xserverx.app/minecraft/** eintragen. Der Reverse Proxy reicht WebSocket-Upgrades an denselben Port weiter.

Für eine eigene Minecraft-Subdomain: PUBLIC_ORIGIN auf deren HTTPS-Origin setzen, DRASL_GATEWAY_URL auf wss://DEINE-DOMAIN/ws und die Location aus nginx-locations.conf verwenden. TLS-Zertifikat am vorhandenen Reverse Proxy einrichten.

## Verbindung und Ports

Browser → HTTPS/WSS-Reverse-Proxy → Port 8790 → Login/Client oder **/ws** → internes Gateway 8081 → interne Online-Bridge 25579 → Java-Spielserver.

Nur **127.0.0.1:8790** wird auf dem VPS veröffentlicht. Port 8081 bleibt intern. Diese Beispiele erwarten Nginx auf dem Host; ein containerisierter Reverse Proxy muss über ein gemeinsames Docker-Netz auf Port 8790 zugreifen.

Der Spielserver bleibt im Online-Modus und muss Drasl-Profile akzeptieren. Der Gateway prüft die Drasl-Sitzung, die Bridge übernimmt die verschlüsselte Java-Anmeldung. Das ist kein beliebiger offener TCP-Proxy: Das Ziel legt der Betreiber in MINECRAFT_HOST/PORT fest.

## Login und iframe

Der Login verwendet einen kurzlebigen Startnachweis im Arbeitsspeicher. Das Spiel wird über ein authentifiziert geladenes srcdoc gestartet; Drittanbieter-Cookies sind dafür nicht nötig. Drasl-Zugriffstokens verbleiben im Server-Arbeitsspeicher. Kein Passwort in URLs, Browser-Speicher oder Konfigurationsdateien. Nach Container-Neustart neu anmelden.

FRAME_ANCESTORS enthält exakte erlaubte Eltern-Origins, kommagetrennt. Bei mehreren verschachtelten iframes alle Vorfahren erlauben. Der äußere iframe benötigt bei Sandbox-Nutzung allow-scripts allow-same-origin allow-forms allow-pointer-lock und für Welt-Downloads allow-downloads. Vollbild mit allowfullscreen sowie allow="fullscreen; autoplay" freigeben. Siehe embed-example.html.

## Bedienung und Leistung

Schmale helle Menüleiste: Konto → Abmelden, Steuerung aktivieren und Ansicht → Grafikprofil. Login mit 3D-Minecraft-Logo und Dirt-Hintergrund.

Grafikprofile: Schnell (Standard, 75 % Auflösung, drei Chunks), Minimal (50 %, zwei Chunks), Ausgewogen (100 %, vier Chunks) und Nativ (ursprüngliche Grafikeinstellungen). Auswahl bleibt im Browser gespeichert. Eine konkrete FPS-Steigerung hängt vom Gerät ab.

## Betrieb und Updates

```sh
docker compose ps
docker compose logs --tail=100
git pull --ff-only
docker compose up -d --build
# Stoppen, persistente Daten behalten:
docker compose down
```

Das Volume minecraft-state enthält den zufällig beim ersten Start erzeugten Gateway-Schlüssel und dessen Konfiguration. **Keine** echten Login-Daten oder lokalen Sitzungen sind eingecheckt. Das Löschen des Volumes setzt diese Konfiguration zurück.

## Dateien und Herkunft

- server.mjs, online-bridge.mjs, index.html: Login, /ws-Weiterleitung, Online-Bridge und Oberfläche.
- client.tar.gz: fertig gebauter JavaScript-Client samt Ressourcen und Sprachen; Docker entpackt nach /app/web-dist.
- gateway.tar.gz: gepinnter BungeeCord-Build 1849, EaglercraftXBungee, DraslLogin-Plugin und Konfigurationsvorlagen; Docker entpackt nach /app/deploy.
- client-changes.tar.gz: angepasste Java-Quellen und Build-Helfer sowie DraslLogin-Pluginquellen. Basis: https://github.com/3kh0/eaglercraft-1.8, Commit 4cb71c5033b9e42245963464976aaa9a799703b4.
- LICENSE und CREDITS: vorhandene Herkunfts- und Lizenzhinweise. Minecraft-Grafiken bleiben Eigentum ihrer jeweiligen Rechteinhaber. Kein offizielles Mojang-/Microsoft-Produkt.

Die Ressourcen liegen als Archive im Repository, damit sich der Container auf dem VPS ohne Minecraft-Decompile oder JavaScript-Kompilierung bauen lässt.

## Validierung

Lokal geprüft: Drasl-Identität, abgewiesene Tickets, Logout/Revocation, iframe-Header, Login ohne Cookie sowie /ws-Upgrade und Binärdaten in beide Richtungen. Der Beitritt zur Spielwelt wurde zuvor mit derselben Client/Gateway/Bridge-Kombination lokal getestet. GitHub Actions hat das Docker-Image erfolgreich gebaut, den Container gestartet sowie HTTP, Login-Grafiken und den echten Gateway über /ws geprüft. Prüflauf: https://github.com/jbroerdev/minecraft-web-drasl/actions/runs/39655317586. Ein Deployment auf dem eigenen VPS inklusive TLS-Reverse-Proxy ist damit noch nicht geprüft.

Tests nach Entpacken des Clients: `mkdir -p ../web-dist && tar -xzf client.tar.gz -C ../web-dist && node --test server.test.mjs`. Die Tests verwenden simulierte Drasl-Antworten und brauchen kein echtes Konto.

