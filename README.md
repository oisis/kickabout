# Kopanka

Zręcznościowa piłka nożna z widokiem z góry, 11 na 11, na Androida (APK), przeglądarkę i PWA.

```sh
npm install
npm run dev                     # gra w sieci lokalnej: http://<IP-komputera>:5173
npm test                        # symulacja, rozgrywki, kariera, serwer (lockstep, pokoje)
scripts/start-server.sh         # serwer gry online (port 8787, PORT=… zmienia)
ANDROID_HOME=~/Android/Sdk npm run apk   # APK debug i release
```

## Co jest w grze

- **Mecz:**
  - 11 na 11 z umiejętnościami zawodników (podania, strzały, główki, odbiór, kontrola, szybkość, bramkarz);
  - 9 formacji i własne taktyki;
  - 3 zmiany, faule, kartki, rzuty wolne i karne;
  - 7 rodzajów murawy (losowa albo zależna od pory roku);
  - zmiana stron, dogrywka, seria rzutów karnych;
  - pauza, powtórki goli, statystyki, dźwięk.
- **Sterowanie:** dotyk (drążek po lewej, KOP po prawej, krótko = podanie, dłużej = strzał, bez piłki = wślizg), klawiatura (gracz 2: WASD + F) i pad.
- **Tryby:**
  - mecz towarzyski (gracz kontra komputer, 2 graczy na jednym urządzeniu, komputer kontra komputer);
  - rozgrywki: liga, puchar (jeden mecz albo dwumecz z bramkami na wyjeździe), turniej (grupy + puchar), gotowe albo własne;
  - kariera (20 sezonów);
  - gra online.
- **Kariera:** grający trener albo trener, dwie ligi z awansem i spadkiem, puchar, finanse, rynek transferowy, oferty pracy, starzenie się zawodników.
- **Edytory:** drużyny (nazwy, stroje, zawodnicy, umiejętności) i taktyki (przeciąganie zawodników).
- **Najlepsze momenty:** gole zapisują się automatycznie, można je odtwarzać, eksportować i importować.

- **Drużyny:**
  - 8 lig europejskich (Anglia, Hiszpania, Niemcy, Włochy, Francja, Holandia, Portugalia, Polska) po 4 klasy rozgrywkowe (I–IV liga) z 12 klubami, łącznie 384 kluby;
  - nazwy klubów w formacie „prawdziwe miasto + wymyślona nazwa” (np. „London Navigators”, „Kraków Burza”);
  - 40 reprezentacji (24 z Europy, 16 z reszty świata);
  - wszyscy zawodnicy są fikcyjni.
- **Gotowe rozgrywki:**
  - w każdym kraju I–IV liga i puchar kraju (48 klubów);
  - dla klubów Puchar Kontynentu (grupy, potem dwumecze) i Tarcza Kontynentu;
  - dla reprezentacji Turniej Narodów Europy (16 drużyn) i Turniej Narodów Świata (32 drużyny);
  - nazwy rozgrywek są opisowe, nie są to marki UEFA ani FIFA.
- **Kariera:** w dowolnej lidze (I–IV) jednego z 8 krajów, z awansem i spadkiem po 2 kluby między każdą parą lig oraz pucharem kraju.
- **Podkręcanie piłki:** przez 0,4 s po kopnięciu drążek w bok zakręca piłkę, do tyłu podbija ją wyżej, a do przodu ją obniża.
- **Języki:** polski, angielski, francuski, niemiecki, włoski, hiszpański i niderlandzki (Opcje → Język). Domyślnie gra używa języka systemu. Tłumaczenia są w `src/lang.ts`, a test `test/i18n.test.ts` pilnuje, żeby każdy tekst miał tłumaczenie we wszystkich językach.

- **Dźwięk:** prawdziwe nagrania na licencji CC0 (kopnięcia, gwizdek, radość po golu, tło trybun) i muzyka w menu. Źródła są w `public/audio/CREDITS.md`. Gdy któregoś pliku brakuje, gra używa dźwięku syntezowanego.

## Architektura

- `src/sim.ts`: cała logika meczu. Stan zawiera wyłącznie liczby całkowite, krok trwa 1/60 s, generator losowy ma ziarno. `step(state, [wejście0, wejście1])` to jedyna funkcja zmieniająca stan. Słowo wejścia niesie sterowanie (bity 0–4) oraz polecenia: pauzę, zmianę zawodnika i taktykę.
- `src/ai.ts`: komputer zwraca takie samo słowo wejścia jak gracz.
- `src/competition.ts`, `src/career.ts`: czyste reguły rozgrywek i kariery. Zapisy są w JSON (localStorage, eksport do pliku).
- `src/match.ts`: prowadzi mecz lokalnie albo online, nagrywa wejścia (powtórki odtwarzają symulację od migawki) i wyzwala dźwięki.
- `src/screens.ts`, `compScreens.ts`, `careerScreens.ts`, `editors.ts`: menu w HTML. `src/render.ts`: canvas.
- `server/server.ts`: serwuje grę, kojarzy graczy w pary (szybka gra albo pokój z 4-literowym kodem) i rozsyła słowa wejścia. Gry nie symuluje. Co 2 s porównuje sumy kontrolne stanu obu graczy i kończy mecz przy rozjeździe.

## Gra online

Uruchom `scripts/start-server.sh`. W grze wybierz „Gra online”, wpisz adres `IP:8787` i swoją drużynę. Potem jedna z opcji:
- **Szybka gra:** łączysz się z dowolnym czekającym graczem.
- **Załóż pokój:** dostajesz kod dla znajomego.
- **Dołącz:** wpisujesz kod pokoju znajomego.

Długość meczu, murawę i zasady ustala założyciel pokoju. Opóźnienie sterowania wynosi 100 ms. Połączenie jest nieszyfrowane (`ws://`), więc serwer nadaje się do sieci domowej albo VPN (np. Tailscale), nie do otwartego internetu.

## APK

Wersja release jest podpisana kluczem `android/release.jks` (hasło w `android/keystore.properties`, oba poza gitem). **Zrób kopię zapasową klucza**: bez niego nie zainstalujesz aktualizacji na tę samą aplikację.
