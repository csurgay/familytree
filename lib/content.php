<?php
/**
 * Story content helpers:
 *  - person biographies (GEDCOM notes) → stories
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
/** Creates one story per person whose note is at least $minLen characters. Re-running skips what exists. */
function ft_notes_to_stories(int $minLen = 80): array
{
    $db = App::$db;
    $g = ft_graph();
    $have = array_flip(array_filter($db->col("SELECT source FROM {stories} WHERE source LIKE 'note:%'")));
    $st = ['created' => 0, 'skipped' => 0, 'short' => 0];
    foreach ($db->all('SELECT id, xref, given, surname, title, suffix, notes FROM {persons} WHERE notes IS NOT NULL ORDER BY id') as $p) {
        $notes = trim((string)$p['notes']);
        if (mb_strlen($notes) < $minLen) { $st['short']++; continue; }
        $key = 'note:' . ($p['xref'] ?: 'p' . $p['id']);
        if (isset($have[$key])) { $st['skipped']++; continue; }
        $gp = $g['P'][(int)$p['id']] ?? null;
        $years = '';
        if ($gp) {
            $b = $gp['by'] ? (string)$gp['by'] : ($gp['deceased'] ? '?' : '');
            $years = $gp['dy'] ? "{$b}–{$gp['dy']}" : ($b ? ($gp['deceased'] ? "{$b}–?" : "sz. {$b}") : '');
        }
        $title = ft_name($p) . ($years ? " ($years)" : '');
        $now = ft_now();
        $sid = $db->insert('stories', ['title' => mb_substr($title, 0, 255), 'body' => $notes,
            'date_raw' => $gp['bdate'] ?? null, 'y' => $gp['by'] ?? null, 'status' => 'ok', 'source' => $key, 'lang' => 'hu',
            'created_by' => null, 'created' => $now, 'updated' => $now]);
        $db->insert('story_links', ['story_id' => $sid, 'person_id' => (int)$p['id']]);
        $have[$key] = true;
        $st['created']++;
    }
    if ($st['created']) App::audit('notes2stories', 'story', null, $st);
    return $st;
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
    if (!$key) throw ft_err('Nincs DeepL kulcs (config.php: deepl_key).', 500);
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
        curl_close($ch);
    } else {
        $ctx = stream_context_create(['http' => ['method' => 'POST', 'header' => implode("\r\n", $headers), 'content' => $json, 'timeout' => 40, 'ignore_errors' => true]]);
        $resp = @file_get_contents($url, false, $ctx);
        $code = 0;
        foreach ($http_response_header ?? [] as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
        $err = $resp === false ? 'kapcsolódási hiba' : '';
    }
    if ($resp === false || $code !== 200) {
        $msg = [403 => 'érvénytelen DeepL kulcs', 456 => 'elfogyott a havi DeepL keret', 429 => 'túl sok kérés, próbáld később'][$code] ?? ($err ?: "HTTP $code");
        throw ft_err('DeepL fordítás sikertelen: ' . $msg, 502);
    }
    $d = json_decode($resp, true);
    $out = array_map(fn($t) => $t['text'], $d['translations'] ?? []);
    return ['texts' => $out, 'detected' => strtolower($d['translations'][0]['detected_source_language'] ?? '')];
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
