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
        ['Hozzáférés', 'living_years', 'int', 100, 'Élőnek tekintjük, ha ennél kevesebb éve született', 'Halálozási adat nélkül. Nyilvános módban az élők adatai rejtve maradnak.', [20, 150]],
        ['Hozzáférés', 'privacy_living', 'select', 'details', 'Élő személyek nyilvános módban', '', ['none' => 'Minden látszik', 'details' => 'Név látszik, dátum, hely, fotó rejtve', 'names' => 'Csak „Élő személy” felirat']],
        ['Hozzáférés', 'show_contacts', 'select', 'heads', 'Telefon és egyéb GEDCOM-adatok láthatósága', '', ['admin' => 'Csak admin', 'heads' => 'Admin és családfők', 'members' => 'Minden bejelentkezett']],
        ['Hozzáférés', 'login_max_attempts', 'int', 6, 'Sikertelen belépések a zárolásig', '', [3, 50]],
        ['Hozzáférés', 'login_lock_minutes', 'int', 10, 'Zárolás hossza (perc)', '', [1, 1440]],

        ['Szerkesztés', 'head_create_direct', 'bool', true, 'A családfő azonnal felvehet új adatot a saját ágán', 'Új személy, esemény, fotó, sztori.'],
        ['Szerkesztés', 'head_update_approval', 'bool', true, 'A családfő módosítása admin jóváhagyásra vár', ''],
        ['Szerkesztés', 'head_delete_approval', 'bool', true, 'A családfő törlése admin jóváhagyásra vár', ''],
        ['Szerkesztés', 'branch_spouses', 'bool', true, 'A házastársak is a családfő ágához tartoznak', ''],
        ['Szerkesztés', 'member_suggest', 'bool', true, 'Családtagok (és családfők a saját águkon kívül) javaslatot tehetnek', 'A javaslatok a jóváhagyási sorba kerülnek.'],
        ['Szerkesztés', 'story_author_edit', 'bool', true, 'A sztori szerzője jóváhagyás nélkül javíthatja a saját sztoriját', ''],

        ['Főoldal', 'recent_days', 'int', 365, 'Friss események időablaka (nap)', 'Ennyi napnál nem régebbi születés, esküvő, haláleset, keresztelő kerül a főoldalra.', [7, 3650]],
        ['Főoldal', 'recent_types', 'multi', ['BIRT', 'MARR', 'DEAT', 'CHR', 'BAPM'], 'Friss eseménytípusok', '', ['BIRT' => 'Születés', 'MARR' => 'Esküvő', 'DEAT' => 'Haláleset', 'CHR' => 'Keresztelő', 'BAPM' => 'Keresztség', 'ENGA' => 'Eljegyzés', 'BURI' => 'Temetés', 'GRAD' => 'Diploma']],
        ['Főoldal', 'recent_count', 'int', 8, 'Friss események száma', '', [1, 50]],
        ['Főoldal', 'recent_fallback', 'bool', true, 'Ha nincs friss esemény, a legutóbb rögzítettek látszanak', ''],
        ['Főoldal', 'anniversaries', 'bool', true, 'Évfordulók a főoldalon', 'Születés- és házassági évfordulók a következő napokban.'],
        ['Főoldal', 'anniversary_days', 'int', 14, 'Évfordulók előretekintése (nap)', '', [1, 60]],
        ['Főoldal', 'round_only_deceased', 'bool', true, 'Elhunytaknál csak a kerek évfordulók', '50., 100., 150. … születésnap.'],
        ['Főoldal', 'home_tree_kind', 'select', 'hourglass', 'Alapértelmezett főoldali családfarészlet', 'Ha nincs kitűzött fa.', ['hourglass' => 'Homokóra', 'ancestors' => 'Felmenők', 'descendants' => 'Leszármazottak', 'fan' => 'Legyező']],
        ['Főoldal', 'home_tree_gens', 'int', 2, 'Nemzedékek a főoldali fában', '', [1, 5]],
        ['Főoldal', 'home_stories', 'int', 3, 'Legújabb sztorik száma', '', [0, 12]],

        ['Diagramok', 'chart_gens_up', 'int', 4, 'Felmenő nemzedékek (alapérték)', '', [1, 10]],
        ['Diagramok', 'chart_gens_down', 'int', 3, 'Leszármazott nemzedékek (alapérték)', '', [1, 10]],
        ['Diagramok', 'chart_photos', 'bool', true, 'Fotók a dobozokban', ''],
        ['Diagramok', 'chart_places', 'bool', false, 'Helyek a dobozokban', ''],
        ['Diagramok', 'chart_style', 'select', 'album', 'Doboz stílus', '', ['album' => 'Album', 'classic' => 'Klasszikus', 'minimal' => 'Letisztult']],
        ['Diagramok', 'chart_png_scale', 'int', 2, 'PNG felbontás szorzó', '', [1, 4]],

        ['Fotók', 'upload_max_mb', 'int', 12, 'Feltöltés max. mérete (MB)', 'A szerver php.ini határa is számít.', [1, 100]],
        ['Fotók', 'photo_max_px', 'int', 2000, 'Tárolt fotó max. oldalhossza (px)', '', [600, 6000]],
        ['Fotók', 'thumb_px', 'int', 360, 'Bélyegkép mérete (px)', '', [120, 800]],
        ['Fotók', 'jpeg_quality', 'int', 85, 'JPEG minőség', '', [50, 100]],

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
