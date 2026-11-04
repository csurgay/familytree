<?php
function ft_photo_row(int $id): array
{
    $r = App::$db->row('SELECT * FROM {photos} WHERE id = ?', [$id]);
    if (!$r) throw ft_err('Nincs ilyen fotó.', 404);
    return $r;
}

function ft_photo_targets(array $p): array
{
    $id = (int)($p['id'] ?? $p['photo_id'] ?? 0);
    $links = App::$db->all('SELECT person_id, family_id, story_id FROM {photo_links} WHERE photo_id = ?', [$id]);
    $P = array_filter(array_map('intval', array_column($links, 'person_id')));
    $F = array_filter(array_map('intval', array_column($links, 'family_id')));
    foreach ($p['links'] ?? [] as $l) { if (!empty($l['person_id'])) $P[] = (int)$l['person_id']; if (!empty($l['family_id'])) $F[] = (int)$l['family_id']; }
    $own = false;
    if (App::uid()) {
        $row = App::$db->row('SELECT uploaded_by FROM {photos} WHERE id = ?', [$id]);
        $own = $row && (int)$row['uploaded_by'] === App::uid() && !$P && !$F;
    }
    return [array_values(array_unique($P)), array_values(array_unique($F)), ['free' => !$P && !$F, 'own' => $own]];
}

function ft_photo_set_links(int $id, array $links): void
{
    $db = App::$db;
    $db->q('DELETE FROM {photo_links} WHERE photo_id = ? AND story_id IS NULL', [$id]);
    foreach ($links as $l) {
        $pid = ft_int($l['person_id'] ?? null); $fid = ft_int($l['family_id'] ?? null);
        if (!$pid && !$fid) continue;
        $db->insert('photo_links', ['photo_id' => $id, 'person_id' => $pid, 'family_id' => $fid,
            'fx' => isset($l['fx']) ? (float)$l['fx'] : 0.5, 'fy' => isset($l['fy']) ? (float)$l['fy'] : 0.35]);
    }
    $db->q('UPDATE {persons} SET photo_id = NULL WHERE photo_id = ? AND id NOT IN (SELECT person_id FROM {photo_links} WHERE photo_id = ? AND person_id IS NOT NULL)', [$id, $id]);
    ft_photo_autoprimary($id);
}

/** Give people/families without a main photo this one. */
function ft_photo_autoprimary(int $id): void
{
    $db = App::$db;
    if ($db->val('SELECT status FROM {photos} WHERE id = ?', [$id]) !== 'ok') return;
    foreach ($db->all('SELECT person_id, family_id FROM {photo_links} WHERE photo_id = ?', [$id]) as $l) {
        if ($l['person_id']) $db->q('UPDATE {persons} SET photo_id = ? WHERE id = ? AND photo_id IS NULL', [$id, (int)$l['person_id']]);
        if ($l['family_id']) $db->q('UPDATE {families} SET photo_id = ? WHERE id = ? AND photo_id IS NULL', [$id, (int)$l['family_id']]);
    }
}

function ft_photo_purge(int $id): void
{
    $db = App::$db;
    $r = $db->row('SELECT * FROM {photos} WHERE id = ?', [$id]);
    if (!$r) return;
    $db->q('DELETE FROM {photo_links} WHERE photo_id = ?', [$id]);
    $db->q('UPDATE {persons} SET photo_id = NULL WHERE photo_id = ?', [$id]);
    $db->q('UPDATE {families} SET photo_id = NULL WHERE photo_id = ?', [$id]);
    $db->q('UPDATE {stories} SET cover_photo_id = NULL WHERE cover_photo_id = ?', [$id]);
    $db->q("DELETE FROM {pins} WHERE kind = 'photo' AND ref_id = ?", [$id]);
    ft_comments_purge('photo', $id);
    $db->delete('photos', $id);
    foreach (['file', 'thumb'] as $k) if ($r[$k] && is_file(App::$root . '/' . $r[$k]) && str_starts_with($r[$k], 'uploads/')) @unlink(App::$root . '/' . $r[$k]);
}

/**
 * Store an uploaded image: verify it really is an image, re-encode with GD (drops EXIF/metadata,
 * defeats polyglot files), fix camera orientation, make a thumbnail.
 */
function ft_store_image(string $tmp, string $origName = ''): array
{
    $s = App::$s;
    if (!is_file($tmp)) throw ft_err('A feltöltött fájl nem érkezett meg.');
    if (filesize($tmp) > (int)$s['upload_max_mb'] * 1024 * 1024) throw ft_err('A fájl nagyobb, mint ' . (int)$s['upload_max_mb'] . ' MB.');
    $info = @getimagesize($tmp);
    if (!$info || !in_array($info[2], [IMAGETYPE_JPEG, IMAGETYPE_PNG, IMAGETYPE_GIF, IMAGETYPE_WEBP], true)) throw ft_err('Csak JPEG, PNG, GIF vagy WebP kép tölthető fel.');
    if (!function_exists('imagecreatefromstring')) throw ft_err('A szerveren nincs GD képkezelő modul.', 500);
    $img = @imagecreatefromstring(file_get_contents($tmp));
    if (!$img) throw ft_err('A kép nem olvasható.');
    if ($info[2] === IMAGETYPE_JPEG && function_exists('exif_read_data')) {
        $exif = @exif_read_data($tmp);
        $o = (int)($exif['Orientation'] ?? 1);
        if ($o === 3) $img = imagerotate($img, 180, 0);
        elseif ($o === 6) $img = imagerotate($img, -90, 0);
        elseif ($o === 8) $img = imagerotate($img, 90, 0);
    }
    $sub = 'uploads/photos/' . date('Y');
    $tsub = 'uploads/thumbs/' . date('Y');
    foreach ([$sub, $tsub] as $d) if (!is_dir(App::$root . '/' . $d)) @mkdir(App::$root . '/' . $d, 0775, true);
    $name = bin2hex(random_bytes(10)) . '.jpg';
    [$w, $h] = ft_save_resized($img, App::$root . "/$sub/$name", (int)$s['photo_max_px'], (int)$s['jpeg_quality']);
    ft_save_resized($img, App::$root . "/$tsub/$name", (int)$s['thumb_px'], 82);
    imagedestroy($img);
    return ['file' => "$sub/$name", 'thumb' => "$tsub/$name", 'w' => $w, 'h' => $h];
}

function ft_save_resized($img, string $path, int $max, int $q): array
{
    $w = imagesx($img); $h = imagesy($img);
    $scale = min(1, $max / max($w, $h));
    $nw = max(1, (int)round($w * $scale)); $nh = max(1, (int)round($h * $scale));
    $dst = imagecreatetruecolor($nw, $nh);
    imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255)); // flatten transparency on white
    imagecopyresampled($dst, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
    if (!imagejpeg($dst, $path, $q)) throw ft_err('A kép mentése nem sikerült (írható az uploads mappa?).', 500);
    imagedestroy($dst);
    return [$nw, $nh];
}

/** Upload endpoint logic. Links go in as {person_id|family_id|story_id}. */
function ft_photo_upload(array $file, array $meta): array
{
    ft_require_login();
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $map = [UPLOAD_ERR_INI_SIZE => 'A fájl nagyobb, mint amit a szerver enged (php.ini upload_max_filesize).', UPLOAD_ERR_FORM_SIZE => 'A fájl túl nagy.',
            UPLOAD_ERR_PARTIAL => 'A feltöltés megszakadt.', UPLOAD_ERR_NO_FILE => 'Nem választottál fájlt.'];
        throw ft_err($map[$file['error'] ?? 4] ?? 'A feltöltés nem sikerült.');
    }
    $pid = ft_int($meta['person_id'] ?? null); $fid = ft_int($meta['family_id'] ?? null); $sid = ft_int($meta['story_id'] ?? null);
    $opts = [];
    if ($sid) { $st = ft_story_row($sid); $opts['own'] = (int)$st['created_by'] === App::uid(); }
    if (!$pid && !$fid) $opts['free'] = true;
    $mode = ft_mode('create', array_filter([$pid]), array_filter([$fid]), $opts);
    if ($mode === 'deny') throw ft_err('Ehhez nincs jogosultságod.', 403);
    $stored = ft_store_image($file['tmp_name'], $file['name'] ?? '');
    $dt = ft_parse_date($meta['date'] ?? null);
    $id = App::$db->insert('photos', $stored + ['title' => ft_str($meta['title'] ?? null), 'descr' => ft_str($meta['descr'] ?? null, 20000),
        'date_raw' => $dt['raw'] ?? null, 'y' => $dt['y'] ?? null, 'status' => $mode === 'direct' ? 'ok' : 'pending',
        'uploaded_by' => App::uid(), 'created' => ft_now()]);
    if ($pid || $fid || $sid) App::$db->insert('photo_links', ['photo_id' => $id, 'person_id' => $pid, 'family_id' => $fid, 'story_id' => $sid, 'fx' => 0.5, 'fy' => 0.35]);
    if ($mode === 'direct') {
        if (!empty($meta['primary']) && $pid) App::$db->update('persons', ['photo_id' => $id], $pid);
        ft_photo_autoprimary($id);
        App::audit('photo.upload', 'photo', $id, $stored['file']);
        App::flush();
        return ['id' => $id, 'queued' => false];
    }
    $cid = App::$db->insert('changes', ['user_id' => App::uid(), 'action' => 'photo.publish', 'entity' => 'photo', 'entity_id' => $id,
        'payload' => json_encode(['id' => $id]), 'summary' => 'Új fotó közzététele' . (!empty($meta['title']) ? ': ' . $meta['title'] : ''), 'status' => 'pending', 'created' => ft_now()]);
    return ['id' => $id, 'queued' => true, 'change_id' => $cid];
}

function ft_photo_url(?string $rel): ?string { return $rel ?: null; }
