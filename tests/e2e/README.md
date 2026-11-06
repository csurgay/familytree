# UI-forgatókönyvek

Böngészős tesztsorozat. Tipikus és trükkös családfa-helyzeteket épít fel **csak a felületen kattintva**,
ahogy egy családtag tenné, és minden lépés után ellenőrzi, hogy pontosan a helyes fa jött-e létre.

Valódi adathoz nem nyúl: egy ideiglenes mappába másolja a programot, saját PHP-szervert indít
üres SQLite-adatbázissal, a telepítőn keresztül létrehoz egy teszt-admint, és azon dolgozik.

## Futtatás

```
npm i -D playwright
npx playwright install chromium
node tests/e2e/ui-scenarios.js            # mind
node tests/e2e/ui-scenarios.js S6 S9      # csak ezek
HEADED=1 node tests/e2e/ui-scenarios.js   # nézd végig böngészőablakban
PHP=C:\xampp\php\php.exe node tests/e2e/ui-scenarios.js   # ha a php nincs a PATH-ban
```

A jelentés: `tests/e2e/report/index.html`. Forgatókönyvenként látszik, hogy átmentek-e az ellenőrzések,
hány kattintás, kitöltött mező és kérdés kellett, milyen ablakok jöttek fel, és milyen hibaüzenetek.
Képernyőképeket és használhatósági megjegyzéseket is tartalmaz.

## Forgatókönyvek

| | |
| --- | --- |
| S1 | Első személy és két szülő |
| S2 | Testvér: a szülőnél „Gyermek”, megkérdezi, melyik házastárssal |
| S3 | Féltestvér: az apa második felesége és közös gyerekük |
| S4 | Gyerek előző kapcsolatból (csak az anyáé) |
| S5 | Rossz helyre került gyerek javítása a családszerkesztőben |
| S6 | Később kiderül az ismeretlen apa |
| S7 | Csáki-eset: előbb az apa, a házastárs később, aztán a második szülő |
| S8 | Új házastárs, a meglévő gyerekek közül kiválasztva a közösek |
| S9 | Két testvér két testvért vesz el (Baum–Csurgay), Rokonság ábra két kapcsolattal |
| S10 | Ugyanaz a pár kétszer: a program nem engedi |
| S11 | Azonos nevű nagyapa és unoka: a keresőben évszámmal megkülönböztethető |
| S12 | Véletlen törlés: megerősítést kér, a fa ép marad |
| S13 | Telefonon: gyerek felvétele kérdéssel, nincs vízszintes görgetés |

Minden forgatókönyv végén épség-ellenőrzés is fut. Nem lehet a fában dupla házaspár, gyerek nélküli
egyszülős család, sem kettőnél több szülő.

Új forgatókönyvet a `SCENARIOS` listába lehet felvenni. A segédfüggvények (`addParent`, `addSpouse`,
`addChild`, `linkExisting`, `editFamilyKid`, `expect`) a `Run` osztályban vannak.
