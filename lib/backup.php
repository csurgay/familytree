<?php
/**
 * Full backup and restore: every database table (persons, users, settings, stories, translations, comments,
 * approvals, log…) plus every uploaded file (photos, thumbnails, saved charts) in one ZIP.
 *
 * Both directions run in short steps (a few seconds each, the browser calls the next one), so shared hosts
 * with a 30 s time limit and small upload limits can handle backups of any size.
 *
 * ZIP layout:
 *   manifest.json            what is inside (format, schema version, row and file counts)
 *   OLVASSEL.txt             a few lines for a human who opens the ZIP
 *   db/<table>.json          {"table", "columns", "rows": [[…], …]}
 *   uploads/photos/…, uploads/thumbs/…, uploads/charts/…
 *
 * Never in the backup: config.php (database password, DeepL key), sessions, password-reset tokens.
 * The users' password hashes ARE in it (so members can log in after a restore) – keep the file safe.
 *
 * Restore order (nothing is changed until everything is checked):
 *   1. the uploads are unpacked into a staging folder, each file checked against its CRC;
 *   2. every db/*.json is read and parsed;
 *   3. the staging folder replaces uploads/, then all tables are replaced in ONE transaction;
 *      if that fails, the old uploads/ is put back;
 *   4. everyone is logged out (the members are now the ones from the backup).
 */

const FT_BACKUP_FORMAT = 'familytree-backup';
const FT_BACKUP_FORMAT_VERSION = 1;
const FT_BACKUP_STEP_SECONDS = 8;
const FT_BACKUP_FILE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'];

function ft_backup_dir(): string
{
    $d = App::$root . '/data/backups';
    if (!is_dir($d) && !@mkdir($d, 0700, true)) throw ft_err('A data/backups mappa nem hozható létre. Adj írási jogot a data mappára.', 500);
    if (!is_file("$d/.htaccess")) @file_put_contents("$d/.htaccess", "Require all denied\n");
    if (!is_file("$d/index.html")) @file_put_contents("$d/index.html", '');
    return $d;
}

/** Only plain names inside data/backups – never a path. */
function ft_backup_path(string $name): string
{
    if (!preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.zip$/', $name)) throw ft_err('Érvénytelen fájlnév.', 400);
    $p = ft_backup_dir() . '/' . $name;
    if (!is_file($p)) throw ft_err('Nincs ilyen mentés a szerveren.', 404);
    return $p;
}

function ft_rrmdir(string $dir, ?float $deadline = null): bool
{
    if (!is_dir($dir)) return true;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) {
        if ($deadline && microtime(true) > $deadline) return false;
        $f->isDir() && !$f->isLink() ? @rmdir($f->getPathname()) : @unlink($f->getPathname());
    }
    return @rmdir($dir);
}

function ft_ini_bytes(string $v): int
{
    $v = trim($v); if ($v === '') return 0;
    $n = (float)$v; $u = strtolower(substr($v, -1));
    return (int)($u === 'g' ? $n * 1073741824 : ($u === 'm' ? $n * 1048576 : ($u === 'k' ? $n * 1024 : $n)));
}

/** Largest upload chunk the server accepts (leaves room for the form fields). */
function ft_backup_chunk_size(): int
{
    $lims = array_filter([ft_ini_bytes((string)ini_get('upload_max_filesize')), ft_ini_bytes((string)ini_get('post_max_size'))]);
    $lim = $lims ? min($lims) : 2 * 1048576;
    return max(256 * 1024, min(8 * 1048576, $lim - 64 * 1024));
}

// =============================================================== ZIP writing (incremental, no ZipArchive)

function ft_zip_dostime(int $ts): array
{
    $d = getdate($ts);
    if ($d['year'] < 1980) $d = getdate(315532800);
    return [($d['hours'] << 11) | ($d['minutes'] << 5) | intdiv($d['seconds'], 2), (($d['year'] - 1980) << 9) | ($d['mon'] << 5) | $d['mday']];
}

/** Append one entry to an open ZIP stream. $src: a string (deflated) or ['file' => path] (stored, streamed). */
function ft_zip_put($fh, string $name, $src, array &$central): void
{
    $off = ftell($fh);
    if (is_array($src)) {
        $path = $src['file'];
        $size = filesize($path);
        $crc = hexdec(hash_file('crc32b', $path));
        $method = 0; $csize = $size; $data = null; $mt = filemtime($path) ?: time();
    } else {
        $size = strlen($src); $crc = crc32($src);
        $data = gzdeflate($src, 6); $method = 8; $csize = strlen($data); $mt = time();
    }
    if ($off + $csize > 0xFFFFFFF0) throw ft_err('A mentés nagyobb lenne 4 GB-nál; ezt ez a változat még nem tudja.', 507);
    [$t, $d] = ft_zip_dostime($mt);
    fwrite($fh, pack('VvvvvvVVVvv', 0x04034b50, 20, 0x0800, $method, $t, $d, $crc, $csize, $size, strlen($name), 0) . $name);
    if ($data !== null) fwrite($fh, $data);
    else { $in = fopen($path, 'rb'); stream_copy_to_stream($in, $fh); fclose($in); }
    $central[] = [$name, $method, $t, $d, $crc, $csize, $size, $off];
}

function ft_zip_finish($fh, array $central): void
{
    $start = ftell($fh); $cd = '';
    foreach ($central as [$name, $method, $t, $d, $crc, $csize, $size, $off]) {
        $cd .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0x0800, $method, $t, $d, $crc, $csize, $size, strlen($name), 0, 0, 0, 0, 0, $off) . $name;
    }
    fwrite($fh, $cd);
    $n = count($central);
    fwrite($fh, pack('VvvvvVVv', 0x06054b50, 0, 0, $n, $n, strlen($cd), $start, 0));
}

// =============================================================== ZIP reading (streamed, entry by entry)

/** The central directory: [name => [method, crc, csize, size, local header offset]]. */
function ft_zip_index(string $path): array
{
    $fh = @fopen($path, 'rb');
    if (!$fh) throw ft_err('A mentésfájl nem olvasható.');
    try {
        $len = filesize($path);
        $tail = min($len, 65536 + 22);
        fseek($fh, $len - $tail);
        $buf = fread($fh, $tail);
        $p = strrpos($buf, "PK\x05\x06");
        if ($p === false || strlen($buf) - $p < 22) throw ft_err('Ez nem ZIP fájl, vagy csonka (hiányzik a tartalomjegyzék). Ha feltöltés közben szakadt meg, töltsd fel újra.');
        $e = unpack('Vsig/vdisk/vcdisk/ventries/vtotal/Vsize/Voffset/vclen', substr($buf, $p, 22));
        if ($e['offset'] + $e['size'] > $len) throw ft_err('A ZIP csonka: a tartalomjegyzék a fájl végén túl mutat.');
        fseek($fh, $e['offset']);
        $cd = $e['size'] ? fread($fh, $e['size']) : '';
        $out = []; $q = 0;
        for ($i = 0; $i < $e['total']; $i++) {
            if (substr($cd, $q, 4) !== "PK\x01\x02") throw ft_err('Sérült ZIP tartalomjegyzék.');
            $c = unpack('vver/vneed/vflag/vmethod/vtime/vdate/Vcrc/Vcsize/Vsize/vnlen/vxlen/vclen/vdisk/vint/Vext/Voff', substr($cd, $q + 4, 42));
            $name = substr($cd, $q + 46, $c['nlen']);
            $q += 46 + $c['nlen'] + $c['xlen'] + $c['clen'];
            if (substr($name, -1) === '/') continue; // folders
            $out[$name] = ['method' => $c['method'], 'crc' => $c['crc'] & 0xFFFFFFFF, 'csize' => $c['csize'], 'size' => $c['size'], 'off' => $c['off'], 'flag' => $c['flag']];
        }
        return $out;
    } finally { fclose($fh); }
}

/** Stream one entry into $out (a writable stream) or return it as a string; checks the CRC. */
function ft_zip_extract(string $path, string $name, array $e, $out = null): ?string
{
    if (!in_array($e['method'], [0, 8], true)) throw ft_err("Nem támogatott tömörítés a mentésben: $name");
    if ($e['flag'] & 1) throw ft_err('Jelszóval védett ZIP-et nem tud megnyitni.');
    $fh = fopen($path, 'rb');
    try {
        fseek($fh, $e['off']);
        $lh = fread($fh, 30);
        if (strlen($lh) < 30 || substr($lh, 0, 4) !== "PK\x03\x04") throw ft_err("Sérült bejegyzés a mentésben: $name");
        $l = unpack('vnlen/vxlen', substr($lh, 26, 4));
        fseek($fh, $e['off'] + 30 + $l['nlen'] + $l['xlen']);
        $ctx = hash_init('crc32b');
        $inf = $e['method'] === 8 ? inflate_init(ZLIB_ENCODING_RAW) : null;
        $left = $e['csize']; $str = $out ? null : ''; $got = 0;
        while ($left > 0) {
            $chunk = fread($fh, min(1048576, $left));
            if ($chunk === '' || $chunk === false) throw ft_err("A mentés csonka ($name).");
            $left -= strlen($chunk);
            if ($inf) { $chunk = inflate_add($inf, $chunk, $left > 0 ? ZLIB_SYNC_FLUSH : ZLIB_FINISH); if ($chunk === false) throw ft_err("Sérült tömörített adat: $name"); }
            hash_update($ctx, $chunk); $got += strlen($chunk);
            if ($out) fwrite($out, $chunk); else $str .= $chunk;
        }
        if ($got !== $e['size'] || hexdec(hash_final($ctx)) !== $e['crc']) throw ft_err("Ellenőrzőösszeg-hiba a mentésben: $name – a fájl sérült.");
        return $str;
    } finally { fclose($fh); }
}

/** Where an uploads/ entry may go – only image files below uploads/photos|thumbs|charts. */
function ft_backup_safe_upload(string $name): ?string
{
    if (!preg_match('~^uploads/(photos|thumbs|charts)/([A-Za-z0-9._-]+/)*[A-Za-z0-9._-]+$~', $name)) return null;
    if (str_contains($name, '..')) return null;
    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
    return in_array($ext, FT_BACKUP_FILE_EXT, true) ? substr($name, 8) : null;
}

/** Read and check the manifest of a backup file. */
function ft_backup_inspect(string $path): array
{
    $idx = ft_zip_index($path);
    if (!isset($idx['manifest.json'])) throw ft_err('Ebben a ZIP-ben nincs manifest.json – ez nem a családfa teljes mentése.');
    $m = json_decode(ft_zip_extract($path, 'manifest.json', $idx['manifest.json']), true);
    if (!is_array($m) || ($m['format'] ?? '') !== FT_BACKUP_FORMAT) throw ft_err('Ez a ZIP nem a családfa teljes mentése.');
    if ((int)($m['format_version'] ?? 0) > FT_BACKUP_FORMAT_VERSION) throw ft_err('Ez a mentés a program egy újabb változatával készült. Előbb frissítsd a programot.');
    $problems = [];
    if ((int)($m['schema'] ?? 0) > FT_SCHEMA_VERSION) $problems[] = 'A mentés újabb adatbázis-szerkezetű (' . (int)$m['schema'] . '), mint ez a program (' . FT_SCHEMA_VERSION . '). Előbb frissítsd a programot.';
    $files = 0; $bytes = 0; $bad = [];
    foreach ($idx as $name => $e) {
        if (str_starts_with($name, 'uploads/')) {
            if (ft_backup_safe_upload($name) === null) $bad[] = $name; else { $files++; $bytes += $e['size']; }
        }
    }
    foreach (array_keys($m['tables'] ?? []) as $t) if (!isset($idx["db/$t.json"])) $problems[] = "Hiányzik a mentésből: db/$t.json";
    if ($bad) $problems[] = 'A mentésben tiltott fájlok vannak, ezeket nem állítja vissza: ' . implode(', ', array_slice($bad, 0, 5)) . (count($bad) > 5 ? ' …' : '');
    $free = @disk_free_space(App::$root);
    if ($free !== false && $free < $bytes * 1.1 + 20 * 1048576) $problems[] = 'Kevés a szabad hely a tárhelyen: ' . ft_human_bytes((int)$free) . ' szabad, kicsomagolva kb. ' . ft_human_bytes($bytes) . ' kell.';
    return ['manifest' => $m, 'files' => $files, 'bytes' => $bytes, 'problems' => $problems,
        'blocking' => (int)($m['schema'] ?? 0) > FT_SCHEMA_VERSION || array_filter($problems, fn($p) => str_starts_with($p, 'Hiányzik'))];
}

function ft_human_bytes(int $b): string
{
    if ($b >= 1073741824) return round($b / 1073741824, 1) . ' GB';
    if ($b >= 1048576) return round($b / 1048576, 1) . ' MB';
    return max(1, round($b / 1024)) . ' kB';
}

// =============================================================== backup job

function ft_backup_job_file(): string { return ft_backup_dir() . '/.job.json'; }

function ft_backup_job(): ?array
{
    $f = ft_backup_job_file();
    if (!is_file($f)) return null;
    $j = json_decode((string)file_get_contents($f), true);
    if (!is_array($j)) { @unlink($f); return null; }
    // a job nobody continued for 15 minutes (closed tab) is abandoned
    if ($j['touched'] < time() - 900) { ft_backup_job_abort($j); return null; }
    return $j;
}

function ft_backup_job_save(array $j): void
{
    $j['touched'] = time();
    file_put_contents(ft_backup_job_file(), json_encode($j, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
}

function ft_backup_job_abort(array $j): void
{
    if (!empty($j['part'])) @unlink(ft_backup_dir() . '/' . $j['part']);
    if (!empty($j['staging'])) ft_rrmdir(ft_backup_dir() . '/' . $j['staging']);
    @unlink(ft_backup_job_file());
}

/** All rows of every table, in one consistent snapshot. */
function ft_backup_dump_db(): array
{
    $db = App::$db; $out = [];
    $db->inTx(function () use ($db, &$out) {
        foreach (ft_schema() as $t => $def) {
            $cols = array_keys($def['cols']);
            $have = $db->columns($t);
            $sel = array_values(array_intersect($cols, $have));
            $rows = [];
            $st = $db->q('SELECT ' . implode(',', $sel) . ' FROM {' . $t . '} ORDER BY id');
            while ($r = $st->fetch(PDO::FETCH_NUM)) $rows[] = $r;
            if ($t === 'users') {       // reset links are never carried over
                foreach (['reset_hash', 'reset_until', 'reset_sent'] as $c) { $i = array_search($c, $sel, true); if ($i !== false) foreach ($rows as &$r) $r[$i] = null; unset($r); }
            }
            if ($t === 'settings') {    // secrets and internal markers stay on this server
                $ki = array_search('k', $sel, true);
                $rows = array_values(array_filter($rows, fn($r) => !in_array($r[$ki], ['deepl_key', 'session_epoch'], true)));
            }
            $out[$t] = ['table' => $t, 'columns' => $sel, 'rows' => $rows];
        }
    });
    return $out;
}

function ft_backup_upload_files(): array
{
    $root = App::$root . '/uploads';
    $out = [];
    if (!is_dir($root)) return $out;
    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $f) {
        if (!$f->isFile()) continue;
        $rel = 'uploads/' . str_replace('\\', '/', substr($f->getPathname(), strlen($root) + 1));
        if (ft_backup_safe_upload($rel) !== null) $out[] = $rel;
    }
    sort($out);
    return $out;
}

/** Start a backup: dumps the database right away; the files follow in ft_backup_step(). */
function ft_backup_start(string $label = 'mentes'): array
{
    @set_time_limit(120);
    if ($j = ft_backup_job()) throw ft_err($j['kind'] === 'restore' ? 'Éppen visszaállítás fut.' : 'Már készül egy mentés.', 409);
    $dir = ft_backup_dir();
    $name = 'csaladfa-' . $label . '-' . date('Ymd-His') . '-' . bin2hex(random_bytes(4)) . '.zip';
    $part = $name . '.part';
    $fh = fopen("$dir/$part", 'wb');
    if (!$fh) throw ft_err('A mentésfájl nem írható a data/backups mappába.', 500);
    $central = [];
    $tables = ft_backup_dump_db();
    $counts = [];
    foreach ($tables as $t => $d) {
        $counts[$t] = count($d['rows']);
        ft_zip_put($fh, "db/$t.json", json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE), $central);
    }
    unset($tables);
    fclose($fh);
    $files = ft_backup_upload_files();
    $j = ['kind' => 'backup', 'name' => $name, 'part' => $part, 'central' => $central, 'files' => $files, 'i' => 0, 'bytes' => 0,
        'missing' => 0, 'counts' => $counts, 'started' => time(), 'by' => App::uid()];
    ft_backup_job_save($j);
    return ft_backup_job_status($j);
}

function ft_backup_job_status(array $j): array
{
    if ($j['kind'] === 'backup') return ['kind' => 'backup', 'done' => false, 'stage' => 'files', 'i' => $j['i'], 'n' => count($j['files'])];
    return ['kind' => 'restore', 'done' => false, 'stage' => $j['stage'], 'i' => $j['i'], 'n' => count($j['uploads'])];
}

function ft_backup_step(): array
{
    @set_time_limit(120);
    $j = ft_backup_job();
    if (!$j) throw ft_err('Nincs folyamatban lévő mentés vagy visszaállítás.', 404);
    return $j['kind'] === 'backup' ? ft_backup_step_backup($j) : ft_restore_step($j);
}

function ft_backup_step_backup(array $j): array
{
    $dir = ft_backup_dir();
    $deadline = microtime(true) + FT_BACKUP_STEP_SECONDS;
    $fh = @fopen("$dir/{$j['part']}", 'r+b');           // not 'a': ftell() must give the real offsets
    if (!$fh) { ft_backup_job_abort($j); throw ft_err('A mentésfájl eltűnt vagy nem írható.', 500); }
    fseek($fh, 0, SEEK_END);
    $central = $j['central'];
    $n = count($j['files']);
    while ($j['i'] < $n && microtime(true) < $deadline) {
        $rel = $j['files'][$j['i']++];
        $abs = App::$root . '/' . $rel;
        if (!is_file($abs)) { $j['missing']++; continue; } // deleted meanwhile
        ft_zip_put($fh, $rel, ['file' => $abs], $central);
        $j['bytes'] += filesize($abs);
    }
    $j['central'] = $central;
    if ($j['i'] < $n) { fclose($fh); ft_backup_job_save($j); return ft_backup_job_status($j); }

    $manifest = ['format' => FT_BACKUP_FORMAT, 'format_version' => FT_BACKUP_FORMAT_VERSION, 'app_version' => FT_VERSION, 'schema' => FT_SCHEMA_VERSION,
        'created' => date('c'), 'site_title' => App::$s['site_title'] ?? '', 'source' => ft_base_url(), 'driver' => App::$db->driver,
        'tables' => $j['counts'], 'files' => ['count' => count($central) - count($j['counts']), 'bytes' => $j['bytes']]];
    ft_zip_put($fh, 'manifest.json', json_encode($manifest, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT), $central);
    ft_zip_put($fh, 'OLVASSEL.txt', "A családfa teljes mentése – " . ($manifest['site_title'] ?: 'Családfa') . "\r\nKészült: " . date('Y-m-d H:i') . " · " . $manifest['source'] . "\r\n\r\n"
        . "Visszaállítás: fogaskerék → Import / export → Teljes mentés → a mentés feltöltése, majd Visszaállítás.\r\n"
        . "Benne van minden adat (személyek, fotók, sztorik, felhasználók, beállítások, napló), a felhasználók jelszava titkosított (hash) formában.\r\n"
        . "Nincs benne: a config.php (adatbázis-jelszó, DeepL kulcs).\r\n\r\nA fájlt kezeld bizalmasan: élő családtagok adatait tartalmazza.\r\n", $central);
    ft_zip_finish($fh, $central);
    fclose($fh);
    rename("$dir/{$j['part']}", "$dir/{$j['name']}");
    @unlink(ft_backup_job_file());
    $size = (int)filesize("$dir/{$j['name']}");
    App::audit('backup', 'app', null, $j['name'] . ' · ' . ft_human_bytes($size));
    ft_backup_prune($j['name']);
    return ['kind' => 'backup', 'done' => true, 'name' => $j['name'], 'size' => $size, 'missing' => $j['missing']];
}

/** Keep the newest N backups made here (uploaded ones are left alone). */
function ft_backup_prune(string $newest = ''): void
{
    $keep = max(1, (int)(App::$s['backup_keep'] ?? 5));
    $mine = glob(ft_backup_dir() . '/csaladfa-mentes-*.zip') ?: [];
    // newest first: the one just made, then by time, then by the date in the name
    usort($mine, fn($a, $b) => (basename($b) === $newest) <=> (basename($a) === $newest) ?: filemtime($b) <=> filemtime($a) ?: strcmp(basename($b), basename($a)));
    foreach (array_slice($mine, $keep) as $f) @unlink($f);
}

function ft_backup_list(): array
{
    $dir = ft_backup_dir();
    $out = [];
    foreach (glob("$dir/*.zip") ?: [] as $f) {
        $row = ['name' => basename($f), 'size' => filesize($f), 'mtime' => date('Y-m-d H:i:s', filemtime($f)), 'uploaded' => str_starts_with(basename($f), 'feltoltott-')];
        try { $i = ft_backup_inspect($f); $row['manifest'] = $i['manifest']; $row['problems'] = $i['problems']; }
        catch (Throwable $e) { $row['error'] = $e->getMessage(); }
        $out[] = $row;
    }
    usort($out, fn($a, $b) => strcmp($b['mtime'], $a['mtime']));
    $free = @disk_free_space(App::$root);
    $j = ft_backup_job();
    return ['backups' => $out, 'free' => $free === false ? null : (int)$free, 'chunk' => ft_backup_chunk_size(),
        'job' => $j ? ft_backup_job_status($j) : null, 'keep' => (int)(App::$s['backup_keep'] ?? 5)];
}

// =============================================================== upload of a backup (in chunks)

function ft_backup_upload_chunk(array $in): array
{
    $id = (string)($in['id'] ?? '');
    if (!preg_match('/^[a-f0-9]{16,32}$/', $id)) throw ft_err('Hibás feltöltés-azonosító.', 400);
    $total = (int)($in['total'] ?? 0); $offset = (int)($in['offset'] ?? -1);
    if ($total <= 0) throw ft_err('Üres fájl.', 400);
    $dir = ft_backup_dir();
    $part = "$dir/.up-$id.part";
    $have = is_file($part) ? filesize($part) : 0;
    if ($offset === 0 && $have === 0) {
        $free = @disk_free_space($dir);
        if ($free !== false && $free < $total * 2.2) throw ft_err('Nincs elég szabad hely a tárhelyen a mentés feltöltéséhez és kicsomagolásához (' . ft_human_bytes((int)$free) . ' szabad).', 507);
    }
    if ($offset !== $have) return ['have' => $have];          // resume from where the server is
    $f = $_FILES['chunk'] ?? null;
    if (!$f || ($f['error'] ?? 4) !== UPLOAD_ERR_OK) throw ft_err('A feltöltés egy része nem érkezett meg (' . (int)($f['error'] ?? 4) . ').');
    $data = file_get_contents($f['tmp_name']);
    if ($have + strlen($data) > $total) throw ft_err('A feltöltött részek nagyobbak a jelzett méretnél.', 400);
    file_put_contents($part, $data, FILE_APPEND | LOCK_EX);
    clearstatcache(true, $part);
    $have = filesize($part);
    if ($have < $total) return ['have' => $have];
    $base = preg_replace('/[^A-Za-z0-9._-]+/', '-', pathinfo((string)($in['name'] ?? 'mentes'), PATHINFO_FILENAME));
    $name = 'feltoltott-' . date('Ymd-His') . '-' . substr(trim($base, '-.') ?: 'mentes', 0, 60) . '.zip';
    try { ft_backup_inspect($part); }
    catch (Throwable $e) { @unlink($part); throw $e; }
    rename($part, "$dir/$name");
    // forgotten half uploads
    foreach (glob("$dir/.up-*.part") ?: [] as $old) if (filemtime($old) < time() - 86400) @unlink($old);
    App::audit('backup.upload', 'app', null, $name);
    return ['have' => $have, 'done' => true, 'name' => $name];
}

// =============================================================== restore job

function ft_restore_start(string $name): array
{
    @set_time_limit(120);
    if ($j = ft_backup_job()) throw ft_err($j['kind'] === 'restore' ? 'Már fut egy visszaállítás.' : 'Előbb várd meg, amíg a mentés elkészül.', 409);
    $path = ft_backup_path($name);
    $info = ft_backup_inspect($path);
    if ($info['blocking']) throw ft_err(implode(' ', $info['problems']));
    $uploads = [];
    foreach (ft_zip_index($path) as $n => $e) if (ft_backup_safe_upload($n) !== null) $uploads[] = $n;
    $staging = '.restore-' . bin2hex(random_bytes(6));
    if (!@mkdir(ft_backup_dir() . "/$staging/uploads", 0755, true)) throw ft_err('Az ideiglenes mappa nem hozható létre.', 500);
    $j = ['kind' => 'restore', 'name' => $name, 'staging' => $staging, 'uploads' => $uploads, 'i' => 0, 'stage' => 'files', 'started' => time(), 'by' => App::uid()];
    ft_backup_job_save($j);
    return ft_backup_job_status($j);
}

function ft_restore_step(array $j): array
{
    $dir = ft_backup_dir();
    $path = "$dir/{$j['name']}";
    $stage = "$dir/{$j['staging']}";
    try {
        if (!is_file($path)) throw ft_err('A visszaállítandó mentés eltűnt a szerverről.');
        if ($j['stage'] === 'files') {
            $deadline = microtime(true) + FT_BACKUP_STEP_SECONDS;
            $idx = ft_zip_index($path);
            $n = count($j['uploads']);
            while ($j['i'] < $n && microtime(true) < $deadline) {
                $name = $j['uploads'][$j['i']++];
                $rel = ft_backup_safe_upload($name);
                $dest = "$stage/uploads/$rel";
                if (!is_dir(dirname($dest))) @mkdir(dirname($dest), 0755, true);
                $out = fopen($dest, 'wb');
                try { ft_zip_extract($path, $name, $idx[$name], $out); } finally { fclose($out); }
            }
            if ($j['i'] >= $n) $j['stage'] = 'db';
            ft_backup_job_save($j);
            return ft_backup_job_status($j);
        }
        // stage 'db': everything is unpacked and checked – now switch over
        $res = ft_restore_apply($path, $stage);
        ft_rrmdir($stage, microtime(true) + 20);
        @unlink(ft_backup_job_file());
        return ['kind' => 'restore', 'done' => true] + $res;
    } catch (Throwable $e) {
        ft_backup_job_abort($j);
        throw $e;
    }
}

/** Parse all tables, swap uploads/, replace the tables in one transaction (put uploads/ back on failure). */
function ft_restore_apply(string $path, string $stage): array
{
    $db = App::$db;
    $idx = ft_zip_index($path);
    $schema = ft_schema();
    $tables = [];
    foreach ($schema as $t => $def) {
        if (!isset($idx["db/$t.json"])) { $tables[$t] = ['columns' => [], 'rows' => []]; continue; } // older backup: table did not exist yet
        $d = json_decode(ft_zip_extract($path, "db/$t.json", $idx["db/$t.json"]), true);
        if (!is_array($d) || !isset($d['columns'], $d['rows']) || !is_array($d['rows'])) throw ft_err("Sérült tábla a mentésben: $t");
        $tables[$t] = $d;
    }
    if (!$tables['users']['rows']) throw ft_err('A mentésben nincs egyetlen felhasználó sem – így senki nem tudna belépni. A visszaállítás elmaradt.');

    // 1) files: the staged copy becomes uploads/, the current one is kept until the database is done
    $up = App::$root . '/uploads';
    $old = "$stage/uploads-old";
    $keep = [];
    foreach (['.htaccess', '.gitkeep', 'index.html'] as $f) if (is_file("$up/$f")) $keep[$f] = file_get_contents("$up/$f");
    if (is_dir($up) && !@rename($up, $old)) throw ft_err('Az uploads mappát nem lehet átnevezni (jogosultság?). Semmi nem változott.', 500);
    if (!@rename("$stage/uploads", $up)) { @rename($old, $up); throw ft_err('Az új uploads mappát nem lehet a helyére tenni. Semmi nem változott.', 500); }
    foreach ($keep as $f => $c) file_put_contents("$up/$f", $c);
    foreach (['photos', 'thumbs', 'charts'] as $d) if (!is_dir("$up/$d")) @mkdir("$up/$d", 0755, true);

    // 2) database
    try {
        $db->inTx(function () use ($db, $schema, $tables) {
            foreach ($schema as $t => $def) {
                $db->q('DELETE FROM {' . $t . '}');
                $cols = array_values(array_intersect($tables[$t]['columns'], array_keys($def['cols'])));
                if (!$cols || !$tables[$t]['rows']) continue;
                $pos = array_map(fn($c) => array_search($c, $tables[$t]['columns'], true), $cols);
                $st = $db->pdo->prepare($db->sql('INSERT INTO {' . $t . '} (' . implode(',', $cols) . ') VALUES (' . implode(',', array_fill(0, count($cols), '?')) . ')'));
                foreach ($tables[$t]['rows'] as $r) {
                    $vals = [];
                    foreach ($pos as $p) { $v = $r[$p] ?? null; $vals[] = is_bool($v) ? (int)$v : (is_array($v) ? json_encode($v, JSON_UNESCAPED_UNICODE) : $v); }
                    $st->execute($vals);
                }
            }
        });
    } catch (Throwable $e) {
        // put the old photos back
        ft_rrmdir($up);
        @rename($old, $up);
        throw ft_err('Az adatbázis visszaállítása nem sikerült, minden maradt a régiben: ' . $e->getMessage(), 500);
    }
    $db->migrate($schema); // a backup from an older version gets the new columns
    // everyone logs in again – the members are now the ones from the backup
    ft_setting_set($db, 'session_epoch', bin2hex(random_bytes(8)));
    App::$s = ft_settings_load($db);
    App::$user = null;
    unset($_SESSION['uid']);
    App::flush();
    App::audit('backup.restore', 'app', null, basename($path));
    ft_rrmdir($old, microtime(true) + 15);
    $m = json_decode(ft_zip_extract($path, 'manifest.json', $idx['manifest.json']), true) ?: [];
    return ['persons' => count($tables['persons']['rows']), 'users' => count($tables['users']['rows']), 'photos' => count($tables['photos']['rows']),
        'files' => count(array_filter(array_keys($idx), fn($n) => ft_backup_safe_upload($n) !== null)), 'created' => $m['created'] ?? null, 'source' => $m['source'] ?? null];
}

/** Send a backup file; supports Range so an interrupted download can resume. */
function ft_backup_send(string $name): void
{
    $path = ft_backup_path($name);
    @set_time_limit(0);
    while (ob_get_level()) ob_end_clean();
    $size = filesize($path); $from = 0; $to = $size - 1;
    if (preg_match('/^bytes=(\d*)-(\d*)$/', $_SERVER['HTTP_RANGE'] ?? '', $m) && ($m[1] !== '' || $m[2] !== '')) {
        if ($m[1] === '') { $from = max(0, $size - (int)$m[2]); } else { $from = (int)$m[1]; if ($m[2] !== '') $to = min($to, (int)$m[2]); }
        if ($from > $to || $from >= $size) { http_response_code(416); header("Content-Range: bytes */$size"); exit; }
        http_response_code(206);
        header("Content-Range: bytes $from-$to/$size");
    }
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $name . '"');
    header('Accept-Ranges: bytes');
    header('Content-Length: ' . ($to - $from + 1));
    header('Cache-Control: private, no-store');
    $fh = fopen($path, 'rb'); fseek($fh, $from);
    $left = $to - $from + 1;
    while ($left > 0 && !connection_aborted()) { $c = fread($fh, min(1048576, $left)); if ($c === '' || $c === false) break; echo $c; flush(); $left -= strlen($c); }
    fclose($fh);
    exit;
}
