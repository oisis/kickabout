# Kopanka

Zręcznościowa piłka nożna z widokiem z góry, 11 na 11, na telefon (PWA) i przeglądarkę.

```sh
npm install
npm run dev     # serwer w sieci lokalnej: otwórz http://<IP-komputera>:5173 na telefonie
npm test        # determinizm, mecz CPU–CPU do końca, wykrywanie gola
npm run build   # statyczna wersja w dist/
```

Sterowanie: lewa połowa ekranu to drążek, prawa to kopnięcie. Krótkie dotknięcie = podanie (celuje w kolegę w kierunku biegu), przytrzymanie = strzał (dłużej = mocniej i wyżej), bez piłki = wślizg. Na klawiaturze: strzałki/WASD + spacja.

## Architektura

- `src/sim.ts`: cała logika meczu. Stan to wyłącznie liczby całkowite (1 m = 1024 jednostki), stały krok 60 Hz, własny generator losowy z ziarnem. `step(state, [wejście0, wejście1])` to jedyna funkcja zmieniająca stan.
- `src/ai.ts`: komputer zwraca takie samo 5-bitowe słowo wejścia jak gracz (kierunki + kopnięcie).
- `src/render.ts`, `src/input.ts`, `src/main.ts`: rysowanie na canvasie, dotyk/klawiatura i pętla gry. Nie wpływają na symulację.

Multiplayer: to samo ziarno i ten sam strumień słów wejścia dają identyczny mecz na każdym urządzeniu. Serwer musi więc tylko łączyć graczy i rozsyłać po jednym słowie na klatkę, a `cpuInput` zastępuje wejście zdalnego gracza.

Instalacja na ekranie głównym i tryb offline (service worker) wymagają HTTPS. Do zbudowania APK posłuży później Capacitor.
