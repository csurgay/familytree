# familytree – Családfa webapp

Gedcom based familytree with images, charts and distributed editing.


Családfa-navigáló és -szerkesztő PHP/MySQL webapp fotókkal, családi sztorikkal, diagramokkal,
arcképcsarnokkal és „Ki kicsoda?” kvízzel. Build-lépés nincs: a mappa egy az egyben feltölthető a tárhelyre.

## Telepítés

1. Töltsd fel a mappát a tárhelyre (pl. `csurgay.com/familytree`).
2. Tedd mellé – vagy eggyel feljebb, a repón kívülre – a `config.php`-t az adatbázis adataival
   (a szokásos PHP-s írásmódok mind működnek). A táblák előtaggal készülnek, így közös adatbázisban
   is elférnek más appok mellett.
3. Az `uploads/` mappa legyen írható a webszerver számára.
4. Nyisd meg az oldalt: az első indításkor létrehozod az admin fiókot, és egy pipával betöltöd a
   `.ged` fájlt (`csurgay.ged` – az app mappájában vagy eggyel feljebb keresi). A táblák maguktól létrejönnek.

Követelmény: PHP 7.4+, PDO MySQL, GD (fotókhoz), mbstring. A `pdo_sqlite` csak az autotesztekhez kell.
Ha nincs `config.php`, az app helyi SQLite fájlon fut (`data/familytree.sqlite`) – ez fejlesztéshez jó.

## Regisztráció, nyelvek

- **Regisztráció:** bárki regisztrálhat saját jelszóval (Belépés → Regisztrálj), és megírhatja, ki ő a családban.
- **Elfelejtett jelszó:** a Belépés oldalon az „Elfelejtetted a jelszavad?” linkre e-mailt küld egy egyszer használható, egy óráig érvényes linkkel (az adatbázisba csak a token hash-e kerül). Hogy egy címhez van-e fiók, a válasz nem árulja el; két percen belül nem megy újabb levél. Új jelszó után a fiók zárolása feloldódik, és a tag be is lép. A levél a szerver `mail()` funkciójával megy; ha a tárhely nem küld levelet, az admin a Felhasználóknál adhat új jelszót. Kikapcsolható: fogaskerék → Hozzáférés. Minden jelszómező mellett szemecske mutatja / rejti a beírt jelszót.
  A fiók az admin jóváhagyásáig nem aktív; a fogaskeréken szám jelzi a várakozókat (és ha a tárhely tud levelet
  küldeni, e-mail is megy). Jóváhagyáskor az admin megadhatja, ki ő a fában, és szerkeszthető ágat rendelhet
  hozzá – ezzel lesz valaki **családfő**. Később a Felhasználók lapon bármikor módosítható.
- **Fordítás:** a sztorik a bekapcsolt nyelvekre (alapból magyar, angol, német) DeepL-lel fordulnak mentéskor.
  A kulcs a `config.php`-ben van (a `:fx` végű ingyenes kulcs is működik); az
  adatbázisba és a böngészőbe nem kerül. A fejlécben választható a nyelv; a fordított sztori alatt
  egy kattintással látszik az eredeti. A már lefordított, változatlan szöveget nem küldi el újra.
  Minden más beírt szöveg is fordul, bármelyik nyelven írták: életrajzok, családjegyzetek, események
  megnevezése és jegyzete, fotók címe és leírása, hozzászólások, kitűzött elemek felirata. Az első
  megtekintéskor (vagy az Import / export lapon előre, egyben) fordul le, utána tárolva marad; a DeepL
  ismeri fel, milyen nyelven írták. Az eredeti szöveg nem változik, a fordítás mellett egy kis
  földgömb mutatja meg. Ha a DeepL hibázik vagy elfogy a keret, az eredeti látszik, és 10 percig nem próbálja újra.
  A teljes felület (menük, gombok, beállítások, dátumok, rokonsági elnevezések) magyarul, angolul és
  németül is elérhető; a nyelvválasztó a jobb felső sarokban van, a választás megmarad. A szótárak:
  `assets/i18n/en.json`, `de.json` (kulcs = a magyar szöveg).
- **Életrajzok a Történetek között:** a személyek és családok hosszabb életrajza (alapból 80 karakter
  felett) a Történetek menüpontban is megjelenik a nevével és életéveivel. Nem másolat: ugyanaz a szöveg,
  a személy (család) lapján kell szerkeszteni. A fogaskerék alatt kikapcsolható.

## Navigáció

- **Fán (kezdőlap, fa-böngésző, személylap):** egy kattintás/koppintás → gyorskártya (fotó, évek,
  „Megnyitás”, „Középre”); dupla kattintás/koppintás → az a személy lesz a kiinduló pont.
- Húzás, csippentés, egérgörgő a nagyításhoz; +/− és „igazítás” gomb.
- A fa-böngészőben a böngésző Vissza gombja az előző kiinduló pontra lép; billentyűk: ↑ apa, ↓ első gyerek,
  ← → testvérek/házastárs, Home a saját személyed (vagy a kezdő személy).

## Szerepek és elosztott szerkesztés

| Szerep | Mit tehet |
|---|---|
| **Admin** | Mindent azonnal. Felhasználókat vesz fel, ágakat rendel családfőkhöz, jóváhagy. |
| **Családfő** | A hozzá rendelt ág(ak)on – a kezdő személy leszármazottai és házastársaik – új személyt, eseményt, fotót, sztorit azonnal felvehet. Módosítás és törlés admin jóváhagyással. A gyökere **fölé** (szülők, nagyszülők, testvérek, nagynénik és családjaik) szintén azonnal felvehet új személyt és adatot, de az ott már meglévőt – a saját korábbi felvitelét is – csak jóváhagyással módosíthatja vagy törölheti. |
| **Családtag** | Megnézhet mindent, javaslatot tehet (jóváhagyási sorba kerül). Regisztráció után ez az alapszerep. |
| **Vendég** | Csak ha a beállításokban nyilvános az oldal; az élő személyek adatai, fotói és a róluk (vagy élő házaspár családjáról) szóló sztorik rejtve. |

Minden módosítás egy „művelet” (`lib/ops.php`); a `lib/perms.php` dönti el, hogy azonnal érvényes,
jóváhagyásra vár, vagy tiltott. Az admin a Jóváhagyások lapon a régi és új értékeket egymás mellett látja.
A szabályok (pl. hogy a családfő módosítása is jóváhagyást kér-e, felvehet-e a gyökere fölé) a fogaskerék alatt állíthatók.

**Hozzászólások:** személy, család, sztori és fotó alatt a bejelentkezett tagok írhatnak – pontosítást,
kérdést, emléket, érdekességet –, és válaszolhatnak egymásnak (egy szint mélyen). A saját hozzászólás
javítható és törölhető, az admin bármelyiket törölheti. A legfrissebbek a kezdőlapon is látszanak.
Az emléket, anekdotát mesélő hozzászólást írója (vagy az admin) megjelölheti „Történet”-nek: akkor a
Történetek menüpontban is megjelenik (ugyanaz a hozzászólás, nem másolat).
Vendégek nem látják őket; a fogaskerék alatt ki is kapcsolhatók.

## Funkciók

- **Kezdőlap:** kitűzött családfarészlet (élő, mozgatható diagram), kitűzött esemény, friss
  születések/esküvők/halálesetek/keresztelők, közelgő évfordulók, sztorik, új fotók, legutóbbi hozzászólások,
  és alul a **családnevek** ábécérendben, több oszlopban (a fő családnevek vastagon; a listájuk és a
  „legalább ennyi családtag” küszöb a fogaskerék alatt állítható). Egy névre kattintva az ilyen nevű
  családtagok listája nyílik meg; az ékezetes és ékezet nélküli írásmód (Szélig/Szelig) együtt látszik.
  Kitűzni az admin tud: eseményt az idővonalon, fát a személy oldalán vagy a fa-böngészőben, sztorit, fotót.
- **Személy- és családlap:** életrajz, életút, szülők/testvérek/házastársak/gyermekek, fotók, sztorik,
  mini homokóra. Szerkesztés, rokon felvétele, meglévő személy kapcsolása.
- **Fotók:** feltöltés húzással, többet egyszerre, mobilon kamerával is. Feltöltés előtt minden kép kivágható
  (nagyítás húzással, két ujjal vagy görgővel, forgatás, 1:1 / 3:4 / 4:3 keret) – személyhez feltöltve a
  kivágó magától megnyílik az archoz. A túl nagy képeket a böngésző már feltöltés előtt kicsinyíti; a szerver
  GD-vel újrakódolja (EXIF törlés, elforgatás javítása, bélyegkép), JPEG 80%-kal, portrét legfeljebb 800×800,
  csoportképet (családi, album, vagy bejelölve) legfeljebb 1600×1600 pixelre (fogaskerék alatt állítható). A nézegetőben személyek jelölhetők, kattintással megadható az arc helye
  (ez adja a portrék és a kvíz kivágását), beállítható fő portré.
- **Diagramok:** felmenők, leszármazottak, homokóra, legyező, családlap, rokonsági útvonal (magyar
  rokonsági elnevezéssel). Kétféle kártyával: álló (keskeny, fotó felül – sűrű nemzedéknél sokkal keskenyebb a fa,
  ez az alapértelmezés) vagy fekvő (széles, fotó balra); a fogaskerék alatt és a fa-böngészőben is választható.
  Fotókkal, helyekkel, három dobozstílussal, állítható kártya-betűmérettel
  (100% = normál szövegméret) és névbetűtípussal (talpas, talpatlan, nagybetűs). A felmenő-, leszármazott- és
  homokóra-diagramon a nemzedékek függőlegesen (fentről lefelé) vagy vízszintesen (balról jobbra) is elrendezhetők;
  a kitűzött főoldali fa is megőrzi a választást. Letöltés PNG/SVG, nyomtatás,
  mentés a közös „Diagramok” galériába.
- **Arcképcsarnok:** portrék nemzedékenként, szűrés családnévre, teljes névsor, fotóalbum.
- **Kvíz:** 5–20 arc (állítható), két mód: 4 hasonló korú (és azonos nemű) családtag közül, vagy
  névlistából; időkorlát, toplista.
- **Fotócsomag-import** (fogaskerék → Import / export): ZIP képekkel és `manifest.json`-nal; a képek a
  GEDCOM-azonosító alapján a megfelelő személyhez kerülnek, újrafuttatva nem duplikál. Így jöttek át a
  TribalPages-fotók (a TribalPages fotó-`pid` megegyezik a GEDCOM `@I…@` azonosítóval).
- **GEDCOM import/export** (5.5.1, UTF-8). A TribalPages-specialitásokat (HTML-entitások, `<br>`,
  `b.1928` utótagok, `Mon DD YYYY` dátumok, „õ/û” elírások) az import kezeli.
- **Admin (fogaskerék):** minden paraméter, felhasználók, családfők és ágak, jóváhagyások,
  import/export, napló, autotesztek, rendszerinfó.

## Belépés Google- vagy Facebook-fiókkal

A családtagok jelszó nélkül, a Google- vagy Facebook-fiókjukkal is beléphetnek.
- **Meglévő tag:** ha a Google / Facebook ugyanazt az (általa igazolt) e-mail címet adja, ami a tag fiókjában van, a két fiók magától összekapcsolódik. Más címmel a Fiókom oldalon kapcsolható össze (és ott választható le).
- **Új családtag:** a gomb után megírja, ki ő a családban, és az admin ugyanúgy jóváhagyja, mint a sima regisztrációt. Jelszava nincs; később a Fiókom oldalon beállíthat egyet.
- A titkos kulcsok csak a `config.php`-ben vannak; a gombok csak akkor jelennek meg, ha ott vannak, és a fogaskerék alatt (Hozzáférés) kikapcsolhatók.

**Google-kulcs** (console.cloud.google.com):
1. Új projekt → *APIs & Services* → *OAuth consent screen*: User type **External**, alkalmazás neve (pl. „A Csurgay család”), támogatási e-mail; scope-nak elég az alap (`openid`, `email`, `profile`). Végül **Publish app** („In production”) – különben csak a felvett tesztfelhasználók léphetnek be. Ezekhez a scope-okhoz nem kell Google-ellenőrzés (logót ne tölts fel, az ellenőrzést indít).
2. *Credentials* → *Create credentials* → *OAuth client ID* → *Web application*. **Authorized redirect URI:** `https://csurgay.com/family/oauth.php` (pontosan így; próbapéldánynál annak a címe is).
3. A kapott *Client ID* és *Client secret* → `config.php`.

**Facebook-kulcs** (developers.facebook.com):
1. *My Apps* → *Create App* → „Authenticate and request data from users with Facebook Login” (Consumer).
2. *Facebook Login* → *Settings*: **Valid OAuth Redirect URIs:** `https://csurgay.com/family/oauth.php`.
3. *App settings* → *Basic*: kell egy **adatvédelmi tájékoztató** URL-je és az adattörlési útmutató URL-je, utána az alkalmazás **Live** módba kapcsolható (addig csak a fejlesztők léphetnek be). Az `email` és `public_profile` engedélyhez nem kell App Review.
4. *App ID* és *App secret* → `config.php`.

Biztonság: egyszer használható, munkamenethez kötött `state`, 10 perces korlát, Google-nél PKCE és `nonce`, a Google-azonosító kibocsátójának és címzettjének ellenőrzése, Facebooknál `appsecret_proof`. A tokeneket a szerver közvetlenül kéri le és nem tárolja; csak a szolgáltatói azonosító kerül az adatbázisba (`user_identities` tábla, a teljes mentésben benne van).

## Teljes mentés és visszaállítás

Fogaskerék → Import / export → **Teljes mentés és visszaállítás**.

- **Mentés készítése most:** egyetlen ZIP-be kerül minden adatbázis-tábla (személyek, családok, események, fotók adatai és arcjelölései, sztorik és fordításaik, hozzászólások, diagramok, felhasználók jelszó-hash-sel, családfők és ágak, beállítások, jóváhagyási sor, napló) és az `uploads/` összes képe. Nincs benne: `config.php` (adatbázis-jelszó, DeepL kulcs), munkamenetek, jelszó-visszaállító linkek.
- A ZIP a szerveren a `data/backups` mappába kerül (webről nem érhető el), onnan tölthető le; a letöltés megszakadás után folytatható. A legutóbbi N saját mentés marad meg (beállítás: *Ennyi saját teljes mentést őriz meg a szerveren*, alapból 5).
- Lépésekben dolgozik (kérésenként ~8 s), így a megosztott tárhely időkorlátja nem akasztja meg; nem kell hozzá ZipArchive. A ZIP szabványos, bármelyik kicsomagolóval megnyitható (`manifest.json`, `OLVASSEL.txt`, `db/*.json`, `uploads/…`).
- **Visszaállítás másik tárhelyen:** másold fel a programot, írd meg a `config.php`-t az új adatbázissal, telepítsd (a kiinduló GEDCOM pipát kiveheted), lépj be az ideiglenes admin fiókkal, Import / export → *Mentés feltöltése* (darabokban megy, a tárhely feltöltési korlátja nem számít), majd a listában **Visszaállítás**. Utána mindenkit kiléptet; a mentésben lévő fiókokkal lehet belépni, az ideiglenes admin eltűnik.
- Biztonság: semmi nem változik, amíg minden képfájl ki nincs csomagolva és ellenőrizve (CRC), és minden tábla be nem olvasható. Az adatbázis egyetlen tranzakcióban cserélődik; ha ez nem sikerül, a régi `uploads/` visszakerül. Visszaállítás előtt alapból teljes mentés készül a mostani állapotról. Csak `uploads/photos|thumbs|charts` alatti képfájl kerülhet vissza (szkript, `.htaccess`, `../` útvonal soha). Újabb adatbázis-szerkezetű mentést nem tölt vissza (előbb a programot kell frissíteni); régebbit igen, a hiányzó oszlopok utána létrejönnek.
- A mentés élő családtagok adatait és a jelszó-hash-eket tartalmazza: bizalmasan kezelendő.

## Autotesztek

Fogaskerék → Autotesztek. A szerver tesztek (27 db) minden futáskor egy friss, memóriabeli SQLite
adatbázison dolgoznak, így az éles adatot nem érintik. A böngésző tesztek (15 db) a betöltött fán,
csak olvasva ellenőrzik a dátumkezelést, a diagramok átfedésmentességét, a rokonsági útvonalat,
a kvíz válaszgenerálását és az SVG-exportot. Parancssorból: `php tests/run.php`.

## Szerkezet

```
index.php, api.php        belépési pontok
lib/                      config-olvasó, DB-réteg (MySQL+SQLite), séma, dátumok, GEDCOM, fa, jogosultság, műveletek, fotók, API
assets/js/                core (API, router, segédek), views, edit, comments, charts, quiz, admin, tests
assets/css/app.css        a teljes megjelenés (világos/sötét)
tests/                    szerver tesztek + parancssori futtató
uploads/                  feltöltött fotók és mentett diagramok (szkriptfuttatás tiltva)
```

A `.htaccess` fájlok elzárják a `lib/`, `tests/`, `data/` mappákat, a `config.php`-t és a `.ged` fájlokat.
A `config.php` a `.gitignore`-ban van, hogy a jelszó ne kerüljön a repóba.
