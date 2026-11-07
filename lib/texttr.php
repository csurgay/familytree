<?php
/**
 * Machine translation of everything people write in, whatever language they write it in:
 * biographies, family notes, event labels and notes, photo titles and descriptions, comments, pin captions.
 * (Stories have their own, older mechanism: story_tr.)
 *
 * How it works
 *  - the JSON builders only mark the translatable fields: '_tr' => [[field, kind, id, srcField?, srcText?, excerpt?], …]
 *  - ft_tr_apply() walks the finished API response, and for the viewer's language adds `<field>_tr`
 *    (the translation) and `<field>_src` (the language of the original). The original field is never
 *    changed, so every edit form keeps working on the original text.
 *  - translations are cached in text_tr (one row per text and target language, with the hash of the
 *    original, so an edited text is translated again). The source language is detected by DeepL;
 *    a text already in the viewer's language is shown as it is (a quick local guess saves the DeepL call
 *    for longer texts).
 *  - missing translations are made on the first view, in one batched DeepL request, at most
 *    FT_TR_MAX_CHARS characters per page view; the admin can translate everything in advance.
 */

const FT_TR_MAX_CHARS = 30000;

function ft_tr_on(): bool
{
    return !empty(App::$s['translate_content']) && ft_translator_ready() && count(ft_langs()) > 1
        && (int)(App::$s['_tr_pause'] ?? 0) < time();
}

/** Quick local language guess (hu / en / de) for texts of a few words; null when unsure. */
function ft_guess_lang(string $t): ?string
{
    $t = mb_strtolower($t);
    preg_match_all('/[\p{L}]+/u', $t, $m);
    $w = $m[0];
    if (count($w) < 4) return null;
    $sets = [
        'hu' => ['a', 'az', 'és', 'hogy', 'nem', 'volt', 'is', 'egy', 'meg', 'de', 'ki', 'el', 'már', 'csak', 'mint', 'majd', 'után', 'ahol', 'aki', 'pedig', 'még', 'nagyon', 'lett', 'született', 'évben', 'ben', 'ban'],
        'en' => ['the', 'and', 'of', 'to', 'in', 'was', 'he', 'she', 'his', 'her', 'with', 'for', 'that', 'is', 'on', 'at', 'as', 'by', 'from', 'were', 'they', 'born', 'after'],
        'de' => ['der', 'die', 'das', 'und', 'ist', 'war', 'mit', 'von', 'zu', 'ein', 'eine', 'nicht', 'sich', 'auf', 'für', 'dem', 'den', 'des', 'im', 'auch', 'wurde', 'geboren', 'nach'],
    ];
    $score = [];
    foreach ($sets as $l => $s) { $f = array_flip($s); $score[$l] = 0; foreach ($w as $x) if (isset($f[$x])) $score[$l]++; }
    if (preg_match('/[őű]/u', $t)) $score['hu'] += 3;
    if (preg_match('/ß/u', $t)) $score['de'] += 3;
    arsort($score);
    [$best, $second] = array_values($score);
    $lang = array_key_first($score);
    return $best >= 2 && $best >= 2 * $second ? $lang : null;
}

/** Walks the response, translates the marked fields for $lang, removes the markers. */
function ft_tr_apply($data, string $lang, bool $translate = true)
{
    $jobs = [];
    ft_tr_collect($data, $jobs);
    $results = $jobs && $translate ? ft_tr_resolve($jobs, $lang) : [];
    ft_tr_fill($data, $results);
    return $data;
}

function ft_tr_collect(&$a, array &$jobs): void
{
    if (!is_array($a)) return;
    if (isset($a['_tr']) && is_array($a['_tr'])) {
        foreach ($a['_tr'] as $i => $m) {
            [$f, $kind, $id] = $m;
            $sf = $m[3] ?? $f;
            $text = $m[4] ?? ($a[$f] ?? null);
            if (!is_string($text) || trim($text) === '' || !preg_match('/\p{L}/u', $text)) continue;
            $key = "$kind:$id:$sf";
            $jobs[$key] = ['kind' => $kind, 'id' => (int)$id, 'field' => $sf, 'text' => $text];
            $a['_tr'][$i]['key'] = $key;
        }
    }
    foreach ($a as $k => &$v) if ($k !== '_tr' && is_array($v)) ft_tr_collect($v, $jobs);
}

function ft_tr_fill(&$a, array $res): void
{
    if (!is_array($a)) return;
    if (isset($a['_tr']) && is_array($a['_tr'])) {
        foreach ($a['_tr'] as $m) {
            $r = isset($m['key']) ? ($res[$m['key']] ?? null) : null;
            if (!$r) continue;
            $f = $m[0];
            $a[$f . '_tr'] = !empty($m[5]) ? ft_excerpt($r['text']) : $r['text'];
            $a[$f . '_src'] = $r['src'];
        }
        unset($a['_tr']);
    }
    foreach ($a as $k => &$v) if (is_array($v)) ft_tr_fill($v, $res);
}

/**
 * For each job: the translation into $lang, or nothing when the text is already in that language
 * (or cannot be translated now). Returns [key => ['text' => …, 'src' => 'hu']].
 */
function ft_tr_resolve(array $jobs, string $lang, ?int $maxChars = FT_TR_MAX_CHARS): array
{
    $db = App::$db;
    // cached rows of these texts, all languages
    $byKind = [];
    foreach ($jobs as $j) $byKind[$j['kind']][$j['id']] = true;
    $rows = [];
    foreach ($byKind as $kind => $ids) {
        foreach (array_chunk(array_keys($ids), 500) as $chunk) {
            $ph = implode(',', array_fill(0, count($chunk), '?'));
            foreach ($db->all("SELECT * FROM {text_tr} WHERE kind = ? AND item_id IN ($ph)", array_merge([$kind], $chunk)) as $r) {
                $rows["$kind:{$r['item_id']}:{$r['field']}"][] = $r;
            }
        }
    }
    $out = []; $todo = [];
    foreach ($jobs as $key => $j) {
        $hash = sha1($j['text']);
        $mine = array_values(array_filter($rows[$key] ?? [], fn($r) => $r['src_hash'] === $hash));
        if (array_filter($mine, fn($r) => $r['src_lang'] === $lang)) continue;        // written in this language
        $hit = array_values(array_filter($mine, fn($r) => $r['lang'] === $lang));
        if ($hit) { if ($hit[0]['src_lang'] !== $lang) $out[$key] = ['text' => $hit[0]['text'], 'src' => $hit[0]['src_lang']]; continue; }
        if (ft_guess_lang($j['text']) === $lang) continue;                              // looks like it is in this language
        $todo[$key] = $j + ['hash' => $hash];
    }
    if (!$todo || !ft_tr_on()) return $out;
    // one DeepL request per ≤ 50 texts; at most $maxChars characters this time, the rest on a later view
    $batch = []; $chars = 0;
    foreach ($todo as $key => $j) {
        $len = mb_strlen($j['text']);
        if ($maxChars !== null && $batch && $chars + $len > $maxChars) break;
        $batch[$key] = $j; $chars += $len;
    }
    foreach (array_chunk($batch, 50, true) as $chunk) {
        try {
            $r = ft_translate_each(array_column($chunk, 'text'), $lang);
        } catch (Throwable $e) {
            // DeepL down / quota used up: show the originals, and do not try again for 10 minutes
            error_log('[familytree] text translate: ' . $e->getMessage());
            ft_setting_set($db, '_tr_pause', time() + 600); App::$s['_tr_pause'] = time() + 600;
            break;
        }
        $i = 0;
        foreach ($chunk as $key => $j) {
            $x = $r[$i++] ?? null;
            if (!$x || !is_string($x['text'] ?? null)) continue;
            $t = $x['text'];
            $d = strtolower(substr((string)($x['detected'] ?? ''), 0, 2));
            $src = $d !== '' ? $d : 'xx';
            $db->q('DELETE FROM {text_tr} WHERE kind = ? AND item_id = ? AND field = ? AND lang = ?', [$j['kind'], $j['id'], $j['field'], $lang]);
            $db->insert('text_tr', ['kind' => $j['kind'], 'item_id' => $j['id'], 'field' => $j['field'], 'lang' => $lang,
                'text' => $src === $lang ? '' : $t, 'src_lang' => $src, 'src_hash' => $j['hash'], 'created' => ft_now()]);
            if ($src !== $lang) $out[$key] = ['text' => $t, 'src' => $src];
        }
    }
    return $out;
}

/** Translate several texts at once; each one's source language is detected separately. */
function ft_translate_each(array $texts, string $target): array
{
    if (isset($GLOBALS['ft_translate_each_mock'])) return ($GLOBALS['ft_translate_each_mock'])(array_values($texts), $target);
    // ft_translate() returns the texts and the first detection only; ask DeepL directly for all of them
    if (isset($GLOBALS['ft_translate_mock'])) {
        $r = ($GLOBALS['ft_translate_mock'])(array_values($texts), $target, null);
        return array_map(fn($t) => ['text' => $t, 'detected' => $r['detected'] ?? ''], $r['texts']);
    }
    return ft_translate(array_values($texts), $target, null)['each'];
}

// ------------------------------------------------------------------ everything in advance (admin)

/** All translatable texts of the database: [key => job]. */
function ft_tr_all_jobs(): array
{
    $db = App::$db; $jobs = [];
    $add = function (string $kind, int $id, string $field, $text) use (&$jobs) {
        if (!is_string($text) || trim($text) === '' || !preg_match('/\p{L}/u', $text)) return;
        $jobs["$kind:$id:$field"] = ['kind' => $kind, 'id' => $id, 'field' => $field, 'text' => $text];
    };
    foreach ($db->all('SELECT id, notes FROM {persons} WHERE notes IS NOT NULL') as $r) $add('person', (int)$r['id'], 'notes', $r['notes']);
    foreach ($db->all('SELECT id, notes FROM {families} WHERE notes IS NOT NULL') as $r) $add('family', (int)$r['id'], 'notes', $r['notes']);
    foreach ($db->all('SELECT id, label, note FROM {events}') as $r) { $add('event', (int)$r['id'], 'label', $r['label']); $add('event', (int)$r['id'], 'note', $r['note']); }
    foreach ($db->all("SELECT id, title, descr FROM {photos} WHERE status = 'ok'") as $r) { $add('photo', (int)$r['id'], 'title', $r['title']); $add('photo', (int)$r['id'], 'descr', $r['descr']); }
    foreach ($db->all("SELECT id, body FROM {comments} WHERE status = 'ok'") as $r) $add('comment', (int)$r['id'], 'body', $r['body']);
    foreach ($db->all('SELECT id, caption FROM {pins}') as $r) $add('pin', (int)$r['id'], 'caption', $r['caption']);
    return $jobs;
}

/** How much is still to translate, per language: ['en' => ['n' => 12, 'chars' => 3400], …]. */
function ft_tr_missing(?array $jobs = null): array
{
    $jobs = $jobs ?? ft_tr_all_jobs();
    $have = [];
    foreach (App::$db->all('SELECT kind, item_id, field, lang, src_lang, src_hash FROM {text_tr}') as $r) {
        $have["{$r['kind']}:{$r['item_id']}:{$r['field']}"][] = $r;
    }
    $out = [];
    foreach (ft_langs() as $lang) {
        $n = 0; $chars = 0; $keys = [];
        foreach ($jobs as $key => $j) {
            $hash = sha1($j['text']);
            $rows = array_filter($have[$key] ?? [], fn($r) => $r['src_hash'] === $hash);
            if (array_filter($rows, fn($r) => $r['src_lang'] === $lang || $r['lang'] === $lang)) continue;
            if (ft_guess_lang($j['text']) === $lang) continue;
            $n++; $chars += mb_strlen($j['text']); $keys[] = $key;
        }
        $out[$lang] = ['n' => $n, 'chars' => $chars, 'keys' => $keys];
    }
    return $out;
}

/** One step of "translate everything": at most $maxChars characters; returns what is left. */
function ft_tr_step(int $maxChars = 20000): array
{
    if (!ft_translator_ready()) throw ft_err('A fordításhoz DeepL kulcs kell a config.php-ben, és a szervernek el kell érnie az internetet.');
    App::$s['_tr_pause'] = 0;
    $jobs = ft_tr_all_jobs();
    $miss = ft_tr_missing($jobs);
    $done = 0;
    foreach ($miss as $lang => $m) {
        if (!$m['n']) continue;
        $sub = array_intersect_key($jobs, array_flip($m['keys']));
        $before = (int)App::$db->val('SELECT COUNT(*) FROM {text_tr} WHERE lang = ?', [$lang]);
        $saved = App::$s['translate_content'] ?? true; App::$s['translate_content'] = true;
        ft_tr_resolve($sub, $lang, $maxChars);
        App::$s['translate_content'] = $saved;
        $done += (int)App::$db->val('SELECT COUNT(*) FROM {text_tr} WHERE lang = ?', [$lang]) - $before;
        if ((int)(App::$s['_tr_pause'] ?? 0) > time()) throw ft_err('A DeepL most nem fordít (hiba vagy elfogyott a keret). A részletek a szerver hibanaplójában vannak.', 502);
        break;   // one language per step keeps each request short
    }
    $left = ft_tr_missing($jobs);
    return ['done' => $done, 'left' => array_map(fn($m) => ['n' => $m['n'], 'chars' => $m['chars']], $left)];
}
