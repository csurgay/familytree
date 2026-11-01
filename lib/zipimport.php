<?php
/**
 * Photo package import (e.g. the photos saved from TribalPages).
 *
 * ZIP layout:  manifest.json + image files.
 * manifest.json: {"source":"tribalpages","photos":[{"file":"tribalpages/1053084.jpg","key":"tp:1053084",
 *                 "xref":"I328","title":"","date":"1987","descr":""}, ...]}
 *   xref  – GEDCOM id of the person on the photo (persons.xref); "person_id" may be given instead
 *   key   – stable id of the photo in the source; an already imported key is skipped, so re-running is safe
 */

/** Minimal ZIP reader (stored + deflate), no ZipArchive needed. Returns [name => bytes]. */
function ft_zip_read(string $path, int $maxTotal = 300 * 1024 * 1024): array
{
    $bin = file_get_contents($path);
    if ($bin === false || strlen($bin) < 22) throw ft_err('A fájl nem olvasható, vagy nem ZIP.');
    $eocd = strrpos($bin, "PK\x05\x06");
    if ($eocd === false) throw ft_err('Ez nem ZIP fájl (hiányzik a tartalomjegyzék).');
    $e = unpack('vdisk/vcdisk/ventries/vtotal/Vsize/Voffset', substr($bin, $eocd + 4, 16));
    $p = $e['offset'];
    $out = [];
    $sum = 0;
    for ($i = 0; $i < $e['total']; $i++) {
        if (substr($bin, $p, 4) !== "PK\x01\x02") throw ft_err('Sérült ZIP tartalomjegyzék.');
        $c = unpack('vmade/vneed/vflag/vmethod/vtime/vdate/Vcrc/Vcsize/Vusize/vnlen/velen/vclen/vdisk/viattr/Vattr/Vlocal', substr($bin, $p + 4, 42));
        $name = substr($bin, $p + 46, $c['nlen']);
        $p += 46 + $c['nlen'] + $c['elen'] + $c['clen'];
        if (substr($name, -1) === '/') continue;
        $l = unpack('vnlen/velen', substr($bin, $c['local'] + 26, 4));
        $data = substr($bin, $c['local'] + 30 + $l['nlen'] + $l['elen'], $c['csize']);
        if ($c['method'] === 8) $data = @gzinflate($data);
        elseif ($c['method'] !== 0) throw ft_err("Nem támogatott tömörítés a ZIP-ben ($name).");
        if ($data === false || strlen($data) !== $c['usize']) throw ft_err("Sérült fájl a ZIP-ben: $name");
        $sum += strlen($data);
        if ($sum > $maxTotal) throw ft_err('A ZIP kicsomagolva túl nagy.');
        $out[str_replace('\\', '/', $name)] = $data;
    }
    return $out;
}

function ft_photo_package_import(string $zipPath): array
{
    $db = App::$db;
    $files = ft_zip_read($zipPath);
    if (!isset($files['manifest.json'])) throw ft_err('A ZIP-ben nincs manifest.json.');
    $man = json_decode($files['manifest.json'], true);
    if (!is_array($man) || !isset($man['photos']) || !is_array($man['photos'])) throw ft_err('A manifest.json formátuma hibás.');

    $byXref = [];
    foreach ($db->all('SELECT id, xref FROM {persons} WHERE xref IS NOT NULL') as $r) $byXref[$r['xref']] = (int)$r['id'];
    $done = array_flip(array_filter($db->col('SELECT source FROM {photos} WHERE source IS NOT NULL')));
    $st = ['imported' => 0, 'skipped' => 0, 'linked' => 0, 'unmatched' => [], 'errors' => []];
    $tmpDir = sys_get_temp_dir();
    @set_time_limit(600);

    foreach ($man['photos'] as $ph) {
        $key = isset($ph['key']) ? mb_substr((string)$ph['key'], 0, 60) : null;
        if ($key && isset($done[$key])) { $st['skipped']++; continue; }
        $file = (string)($ph['file'] ?? '');
        if (!isset($files[$file])) { $st['errors'][] = "Hiányzó kép a ZIP-ben: $file"; continue; }
        $pid = isset($ph['person_id']) ? (int)$ph['person_id'] : ($byXref[(string)($ph['xref'] ?? '')] ?? null);
        if (!$pid && !empty($ph['xref'])) $st['unmatched'][] = $ph['xref'];
        $tmp = tempnam($tmpDir, 'ftimp');
        file_put_contents($tmp, $files[$file]);
        try {
            $stored = ft_store_image($tmp, basename($file));
        } catch (Throwable $e) {
            $st['errors'][] = basename($file) . ': ' . $e->getMessage();
            @unlink($tmp);
            continue;
        }
        @unlink($tmp);
        $dt = ft_parse_date($ph['date'] ?? null);
        $id = $db->insert('photos', $stored + ['title' => ft_str($ph['title'] ?? null), 'descr' => ft_str($ph['descr'] ?? null, 20000),
            'date_raw' => $dt['raw'] ?? null, 'y' => $dt['y'] ?? null, 'status' => 'ok', 'source' => $key,
            'uploaded_by' => App::uid(), 'created' => ft_now()]);
        if ($pid) {
            $db->insert('photo_links', ['photo_id' => $id, 'person_id' => $pid, 'fx' => 0.5, 'fy' => 0.35]);
            ft_photo_autoprimary($id);
            $st['linked']++;
        }
        if ($key) $done[$key] = true;
        $st['imported']++;
    }
    $st['unmatched'] = array_values(array_unique($st['unmatched']));
    App::flush();
    App::audit('photo.import', 'app', null, $st);
    return $st;
}
