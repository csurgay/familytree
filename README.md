# familytree – Családfa webapp

Gedcom based familytree with images, charts and distributed editing.


Családfa-navigáló és -szerkesztő PHP/MySQL webapp fotókkal, családi sztorikkal, diagramokkal,
arcképcsarnokkal és „Ki kicsoda?” kvízzel. Build-lépés nincs: a mappa egy az egyben feltölthető a tárhelyre.

## Telepítés

1. Töltsd fel a mappát a tárhelyre (pl. `csurgay.com/familytree`).
2. Tedd mellé – vagy eggyel feljebb, a repón kívülre – a `config.php`-t az adatbázis adataival. Bármelyik szokásos forma működik:
   `define('DB_HOST', …)` konstansok, `$servername / $username / $password / $dbname` változók,
   vagy `return ['db' => ['host'=>…, 'name'=>…, 'user'=>…, 'pass'=>…]]`. Minta: `config.sample.php`. Tábla-előtag: `DB_PREFIX` (alapból `ft_`),
   így közös adatbázisban is elfér más appok mellett.
3. Az `uploads/` mappa legyen írható a webszerver számára.
4. Nyisd meg az oldalt: az első indításkor létrehozod az admin fiókot, és egy pipával betöltöd a
   `.ged` fájlt (`csurgay.ged` – az app mappájában vagy eggyel feljebb keresi). A táblák maguktól létrejönnek.

Követelmény: PHP 8.0+, PDO MySQL, GD (fotókhoz), mbstring. A `pdo_sqlite` csak az autotesztekhez kell.
Ha nincs `config.php`, az app helyi SQLite fájlon fut (`data/familytree.sqlite`) – ez fejlesztéshez jó.

## Szerepek és elosztott szerkesztés

| Szerep | Mit tehet |
|---|---|
| **Admin** | Mindent azonnal. Felhasználókat vesz fel, ágakat rendel családfőkhöz, jóváhagy. |
| **Családfő** | A hozzá rendelt ág(ak)on – a kezdő személy leszármazottai és házastársaik – új személyt, eseményt, fotót, sztorit azonnal felvehet. Módosítás és törlés admin jóváhagyással. |
| **Családtag** | Megnézhet mindent, javaslatot tehet (jóváhagyási sorba kerül). |
| **Vendég** | Csak ha a beállításokban nyilvános az oldal; az élő személyek adatai rejtve. |

Minden módosítás egy „művelet” (`lib/ops.php`); a `lib/perms.php` dönti el, hogy azonnal érvényes,
jóváhagyásra vár, vagy tiltott. Az admin a Jóváhagyások lapon a régi és új értékeket egymás mellett látja.
A szabályok (pl. hogy a családfő módosítása is jóváhagyást kér-e) a fogaskerék alatt állíthatók.

## Funkciók

- **Kezdőlap:** kitűzött családfarészlet (élő, mozgatható diagram), kitűzött esemény, friss
  születések/esküvők/halálesetek/keresztelők, közelgő évfordulók, sztorik, új fotók.
  Kitűzni az admin tud: eseményt az idővonalon, fát a személy oldalán vagy a fa-böngészőben, sztorit, fotót.
- **Személy- és családlap:** életrajz, életút, szülők/testvérek/házastársak/gyermekek, fotók, sztorik,
  mini homokóra. Szerkesztés, rokon felvétele, meglévő személy kapcsolása.
- **Fotók:** feltöltés húzással, többet egyszerre; a szerver GD-vel újrakódolja (EXIF törlés, elforgatás
  javítása, bélyegkép). A nézegetőben személyek jelölhetők, kattintással megadható az arc helye
  (ez adja a portrék és a kvíz kivágását), beállítható fő portré.
- **Diagramok:** felmenők, leszármazottak, homokóra, legyező, családlap, rokonsági útvonal (magyar
  rokonsági elnevezéssel). Fotókkal, helyekkel, három dobozstílussal. Letöltés PNG/SVG, nyomtatás,
  mentés a közös „Diagramok” galériába.
- **Arcképcsarnok:** portrék nemzedékenként, szűrés családnévre, teljes névsor, fotóalbum.
- **Kvíz:** 5–20 arc (állítható), két mód: 4 hasonló korú (és azonos nemű) családtag közül, vagy
  névlistából; időkorlát, toplista.
- **GEDCOM import/export** (5.5.1, UTF-8). A TribalPages-specialitásokat (HTML-entitások, `<br>`,
  `b.1928` utótagok, `Mon DD YYYY` dátumok, „õ/û” elírások) az import kezeli.
- **Admin (fogaskerék):** minden paraméter, felhasználók, családfők és ágak, jóváhagyások,
  import/export, napló, autotesztek, rendszerinfó.

## Autotesztek

Fogaskerék → Autotesztek. A szerver tesztek (20 db) minden futáskor egy friss, memóriabeli SQLite
adatbázison dolgoznak, így az éles adatot nem érintik. A böngésző tesztek (15 db) a betöltött fán,
csak olvasva ellenőrzik a dátumkezelést, a diagramok átfedésmentességét, a rokonsági útvonalat,
a kvíz válaszgenerálását és az SVG-exportot. Parancssorból: `php tests/run.php`.

## Szerkezet

```
index.php, api.php        belépési pontok
lib/                      config-olvasó, DB-réteg (MySQL+SQLite), séma, dátumok, GEDCOM, fa, jogosultság, műveletek, fotók, API
assets/js/                core (API, router, segédek), views, edit, charts, quiz, admin, tests
assets/css/app.css        a teljes megjelenés (világos/sötét)
tests/                    szerver tesztek + parancssori futtató
uploads/                  feltöltött fotók és mentett diagramok (szkriptfuttatás tiltva)
```

A `.htaccess` fájlok elzárják a `lib/`, `tests/`, `data/` mappákat, a `config.php`-t és a `.ged` fájlokat.
A `config.php` a `.gitignore`-ban van, hogy a jelszó ne kerüljön a repóba.
