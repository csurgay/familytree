<?php
/**
 * Place names on a map. Every distinct place written into an event or a photo is looked up once with
 * OpenStreetMap's Nominatim (at most one request a second, as its usage policy asks) and kept in {places};
 * an admin can correct a wrong hit with a better search text or with coordinates.
 */

const FT_GEOCODER = 'https://nominatim.openstreetmap.org/search';

/** Every place name in use, with how many events/photos carry it. */
function ft_place_names(): array
{
    $n = [];
    foreach (App::$db->all("SELECT place, COUNT(*) AS c FROM {events} WHERE place IS NOT NULL AND place <> '' GROUP BY place") as $r) $n[trim($r['place'])] = ($n[trim($r['place'])] ?? 0) + (int)$r['c'];
    foreach (App::$db->all("SELECT place, COUNT(*) AS c FROM {photos} WHERE place IS NOT NULL AND place <> '' GROUP BY place") as $r) $n[trim($r['place'])] = ($n[trim($r['place'])] ?? 0) + (int)$r['c'];
    unset($n['']);
    return $n;
}

/** Map positions of the given names (those found so far). */
function ft_places_known(array $names = []): array
{
    $want = $names ? array_flip(array_map(fn($x) => trim((string)$x), $names)) : null;
    $out = [];
    foreach (App::$db->all("SELECT name, lat, lon FROM {places} WHERE lat IS NOT NULL") as $r)
        if (!$want || isset($want[$r['name']])) $out[$r['name']] = [round((float)$r['lat'], 5), round((float)$r['lon'], 5)];
    return $out;
}

function ft_places_status(): array
{
    $rows = [];
    foreach (App::$db->all('SELECT * FROM {places}') as $r) $rows[$r['name']] = $r;
    $out = [];
    foreach (ft_place_names() as $name => $c) {
        $r = $rows[$name] ?? null;
        $out[] = ['name' => $name, 'count' => $c, 'status' => $r['status'] ?? 'new', 'lat' => isset($r['lat']) ? (float)$r['lat'] : null,
            'lon' => isset($r['lon']) ? (float)$r['lon'] : null, 'found' => $r['found'] ?? null];
    }
    usort($out, fn($a, $b) => $b['count'] <=> $a['count'] ?: strcmp($a['name'], $b['name']));
    return ['places' => $out, 'left' => count(array_filter($out, fn($p) => $p['status'] === 'new'))];
}

/** One lookup at Nominatim: [lat, lon, display name] or null. */
function ft_geocode(string $q): ?array
{
    $url = FT_GEOCODER . '?' . http_build_query(['q' => $q, 'format' => 'jsonv2', 'limit' => 1, 'accept-language' => 'hu']);
    $ua = 'familytree/' . FT_VERSION . ' (' . ($_SERVER['HTTP_HOST'] ?? 'family tree app') . ')';
    $body = null;
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 12, CURLOPT_USERAGENT => $ua, CURLOPT_FOLLOWLOCATION => true]);
        $body = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        unset($ch);
        if ($code !== 200) throw ft_err('A térképes helykereső most nem válaszol (' . $code . ').', 503);
    } else {
        $body = @file_get_contents($url, false, stream_context_create(['http' => ['header' => "User-Agent: $ua\r\n", 'timeout' => 12]]));
        if ($body === false) throw ft_err('A térképes helykereső most nem érhető el.', 503);
    }
    $j = json_decode((string)$body, true);
    if (!is_array($j) || !$j) return null;
    return [(float)$j[0]['lat'], (float)$j[0]['lon'], mb_substr((string)($j[0]['display_name'] ?? ''), 0, 255)];
}

function ft_place_save(string $name, ?array $hit, string $status): void
{
    $row = ['lat' => $hit[0] ?? null, 'lon' => $hit[1] ?? null, 'found' => $hit[2] ?? null, 'status' => $status, 'updated' => ft_now()];
    $id = App::$db->val('SELECT id FROM {places} WHERE name = ?', [$name]);
    if ($id) App::$db->update('places', $row, (int)$id);
    else App::$db->insert('places', $row + ['name' => $name]);
}

/** Look up the next few unknown places (about 10 seconds of work), for a progress loop in the browser. */
function ft_geocode_step(int $max = 8): array
{
    $known = array_flip(App::$db->col('SELECT name FROM {places}'));
    $todo = array_values(array_filter(array_keys(ft_place_names()), fn($n) => !isset($known[$n])));
    $done = 0; $found = 0;
    foreach (array_slice($todo, 0, $max) as $i => $name) {
        if ($i) usleep(1100000);                     // Nominatim: one request a second
        $hit = ft_geocode($name);
        ft_place_save($name, $hit, $hit ? 'ok' : 'none');
        $done++; if ($hit) $found++;
    }
    return ['done' => $done, 'found' => $found, 'left' => max(0, count($todo) - $done)];
}

/** Admin correction: coordinates, or a better search text ("Timișoara, Románia"), or empty = look it up again. */
function ft_place_set(string $name, $lat, $lon, string $search = ''): array
{
    $name = trim($name);
    if ($name === '') throw ft_err('Hiányzik a hely neve.');
    if ($lat !== null && $lat !== '' && $lon !== null && $lon !== '') {
        $lat = (float)str_replace(',', '.', (string)$lat); $lon = (float)str_replace(',', '.', (string)$lon);
        if (abs($lat) > 90 || abs($lon) > 180) throw ft_err('Érvénytelen koordináta.');
        ft_place_save($name, [$lat, $lon, 'kézzel megadva'], 'manual');
    } else {
        $hit = ft_geocode(trim($search) !== '' ? trim($search) : $name);
        ft_place_save($name, $hit, $hit ? (trim($search) !== '' ? 'manual' : 'ok') : 'none');
    }
    App::audit('place.set', 'place', null, $name);
    return App::$db->row('SELECT * FROM {places} WHERE name = ?', [$name]);
}
