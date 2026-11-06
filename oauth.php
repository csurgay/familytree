<?php
/**
 * Sign-in with Google / Facebook. This exact address (<site>/oauth.php) is the redirect URI
 * to register in the Google Cloud console and in the Meta app. See lib/oauth.php.
 *   oauth.php?start=google[&mode=link&csrf=…][&next=#/…]   → off to the provider
 *   oauth.php?code=…&state=…                                  ← back from the provider
 */
declare(strict_types=1);
require __DIR__ . '/lib/app.php';
require __DIR__ . '/lib/api.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');      // the code in the URL must not leak to other sites
header('Cache-Control: no-store');

$err = App::init(__DIR__);
if ($err) { http_response_code(503); header('Content-Type: text/plain; charset=utf-8'); echo $err['error']; exit; }
App::startSession();
App::$lang = ft_lang($_GET['lang'] ?? ($_SESSION['lang'] ?? 'hu'));

$back = '#/login';
try {
    if (isset($_GET['start'])) {
        $mode = ($_GET['mode'] ?? '') === 'link' ? 'link' : 'login';
        if ($mode === 'link') {
            $back = '#/account';
            if (!hash_equals($_SESSION['csrf'] ?? '', (string)($_GET['csrf'] ?? ''))) throw ft_err('A munkamenet lejárt, töltsd újra az oldalt.', 419);
        }
        header('Location: ' . ft_oauth_start((string)$_GET['start'], $mode, (string)($_GET['next'] ?? '')), true, 302);
        exit;
    }
    if (($_SESSION['oauth']['mode'] ?? '') === 'link') $back = '#/account';
    $to = ft_oauth_callback($_GET);
} catch (Throwable $e) {
    if (!$e instanceof ApiError) error_log('[familytree] oauth ' . $e);
    $_SESSION['oauth_err'] = $e instanceof ApiError ? $e->getMessage() : 'Váratlan hiba a belépésnél. Próbáld újra.';
    $to = $back . '?oauth=error';
}
header('Location: ' . ft_base_url() . '/' . $to, true, 302);
