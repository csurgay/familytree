<?php
/** Every tunable parameter of the app. The admin gear page is generated from this list. */
function ft_settings_def(): array
{
    return [
        // group, key, type, default, label, help, [options]
        ['Általános', 'site_title', 'text', 'A Csurgay család', 'Az oldal címe', 'A fejlécben és a böngészőfülön jelenik meg.'],
        ['Általános', 'site_subtitle', 'text', 'Családfa, fotók és történetek', 'Alcím', ''],
        ['Általános', 'home_person', 'person', 0, 'Kiinduló személy', 'Ő áll a fa-böngésző és a főoldali családfarészlet középpontjában, ha nincs más kitűzve.'],
        ['Általános', 'name_order', 'select', 'hu', 'Névsorrend', '', ['hu' => 'Vezetéknév Keresztnév', 'west' => 'Keresztnév Vezetéknév']],
        ['Általános', 'hide_suffix_numbers', 'bool', true, 'Sorszám-utótagok elrejtése', 'Pl. a TribalPages-ből jött „2” utótag ne látsszon a nevekben.'],
        ['Általános', 'theme', 'select', 'auto', 'Színséma', '', ['auto' => 'A rendszer szerint', 'light' => 'Világos', 'dark' => 'Sötét']],
        ['Általános', 'accent', 'color', '#a7782f', 'Kiemelő szín', 'Kitűzött elemek, aktív menüpont.'],

        ['Hozzáférés', 'public_access', 'select', 'login', 'Ki láthatja az oldalt?', '', ['public' => 'Bárki, bejelentkezés nélkül', 'login' => 'Csak bejelentkezett családtagok']],
        ['Hozzáférés', 'allow_register', 'bool', true, 'Bárki regisztrálhat saját jelszóval', 'A regisztráció az admin jóváhagyása után lesz aktív.'],
        ['Hozzáférés', 'oauth_google', 'bool', true, 'Belépés és regisztráció Google-fiókkal', 'Csak akkor jelenik meg, ha a config.php-ben ott a GOOGLE_CLIENT_ID és a GOOGLE_CLIENT_SECRET. Új családtag ezzel is admin-jóváhagyással kerül be.'],
        ['Hozzáférés', 'oauth_facebook', 'bool', true, 'Belépés és regisztráció Facebook-fiókkal', 'Csak akkor jelenik meg, ha a config.php-ben ott a FACEBOOK_APP_ID és a FACEBOOK_APP_SECRET.'],
        ['Hozzáférés', 'pw_reset', 'bool', true, 'Elfelejtett jelszó: új jelszó e-mailben küldött linkkel', 'A link egy óráig érvényes, egyszer használható. A szerver mail() funkciójával megy; ha a tárhely nem küld levelet, az admin a felhasználók között adhat új jelszót.'],
        ['Hozzáférés', 'register_notify', 'bool', true, 'E-mail az adminoknak új regisztrációról', 'A szerver mail() funkciójával; ha a tárhely nem küld levelet, a gombnál akkor is látszik a szám.'],
        ['Hozzáférés', 'living_years', 'int', 100, 'Élőnek tekintjük, ha ennél kevesebb éve született', 'Halálozási adat nélkül. Nyilvános módban az élők adatai rejtve maradnak.', [20, 150]],
        ['Hozzáférés', 'privacy_living', 'select', 'details', 'Élő személyek nyilvános módban', '', ['none' => 'Minden látszik', 'details' => 'Név látszik, dátum, hely, fotó rejtve', 'names' => 'Csak „Élő személy” felirat']],
        ['Hozzáférés', 'show_contacts', 'select', 'heads', 'Telefon és egyéb GEDCOM-adatok láthatósága', '', ['admin' => 'Csak admin', 'heads' => 'Admin és családfők', 'members' => 'Minden bejelentkezett']],
        ['Hozzáférés', 'comments', 'select', 'members', 'Hozzászólások', 'Személyek, családok, sztorik és fotók alatt a bejelentkezett tagok pontosíthatnak, kérdezhetnek, érdekességet írhatnak. Csak bejelentkezve láthatók.', ['off' => 'Kikapcsolva', 'members' => 'Bejelentkezett tagok írhatnak és olvashatnak']],
        ['Hozzáférés', 'login_max_attempts', 'int', 6, 'Sikertelen belépések a zárolásig', '', [3, 50]],
        ['Hozzáférés', 'login_lock_minutes', 'int', 10, 'Zárolás hossza (perc)', '', [1, 1440]],

        ['Szerkesztés', 'head_create_direct', 'bool', true, 'A családfő azonnal felvehet új adatot a saját ágán', 'Új személy, esemény, fotó, sztori.'],
        ['Szerkesztés', 'head_update_approval', 'bool', true, 'A családfő módosítása admin jóváhagyásra vár', ''],
        ['Szerkesztés', 'head_delete_approval', 'bool', true, 'A családfő törlése admin jóváhagyásra vár', ''],
        ['Szerkesztés', 'head_above_create', 'bool', true, 'A családfő a gyökere fölé is felvehet új személyt és adatot', 'Szülők, nagyszülők, testvérek, nagynénik… és hozzájuk esemény, fotó, sztori. A gyökér fölött már meglévő adatot (a saját korábbi felvitelét is) csak admin-jóváhagyással módosíthatja vagy törölheti.'],
        ['Szerkesztés', 'branch_spouses', 'bool', true, 'A házastársak is a családfő ágához tartoznak', ''],
        ['Szerkesztés', 'member_suggest', 'bool', true, 'Családtagok (és családfők a saját águkon kívül) javaslatot tehetnek', 'A javaslatok a jóváhagyási sorba kerülnek.'],
        ['Szerkesztés', 'story_author_edit', 'bool', true, 'A sztori szerzője jóváhagyás nélkül javíthatja a saját sztoriját', ''],

        ['Hozzáférés', 'backup_keep', 'int', 5, 'Ennyi saját teljes mentést őriz meg a szerveren', 'A data/backups mappában; a régebbiek automatikusan törlődnek. A feltöltött mentéseket nem törli.', [1, 50]],
        ['Nyelvek és szövegek', 'languages', 'multi', ['hu', 'en', 'de'], 'Nyelvek', 'Ezekre a nyelvekre fordítjuk a sztorikat. A DeepL kulcs a config.php-ben van (deepl_key).', ['hu' => 'Magyar', 'en' => 'English', 'de' => 'Deutsch']],
        ['Nyelvek és szövegek', 'translate_auto', 'bool', true, 'Sztori mentésekor automatikus fordítás', 'Ha ki van kapcsolva, az Import / export lapon kézzel indítható.'],
        ['Nyelvek és szövegek', 'notes_to_stories', 'bool', true, 'GEDCOM-importkor a hosszabb életrajzokból sztori is készül', 'Az életrajz a személy lapján is megmarad.'],
        ['Nyelvek és szövegek', 'notes_story_min', 'int', 80, 'Ennél hosszabb életrajzból lesz sztori (karakter)', 'A rövid bejegyzések (pl. „orvos”) csak az életrajzban maradnak.', [1, 5000]],
        ['Főoldal', 'recent_days', 'int', 365, 'Friss események időablaka (nap)', 'Ennyi napnál nem régebbi születés, esküvő, haláleset, keresztelő kerül a főoldalra.', [7, 3650]],
        ['Főoldal', 'recent_types', 'multi', ['BIRT', 'MARR', 'DEAT', 'CHR', 'BAPM'], 'Friss eseménytípusok', '', ['BIRT' => 'Születés', 'MARR' => 'Esküvő', 'DEAT' => 'Haláleset', 'CHR' => 'Keresztelő', 'BAPM' => 'Keresztség', 'ENGA' => 'Eljegyzés', 'BURI' => 'Temetés', 'GRAD' => 'Diploma']],
        ['Főoldal', 'recent_count', 'int', 8, 'Friss események száma', '', [1, 50]],
        ['Főoldal', 'recent_fallback', 'bool', true, 'Ha nincs friss esemény, a legutóbb rögzítettek látszanak', ''],
        ['Főoldal', 'anniversaries', 'bool', true, 'Évfordulók a főoldalon', 'Születés- és házassági évfordulók a következő napokban.'],
        ['Főoldal', 'anniversary_days', 'int', 14, 'Évfordulók előretekintése (nap)', '', [1, 60]],
        ['Főoldal', 'round_only_deceased', 'bool', true, 'Elhunytaknál csak a kerek évfordulók', '50., 100., 150. … születésnap.'],
        ['Főoldal', 'home_tree_kind', 'select', 'hourglass', 'Alapértelmezett főoldali családfarészlet', 'Ha nincs kitűzött fa.', ['hourglass' => 'Homokóra', 'ancestors' => 'Felmenők', 'descendants' => 'Leszármazottak', 'fan' => 'Legyező']],
        ['Főoldal', 'home_tree_gens', 'int', 2, 'Felmenő nemzedékek a főoldali fában', '', [1, 5]],
        ['Főoldal', 'home_tree_down', 'int', 2, 'Leszármazott nemzedékek a főoldali fában', '2 = gyerekek és unokák. Ha kilóg, a fa húzható és nagyítható.', [1, 5]],
        ['Főoldal', 'home_surnames', 'bool', true, 'Családnevek listája a főoldalon', 'Ábécérendben, több oszlopban; egy névre kattintva az ilyen nevű családtagok listája nyílik meg.'],
        ['Főoldal', 'home_surnames_bold', 'text', 'Csurgay, Szélig, Csáki, Boromissza, Baum, Cholnoky, Pellathy', 'Kiemelt (vastag) családnevek', 'Vesszővel elválasztva.'],
        ['Főoldal', 'home_surnames_min', 'int', 8, 'Automatikus kiemelés ennyi családtagtól', 'Akikből legalább ennyien vannak, azok neve is vastag. 0 = csak a fent felsoroltak.', [0, 1000]],
        ['Főoldal', 'home_stories', 'int', 3, 'Legújabb sztorik száma', '', [0, 12]],

        ['Diagramok', 'chart_gens_up', 'int', 4, 'Felmenő nemzedékek (alapérték)', '', [1, 10]],
        ['Diagramok', 'chart_gens_down', 'int', 3, 'Leszármazott nemzedékek (alapérték)', '', [1, 10]],
        ['Diagramok', 'chart_photos', 'bool', true, 'Fotók a dobozokban', ''],
        ['Diagramok', 'chart_places', 'bool', false, 'Helyek a dobozokban', ''],
        ['Diagramok', 'chart_font', 'int', 125, 'Betűméret a kártyákon (%)', 'A fán és a diagramokon, a kezdő nagyításnál. 100% = a nevek akkorák, mint az oldal normál szövege (16 px); a kártyák arányosan nőnek.', [60, 220]],
        ['Diagramok', 'chart_name_style', 'select', 'serif', 'Nevek betűtípusa a kártyákon', '', ['serif' => 'Talpas (klasszikus)', 'sans' => 'Talpatlan', 'sans_caps' => 'Talpatlan, NAGYBETŰS nevek']],
        ['Diagramok', 'chart_card', 'select', 'tall', 'Kártyák formája', 'Álló: keskeny kártya, fotó felül, alatta a név – a sűrű nemzedékek (sok unoka, sok felmenő) így jóval keskenyebbek, a fát inkább fel-le kell görgetni. Fekvő: széles kártya, fotó balra, mellette a név.', ['tall' => 'Álló (keskeny, fotó felül)', 'wide' => 'Fekvő (széles, fotó balra)']],
        ['Diagramok', 'chart_photo', 'select', 'large', 'Fotók mérete a kártyákon', 'A kártya magassága a fotóhoz igazodik. A „Nagyon nagy” kör kicsit kilóg a kártya széléből, az „Igazolványkép” lekerekített, álló téglalap. A házastársak csíkjában és a legyezőben a fotó mérete nem változik.', ['normal' => 'Normál', 'large' => 'Nagy', 'xl' => 'Nagyon nagy (kilóg a kártyából)', 'portrait' => 'Igazolványkép (álló téglalap)']],
        ['Diagramok', 'chart_style', 'select', 'album', 'Doboz stílus', '', ['album' => 'Album', 'classic' => 'Klasszikus', 'minimal' => 'Letisztult']],
        ['Diagramok', 'chart_png_scale', 'int', 2, 'PNG felbontás szorzó', '', [1, 4]],

        ['Fotók', 'upload_max_mb', 'int', 12, 'Feltöltés max. mérete (MB)', 'A szerver php.ini határa is számít.', [1, 100]],
        ['Fotók', 'photo_portrait_px', 'int', 800, 'Portré / egyszemélyes fotó max. mérete (px)', 'A nagyobb képeket erre kicsinyítjük (szélesség és magasság is legfeljebb ennyi).', [200, 6000]],
        ['Fotók', 'photo_group_px', 'int', 1600, 'Csoportkép (több ember) max. mérete (px)', 'Családi és albumfotóknál, ahol többen vannak a képen.', [200, 6000]],
        ['Fotók', 'thumb_px', 'int', 360, 'Bélyegkép mérete (px)', '', [120, 800]],
        ['Fotók', 'photo_quality', 'int', 80, 'JPEG tömörítés minősége (%)', '', [40, 100]],

        ['Kvíz', 'quiz_count', 'int', 10, 'Kérdések száma (alapérték)', '', [3, 50]],
        ['Kvíz', 'quiz_min', 'int', 5, 'Választható legkevesebb kérdés', '', [1, 50]],
        ['Kvíz', 'quiz_max', 'int', 20, 'Választható legtöbb kérdés', '', [1, 100]],
        ['Kvíz', 'quiz_mode', 'select', 'choice', 'Alap játékmód', '', ['choice' => '4 hasonló korú közül', 'list' => 'Névlistából']],
        ['Kvíz', 'quiz_age_band', 'int', 15, 'Hasonló kor: születési év eltérése legfeljebb (év)', '', [1, 100]],
        ['Kvíz', 'quiz_same_sex', 'bool', true, 'Válaszlehetőségek azonos neműek', ''],
        ['Kvíz', 'quiz_seconds', 'int', 0, 'Időkorlát kérdésenként (mp, 0 = nincs)', '', [0, 120]],
        ['Kvíz', 'quiz_list_all', 'bool', false, 'Névlista módban minden családtag szerepel', 'Különben csak azok, akikről van portré.'],
        ['Kvíz', 'quiz_toplist', 'int', 10, 'Toplista hossza', '', [0, 100]],
    ];
}

function ft_settings_defaults(): array
{
    $d = [];
    foreach (ft_settings_def() as $s) $d[$s[1]] = $s[3];
    return $d;
}

function ft_settings_load(DB $db): array
{
    $vals = ft_settings_defaults();
    if (!$db->tableExists('settings')) return $vals;
    foreach ($db->all('SELECT k, v FROM {settings}') as $r) {
        $v = json_decode($r['v'], true);
        $vals[$r['k']] = $v;
    }
    return $vals;
}

function ft_setting_set(DB $db, string $k, $v): void
{
    $j = json_encode($v, JSON_UNESCAPED_UNICODE);
    if ($db->val('SELECT id FROM {settings} WHERE k = ?', [$k])) $db->q('UPDATE {settings} SET v = ? WHERE k = ?', [$j, $k]);
    else $db->insert('settings', ['k' => $k, 'v' => $j]);
}

/** Validate + coerce one value according to its definition. Throws on invalid. */
function ft_setting_coerce(array $def, $v)
{
    [, $k, $type, $default, $label] = $def;
    $opt = $def[6] ?? null;
    switch ($type) {
        case 'bool': return (bool)$v;
        case 'int': case 'person':
            if (!is_numeric($v)) throw new InvalidArgumentException("$label: számot kérek.");
            $v = (int)$v;
            if ($type === 'int' && $opt && ($v < $opt[0] || $v > $opt[1])) throw new InvalidArgumentException("$label: {$opt[0]} és {$opt[1]} közötti érték kell.");
            return $v;
        case 'select':
            if (!isset($opt[$v])) throw new InvalidArgumentException("$label: érvénytelen választás.");
            return $v;
        case 'multi':
            return array_values(array_filter((array)$v, fn($x) => isset($opt[$x])));
        case 'color':
            if (!preg_match('/^#[0-9a-fA-F]{6}$/', (string)$v)) throw new InvalidArgumentException("$label: #rrggbb formátumú szín kell.");
            return strtolower($v);
        default:
            return mb_substr(trim((string)$v), 0, 500);
    }
}
