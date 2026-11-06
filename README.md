# Kickabout

Zręcznościowa piłka nożna z widokiem z góry, 11 na 11, na Androida (APK) i przeglądarkę, ze stroną www, kontami graczy i grą online.

Repozytorium: `git@github.com:oisis/kickabout.git`.

```sh
npm install
npm run dev                         # sama gra: http://<IP-komputera>:5173
npm test                            # symulacja, rozgrywki, kariera, serwer, konta
docker compose up --build           # strona + gra + API: http://localhost:8080 (gra pod /play/)
ANDROID_HOME=~/Android/Sdk npm run apk   # APK debug i release → apk/kickabout.apk
```

## Co jest w grze

- **Mecz:**
  - 11 na 11 z umiejętnościami zawodników (podania, strzały, główki, odbiór, kontrola, szybkość, bramkarz);
  - 9 formacji i własne taktyki;
  - 3 zmiany, faule, kartki, rzuty wolne i karne;
  - 7 rodzajów murawy (losowa albo zależna od pory roku);
  - zmiana stron, dogrywka, seria rzutów karnych;
  - numery na koszulkach, pauza, powtórki goli, statystyki, dźwięk.
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

Dwie usługi, każda z własnym obrazem Dockera:

| Usługa | Katalog | Obraz | Co robi |
|---|---|---|---|
| **API** | `server/` | `ghcr.io/oisis/kickabout-api` | konta (`/api/…`, SQLite w `/data`) i mecze online (WebSocket). Gry nie symuluje: kojarzy graczy, rozsyła słowa wejścia, co 2 s porównuje sumy kontrolne stanu i przerywa mecz przy rozjeździe. |
| **Strona** | `web/` + gra z `src/` | `ghcr.io/oisis/kickabout-web` | nginx: strona główna, panel konta, gra w przeglądarce pod `/play/`, APK pod `/download/kickabout.apk`. Przekazuje `/api/` i `/ws` do API (`API_UPSTREAM`). |

Gra:
- `src/sim.ts`: cała logika meczu. Stan zawiera wyłącznie liczby całkowite, krok trwa 1/60 s, generator losowy ma ziarno. `step(state, [wejście0, wejście1])` to jedyna funkcja zmieniająca stan.
- `src/ai.ts`: komputer zwraca takie samo słowo wejścia jak gracz.
- `src/competition.ts`, `src/career.ts`: czyste reguły rozgrywek i kariery. Zapisy są w JSON (localStorage `kickabout.*`, eksport do pliku; stare zapisy `kopanka.*` są przenoszone automatycznie).
- `src/match.ts`: prowadzi mecz lokalnie albo online, nagrywa wejścia i wyzwala dźwięki.
- `src/screens.ts`, `compScreens.ts`, `careerScreens.ts`, `editors.ts`: menu w HTML. `src/render.ts`: canvas.

## Konta graczy

Logowanie przez Google i GitHub (OAuth 2.0). Na stronie `/account.html` gracz zmienia nazwę, łączy i odłącza metody logowania, widzi zalogowane urządzenia, wylogowuje inne urządzenia i usuwa konto.

Konfiguracja API (zmienne środowiskowe):

| Zmienna | Znaczenie |
|---|---|
| `PUBLIC_URL` | publiczny adres strony, np. `https://kickabout.example.com` (adresy powrotu OAuth, ciasteczka `Secure` przy https) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth client ID (Web), redirect URI: `<PUBLIC_URL>/api/auth/google/callback` |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | [GitHub → Settings → Developer settings → OAuth Apps](https://github.com/settings/developers), callback URL: `<PUBLIC_URL>/api/auth/github/callback` |
| `DEV_LOGIN=1` | logowanie samym imieniem, tylko do testów |
| `DB_PATH` | plik SQLite (w obrazie `/data/kickabout.db`) |

Dostawca bez danych jest ukryty na stronie. Sesje to losowe tokeny w ciasteczku `HttpOnly; SameSite=Lax` (w bazie tylko ich skrót SHA-256), ważne 30 dni.

## Gra online

- **W przeglądarce** (`/play/`): adres serwera jest wpisany automatycznie (`/ws` tej samej strony).
- **W aplikacji**: domyślny adres ustawia się przy budowaniu APK (`VITE_SERVER=wss://kickabout.example.com/ws`, a odnośnik „Strona www i konto” w menu: `VITE_SITE=https://kickabout.example.com/`). Można też wpisać `IP:8787` serwera API w sieci lokalnej (`scripts/start-server.sh`).

Potem jedna z opcji:
- **Szybka gra:** łączysz się z dowolnym czekającym graczem.
- **Załóż pokój:** dostajesz kod dla znajomego.
- **Dołącz:** wpisujesz kod pokoju znajomego.

Długość meczu, murawę i zasady ustala założyciel pokoju. Opóźnienie sterowania wynosi 100 ms.

## Wdrożenie

**Docker Compose:** `docker compose up --build` uruchamia oba obrazy. Dane OAuth wpisz do `.env` (zmienne z tabeli wyżej). Lokalnie domyślnie działa `DEV_LOGIN=1`.

**Kubernetes (Helm):** chart `deploy/helm/kickabout`:

```sh
helm upgrade --install kickabout deploy/helm/kickabout -n kickabout --create-namespace \
  --set publicUrl=https://kickabout.example.com --set ingress.host=kickabout.example.com \
  --set api.oauth.githubClientId=… --set api.oauth.githubClientSecret=…
```

- API działa w jednej replice: SQLite na wolumenie RWO, a poczekalnia meczów jest w pamięci.
- Wolumen zostaje po `helm uninstall`.
- Dane OAuth można podać przez istniejący Secret (`api.oauth.existingSecret`).
- Dla prywatnych pakietów GHCR ustaw `imagePullSecrets`.

**Lokalny K3s:** `deploy/k3s-registry.yaml` (rejestr obrazów na `127.0.0.1:30500`) i `deploy/k3s-local.yaml`:

```sh
kubectl apply -f deploy/k3s-registry.yaml
docker build -f docker/api.Dockerfile -t 127.0.0.1:30500/kickabout-api:dev . && docker push 127.0.0.1:30500/kickabout-api:dev
docker build -f docker/web.Dockerfile -t 127.0.0.1:30500/kickabout-web:dev . && docker push 127.0.0.1:30500/kickabout-web:dev
helm upgrade --install kickabout deploy/helm/kickabout -n kickabout --create-namespace -f deploy/k3s-local.yaml
```

Strona: `https://kickabout.localhost` (Traefik, certyfikat domyślny) oraz `http://172.16.0.10:30080` dla telefonów w sieci lokalnej.

## CI/CD

`.github/workflows/release.yml`:
- każdy push i pull request: testy;
- push na `main`: APK oraz obrazy `ghcr.io/oisis/kickabout-{api,web}` z tagami `latest` i `sha-<commit>` (amd64 + arm64);
- tag `v1.2.3`: obrazy `1.2.3` i `1.2` oraz GitHub Release z APK.

Ustawienia repozytorium:
- zmienna `PUBLIC_URL`: adres, z którym łączy się APK;
- sekrety `ANDROID_KEYSTORE_BASE64` (`base64 -w0 android/release.jks`), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Bez nich APK jest podpisany kluczem debug.

Pobieranie obrazów na serwerze:

```sh
docker login ghcr.io -u oisis   # token z uprawnieniem read:packages, jeśli pakiety są prywatne
docker pull ghcr.io/oisis/kickabout-api:latest
docker pull ghcr.io/oisis/kickabout-web:latest
```

## Testy na emulatorach

`scripts/e2e-human.ts`: pełna sesja na dwóch emulatorach z APK debug. Przechodzi opcje, edytory drużyn i taktyk, mecz towarzyski, ligę, pokój online z pauzą i zmianą, szybką grę, najlepsze momenty i odnośnik do strony. Przykład: `SERVER=172.16.0.10:30080/ws node scripts/e2e-human.ts`.

## APK

- Identyfikator aplikacji to `com.kickabout.game`. Poprzednia `pl.kopanka.game` to osobna aplikacja: trzeba ją odinstalować.
- Wersja release jest podpisana kluczem `android/release.jks` (hasło w `android/keystore.properties`, oba poza gitem).
- **Zrób kopię zapasową klucza**: bez niego nie zainstalujesz aktualizacji na tę samą aplikację.
