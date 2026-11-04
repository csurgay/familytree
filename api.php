<?php
declare(strict_types=1);
require __DIR__ . '/lib/app.php';
require __DIR__ . '/lib/api.php';

header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');

function ft_json($data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE | JSON_PARTIAL_OUTPUT_ON_ERROR);
    exit;
}

$err = App::init(__DIR__);
if ($err) ft_json(['ok' => false, 'error' => $err['error'], 'setup' => $err], 503);
App::startSession();
App::$lang = ft_lang($_SERVER['HTTP_X_LANG'] ?? $_GET['lang'] ?? 'hu');

$action = (string)($_GET['a'] ?? '');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

try {
    // ---- downloads (GET)
    if ($action === 'export') {
        if (!ft_can_read() || !App::loggedIn()) throw new ApiError('Az exporthoz be kell jelentkezni.', 401);
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
        $base = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . rtrim(dirname($_SERVER['SCRIPT_NAME'] ?? '/'), '/');
        $ged = ft_gedcom_export(App::$db, $base);
        App::audit('gedcom.export', 'app', null, strlen($ged) . ' bájt');
        header('Content-Type: text/plain; charset=utf-8');
        header('Content-Disposition: attachment; filename="csaladfa-' . date('Ymd') . '.ged"');
        echo $ged;
        exit;
    }

    $in = [];
    if ($method === 'POST') {
        if (!hash_equals($_SESSION['csrf'] ?? '', (string)($_SERVER['HTTP_X_CSRF'] ?? $_POST['csrf'] ?? ''))) {
            throw new ApiError('A munkamenet lejárt, töltsd újra az oldalt.', 419);
        }
        $ct = $_SERVER['CONTENT_TYPE'] ?? '';
        if (str_starts_with($ct, 'application/json')) $in = json_decode(file_get_contents('php://input') ?: '[]', true) ?: [];
        else $in = $_POST;
        if (isset($in['json']) && is_string($in['json'])) $in = (json_decode($in['json'], true) ?: []) + $in;
    } else {
        $in = $_GET;
    }

    $open = ['boot', 'login', 'logout', 'install', 'register'];
    if (!in_array($action, $open, true) && !ft_can_read()) throw new ApiError('Az oldal megtekintéséhez jelentkezz be.', 401);
    $writes = ['login', 'logout', 'install', 'register', 'password', 'op', 'pin', 'unpin', 'chart.save', 'chart.delete', 'quiz.save', 'upload', 'comment.add', 'comment.edit', 'comment.delete'];
    if ((in_array($action, $writes, true) || str_starts_with($action, 'admin.')) && $method !== 'POST' && $action !== 'admin.changes' && $action !== 'admin.users' && $action !== 'admin.branches' && $action !== 'admin.audit' && $action !== 'admin.stats') {
        throw new ApiError('POST kérés szükséges.', 405);
    }

    if ($action === 'upload') {
        $res = ft_photo_upload($_FILES['file'] ?? [], $in);
        ft_json(['ok' => true, 'data' => $res]);
    }

    $h = ft_handlers();
    if (!isset($h[$action])) throw new ApiError('Ismeretlen kérés: ' . $action, 404);
    ft_json(['ok' => true, 'data' => $h[$action]($in)]);
} catch (ApiError $e) {
    ft_json(['ok' => false, 'error' => ft_t($e->getMessage())], $e->status);
} catch (Throwable $e) {
    error_log('[familytree] ' . $e);
    $msg = App::isAdmin() ? $e->getMessage() . ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')' : ft_t('Váratlan szerverhiba. Az admin a naplóban látja a részleteket.');
    ft_json(['ok' => false, 'error' => $msg], 500);
}
