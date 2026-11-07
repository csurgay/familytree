<?php
/** Read-side helpers and all API handlers. */

/** Best-effort e-mail (hosting mail()); never throws. */
function ft_mail(string $to, string $subject, string $body): bool
{
    if (!filter_var($to, FILTER_VALIDATE_EMAIL)) return false;
    if (isset($GLOBALS['ft_mail_sink']) && is_array($GLOBALS['ft_mail_sink'])) { $GLOBALS['ft_mail_sink'][] = compact('to', 'subject', 'body'); return true; } // self-tests
    if (!function_exists('mail')) return false;
    $host = preg_replace('/[^a-z0-9.\-]/i', '', $_SERVER['HTTP_HOST'] ?? 'localhost');
    $headers = "From: " . (App::$s['site_title'] ?? 'Családfa') . " <noreply@$host>\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit";
    $subject = '=?UTF-8?B?' . base64_encode($subject) . '?=';
    return @mail($to, $subject, $body, $headers);
}
function ft_base_url(): string
{
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    return $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/\\');
}

function ft_light_person(array $g, array $p, array $photoMap): array
{
    $id = $p['id'];
    $o = ['id' => $id, 'g' => $p['given'] ?? '', 's' => $p['surname'] ?? '', 't' => $p['title'] ?? '', 'x' => $p['suffix'] ?? '',
        'n' => $p['nickname'] ?? '', 'sx' => $p['sex'] ?: 'U', 'b' => $p['by'], 'd' => $p['dy'], 'bs' => $p['bsort'], 'dec' => $p['deceased'],
        'bp' => $p['bp'], 'dp' => $p['dp'], 'fs' => $p['fams'], 'fc' => $p['famc'], 'e' => $g['est'][$id] ?? null];
    if ($p['photo_id'] && isset($photoMap[$p['photo_id']])) {
        $ph = $photoMap[$p['photo_id']];
        $o['ph'] = $ph['thumb']; $o['pf'] = $ph['file'];
        $f = $ph['focus'][$id] ?? [0.5, 0.35];
        $o['fx'] = $f[0]; $o['fy'] = $f[1];
    }
    $o['liv'] = ft_is_living($g, $id);
    if (!empty($p['rel'])) { $r = array_filter($p['rel'], fn($x) => $x !== 'birth'); if ($r) $o['rel'] = $r; }
    return ft_mask_light($o);
}

function ft_mask_light(array $o): array
{
    if (!$o['liv'] || !ft_mask_living()) return $o;
    $o['b'] = null; $o['d'] = null; $o['bs'] = null; $o['bp'] = null; $o['dp'] = null; $o['e'] = null;
    unset($o['ph'], $o['pf'], $o['fx'], $o['fy']);
    if (App::$s['privacy_living'] === 'names') { $o['g'] = 'Élő személy'; $o['s'] = ''; $o['t'] = ''; $o['x'] = ''; $o['n'] = ''; }
    $o['masked'] = true;
    return $o;
}

function ft_photo_map(): array
{
    return App::cache('photomap', function () {
        $m = [];
        foreach (App::$db->all("SELECT id, file, thumb, w, h FROM {photos} WHERE status = 'ok'") as $r) { $r['focus'] = []; $m[(int)$r['id']] = $r; }
        foreach (App::$db->all('SELECT photo_id, person_id, fx, fy FROM {photo_links} WHERE person_id IS NOT NULL') as $l) {
            if (isset($m[(int)$l['photo_id']])) $m[(int)$l['photo_id']]['focus'][(int)$l['person_id']] = [(float)($l['fx'] ?? .5), (float)($l['fy'] ?? .35)];
        }
        return $m;
    });
}

function ft_event_json(array $e, ?array $g = null): array
{
    $g = $g ?? ft_graph();
    $o = ['id' => (int)$e['id'], 'type' => $e['type'], 'tl' => FT_EVENT_TYPES[$e['type']] ?? $e['type'], 'label' => $e['label'],
        'raw' => $e['date_raw'], 'date' => ft_format_date($e['date_raw']), 'y' => ft_int($e['y']), 'm' => ft_int($e['m']), 'd' => ft_int($e['d']),
        'sort' => ft_int($e['sort']), 'place' => $e['place'], 'note' => $e['note'], 'person_id' => ft_int($e['person_id']), 'family_id' => ft_int($e['family_id']),
        '_tr' => [['label', 'event', (int)$e['id']], ['note', 'event', (int)$e['id']]]];
    return $o;
}

/** Is an event hidden for the current viewer (living person in public mode)? */
function ft_event_hidden(array $e, array $g): bool
{
    if ($e['person_id'] && !isset($g['P'][(int)$e['person_id']])) return true;
    if ($e['family_id'] && !isset($g['F'][(int)$e['family_id']])) return true;
    if (!ft_mask_living()) return false;
    if ($e['person_id']) return ft_is_living($g, (int)$e['person_id']);
    if ($e['family_id'] && isset($g['F'][(int)$e['family_id']])) {
        $f = $g['F'][(int)$e['family_id']];
        return ($f['husband_id'] && ft_is_living($g, $f['husband_id'])) || ($f['wife_id'] && ft_is_living($g, $f['wife_id']));
    }
    return false;
}

function ft_photo_json(array $r, bool $withLinks = true): array
{
    $o = ['id' => (int)$r['id'], 'file' => $r['file'], 'thumb' => $r['thumb'], 'w' => (int)$r['w'], 'h' => (int)$r['h'], 'title' => $r['title'],
        'descr' => $r['descr'], 'raw' => $r['date_raw'], 'date' => ft_format_date($r['date_raw']), 'status' => $r['status'], 'uploaded_by' => ft_int($r['uploaded_by']),
        '_tr' => [['title', 'photo', (int)$r['id']], ['descr', 'photo', (int)$r['id']]]];
    if ($withLinks) $o['links'] = array_map(fn($l) => ['person_id' => ft_int($l['person_id']), 'family_id' => ft_int($l['family_id']), 'story_id' => ft_int($l['story_id']),
        'fx' => (float)($l['fx'] ?? .5), 'fy' => (float)($l['fy'] ?? .35)], App::$db->all('SELECT * FROM {photo_links} WHERE photo_id = ?', [(int)$r['id']]));
    return $o;
}

function ft_photo_visible(array $photo, array $g): bool
{
    if ($photo['status'] !== 'ok' && !App::isAdmin() && (int)$photo['uploaded_by'] !== App::uid()) return false;
    if (!ft_mask_living()) return true;
    foreach ($photo['links'] ?? [] as $l) {
        if ($l['person_id'] && ft_is_living($g, $l['person_id'])) return false;
        if ($l['family_id'] && ft_story_visible(['family_ids' => [$l['family_id']]]) === false) return false;
        if ($l['story_id'] && ($st = App::$db->row('SELECT * FROM {stories} WHERE id = ?', [(int)$l['story_id']])) && !ft_story_visible(ft_story_json($st))) return false;
    }
    return true;
}

/** Stories about living people (or a family with a living partner) are for logged-in members only. */
function ft_story_visible(array $story): bool
{
    if (!ft_mask_living()) return true;
    $g = ft_graph();
    foreach ($story['person_ids'] ?? [] as $pid) if (ft_is_living($g, (int)$pid)) return false;
    foreach ($story['family_ids'] ?? [] as $fid) {
        $f = $g['F'][(int)$fid] ?? null;
        if ($f && (($f['husband_id'] && ft_is_living($g, $f['husband_id'])) || ($f['wife_id'] && ft_is_living($g, $f['wife_id'])))) return false;
    }
    return true;
}
/** ft_story_json for a list of rows, without the ones the viewer may not see. */
function ft_story_list(array $rows, ?string $lang = null, int $limit = 0): array
{
    $out = [];
    foreach ($rows as $r) {
        $j = ft_story_json($r);
        if (!ft_story_visible($j)) continue;
        $out[] = $lang ? ft_story_localize($j, $r, $lang) : $j;
        if ($limit && count($out) >= $limit) break;
    }
    return $out;
}

function ft_story_json(array $s, bool $full = false): array
{
    $body = (string)$s['body'];
    $o = ['id' => (int)$s['id'], 'title' => $s['title'], 'raw' => $s['date_raw'], 'date' => ft_format_date($s['date_raw']), 'y' => ft_int($s['y']),
        'excerpt' => ft_excerpt($body),
        'created' => $s['created'], 'updated' => $s['updated'], 'author_id' => ft_int($s['created_by']),
        'imported' => str_starts_with((string)($s['source'] ?? ''), 'note:'),
        'author' => $s['created_by'] ? App::$db->val('SELECT name FROM {users} WHERE id = ?', [(int)$s['created_by']]) : null];
    $o['cover'] = null;
    if ($s['cover_photo_id'] && ($ph = App::$db->row("SELECT thumb, file FROM {photos} WHERE id = ? AND status = 'ok'", [(int)$s['cover_photo_id']]))) $o['cover'] = $ph;
    $links = App::$db->all('SELECT person_id, family_id FROM {story_links} WHERE story_id = ?', [(int)$s['id']]);
    $o['person_ids'] = array_values(array_filter(array_map('intval', array_column($links, 'person_id'))));
    if (!$o['cover'] && $o['person_ids']) {
        // no cover photo: use the portrait of the first person the story is about
        $ph = App::$db->row("SELECT p.thumb, p.file FROM {persons} x JOIN {photos} p ON p.id = x.photo_id WHERE x.id = ? AND p.status = 'ok'", [$o['person_ids'][0]]);
        if ($ph && !(ft_mask_living() && ft_is_living(ft_graph(), $o['person_ids'][0]))) $o['cover'] = $ph + ['portrait' => true];
    }
    $o['family_ids'] = array_values(array_filter(array_map('intval', array_column($links, 'family_id'))));
    if ($full) $o['body'] = $body;
    return $o;
}

function ft_modes(array $persons, array $families, array $opts = []): array
{
    return ['create' => ft_mode('create', $persons, $families, $opts), 'update' => ft_mode('update', $persons, $families, $opts), 'delete' => ft_mode('delete', $persons, $families, $opts)];
}

function ft_pick_home_person(array $g): ?int
{
    if (!$g['P']) return null;
    $best = null; $bestScore = -1;
    foreach ($g['P'] as $id => $p) {
        $anc = 0; $frontier = [$id];
        for ($i = 0; $i < 4; $i++) { $n = []; foreach ($frontier as $x) foreach (ft_parents($g, $x) as $pp) $n[] = $pp; $anc += count($n); $frontier = $n; }
        $desc = 0; $frontier = [$id];
        for ($i = 0; $i < 3; $i++) { $n = []; foreach ($frontier as $x) foreach (ft_children($g, $x) as $c) $n[] = $c; $desc += count($n); $frontier = $n; }
        $score = min($anc, 20) + min($desc, 14) + ($p['by'] ? 1 : 0);
        if ($score > $bestScore) { $bestScore = $score; $best = $id; }
    }
    return $best;
}

function ft_generations(array $g): int
{
    $memo = [];
    $depth = function ($id, $guard = 0) use (&$depth, &$memo, $g) {
        if (isset($memo[$id])) return $memo[$id];
        if ($guard > 60) return 1;
        $m = 0;
        foreach (ft_parents($g, $id) as $p) $m = max($m, $depth($p, $guard + 1));
        return $memo[$id] = $m + 1;
    };
    $max = 0;
    foreach ($g['P'] as $id => $_) $max = max($max, $depth($id));
    return $max;
}

// =====================================================================================
// Handlers: name => fn(array $in): mixed
// =====================================================================================
function ft_handlers(): array
{
    return [
        'boot' => function () {
            $db = App::$db;
            $installed = (int)$db->val('SELECT COUNT(*) FROM {users}') > 0;
            $u = App::$user;
            $out = ['installed' => $installed, 'version' => FT_VERSION, 'csrf' => $_SESSION['csrf'] ?? '',
                'sf' => substr(hash('sha256', session_id() . '|ft'), 0, 10),  // session fingerprint: tells the browser whether its cookie sticks
                'user' => $u ? ['id' => (int)$u['id'], 'name' => $u['name'], 'email' => $u['email'], 'role' => $u['role'], 'person_id' => ft_int($u['person_id']), 'hasPassword' => (string)$u['pass_hash'] !== ''] : null,
                'oauth' => ft_oauth_enabled(), 'oauthNew' => ft_oauth_pending_info(),
                'settings' => array_filter(App::$s, fn($k) => $k[0] !== '_', ARRAY_FILTER_USE_KEY),
                'canRead' => ft_can_read(), 'eventTypes' => FT_EVENT_TYPES, 'driver' => $db->driver,
                'langs' => array_map(fn($l) => ['code' => $l, 'name' => FT_LANGS[$l]], ft_langs()), 'allowRegister' => (bool)App::$s['allow_register'], 'pwReset' => (bool)App::$s['pw_reset'],
                'repoGedcom' => $installed ? null : (($gf = ft_find_ged(App::$root)) ? basename($gf) : null)];
            if (!empty($_SESSION['oauth_err'])) { $out['oauthError'] = ft_t((string)$_SESSION['oauth_err']); unset($_SESSION['oauth_err']); }
            if (App::isAdmin()) {
                $out['settingsDef'] = ft_settings_def();
                $out['pendingUsers'] = (int)$db->val("SELECT COUNT(*) FROM {users} WHERE status = 'pending'");
                $out['pending'] = (int)$db->val("SELECT COUNT(*) FROM {changes} WHERE status = 'pending'") + $out['pendingUsers'];
                $out['pendingChanges'] = $out['pending'] - $out['pendingUsers'];
                $out['translator'] = ft_translator_ready();
            }
            if (App::loggedIn()) {
                $out['branchRoots'] = array_map('intval', $db->col('SELECT person_id FROM {branches} WHERE user_id = ?', [App::uid()]));
                $out['myPending'] = (int)$db->val("SELECT COUNT(*) FROM {changes} WHERE status = 'pending' AND user_id = ?", [App::uid()]);
            }
            return $out;
        },

        'install' => function ($in) {
            $db = App::$db;
            if ((int)$db->val('SELECT COUNT(*) FROM {users}') > 0) throw ft_err('Az app már telepítve van.', 403);
            $email = mb_strtolower(trim((string)($in['email'] ?? '')));
            $name = ft_str($in['name'] ?? '', 120);
            $pass = (string)($in['password'] ?? '');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw ft_err('Érvényes e-mail címet adj meg.');
            if (!$name) throw ft_err('Add meg a neved.');
            if (mb_strlen($pass) < 8) throw ft_err('A jelszó legalább 8 karakter legyen.');
            $uid = $db->insert('users', ['email' => $email, 'name' => $name, 'pass_hash' => password_hash($pass, PASSWORD_DEFAULT), 'role' => 'admin', 'active' => 1, 'failed' => 0, 'created' => ft_now()]);
            session_regenerate_id(true);
            $_SESSION['uid'] = $uid;
            App::$user = $db->row('SELECT * FROM {users} WHERE id = ?', [$uid]);
            $stats = null;
            if (!empty($in['import'])) {
                $gf = ft_find_ged(App::$root);
                if ($gf) {
                    $stats = ft_gedcom_import($db, ft_gedcom_parse(file_get_contents($gf)), 'replace', $uid);
                    App::flush();
                    $hp = ft_pick_home_person(ft_graph());
                    if ($hp) ft_setting_set($db, 'home_person', $hp);
                }
            }
            if (!empty($in['title'])) ft_setting_set($db, 'site_title', ft_str($in['title']));
            App::audit('install', 'app', null, $stats ?: 'üres adatbázis');
            return ['imported' => $stats];
        },

        'login' => function ($in) {
            $db = App::$db;
            $email = mb_strtolower(trim((string)($in['email'] ?? '')));
            $u = $db->row('SELECT * FROM {users} WHERE email = ?', [$email]);
            if ($u && $u['locked_until'] && $u['locked_until'] > ft_now()) throw ft_err('Túl sok sikertelen próbálkozás. Próbáld újra ' . substr($u['locked_until'], 11, 5) . ' után.', 429);
            if ($u && !$u['active'] && password_verify((string)($in['password'] ?? ''), $u['pass_hash'])) {
                throw ft_err(($u['status'] ?? '') === 'pending' ? 'A regisztrációd jóváhagyásra vár. Amint az admin elfogadja, be tudsz lépni.' : 'Ez a fiók le van tiltva. Keresd az admint.', 403);
            }
            if (!$u || !$u['active'] || !password_verify((string)($in['password'] ?? ''), $u['pass_hash'])) {
                if ($u) {
                    $f = (int)$u['failed'] + 1;
                    $lock = $f >= (int)App::$s['login_max_attempts'] ? date('Y-m-d H:i:s', time() + 60 * (int)App::$s['login_lock_minutes']) : null;
                    $db->update('users', ['failed' => $lock ? 0 : $f, 'locked_until' => $lock], (int)$u['id']);
                }
                usleep(300000);
                throw ft_err('Hibás e-mail cím vagy jelszó.', 401);
            }
            if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) $db->update('users', ['pass_hash' => password_hash((string)$in['password'], PASSWORD_DEFAULT)], (int)$u['id']);
            $db->update('users', ['failed' => 0, 'locked_until' => null, 'last_login' => ft_now()], (int)$u['id']);
            session_regenerate_id(true);
            $_SESSION['uid'] = (int)$u['id'];
            $_SESSION['ep'] = (string)(App::$s['session_epoch'] ?? '');
            App::$user = $u;
            return ['ok' => true];
        },
        'register' => function ($in) {
            $db = App::$db;
            if (!App::$s['allow_register']) throw ft_err('A regisztráció jelenleg nincs engedélyezve.', 403);
            // honeypot: bots fill every field (old pages send "website", new ones a name no autofill knows)
            if (!empty($in['hp_x7']) || (!empty($in['website']) && !isset($in['hp_x7']))) return ['ok' => true];
            $now = time();
            $_SESSION['reg'] = array_values(array_filter($_SESSION['reg'] ?? [], fn($t) => $t > $now - 3600));
            if (count($_SESSION['reg']) >= 3) throw ft_err('Túl sok regisztrációs próbálkozás. Próbáld újra egy óra múlva.', 429);
            $email = mb_strtolower(trim((string)($in['email'] ?? '')));
            $name = ft_str($in['name'] ?? '', 120);
            $pass = (string)($in['password'] ?? '');
            if (!$name) throw ft_err('Add meg a neved.');
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw ft_err('Érvényes e-mail címet adj meg.');
            if (mb_strlen($pass) < 8) throw ft_err('A jelszó legalább 8 karakter legyen.');
            if ($db->val('SELECT id FROM {users} WHERE email = ?', [$email])) throw ft_err('Ezzel az e-mail címmel már regisztráltak. Ha elfelejtetted a jelszavad, a belépésnél kérhetsz újat.');
            $intro = ft_str($in['intro'] ?? '', 2000);
            $id = $db->insert('users', ['email' => $email, 'name' => $name, 'pass_hash' => password_hash($pass, PASSWORD_DEFAULT), 'role' => 'member',
                'active' => 0, 'status' => 'pending', 'intro' => $intro, 'lang' => ft_lang($in['lang'] ?? 'hu'), 'failed' => 0, 'created' => ft_now()]);
            $_SESSION['reg'][] = $now;
            App::audit('register', 'user', $id, "$name <$email>");
            if (App::$s['register_notify']) {
                foreach ($db->col("SELECT email FROM {users} WHERE role = 'admin' AND active = 1") as $to) {
                    ft_mail($to, 'Új regisztráció: ' . $name, "$name ($email) regisztrált a családfa oldalra.\n\nBemutatkozás:\n" . ($intro ?: '—') . "\n\nJóváhagyás: " . ft_base_url() . '/#/admin/users');
                }
            }
            return ['ok' => true];
        },
        'logout' => function () { $_SESSION = []; session_regenerate_id(true); $_SESSION['csrf'] = bin2hex(random_bytes(16)); App::$user = null; return ['ok' => true]; },
        'password' => function ($in) {
            ft_require_login();
            // a member who signed up with Google / Facebook has no password yet and may set one
            if ((string)App::$user['pass_hash'] !== '' && !password_verify((string)($in['old'] ?? ''), App::$user['pass_hash'])) throw ft_err('A jelenlegi jelszó nem stimmel.');
            if (mb_strlen((string)($in['new'] ?? '')) < 8) throw ft_err('Az új jelszó legalább 8 karakter legyen.');
            App::$db->update('users', ['pass_hash' => password_hash((string)$in['new'], PASSWORD_DEFAULT), 'reset_hash' => null, 'reset_until' => null], App::uid());
            return ['ok' => true];
        },
        'register.oauth' => fn($in) => ft_oauth_register($in),
        'oauth.mine' => fn() => ft_oauth_mine(),
        'oauth.unlink' => fn($in) => ft_oauth_unlink((string)($in['provider'] ?? '')),
        // forgotten password: always the same answer, so the form does not reveal who has an account
        'pwreset.request' => function ($in) {
            $db = App::$db;
            if (!App::$s['pw_reset']) throw ft_err('Az elfelejtett jelszó funkció ki van kapcsolva. Keresd az admint.', 403);
            $email = mb_strtolower(trim((string)($in['email'] ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw ft_err('Érvényes e-mail címet adj meg.');
            $now = time();
            $_SESSION['pwr'] = array_values(array_filter($_SESSION['pwr'] ?? [], fn($t) => $t > $now - 3600));
            if (count($_SESSION['pwr']) >= 5) throw ft_err('Túl sok kérés. Próbáld újra egy óra múlva.', 429);
            $_SESSION['pwr'][] = $now;
            $u = $db->row('SELECT * FROM {users} WHERE email = ?', [$email]);
            if ($u && $u['active'] && (!$u['reset_sent'] || $u['reset_sent'] < date('Y-m-d H:i:s', $now - 120))) {
                $token = bin2hex(random_bytes(24));
                $db->update('users', ['reset_hash' => hash('sha256', $token), 'reset_until' => date('Y-m-d H:i:s', $now + 3600), 'reset_sent' => ft_now()], (int)$u['id']);
                $site = App::$s['site_title'] ?? 'Családfa';
                $keep = App::$lang; App::$lang = ft_lang($u['lang'] ?: 'hu'); // the mail goes in the member's own language
                $tr = fn($s) => ft_t($s);
                ft_mail($u['email'], $tr('Új jelszó beállítása') . ' – ' . $site,
                    $tr('Szia') . ' ' . $u['name'] . "!\n\n" . $tr('Valaki (remélhetőleg te) új jelszót kért a fiókodhoz. Az alábbi linken egy órán belül megadhatod az új jelszót:') . "\n\n"
                    . ft_base_url() . '/#/reset/' . $token . "\n\n" . $tr('Ha nem te kérted, nyugodtan hagyd figyelmen kívül ezt a levelet, a jelszavad nem változik.') . "\n");
                App::$lang = $keep;
                App::audit('pwreset.request', 'user', (int)$u['id'], $u['email']);
            }
            usleep(200000);
            return ['ok' => true];
        },
        'pwreset' => function ($in) {
            $db = App::$db;
            $token = (string)($in['token'] ?? '');
            $u = preg_match('/^[0-9a-f]{48}$/', $token) ? $db->row('SELECT * FROM {users} WHERE reset_hash = ?', [hash('sha256', $token)]) : null;
            if (!$u || !$u['active'] || !$u['reset_until'] || $u['reset_until'] < ft_now()) throw ft_err('Ez a link érvénytelen vagy lejárt. Kérj újat az „Elfelejtett jelszó” linkkel.', 410);
            if (!empty($in['check'])) return ['ok' => true, 'name' => $u['name']];
            $pass = (string)($in['password'] ?? '');
            if (mb_strlen($pass) < 8) throw ft_err('A jelszó legalább 8 karakter legyen.');
            $db->update('users', ['pass_hash' => password_hash($pass, PASSWORD_DEFAULT), 'reset_hash' => null, 'reset_until' => null,
                'failed' => 0, 'locked_until' => null, 'last_login' => ft_now()], (int)$u['id']);
            App::audit('pwreset', 'user', (int)$u['id'], $u['email']);
            if (session_status() === PHP_SESSION_ACTIVE) session_regenerate_id(true);
            $_SESSION['uid'] = (int)$u['id'];
            $_SESSION['ep'] = (string)(App::$s['session_epoch'] ?? '');
            App::$user = $db->row('SELECT * FROM {users} WHERE id = ?', [(int)$u['id']]);
            return ['ok' => true];
        },

        'tree' => function () {
            $g = ft_graph(); $pm = ft_photo_map();
            $P = []; foreach ($g['P'] as $p) $P[] = ft_light_person($g, $p, $pm);
            $F = [];
            foreach ($g['F'] as $f) {
                $o = ['id' => $f['id'], 'h' => $f['husband_id'], 'w' => $f['wife_id'], 'c' => $f['children'], 'my' => $f['my'], 'dv' => $f['div']];
                if ($f['photo_id'] && isset($pm[$f['photo_id']])) $o['ph'] = $pm[$f['photo_id']]['thumb'];
                if (ft_mask_living() && (($f['husband_id'] && ft_is_living($g, $f['husband_id'])) || ($f['wife_id'] && ft_is_living($g, $f['wife_id'])))) { $o['my'] = null; unset($o['ph']); }
                $F[] = $o;
            }
            $branch = App::role() === 'head' ? array_keys(array_filter(ft_user_branch(App::uid())['P'], fn($v) => true)) : [];
            return ['persons' => $P, 'families' => $F, 'home' => (int)App::$s['home_person'] ?: ft_pick_home_person($g), 'branch' => $branch];
        },

        'person' => function ($in) {
            $id = (int)($in['id'] ?? 0);
            $g = ft_graph();
            if (!isset($g['P'][$id])) throw ft_err('Nincs ilyen személy.', 404);
            $row = ft_person_row($id);
            $light = ft_light_person($g, $g['P'][$id], ft_photo_map());
            $masked = !empty($light['masked']);
            $events = [];
            if (!$masked) foreach (App::$db->all('SELECT * FROM {events} WHERE person_id = ? ORDER BY sort IS NULL, sort, id', [$id]) as $e) $events[] = ft_event_json($e);
            $families = [];
            foreach ($g['P'][$id]['fams'] as $fid) {
                $fevs = [];
                foreach (App::$db->all('SELECT * FROM {events} WHERE family_id = ? ORDER BY sort IS NULL, sort, id', [$fid]) as $e) if (!ft_event_hidden($e, $g)) $fevs[] = ft_event_json($e);
                $families[] = ['id' => $fid, 'events' => $fevs];
            }
            $photos = [];
            if (!$masked) foreach (App::$db->all('SELECT p.* FROM {photos} p JOIN {photo_links} l ON l.photo_id = p.id WHERE l.person_id = ? ORDER BY p.y IS NULL, p.y, p.id', [$id]) as $ph) {
                $j = ft_photo_json($ph); if (ft_photo_visible($j, $g)) $photos[] = $j;
            }
            $stories = ft_story_list(App::$db->all('SELECT s.* FROM {stories} s JOIN {story_links} l ON l.story_id = s.id WHERE l.person_id = ? ORDER BY s.y IS NULL, s.y, s.id', [$id]), App::$lang);
            $out = ['person' => $light, 'notes' => $masked ? null : $row['notes'], 'married_name' => $masked ? null : $row['married_name'],
                'photo_id' => $masked ? null : ft_int($row['photo_id']), 'events' => $events, 'families' => $families, 'photos' => $photos, 'stories' => $stories,
                'modes' => ft_modes([$id], []), 'xref' => $row['xref'], 'created' => $row['created'], 'updated' => $row['updated'],
                '_tr' => [['notes', 'person', $id]]];
            if (ft_can_see_contacts() && $row['extra']) $out['extra'] = json_decode($row['extra'], true);
            if (App::isAdmin()) {
                $out['heads'] = App::$db->all('SELECT u.id, u.name FROM {branches} b JOIN {users} u ON u.id = b.user_id WHERE b.person_id = ?', [$id]);
            }
            return $out;
        },

        'family' => function ($in) {
            $id = (int)($in['id'] ?? 0);
            $g = ft_graph();
            if (!isset($g['F'][$id])) throw ft_err('Nincs ilyen család.', 404);
            $row = ft_family_row($id);
            $events = [];
            foreach (App::$db->all('SELECT * FROM {events} WHERE family_id = ? ORDER BY sort IS NULL, sort, id', [$id]) as $e) if (!ft_event_hidden($e, $g)) $events[] = ft_event_json($e);
            $photos = [];
            foreach (App::$db->all('SELECT p.* FROM {photos} p JOIN {photo_links} l ON l.photo_id = p.id WHERE l.family_id = ? ORDER BY p.y IS NULL, p.y, p.id', [$id]) as $ph) {
                $j = ft_photo_json($ph); if (ft_photo_visible($j, $g)) $photos[] = $j;
            }
            $stories = ft_story_list(App::$db->all('SELECT s.* FROM {stories} s JOIN {story_links} l ON l.story_id = s.id WHERE l.family_id = ?', [$id]), App::$lang);
            $f = $g['F'][$id];
            $hidden = ft_mask_living() && (($f['husband_id'] && ft_is_living($g, $f['husband_id'])) || ($f['wife_id'] && ft_is_living($g, $f['wife_id'])));
            return ['id' => $id, 'notes' => $hidden ? null : $row['notes'], 'events' => $events, 'photos' => $photos, 'stories' => $stories,
                'photo_id' => ft_int($row['photo_id']), 'modes' => ft_modes([], [$id]), '_tr' => [['notes', 'family', $id]]];
        },

        'home' => function () {
            $db = App::$db; $s = App::$s; $g = ft_graph();
            $types = array_values(array_intersect((array)$s['recent_types'], array_keys(FT_EVENT_TYPES))) ?: ['BIRT'];
            $in = implode(',', array_fill(0, count($types), '?'));
            $today = (int)date('Ymd');
            $from = (int)date('Ymd', time() - 86400 * (int)$s['recent_days']);
            $lim = (int)$s['recent_count'];
            $rows = $db->all("SELECT * FROM {events} WHERE type IN ($in) AND sort >= ? AND sort <= ? ORDER BY sort DESC LIMIT 100", array_merge($types, [$from, $today]));
            $rows = array_values(array_filter($rows, fn($e) => !ft_event_hidden($e, $g)));
            $recentMode = 'window';
            if (!$rows && $s['recent_fallback']) {
                $recentMode = 'latest';
                $rows = array_values(array_filter($db->all("SELECT * FROM {events} WHERE type IN ($in) AND sort IS NOT NULL AND sort <= ? ORDER BY sort DESC LIMIT 100", array_merge($types, [$today + 10000])), fn($e) => !ft_event_hidden($e, $g)));
            }
            // freshly recorded (in the last window) also counts as news even if the event itself is old
            $recent = array_map(fn($e) => ft_event_json($e, $g), array_slice($rows, 0, $lim));

            $ann = [];
            if ($s['anniversaries']) {
                $days = (int)$s['anniversary_days'];
                $Y = (int)date('Y');
                for ($i = 0; $i <= $days; $i++) {
                    $t = time() + 86400 * $i; $m = (int)date('n', $t); $d = (int)date('j', $t); $yy = (int)date('Y', $t);
                    foreach ($db->all("SELECT * FROM {events} WHERE type IN ('BIRT','MARR') AND m = ? AND d = ? AND y IS NOT NULL", [$m, $d]) as $e) {
                        if (ft_event_hidden($e, $g)) continue;
                        $years = $yy - (int)$e['y'];
                        if ($years <= 0) continue;
                        if ($e['type'] === 'BIRT') {
                            $pid = (int)$e['person_id'];
                            if (!isset($g['P'][$pid])) continue;
                            $alive = ft_is_living($g, $pid);
                            if (!$alive && $s['round_only_deceased'] && $years % 50 !== 0) continue;
                            if (!$alive && !$s['round_only_deceased'] && $years % 10 !== 0) continue;
                        } else {
                            $f = $g['F'][(int)$e['family_id']] ?? null;
                            if (!$f || $f['div']) continue;
                            $both = $f['husband_id'] && $f['wife_id'] && ft_is_living($g, $f['husband_id']) && ft_is_living($g, $f['wife_id']);
                            if (!$both && $years % 50 !== 0) continue;
                        }
                        $ann[] = ft_event_json($e, $g) + ['in_days' => $i, 'years' => $years];
                    }
                }
            }
            $pins = [];
            foreach ($db->all('SELECT * FROM {pins} ORDER BY sort, id') as $p) {
                $o = ['id' => (int)$p['id'], 'kind' => $p['kind'], 'ref_id' => (int)$p['ref_id'], 'params' => json_decode($p['params'] ?? '{}', true) ?: [], 'caption' => $p['caption'],
                    '_tr' => [['caption', 'pin', (int)$p['id']]]];
                if ($p['kind'] === 'event') {
                    $e = $db->row('SELECT * FROM {events} WHERE id = ?', [(int)$p['ref_id']]);
                    if (!$e || ft_event_hidden($e, $g)) continue;
                    $o['event'] = ft_event_json($e, $g);
                    $ph = null;
                    if ($e['person_id'] && ($pp = $g['P'][(int)$e['person_id']] ?? null) && $pp['photo_id']) $ph = ft_photo_map()[$pp['photo_id']] ?? null;
                    if ($e['family_id'] && ($ff = $g['F'][(int)$e['family_id']] ?? null) && $ff['photo_id']) $ph = ft_photo_map()[$ff['photo_id']] ?? $ph;
                    $o['photo'] = $ph ? ['file' => $ph['file'], 'thumb' => $ph['thumb']] : null;
                } elseif ($p['kind'] === 'story') {
                    $st = $db->row('SELECT * FROM {stories} WHERE id = ?', [(int)$p['ref_id']]);
                    if (!$st) continue;
                    $sj = ft_story_json($st); if (!ft_story_visible($sj)) continue;
                    $o['story'] = ft_story_localize($sj, $st, ft_lang($_GET['lang'] ?? 'hu'));
                } elseif ($p['kind'] === 'photo') {
                    $ph = $db->row("SELECT * FROM {photos} WHERE id = ? AND status = 'ok'", [(int)$p['ref_id']]);
                    if (!$ph) continue;
                    $j = ft_photo_json($ph); if (!ft_photo_visible($j, $g)) continue;
                    $o['photo'] = $j;
                } elseif ($p['kind'] === 'tree' || $p['kind'] === 'person') {
                    if (!isset($g['P'][(int)$p['ref_id']])) continue;
                }
                $pins[] = $o;
            }
            $lang = ft_lang($_GET['lang'] ?? 'hu');
            $stories = (int)$s['home_stories'] > 0 ? ft_story_list($db->all('SELECT * FROM {stories} ORDER BY created DESC LIMIT 200'), $lang, (int)$s['home_stories']) : [];
            $minY = $db->val('SELECT MIN(y) FROM {events} WHERE y IS NOT NULL AND y > 1000');
            $stats = ['persons' => count($g['P']), 'families' => count($g['F']), 'photos' => (int)$db->val("SELECT COUNT(*) FROM {photos} WHERE status = 'ok'"),
                'stories' => (int)$db->val('SELECT COUNT(*) FROM {stories}'), 'since' => $minY ? (int)$minY : null,
                'surnames' => count(array_unique(array_filter(array_map(fn($p) => $p['surname'], $g['P'])))),
                'generations' => App::cache('gens', fn() => ft_generations($g))];
            $newPhotos = [];
            foreach ($db->all("SELECT * FROM {photos} WHERE status = 'ok' ORDER BY id DESC LIMIT 12") as $ph) { $j = ft_photo_json($ph); if (ft_photo_visible($j, $g)) $newPhotos[] = $j; }
            return ['recent' => $recent, 'recentMode' => $recentMode, 'anniversaries' => $ann, 'pins' => $pins, 'stories' => $stories, 'stats' => $stats, 'newPhotos' => array_slice($newPhotos, 0, 8), 'comments' => ft_comments_recent(6)];
        },

        'comments' => fn($in) => ft_comments_list((string)($in['entity'] ?? ''), (int)($in['entity_id'] ?? 0)),
        'comment.add' => fn($in) => ft_comment_add($in),
        'comment.edit' => fn($in) => ft_comment_edit($in),
        'comment.delete' => fn($in) => ft_comment_delete($in),
        'comment.story' => fn($in) => ft_comment_story($in),
        'story.extra' => fn($in) => ft_story_extra((string)($in['kind'] ?? ''), (int)($in['id'] ?? 0)),

        'events' => function ($in) {
            $g = ft_graph();
            $type = strtoupper((string)($in['type'] ?? ''));
            $sql = 'SELECT * FROM {events} WHERE sort IS NOT NULL';
            $args = [];
            if ($type && isset(FT_EVENT_TYPES[$type])) { $sql .= ' AND type = ?'; $args[] = $type; }
            if (!empty($in['year'])) { $sql .= ' AND y = ?'; $args[] = (int)$in['year']; }
            $sql .= ' ORDER BY sort DESC LIMIT 2000';
            return array_values(array_map(fn($e) => ft_event_json($e, $g), array_filter(App::$db->all($sql, $args), fn($e) => !ft_event_hidden($e, $g))));
        },

        'photos' => function ($in) {
            $g = ft_graph();
            $sql = 'SELECT * FROM {photos} p'; $args = []; $w = [];
            if (!empty($in['person_id'])) { $sql .= ' JOIN {photo_links} l ON l.photo_id = p.id'; $w[] = 'l.person_id = ?'; $args[] = (int)$in['person_id']; }
            if (!empty($in['pending'])) { $w[] = "p.status = 'pending'"; }
            if ($w) $sql .= ' WHERE ' . implode(' AND ', $w);
            $sql .= ' ORDER BY p.id DESC LIMIT 1000';
            $out = [];
            foreach (App::$db->all($sql, $args) as $r) { $j = ft_photo_json($r); if (ft_photo_visible($j, $g)) $out[] = $j; }
            return $out;
        },
        'photo' => function ($in) {
            $j = ft_photo_json(ft_photo_row((int)($in['id'] ?? 0)));
            if (!ft_photo_visible($j, ft_graph())) throw ft_err('Ez a fotó nem nyilvános.', 403);
            $t = ft_photo_targets(['id' => $j['id']]);
            $j['modes'] = ft_modes($t[0], $t[1], $t[2]);
            $j['uploader'] = $j['uploaded_by'] ? App::$db->val('SELECT name FROM {users} WHERE id = ?', [$j['uploaded_by']]) : null;
            return $j;
        },

        'stories' => function ($in) {
            $lang = ft_lang($in['lang'] ?? 'hu');
            return ft_story_feed($lang);
        },
        'story' => function ($in) {
            $s = ft_story_row((int)($in['id'] ?? 0));
            $sj = ft_story_json($s, true);
            if (!ft_story_visible($sj)) throw ft_err('Ez a történet élő családtagról szól, ezért csak bejelentkezve olvasható.', 401);
            $o = ft_story_localize($sj, $s, ft_lang($in['lang'] ?? 'hu'));
            $o['raw_body'] = $s['body']; $o['raw_title'] = $s['title'];
            $g = ft_graph();
            $o['photos'] = [];
            foreach (App::$db->all('SELECT p.* FROM {photos} p JOIN {photo_links} l ON l.photo_id = p.id WHERE l.story_id = ?', [(int)$s['id']]) as $ph) { $j = ft_photo_json($ph); if (ft_photo_visible($j, $g)) $o['photos'][] = $j; }
            $t = ft_ops()['story.update']['targets'](['id' => (int)$s['id']]);
            $o['modes'] = ft_modes($t[0], $t[1], $t[2]);
            return $o;
        },

        'sources' => fn() => App::$db->all('SELECT * FROM {sources} ORDER BY id'),

        'op' => function ($in) {
            ft_require_login();
            $name = (string)($in['name'] ?? '');
            $r = ft_run_op($name, (array)($in['payload'] ?? []));
            if (empty($r['queued']) && in_array($name, ['story.create', 'story.update'], true) && !empty($r['id'])) {
                $w = ft_story_after_save((int)$r['id']);
                if ($w) $r['warning'] = 'A sztori elmentve, de a fordítás nem sikerült: ' . $w;
            }
            return $r;
        },

        'pin' => function ($in) {
            ft_require_admin();
            $kind = (string)($in['kind'] ?? '');
            if (!in_array($kind, ['event', 'story', 'tree', 'photo', 'person'], true)) throw ft_err('Ismeretlen kitűzés-típus.');
            if (!empty($in['replace'])) App::$db->q('DELETE FROM {pins} WHERE kind = ?', [$kind]);
            $id = App::$db->insert('pins', ['kind' => $kind, 'ref_id' => (int)$in['ref_id'], 'params' => json_encode($in['params'] ?? new stdClass()),
                'caption' => ft_str($in['caption'] ?? null), 'sort' => (int)($in['sort'] ?? 0), 'created_by' => App::uid(), 'created' => ft_now()]);
            App::audit('pin', $kind, (int)$in['ref_id'], $in['caption'] ?? '');
            return ['id' => $id];
        },
        'unpin' => function ($in) { ft_require_admin(); App::$db->delete('pins', (int)$in['id']); return ['ok' => true]; },

        'charts' => fn() => App::$db->all('SELECT c.*, u.name AS author FROM {charts} c LEFT JOIN {users} u ON u.id = c.created_by ORDER BY c.id DESC'),
        'chart.save' => function ($in) {
            ft_require_login();
            $png = (string)($in['png'] ?? '');
            if (!preg_match('#^data:image/png;base64,#', $png)) throw ft_err('Hiányzik a kép.');
            $bin = base64_decode(substr($png, 22), true);
            if ($bin === false || strlen($bin) > 30 * 1024 * 1024 || substr($bin, 0, 8) !== "\x89PNG\r\n\x1a\n") throw ft_err('Hibás PNG.');
            $svg = (string)($in['svg'] ?? '');
            if (strlen($svg) > 30 * 1024 * 1024) throw ft_err('Túl nagy SVG.');
            // strip anything scripty from the SVG before storing it
            $svg = preg_replace('#<script\b.*?</script>#is', '', $svg);
            $svg = preg_replace('#\son\w+\s*=\s*("[^"]*"|\'[^\']*\')#i', '', $svg);
            $dir = App::$root . '/uploads/charts';
            if (!is_dir($dir)) @mkdir($dir, 0775, true);
            $name = date('Ymd') . '-' . bin2hex(random_bytes(6));
            file_put_contents("$dir/$name.png", $bin);
            if ($svg) file_put_contents("$dir/$name.svg", $svg);
            $id = App::$db->insert('charts', ['title' => ft_str($in['title'] ?? 'Diagram') ?: 'Diagram', 'kind' => ft_str($in['kind'] ?? '', 20), 'person_id' => ft_int($in['person_id'] ?? null),
                'config' => json_encode($in['config'] ?? [], JSON_UNESCAPED_UNICODE), 'png' => "uploads/charts/$name.png", 'svg' => $svg ? "uploads/charts/$name.svg" : null,
                'created_by' => App::uid(), 'created' => ft_now()]);
            App::audit('chart.save', 'chart', $id, $in['title'] ?? '');
            return ['id' => $id, 'png' => "uploads/charts/$name.png"];
        },
        'chart.delete' => function ($in) {
            ft_require_login();
            $c = App::$db->row('SELECT * FROM {charts} WHERE id = ?', [(int)$in['id']]);
            if (!$c) throw ft_err('Nincs ilyen diagram.', 404);
            if (!App::isAdmin() && (int)$c['created_by'] !== App::uid()) throw ft_err('Csak a saját diagramodat törölheted.', 403);
            foreach (['png', 'svg'] as $k) if ($c[$k] && str_starts_with($c[$k], 'uploads/charts/')) @unlink(App::$root . '/' . $c[$k]);
            App::$db->delete('charts', (int)$c['id']);
            return ['ok' => true];
        },

        'quiz.save' => function ($in) {
            $total = max(1, min(200, (int)($in['total'] ?? 0)));
            $score = max(0, min($total, (int)($in['score'] ?? 0)));
            $name = App::loggedIn() ? App::$user['name'] : (ft_str($in['name'] ?? '', 80) ?: 'Vendég');
            $id = App::$db->insert('quiz_scores', ['name' => $name, 'user_id' => App::uid(), 'score' => $score, 'total' => $total,
                'mode' => in_array($in['mode'] ?? '', ['choice', 'list'], true) ? $in['mode'] : 'choice', 'ms' => max(0, (int)($in['ms'] ?? 0)), 'created' => ft_now()]);
            return ['id' => $id];
        },
        'quiz.top' => function () {
            $n = (int)App::$s['quiz_toplist'];
            if ($n <= 0) return [];
            $rows = array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name'], 'score' => (int)$r['score'], 'total' => (int)$r['total'], 'mode' => $r['mode'], 'ms' => (int)$r['ms'], 'created' => $r['created']],
                App::$db->all('SELECT id, name, score, total, mode, ms, created FROM {quiz_scores} ORDER BY id DESC LIMIT 2000'));
            usort($rows, fn($a, $b) => [$b['score'] / max(1, $b['total']), $b['total'], -$a['ms']] <=> [$a['score'] / max(1, $a['total']), $a['total'], -$b['ms']]);
            return array_slice($rows, 0, $n);
        },

        'changes.mine' => function () {
            ft_require_login();
            return App::$db->all('SELECT id, action, summary, status, review_note, created, reviewed FROM {changes} WHERE user_id = ? ORDER BY id DESC LIMIT 200', [App::uid()]);
        },

        // ------------------------------------------------------------------ admin
        'admin.changes' => function ($in) {
            ft_require_admin();
            $st = in_array($in['status'] ?? 'pending', ['pending', 'approved', 'rejected'], true) ? ($in['status'] ?? 'pending') : 'pending';
            $rows = App::$db->all('SELECT c.*, u.name AS user_name FROM {changes} c LEFT JOIN {users} u ON u.id = c.user_id WHERE c.status = ? ORDER BY c.id DESC LIMIT 300', [$st]);
            foreach ($rows as &$r) {
                $r['payload'] = json_decode($r['payload'] ?? 'null', true);
                $r['before'] = json_decode($r['before_json'] ?? 'null', true);
                unset($r['before_json']);
                if ($r['action'] === 'photo.publish' || $r['entity'] === 'photo') {
                    $r['photo'] = App::$db->row('SELECT thumb, file, title FROM {photos} WHERE id = ?', [(int)$r['entity_id']]);
                }
            }
            return $rows;
        },
        'admin.review' => fn($in) => ft_change_review((int)$in['id'], !empty($in['approve']), (string)($in['note'] ?? '')),

        'admin.settings' => function ($in) {
            ft_require_admin();
            $defs = []; foreach (ft_settings_def() as $d) $defs[$d[1]] = $d;
            $errors = []; $saved = 0;
            foreach ((array)($in['values'] ?? []) as $k => $v) {
                if (!isset($defs[$k])) continue;
                try { ft_setting_set(App::$db, $k, ft_setting_coerce($defs[$k], $v)); $saved++; }
                catch (InvalidArgumentException $e) { $errors[$k] = $e->getMessage(); }
            }
            if ($errors) throw ft_err(implode(' ', $errors));
            App::$s = ft_settings_load(App::$db);
            App::audit('settings', 'app', null, "$saved beállítás");
            return ['saved' => $saved];
        },
        'admin.users' => function () {
            ft_require_admin();
            $rows = App::$db->all('SELECT id, email, name, role, person_id, active, status, intro, created, last_login FROM {users} ORDER BY name');
            foreach ($rows as &$r) {
                $r['branches'] = array_map('intval', App::$db->col('SELECT person_id FROM {branches} WHERE user_id = ?', [(int)$r['id']]));
                $r['logins'] = App::$db->col('SELECT provider FROM {user_identities} WHERE user_id = ? ORDER BY provider', [(int)$r['id']]);
            }
            return $rows;
        },
        'admin.user.save' => function ($in) {
            ft_require_admin();
            $db = App::$db;
            $id = ft_int($in['id'] ?? null);
            $email = mb_strtolower(trim((string)($in['email'] ?? '')));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw ft_err('Érvényes e-mail címet adj meg.');
            $dupe = $db->val('SELECT id FROM {users} WHERE email = ?' . ($id ? ' AND id <> ?' : ''), $id ? [$email, $id] : [$email]);
            if ($dupe) throw ft_err('Ezzel az e-mail címmel már van felhasználó.');
            $role = in_array($in['role'] ?? '', ['admin', 'head', 'member'], true) ? $in['role'] : 'member';
            $d = ['email' => $email, 'name' => ft_str($in['name'] ?? '', 120) ?: $email, 'role' => $role, 'person_id' => ft_int($in['person_id'] ?? null), 'active' => !empty($in['active']) ? 1 : 0];
            $d['status'] = $d['active'] ? 'active' : 'disabled';
            $pw = (string)($in['password'] ?? '');
            if ($pw !== '') { if (mb_strlen($pw) < 8) throw ft_err('A jelszó legalább 8 karakter legyen.'); $d['pass_hash'] = password_hash($pw, PASSWORD_DEFAULT); $d['failed'] = 0; $d['locked_until'] = null; }
            if ($id) {
                if ($id === App::uid() && ($role !== 'admin' || !$d['active'])) throw ft_err('A saját admin jogodat nem veheted el.');
                $db->update('users', $d, $id);
            } else {
                if ($pw === '') throw ft_err('Új felhasználónak adj meg kezdő jelszót.');
                $id = $db->insert('users', $d + ['created' => ft_now(), 'failed' => 0]);
            }
            App::audit('user.save', 'user', $id, $email . ' (' . $role . ')');
            return ['id' => $id];
        },
        'admin.user.approve' => function ($in) {
            ft_require_admin();
            $db = App::$db;
            $id = (int)($in['id'] ?? 0);
            $u = $db->row('SELECT * FROM {users} WHERE id = ?', [$id]);
            if (!$u) throw ft_err('Nincs ilyen felhasználó.', 404);
            $roots = array_values(array_unique(array_filter(array_map('intval', (array)($in['branch_ids'] ?? [])))));
            foreach ($roots as $r) ft_person_row($r);
            $role = in_array($in['role'] ?? '', ['admin', 'head', 'member'], true) ? $in['role'] : 'member';
            if ($roots && $role === 'member') $role = 'head';
            $db->update('users', ['active' => 1, 'status' => 'active', 'role' => $role, 'person_id' => ft_int($in['person_id'] ?? null)], $id);
            foreach ($roots as $r) if (!$db->val('SELECT id FROM {branches} WHERE user_id = ? AND person_id = ?', [$id, $r])) $db->insert('branches', ['user_id' => $id, 'person_id' => $r, 'created' => ft_now()]);
            App::audit('user.approve', 'user', $id, $u['email'] . ' → ' . $role);
            ft_mail($u['email'], 'Jóváhagyták a regisztrációdat', 'Szia ' . $u['name'] . "!\n\nAz admin jóváhagyta a hozzáférésedet, mostantól be tudsz lépni:\n" . ft_base_url() . "/#/login\n");
            return ['ok' => true, 'role' => $role];
        },
        'admin.user.branches' => function ($in) {
            ft_require_admin();
            $db = App::$db;
            $uid = (int)($in['user_id'] ?? 0);
            $u = $db->row('SELECT * FROM {users} WHERE id = ?', [$uid]);
            if (!$u) throw ft_err('Nincs ilyen felhasználó.', 404);
            $want = array_values(array_unique(array_filter(array_map('intval', (array)($in['person_ids'] ?? [])))));
            foreach ($want as $p) ft_person_row($p);
            $have = array_map('intval', $db->col('SELECT person_id FROM {branches} WHERE user_id = ?', [$uid]));
            foreach (array_diff($have, $want) as $p) $db->q('DELETE FROM {branches} WHERE user_id = ? AND person_id = ?', [$uid, $p]);
            foreach (array_diff($want, $have) as $p) $db->insert('branches', ['user_id' => $uid, 'person_id' => $p, 'created' => ft_now()]);
            if ($want && $u['role'] === 'member') $db->update('users', ['role' => 'head'], $uid);
            App::audit('user.branches', 'user', $uid, count($want) . ' ág');
            return ['ok' => true];
        },
        'admin.user.delete' => function ($in) {
            ft_require_admin();
            $id = (int)$in['id'];
            if ($id === App::uid()) throw ft_err('Saját magadat nem törölheted.');
            App::$db->q('DELETE FROM {branches} WHERE user_id = ?', [$id]);
            App::$db->q('DELETE FROM {user_identities} WHERE user_id = ?', [$id]);
            App::$db->delete('users', $id);
            App::audit('user.delete', 'user', $id, '');
            return ['ok' => true];
        },
        'admin.branches' => function () {
            ft_require_admin();
            $g = ft_graph();
            $rows = App::$db->all('SELECT b.id, b.user_id, b.person_id, u.name AS user_name FROM {branches} b JOIN {users} u ON u.id = b.user_id ORDER BY u.name');
            foreach ($rows as &$r) { $r['size'] = count(ft_branch_set($g, (int)$r['person_id'], (bool)App::$s['branch_spouses'])); }
            return $rows;
        },
        'admin.branch.save' => function ($in) {
            ft_require_admin();
            $uid = (int)$in['user_id']; $pid = (int)$in['person_id'];
            $u = App::$db->row('SELECT * FROM {users} WHERE id = ?', [$uid]);
            if (!$u) throw ft_err('Nincs ilyen felhasználó.');
            ft_person_row($pid);
            if (App::$db->val('SELECT id FROM {branches} WHERE user_id = ? AND person_id = ?', [$uid, $pid])) throw ft_err('Ez az ág már hozzá van rendelve.');
            if ($u['role'] === 'member') App::$db->update('users', ['role' => 'head'], $uid);
            $id = App::$db->insert('branches', ['user_id' => $uid, 'person_id' => $pid, 'created' => ft_now()]);
            App::audit('branch.add', 'user', $uid, ft_name(ft_person_row($pid)));
            return ['id' => $id];
        },
        'admin.branch.delete' => function ($in) { ft_require_admin(); App::$db->delete('branches', (int)$in['id']); return ['ok' => true]; },
        'admin.audit' => function ($in) {
            ft_require_admin();
            return App::$db->all('SELECT a.*, u.name AS user_name FROM {audit} a LEFT JOIN {users} u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ' . max(10, min(2000, (int)($in['limit'] ?? 300))));
        },
        'admin.import' => function ($in) {
            ft_require_admin();
            $mode = ($in['mode'] ?? 'add') === 'replace' ? 'replace' : 'add';
            if (!empty($_FILES['file']['tmp_name'])) $text = file_get_contents($_FILES['file']['tmp_name']);
            else { $f = ft_find_ged(App::$root); if (!$f) throw ft_err('Nincs .ged fájl az app mappájában (vagy eggyel feljebb), tölts fel egyet.'); $text = file_get_contents($f); }
            $recs = ft_gedcom_parse($text);
            if (!array_filter($recs, fn($r) => $r['tag'] === 'INDI')) throw ft_err('A fájlban nincs egyetlen személy (INDI) sem — biztosan GEDCOM?');
            $stats = ft_gedcom_import(App::$db, $recs, $mode, App::uid());
            App::flush();
            if ($mode === 'replace' || !(int)App::$s['home_person']) { $hp = ft_pick_home_person(ft_graph()); if ($hp) ft_setting_set(App::$db, 'home_person', $hp); }
            App::audit('gedcom.import', 'app', null, $stats);
            return $stats;
        },
        'admin.tr_status' => function () {
            ft_require_admin();
            return ['ready' => ft_translator_ready(), 'on' => !empty(App::$s['translate_content']),
                'left' => array_map(fn($m) => ['n' => $m['n'], 'chars' => $m['chars']], ft_tr_missing()),
                'cached' => (int)App::$db->val('SELECT COUNT(*) FROM {text_tr}')];
        },
        'admin.tr_step' => function () {
            ft_require_admin();
            @set_time_limit(120);
            return ft_tr_step();
        },
        'admin.translate' => function ($in) {
            ft_require_admin();
            if (!ft_translator_ready()) throw ft_err('A fordításhoz DeepL kulcs kell a config.php-ben, és a szervernek el kell érnie az internetet.');
            @set_time_limit(120);
            $t0 = microtime(true); $done = 0; $calls = 0; $left = 0;
            foreach (App::$db->col('SELECT id FROM {stories} ORDER BY id') as $sid) {
                if (microtime(true) - $t0 > 20) { $left++; continue; } // keep each request short; the page calls again
                $r = ft_story_translate((int)$sid, !empty($in['force']));
                $calls += count($r); if ($r) $done++;
            }
            return ['stories' => $done, 'translations' => $calls, 'left' => $left];
        },
        'admin.backups' => function () { ft_require_admin(); return ft_backup_list(); },
        'admin.backup.start' => function () { ft_require_admin(); return ft_backup_start(); },
        'admin.backup.step' => function () { ft_require_admin(); return ft_backup_step(); },
        'admin.backup.cancel' => function () { ft_require_admin(); if ($j = ft_backup_job()) ft_backup_job_abort($j); return ['ok' => true]; },
        'admin.backup.upload' => function ($in) { ft_require_admin(); return ft_backup_upload_chunk($in); },
        'admin.backup.inspect' => function ($in) {
            ft_require_admin();
            $i = ft_backup_inspect(ft_backup_path((string)($in['name'] ?? '')));
            $i['blocking'] = (bool)$i['blocking'];
            return $i;
        },
        'admin.backup.delete' => function ($in) {
            ft_require_admin();
            $p = ft_backup_path((string)($in['name'] ?? ''));
            $j = ft_backup_job();
            if ($j && ($j['name'] ?? '') === basename($p)) throw ft_err('Ezt a mentést éppen használja egy futó folyamat.', 409);
            unlink($p);
            App::audit('backup.delete', 'app', null, basename($p));
            return ['ok' => true];
        },
        'admin.restore.start' => function ($in) { ft_require_admin(); return ft_restore_start((string)($in['name'] ?? '')); },
        'admin.photoimport' => function () {
            ft_require_admin();
            $f = $_FILES['file'] ?? null;
            if (!$f || ($f['error'] ?? 4) !== UPLOAD_ERR_OK) throw ft_err(($f['error'] ?? 4) === UPLOAD_ERR_INI_SIZE ? 'A ZIP nagyobb, mint amit a szerver enged (upload_max_filesize).' : 'Válassz egy ZIP fájlt.');
            return ft_photo_package_import($f['tmp_name']);
        },
        // photo hunting: everyone without a portrait, and the approved photos they are already tagged on
        'admin.nophoto' => function () {
            ft_require_admin();
            $tagged = [];
            foreach (App::$db->all("SELECT l.person_id, l.photo_id FROM {photo_links} l JOIN {photos} p ON p.id = l.photo_id
                                    WHERE l.person_id IS NOT NULL AND p.status = 'ok' ORDER BY p.id") as $r) $tagged[(int)$r['person_id']][] = (int)$r['photo_id'];
            $out = [];
            foreach (App::$db->col('SELECT id FROM {persons} WHERE photo_id IS NULL OR photo_id = 0 ORDER BY id') as $id) {
                $out[] = ['id' => (int)$id, 'photos' => $tagged[(int)$id] ?? []];
            }
            return ['list' => $out, 'total' => (int)App::$db->val('SELECT COUNT(*) FROM {persons}')];
        },
        'admin.stats' => function () {
            ft_require_admin();
            $o = [];
            foreach (array_keys(ft_schema()) as $t) $o[$t] = (int)App::$db->val("SELECT COUNT(*) FROM {{$t}}");
            return ['counts' => $o, 'driver' => App::$db->driver, 'php' => PHP_VERSION, 'gd' => function_exists('imagecreatefromstring'),
                'sqlite' => extension_loaded('pdo_sqlite'), 'upload_max' => ini_get('upload_max_filesize'), 'post_max' => ini_get('post_max_size'),
                'uploads_writable' => is_writable(App::$root . '/uploads'), 'config' => App::$cfg['source'], 'prefix' => App::$db->p,
                'session' => ini_get('session.save_handler') . ' · ' . (App::$sessionDir ? 'data/sessions' : (session_save_path() ?: '(alapértelmezett)')) . ' · ' . ini_get('session.gc_maxlifetime') . ' s', 'deepl' => (bool)ft_deepl_key(), 'curl' => function_exists('curl_init'), 'zip' => true, 'mail' => function_exists('mail')];
        },
        'admin.tests' => function ($in) {
            ft_require_admin();
            require_once App::$root . '/tests/server_tests.php';
            return ft_run_server_tests((string)($in['only'] ?? ''));
        },
    ];
}
