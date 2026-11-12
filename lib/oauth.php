<?php
/**
 * Log in with Google or Facebook ("Belépés Google-fiókkal").
 *
 * The keys live in config.php only (never in the database or the browser).
 * Redirect URI to register at both: <site>/oauth.php
 *
 * Rules
 *  - an identity (provider + its user id) already linked to a member → that member logs in;
 *  - otherwise a member with the same, provider-verified e-mail → linked automatically and logged in;
 *  - otherwise a new registration: the member writes who they are, and the admin approves it as usual;
 *  - pending / disabled members cannot log in this way either;
 *  - a logged-in member can link and unlink providers on the account page (the last way in cannot be removed).
 * Protection: one-time `state` bound to the session, 10-minute limit, PKCE and `nonce` for Google,
 * `appsecret_proof` for Facebook; the tokens are fetched server-to-server and never stored.
 */

const FT_OAUTH = [
    'google' => ['name' => 'Google', 'auth' => 'https://accounts.google.com/o/oauth2/v2/auth', 'token' => 'https://oauth2.googleapis.com/token'],
    'facebook' => ['name' => 'Facebook', 'auth' => 'https://www.facebook.com/v19.0/dialog/oauth', 'token' => 'https://graph.facebook.com/v19.0/oauth/access_token',
        'me' => 'https://graph.facebook.com/v19.0/me'],
];

/** [id, secret] of a provider from config.php, or null. */
function ft_oauth_keys(string $p): ?array
{
    $c = App::$cfg;
    $id = $c[$p . '_id'] ?? null; $sec = $c[$p . '_secret'] ?? null;
    return $id && $sec ? [$id, $sec] : null;
}

/** Providers that are switched on and have keys. */
function ft_oauth_enabled(): array
{
    $out = [];
    foreach (array_keys(FT_OAUTH) as $p) if (!empty(App::$s['oauth_' . $p]) && ft_oauth_keys($p)) $out[] = $p;
    return $out;
}

function ft_oauth_redirect_uri(): string { return ft_base_url() . '/oauth.php'; }

function ft_b64url(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function ft_b64url_dec(string $s): string { return (string)base64_decode(strtr($s, '-_', '+/') . str_repeat('=', (4 - strlen($s) % 4) % 4)); }

/** Server-to-server HTTP; tests set $GLOBALS['ft_oauth_mock'] = fn($method, $url, $params) => array. */
function ft_oauth_http(string $method, string $url, array $params = []): array
{
    if (isset($GLOBALS['ft_oauth_mock'])) return ($GLOBALS['ft_oauth_mock'])($method, $url, $params);
    $body = http_build_query($params);
    if ($method === 'GET' && $params) { $url .= (str_contains($url, '?') ? '&' : '?') . $body; $body = ''; }
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $opt = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 20, CURLOPT_HTTPHEADER => ['Accept: application/json']];
        if ($method === 'POST') { $opt[CURLOPT_POST] = true; $opt[CURLOPT_POSTFIELDS] = $body; }
        curl_setopt_array($ch, $opt);
        $resp = curl_exec($ch); $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE); $err = curl_error($ch);
        unset($ch);   // curl_close() is a no-op since PHP 8 and deprecated in 8.5
    } else {
        $ctx = stream_context_create(['http' => ['method' => $method, 'header' => "Accept: application/json\r\nContent-Type: application/x-www-form-urlencoded",
            'content' => $body, 'timeout' => 20, 'ignore_errors' => true]]);
        $resp = @file_get_contents($url, false, $ctx); $code = 0; $err = $resp === false ? 'kapcsolódási hiba' : '';
        foreach (ft_response_headers(get_defined_vars()) as $h) if (preg_match('#^HTTP/\S+\s+(\d+)#', $h, $m)) $code = (int)$m[1];
    }
    $d = is_string($resp) ? json_decode($resp, true) : null;
    if ($code !== 200 || !is_array($d)) {
        error_log('[familytree] oauth ' . parse_url($url, PHP_URL_HOST) . " HTTP $code $err " . substr((string)$resp, 0, 300));
        throw ft_err('A bejelentkező szolgáltatás nem válaszolt rendesen. Próbáld újra.', 502);
    }
    return $d;
}

/** Step 1: where to send the browser. $mode: 'login' or 'link'. */
function ft_oauth_start(string $p, string $mode = 'login', string $next = ''): string
{
    if (!in_array($p, ft_oauth_enabled(), true)) throw ft_err('Ez a belépési mód nincs bekapcsolva.', 404);
    if ($mode === 'link' && !App::loggedIn()) throw ft_err('A fiók kapcsolásához előbb lépj be.', 401);
    [$id] = ft_oauth_keys($p);
    $state = ft_b64url(random_bytes(24));
    $verifier = ft_b64url(random_bytes(48));
    $nonce = ft_b64url(random_bytes(18));
    $_SESSION['oauth'] = ['p' => $p, 'state' => $state, 'verifier' => $verifier, 'nonce' => $nonce, 'mode' => $mode,
        'next' => preg_match('~^#/[^\s<>"]{0,300}$~', $next) ? $next : '', 't' => time(), 'uid' => App::uid()];
    $q = ['client_id' => $id, 'redirect_uri' => ft_oauth_redirect_uri(), 'response_type' => 'code', 'state' => $state];
    if ($p === 'google') $q += ['scope' => 'openid email profile', 'nonce' => $nonce, 'code_challenge' => ft_b64url(hash('sha256', $verifier, true)),
        'code_challenge_method' => 'S256', 'prompt' => 'select_account'];
    else $q += ['scope' => 'email,public_profile'];
    return FT_OAUTH[$p]['auth'] . '?' . http_build_query($q);
}

/** Step 2: the provider sent the browser back. Returns the hash route to show next. */
function ft_oauth_callback(array $q): string
{
    $s = $_SESSION['oauth'] ?? null;
    unset($_SESSION['oauth']);                               // one-time
    if (!$s || !is_string($q['state'] ?? null) || !hash_equals($s['state'], $q['state'])) throw ft_err('A bejelentkezés lejárt vagy egy másik ablakból jött. Kezdd újra.', 400);
    if ($s['t'] < time() - 600) throw ft_err('A bejelentkezés lejárt (10 perc). Kezdd újra.', 400);
    if (!empty($q['error'])) {
        if (in_array($q['error'], ['access_denied', 'user_cancelled_login', 'user_denied'], true)) throw ft_err('A belépést megszakítottad.', 400);
        throw ft_err('A szolgáltató hibát jelzett: ' . substr(preg_replace('/[^\w .-]/u', '', (string)($q['error_description'] ?? $q['error'])), 0, 120), 400);
    }
    $code = (string)($q['code'] ?? '');
    if ($code === '') throw ft_err('Hiányzik a belépési kód.', 400);
    $p = $s['p'];
    if (!in_array($p, ft_oauth_enabled(), true)) throw ft_err('Ez a belépési mód nincs bekapcsolva.', 404);
    $who = $p === 'google' ? ft_oauth_google($code, $s) : ft_oauth_facebook($code);
    return ft_oauth_finish($p, $who, $s);
}

/** Google: code → id_token (straight from Google over TLS, so its claims are checked, not its signature). */
function ft_oauth_google(string $code, array $s): array
{
    [$id, $sec] = ft_oauth_keys('google');
    $t = ft_oauth_http('POST', FT_OAUTH['google']['token'], ['code' => $code, 'client_id' => $id, 'client_secret' => $sec,
        'redirect_uri' => ft_oauth_redirect_uri(), 'grant_type' => 'authorization_code', 'code_verifier' => $s['verifier']]);
    $parts = explode('.', (string)($t['id_token'] ?? ''));
    $c = count($parts) === 3 ? json_decode(ft_b64url_dec($parts[1]), true) : null;
    if (!is_array($c)) throw ft_err('A Google nem küldött azonosítót.', 502);
    if (!in_array($c['iss'] ?? '', ['accounts.google.com', 'https://accounts.google.com'], true)
        || ($c['aud'] ?? '') !== $id || (int)($c['exp'] ?? 0) < time() - 60 || !hash_equals($s['nonce'], (string)($c['nonce'] ?? ''))) {
        throw ft_err('A Google-azonosító ellenőrzése nem sikerült.', 400);
    }
    $verified = ($c['email_verified'] ?? false) === true || ($c['email_verified'] ?? '') === 'true';
    return ['sub' => (string)$c['sub'], 'email' => mb_strtolower(trim((string)($c['email'] ?? ''))), 'verified' => $verified, 'name' => trim((string)($c['name'] ?? ''))];
}

function ft_oauth_facebook(string $code): array
{
    [$id, $sec] = ft_oauth_keys('facebook');
    $t = ft_oauth_http('GET', FT_OAUTH['facebook']['token'], ['client_id' => $id, 'client_secret' => $sec, 'redirect_uri' => ft_oauth_redirect_uri(), 'code' => $code]);
    $tok = (string)($t['access_token'] ?? '');
    if ($tok === '') throw ft_err('A Facebook nem küldött hozzáférési kódot.', 502);
    $me = ft_oauth_http('GET', FT_OAUTH['facebook']['me'], ['fields' => 'id,name,email', 'access_token' => $tok, 'appsecret_proof' => hash_hmac('sha256', $tok, $sec)]);
    if (empty($me['id'])) throw ft_err('A Facebook nem küldött azonosítót.', 502);
    // Facebook only hands out confirmed addresses; an account registered with a phone number has none
    $email = mb_strtolower(trim((string)($me['email'] ?? '')));
    return ['sub' => (string)$me['id'], 'email' => $email, 'verified' => $email !== '', 'name' => trim((string)($me['name'] ?? ''))];
}

function ft_oauth_login(array $u, string $p, string $next): string
{
    if (!$u['active']) {
        if (($u['status'] ?? '') === 'pending') return '#/login?oauth=pending';
        throw ft_err('Ez a fiók le van tiltva. Keresd az admint.', 403);
    }
    $db = App::$db;
    $db->update('users', ['failed' => 0, 'locked_until' => null, 'last_login' => ft_now()], (int)$u['id']);
    if (session_status() === PHP_SESSION_ACTIVE) session_regenerate_id(true);
    $_SESSION['uid'] = (int)$u['id'];
    $_SESSION['ep'] = (string)(App::$s['session_epoch'] ?? '');
    App::$user = $u;
    App::audit('login.' . $p, 'user', (int)$u['id'], $u['email']);
    return $next ?: '#/';
}

function ft_oauth_finish(string $p, array $who, array $s): string
{
    $db = App::$db;
    if ($who['sub'] === '') throw ft_err('Hiányzik a fiókazonosító.', 502);
    $idn = $db->row('SELECT * FROM {user_identities} WHERE provider = ? AND subject = ?', [$p, $who['sub']]);
    $now = ft_now();

    if ($s['mode'] === 'link') {
        if (!App::loggedIn() || App::uid() !== (int)$s['uid']) throw ft_err('A fiók kapcsolásához előbb lépj be.', 401);
        if ($idn && (int)$idn['user_id'] !== App::uid()) throw ft_err('Ez a ' . FT_OAUTH[$p]['name'] . '-fiók már egy másik családtaghoz van kapcsolva.', 409);
        if (!$idn) $db->insert('user_identities', ['user_id' => App::uid(), 'provider' => $p, 'subject' => $who['sub'], 'email' => $who['email'] ?: null,
            'name' => $who['name'] ?: null, 'created' => $now, 'last_used' => $now]);
        App::audit('oauth.link', 'user', App::uid(), $p);
        return '#/account?linked=' . $p;
    }

    if ($idn) {
        $u = $db->row('SELECT * FROM {users} WHERE id = ?', [(int)$idn['user_id']]);
        if (!$u) { $db->delete('user_identities', (int)$idn['id']); }
        else { $db->update('user_identities', ['last_used' => $now], (int)$idn['id']); return ft_oauth_login($u, $p, $s['next']); }
    }
    // a member with this address: link (only when the provider vouches for the address)
    if ($who['email'] !== '') {
        $u = $db->row('SELECT * FROM {users} WHERE email = ?', [$who['email']]);
        if ($u) {
            if (!$who['verified']) throw ft_err('Ezzel az e-mail címmel már van fiók, de a ' . FT_OAUTH[$p]['name'] . ' nem igazolta a címet. Lépj be jelszóval, és a Fiókom oldalon kapcsold össze.', 409);
            $db->insert('user_identities', ['user_id' => (int)$u['id'], 'provider' => $p, 'subject' => $who['sub'], 'email' => $who['email'],
                'name' => $who['name'] ?: null, 'created' => $now, 'last_used' => $now]);
            App::audit('oauth.link', 'user', (int)$u['id'], $p . ' (azonos e-mail)');
            return ft_oauth_login($u, $p, $s['next']);
        }
    }
    // somebody new: they still say who they are, and the admin approves
    if (!App::$s['allow_register']) throw ft_err('Ehhez a ' . FT_OAUTH[$p]['name'] . '-fiókhoz nem tartozik családtag, és a regisztráció most nincs engedélyezve. Kérj hozzáférést az admintól.', 403);
    $_SESSION['oauth_new'] = ['p' => $p, 'sub' => $who['sub'], 'email' => $who['verified'] ? $who['email'] : '', 'name' => $who['name'], 't' => time()];
    return '#/register?oauth=' . $p;
}

/** What the registration form shows after a provider sign-in. */
function ft_oauth_pending_info(): ?array
{
    $n = $_SESSION['oauth_new'] ?? null;
    if (!$n || $n['t'] < time() - 1800) return null;
    return ['provider' => $n['p'], 'providerName' => FT_OAUTH[$n['p']]['name'], 'email' => $n['email'], 'name' => $n['name']];
}

/** Finish a registration that started with a provider sign-in (no password). */
function ft_oauth_register(array $in): array
{
    $n = $_SESSION['oauth_new'] ?? null;
    if (!$n || $n['t'] < time() - 1800) throw ft_err('A regisztráció lejárt. Kezdd újra a Google / Facebook gombbal.', 400);
    if (!App::$s['allow_register']) throw ft_err('A regisztráció jelenleg nincs engedélyezve.', 403);
    $db = App::$db;
    $name = ft_str($in['name'] ?? '', 120);
    if (!$name) throw ft_err('Add meg a neved.');
    $email = $n['email'] ?: mb_strtolower(trim((string)($in['email'] ?? '')));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw ft_err('Érvényes e-mail címet adj meg.');
    if ($db->val('SELECT id FROM {users} WHERE email = ?', [$email])) throw ft_err('Ezzel az e-mail címmel már van fiók. Lépj be azzal, és a Fiókom oldalon kapcsold hozzá a ' . FT_OAUTH[$n['p']]['name'] . '-fiókot.');
    if ($db->val('SELECT id FROM {user_identities} WHERE provider = ? AND subject = ?', [$n['p'], $n['sub']])) throw ft_err('Ez a fiók már regisztrált.');
    $intro = ft_str($in['intro'] ?? '', 2000);
    $now = ft_now();
    $uid = $db->inTx(function () use ($db, $email, $name, $intro, $in, $n, $now) {
        $uid = $db->insert('users', ['email' => $email, 'name' => $name, 'pass_hash' => '', 'role' => 'member', 'active' => 0, 'status' => 'pending',
            'intro' => $intro, 'lang' => ft_lang($in['lang'] ?? 'hu'), 'failed' => 0, 'created' => $now]);
        $db->insert('user_identities', ['user_id' => $uid, 'provider' => $n['p'], 'subject' => $n['sub'], 'email' => $n['email'] ?: null,
            'name' => $n['name'] ?: null, 'created' => $now, 'last_used' => $now]);
        return $uid;
    });
    unset($_SESSION['oauth_new']);
    App::audit('register', 'user', $uid, "$name <$email> · " . FT_OAUTH[$n['p']]['name']);
    if (App::$s['register_notify']) {
        foreach ($db->col("SELECT email FROM {users} WHERE role = 'admin' AND active = 1") as $to) {
            ft_mail($to, 'Új regisztráció: ' . $name, "$name ($email) regisztrált a családfa oldalra (" . FT_OAUTH[$n['p']]['name'] . "-fiókkal).\n\nBemutatkozás:\n" . ($intro ?: '—') . "\n\nJóváhagyás: " . ft_base_url() . '/#/admin/users');
        }
    }
    return ['ok' => true];
}

/** The providers linked to the current member, and whether they also have a password. */
function ft_oauth_mine(): array
{
    ft_require_login();
    $rows = App::$db->all('SELECT provider, email, name, created, last_used FROM {user_identities} WHERE user_id = ? ORDER BY provider', [App::uid()]);
    return ['linked' => $rows, 'enabled' => ft_oauth_enabled(), 'hasPassword' => (string)App::$user['pass_hash'] !== ''];
}

function ft_oauth_unlink(string $p): array
{
    ft_require_login();
    $db = App::$db;
    $n = (int)$db->val('SELECT COUNT(*) FROM {user_identities} WHERE user_id = ?', [App::uid()]);
    if ((string)App::$user['pass_hash'] === '' && $n <= 1) throw ft_err('Ez az egyetlen belépési módod. Előbb állíts be jelszót, vagy kapcsolj hozzá egy másik fiókot.', 409);
    $db->q('DELETE FROM {user_identities} WHERE user_id = ? AND provider = ?', [App::uid(), $p]);
    App::audit('oauth.unlink', 'user', App::uid(), $p);
    return ['ok' => true];
}
