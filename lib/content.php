<?php
/**
 * Story content helpers:
 *  - the Stories feed: stories + longer biographies + comments marked as memories (no copies)
 *  - machine translation of stories with DeepL (hu / en / de)
 */

const FT_LANGS = ['hu' => 'Magyar', 'en' => 'English', 'de' => 'Deutsch'];
const FT_DEEPL_TARGET = ['hu' => 'HU', 'en' => 'EN-GB', 'de' => 'DE'];

function ft_langs(): array
{
    $on = array_values(array_intersect((array)(App::$s['languages'] ?? ['hu', 'en', 'de']), array_keys(FT_LANGS)));
    return $on ?: ['hu'];
}
function ft_lang($x): string
{
    $x = strtolower(substr((string)$x, 0, 2));
    return isset(FT_LANGS[$x]) ? $x : 'hu';
}

// ------------------------------------------------------------------ biographies → stories
/** "1894–1960", "sz. 1936", "1864–?" for a graph person. */
function ft_life_years(?array $gp): string
{
    if (!$gp) return '';
    $b = $gp['by'] ? (string)$gp['by'] : ($gp['deceased'] ? '?' : '');
    return $gp['dy'] ? "{$b}–{$gp['dy']}" : ($b ? ($gp['deceased'] ? "{$b}–?" : "sz. {$b}") : '');
}

function ft_excerpt(string $t, int $n = 260): string
{
    return mb_substr(trim(preg_replace('/\s+/u', ' ', preg_replace('/[#*_>\[\]]/u', '', $t))), 0, $n);
}

/** Portrait thumb/file of a person (null when hidden or missing). */
function ft_portrait(?int $pid): ?array
{
    if (!$pid) return null;
    if (ft_mask_living() && ft_is_living(ft_graph(), $pid)) return null;
    $ph = App::$db->row("SELECT p.thumb, p.file FROM {persons} x JOIN {photos} p ON p.id = x.photo_id WHERE x.id = ? AND p.status = 'ok'", [$pid]);
    return $ph ? $ph + ['portrait' => true] : null;
}

function ft_family_title(array $g, int $fid): string
{
    $f = $g['F'][$fid] ?? null;
    if (!$f) return '';
    $n = [];
    foreach (['husband_id', 'wife_id'] as $k) if ($f[$k] && isset($g['P'][$f[$k]])) $n[] = ft_name($g['P'][$f[$k]]);
    return implode(' és ', $n);
}

/**
 * What a comment is about: label, year (for ordering), cover, the people/families it concerns.
 * Used for comments marked as a story (memory) – they show up among the stories too.
 */
function ft_comment_about(array $c): array
{
    $g = ft_graph(); $id = (int)$c['entity_id'];
    $o = ['label' => '', 'y' => null, 'cover' => null, 'person_ids' => [], 'family_ids' => [], 'photo' => null];
    switch ($c['entity']) {
        case 'person':
            $gp = $g['P'][$id] ?? null;
            if ($gp) { $o['label'] = ft_name($gp); $o['y'] = $gp['by']; $o['person_ids'] = [$id]; $o['cover'] = ft_portrait($id); }
            break;
        case 'family':
            $f = $g['F'][$id] ?? null;
            if ($f) { $o['label'] = ft_family_title($g, $id); $o['y'] = $f['my']; $o['family_ids'] = [$id]; $o['cover'] = ft_portrait($f['husband_id'] ?: $f['wife_id']); }
            break;
        case 'story':
            $st = App::$db->row('SELECT * FROM {stories} WHERE id = ?', [$id]);
            if ($st) { $sj = ft_story_json($st); $o['label'] = $st['title']; $o['y'] = ft_int($st['y']); $o['person_ids'] = $sj['person_ids']; $o['family_ids'] = $sj['family_ids']; $o['cover'] = $sj['cover']; }
            break;
        case 'photo':
            $ph = App::$db->row("SELECT * FROM {photos} WHERE id = ? AND status = 'ok'", [$id]);
            if ($ph) {
                $j = ft_photo_json($ph);
                $o['label'] = $ph['title'] ?: 'fotó'; $o['y'] = ft_int($ph['y'] ?? null);
                $o['person_ids'] = array_values(array_filter(array_map(fn($l) => $l['person_id'], $j['links'] ?? [])));
                $o['family_ids'] = array_values(array_filter(array_map(fn($l) => $l['family_id'], $j['links'] ?? [])));
                $o['cover'] = ['thumb' => $ph['thumb'], 'file' => $ph['file']];
                $o['photo'] = ft_photo_visible($j, $g) ? $j : null;
                if (!$o['photo']) $o['cover'] = null;
            }
            break;
    }
    return $o;
}

/**
 * The Stories page: the stories themselves, plus – without copying them – the longer biographies of
 * persons and families (setting bios_in_stories, length ≥ notes_story_min) and the comments marked as a
 * story/memory. Every item has a kind: story | bio | fbio | comment.
 */
function ft_story_feed(string $lang): array
{
    $db = App::$db; $g = ft_graph();
    $rows = $db->all('SELECT * FROM {stories} ORDER BY y IS NULL, y DESC, created DESC');
    $out = array_map(fn($x) => $x + ['kind' => 'story'], ft_story_list($rows, $lang));
    // persons that still have an old copy of their biography as a story (earlier imports): no second entry
    $copied = [];
    foreach ($db->all("SELECT l.person_id FROM {stories} s JOIN {story_links} l ON l.story_id = s.id WHERE s.source LIKE 'note:%'") as $r) $copied[(int)$r['person_id']] = true;
    if (App::$s['bios_in_stories'] ?? true) {
        $min = max(1, (int)(App::$s['notes_story_min'] ?? 80));
        foreach ($db->all('SELECT id, notes FROM {persons} WHERE notes IS NOT NULL') as $p) {
            $pid = (int)$p['id']; $notes = trim((string)$p['notes']);
            if (mb_strlen($notes) < $min || isset($copied[$pid]) || !isset($g['P'][$pid])) continue;
            $it = ft_bio_item('bio', $pid, $notes, $g);
            if (ft_story_visible($it)) $out[] = $it;
        }
        foreach ($db->all('SELECT id, notes FROM {families} WHERE notes IS NOT NULL') as $f) {
            $fid = (int)$f['id']; $notes = trim((string)$f['notes']);
            if (mb_strlen($notes) < $min || !isset($g['F'][$fid])) continue;
            $it = ft_bio_item('fbio', $fid, $notes, $g);
            if (ft_story_visible($it)) $out[] = $it;
        }
    }
    if (ft_comments_on() && App::loggedIn()) {
        $rows = $db->all("SELECT * FROM {comments} WHERE story = 1 AND status = 'ok' ORDER BY created DESC");
        $names = ft_user_names(array_column($rows, 'user_id'));
        foreach ($rows as $c) $out[] = ft_comment_story_item($c, $names);
    }
    // by year, newest first; undated ones at the end
    usort($out, fn($a, $b) => [($a['y'] ?? null) === null, -($a['y'] ?? 0)] <=> [($b['y'] ?? null) === null, -($b['y'] ?? 0)]);
    return $out;
}

function ft_bio_item(string $kind, int $id, string $notes, array $g): array
{
    if ($kind === 'bio') {
        $gp = $g['P'][$id]; $yrs = ft_life_years($gp);
        return ['kind' => 'bio', 'id' => $id, 'title' => ft_name($gp) . ($yrs ? " ($yrs)" : ''), 'y' => $gp['by'], 'date' => null,
            'excerpt' => ft_excerpt($notes), 'cover' => ft_portrait($id), 'person_ids' => [$id], 'family_ids' => [],
            '_tr' => [['excerpt', 'person', $id, 'notes', $notes, true]]];
    }
    $f = $g['F'][$id];
    return ['kind' => 'fbio', 'id' => $id, 'title' => ft_family_title($g, $id), 'y' => $f['my'], 'date' => null,
        'excerpt' => ft_excerpt($notes), 'cover' => ft_portrait($f['husband_id'] ?: $f['wife_id']), 'person_ids' => [], 'family_ids' => [$id],
        '_tr' => [['excerpt', 'family', $id, 'notes', $notes, true]]];
}

function ft_comment_story_item(array $c, array $names): array
{
    $a = ft_comment_about($c);
    return ['kind' => 'comment', 'id' => (int)$c['id'], 'title' => $a['label'], 'y' => $a['y'], 'date' => null,
        'excerpt' => ft_excerpt((string)$c['body']), 'cover' => $a['cover'], 'person_ids' => $a['person_ids'], 'family_ids' => $a['family_ids'],
        'author' => $names[(int)$c['user_id']] ?? null, 'created' => $c['created'], 'entity' => $c['entity'], 'entity_id' => (int)$c['entity_id'],
        '_tr' => [['excerpt', 'comment', (int)$c['id'], 'body', (string)$c['body'], true]]];
}

/** One biography or comment-memory, read like a story (kind: bio | fbio | comment). */
function ft_story_extra(string $kind, int $id): array
{
    $db = App::$db; $g = ft_graph();
    if ($kind === 'bio' || $kind === 'fbio') {
        $table = $kind === 'bio' ? 'persons' : 'families';
        $notes = trim((string)$db->val("SELECT notes FROM {{$table}} WHERE id = ?", [$id]));
        if ($notes === '' || ($kind === 'bio' ? !isset($g['P'][$id]) : !isset($g['F'][$id]))) throw ft_err('Nincs ilyen életrajz.', 404);
        $o = ft_bio_item($kind, $id, $notes, $g);
        if (!ft_story_visible($o)) throw ft_err('Ez az életrajz élő családtagról szól, ezért csak bejelentkezve olvasható.', 401);
        $o['body'] = $notes;
        $o['_tr'][] = ['body', $kind === 'bio' ? 'person' : 'family', $id, 'notes'];
        return $o;
    }
    if ($kind === 'comment') {
        ft_comments_guard();
        $c = $db->row("SELECT * FROM {comments} WHERE id = ? AND status = 'ok'", [$id]);
        if (!$c) throw ft_err('Nincs ilyen hozzászólás.', 404);
        $names = ft_user_names([$c['user_id']]);
        $o = ft_comment_story_item($c, $names);
        $o['body'] = $c['body'];
        $o['_tr'][] = ['body', 'comment', $id];
        $o['story'] = (bool)$c['story'];
        $a = ft_comment_about($c);
        $o['photo'] = $a['photo'];
        $rows = $db->all("SELECT * FROM {comments} WHERE parent_id = ? AND status = 'ok' ORDER BY created, id", [$id]);
        $rn = ft_user_names(array_column($rows, 'user_id'));
        $o['replies'] = array_map(fn($r) => ft_comment_json($r, $rn), $rows);
        return $o;
    }
    throw ft_err('Ismeretlen elem.', 400);
}

// ------------------------------------------------------------------ translation
function ft_deepl_key(): ?string
{
    $k = App::$cfg['deepl'] ?? null;
    if (!$k) $k = trim((string)(App::$s['deepl_key'] ?? '')) ?: null;
    return $k;
}
function ft_translator_ready(): bool
{
    if (isset($GLOBALS['ft_translate_mock'])) return true;
    return (bool)ft_deepl_key() && (function_exists('curl_init') || ini_get('allow_url_fopen'));
}

/**
 * Translate texts with DeepL. Returns ['texts' => [...], 'detected' => 'hu'|...].
 * Tests set $GLOBALS['ft_translate_mock'] = fn(array $texts, string $target, ?string $source) => [...].
 */
function ft_translate(array $texts, string $target, ?string $source = null): array
{
    if (isset($GLOBALS['ft_translate_mock'])) return ($GLOBALS['ft_translate_mock'])($texts, $target, $source);
    $key = ft_deepl_key();
    if (!$key) throw ft_err('Nincs DeepL kulcs a config.php-ben.', 500);
    $url = (str_ends_with($key, ':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com') . '/v2/translate';
    $body = ['text' => array_values($texts), 'target_lang' => FT_DEEPL_TARGET[$target] ?? strtoupper($target), 'preserve_formatting' => true];
    if ($source) $body['source_lang'] = strtoupper($source);
    $json = json_encode($body, JSON_UNESCAPED_UNICODE);
    $headers = ['Authorization: DeepL-Auth-Key ' . $key, 'Content-Type: application/json'];
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => $json, CURLOPT_HTTPHEADER => $headers, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40]);
        $resp = curl_exec($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        unset($ch);
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $json, 'timeout' => 40, 'ignore_errors' => true]]);
        $resp = @file_get_contents($url, false, $ctx);
        $code = 0;
        foreach (ft_response_headers(get_defined_vars()) as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
        $err = $resp === false ? 'kapcsolódási hiba' : '';
    }
    if ($resp === false || $code !== 200) {
        $msg = [403 => 'érvénytelen DeepL kulcs', 456 => 'elfogyott a havi DeepL keret', 429 => 'túl sok kérés, próbáld később'][$code] ?? ($err ?: "HTTP $code");
        throw ft_err('DeepL fordítás sikertelen: ' . $msg, 502);
    }
    $d = json_decode($resp, true);
    $out = array_map(fn($t) => $t['text'], $d['translations'] ?? []);
    $each = array_map(fn($t) => ['text' => $t['text'], 'detected' => strtolower((string)($t['detected_source_language'] ?? ''))], $d['translations'] ?? []);
    return ['texts' => $out, 'detected' => strtolower($d['translations'][0]['detected_source_language'] ?? ''), 'each' => $each];
}

/** Translate one story into every other enabled language. Unchanged texts are not sent again. */
function ft_story_translate(int $sid, bool $force = false): array
{
    $db = App::$db;
    $s = ft_story_row($sid);
    $src = ft_lang($s['lang'] ?: 'hu');
    $hash = sha1($s['title'] . "\0" . $s['body']);
    $done = [];
    foreach (ft_langs() as $lang) {
        if ($lang === $src) continue;
        $tr = $db->row('SELECT * FROM {story_tr} WHERE story_id = ? AND lang = ?', [$sid, $lang]);
        if ($tr && $tr['src_hash'] === $hash && !$force) continue;
        $r = ft_translate([(string)$s['title'], (string)$s['body']], $lang, $src);
        [$t, $b] = $r['texts'] + ['', ''];
        if ($tr) $db->update('story_tr', ['title' => mb_substr($t, 0, 255), 'body' => $b, 'src_hash' => $hash, 'created' => ft_now()], (int)$tr['id']);
        else $db->insert('story_tr', ['story_id' => $sid, 'lang' => $lang, 'title' => mb_substr($t, 0, 255), 'body' => $b, 'src_hash' => $hash, 'created' => ft_now()]);
        $done[] = $lang;
    }
    return $done;
}

/** After a story was saved: translate if enabled. Never breaks the save – returns a warning instead. */
function ft_story_after_save(int $sid): ?string
{
    if (!App::$s['translate_auto'] || !ft_translator_ready()) return null;
    try { ft_story_translate($sid); return null; }
    catch (Throwable $e) { error_log('[familytree] translate: ' . $e->getMessage()); return $e->getMessage(); }
}

/** Story fields in the requested language (falls back to the original). */
function ft_story_localize(array $o, array $row, string $lang): array
{
    $o['lang'] = ft_lang($row['lang'] ?: 'hu');
    $o['langs'] = array_values(array_unique(array_merge([$o['lang']], array_map('strval', App::$db->col('SELECT lang FROM {story_tr} WHERE story_id = ?', [(int)$row['id']])))));
    if ($lang === $o['lang']) return $o;
    $tr = App::$db->row('SELECT title, body FROM {story_tr} WHERE story_id = ? AND lang = ?', [(int)$row['id'], $lang]);
    if (!$tr) return $o;
    $o['orig_title'] = $o['title'];
    $o['title'] = $tr['title'];
    $o['excerpt'] = mb_substr(trim(preg_replace('/\s+/u', ' ', preg_replace('/[#*_>\[\]]/u', '', (string)$tr['body']))), 0, 260);
    if (array_key_exists('body', $o)) { $o['orig_body'] = $o['body']; $o['body'] = $tr['body']; }
    $o['shown_lang'] = $lang;
    return $o;
}
