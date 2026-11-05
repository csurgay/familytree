<?php
declare(strict_types=1);

require_once __DIR__ . '/compat.php';
require_once __DIR__ . '/config_loader.php';
require_once __DIR__ . '/db.php';
require_once __DIR__ . '/schema.php';
require_once __DIR__ . '/dates.php';
require_once __DIR__ . '/settings.php';
require_once __DIR__ . '/gedcom.php';
require_once __DIR__ . '/tree.php';
require_once __DIR__ . '/perms.php';
require_once __DIR__ . '/ops.php';
require_once __DIR__ . '/photos.php';
require_once __DIR__ . '/zipimport.php';
require_once __DIR__ . '/content.php';
require_once __DIR__ . '/comments.php';
require_once __DIR__ . '/backup.php';

const FT_VERSION = '1.0.0';

class ApiError extends RuntimeException
{
    public int $status;
    public function __construct(string $msg, int $status = 400) { parent::__construct($msg); $this->status = $status; }
}

function ft_now(): string { return date('Y-m-d H:i:s'); }

/** Translate a server message into the request language (same dictionaries as the browser). */
function ft_t(string $s, ...$args): string
{
    static $dicts = [];
    $lang = App::$lang;
    if ($lang !== 'hu') {
        if (!isset($dicts[$lang])) {
            $f = App::$root . "/assets/i18n/$lang.json";
            $dicts[$lang] = is_file($f) ? (json_decode((string)file_get_contents($f), true) ?: []) : [];
        }
        $s = $dicts[$lang][$s] ?? $s;
    }
    foreach ($args as $i => $v) $s = str_replace('{' . $i . '}', (string)$v, $s);
    return $s;
}

final class App
{
    public static DB $db;
    public static array $cfg = [];
    public static array $s = [];          // settings
    public static ?array $user = null;    // logged-in user row
    public static string $root = '';
    public static ?string $sessionDir = null;
    public static string $lang = 'hu';     // UI language of the current request (X-Lang header)
    private static array $cache = [];

    /** Connects and migrates. Returns null on success or an error array for the setup page. */
    public static function init(string $root): ?array
    {
        self::$root = $root;
        self::$cfg = ft_load_config($root);
        if (self::$cfg['driver'] === 'error') return self::$cfg;
        try {
            self::$db = DB::fromConfig(self::$cfg);
        } catch (Throwable $e) {
            return ['error' => 'Nem sikerült csatlakozni az adatbázishoz: ' . $e->getMessage(), 'source' => self::$cfg['source']];
        }
        try {
            self::$s = ft_settings_load(self::$db);
            if ((int)(self::$s['_schema'] ?? 0) < FT_SCHEMA_VERSION) {
                self::$db->migrate(ft_schema());
                if (self::$db->warnings) error_log('[familytree] index warnings: ' . implode(' | ', self::$db->warnings));
                ft_setting_set(self::$db, '_schema', FT_SCHEMA_VERSION);
                self::$s = ft_settings_load(self::$db);
            }
        } catch (Throwable $e) {
            return ['error' => 'Az adatbázis-táblák létrehozása nem sikerült: ' . $e->getMessage(), 'source' => self::$cfg['source'], 'migrate' => true];
        }
        return null;
    }

    /** Swap in another DB (used by the self-tests). */
    public static function useDb(DB $db, ?array $settings = null): void
    {
        self::$db = $db;
        self::$s = $settings ?? ft_settings_load($db);
        self::$cache = [];
    }

    public static function startSession(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) return;
        $secure = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        session_name('ftsess');
        // Shared hosts often purge sessions after ~24 minutes; keep ours in data/sessions for 30 days –
        // but only with the plain file handler (a redis/memcached save_path must not be replaced).
        $defaultPath = session_save_path();
        self::$sessionDir = null;
        $dir = self::$root . '/data/sessions';
        if (ini_get('session.save_handler') === 'files' && (is_dir($dir) || @mkdir($dir, 0700, true)) && is_writable($dir)) {
            session_save_path($dir);
            @ini_set('session.gc_maxlifetime', (string)(60 * 60 * 24 * 30));
            @ini_set('session.gc_probability', '1');
            @ini_set('session.gc_divisor', '1000');
            self::$sessionDir = $dir;
        }
        session_set_cookie_params(['lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax', 'secure' => $secure]);
        if (!@session_start() && self::$sessionDir) {   // own folder failed: fall back to the host's default
            session_save_path($defaultPath); self::$sessionDir = null; session_start();
        }
        if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
        if (!empty($_SESSION['uid']) && ($_SESSION['ep'] ?? '') !== (string)(self::$s['session_epoch'] ?? '')) unset($_SESSION['uid']);
        if (!empty($_SESSION['uid'])) {
            $u = self::$db->row('SELECT * FROM {users} WHERE id = ? AND active = 1', [(int)$_SESSION['uid']]);
            self::$user = $u ?: null;
            if (!$u) unset($_SESSION['uid']);
        }
    }

    public static function cache(string $k, callable $fn)
    {
        if (!array_key_exists($k, self::$cache)) self::$cache[$k] = $fn();
        return self::$cache[$k];
    }
    public static function flush(): void { self::$cache = []; }

    public static function uid(): ?int { return self::$user ? (int)self::$user['id'] : null; }
    public static function role(): string { return self::$user['role'] ?? 'guest'; }
    public static function isAdmin(): bool { return self::role() === 'admin'; }
    public static function loggedIn(): bool { return self::$user !== null; }

    public static function audit(string $action, string $entity, ?int $id, $summary): void
    {
        self::$db->insert('audit', ['user_id' => self::uid(), 'action' => $action, 'entity' => $entity, 'entity_id' => $id,
            'summary' => is_string($summary) ? $summary : json_encode($summary, JSON_UNESCAPED_UNICODE), 'created' => ft_now()]);
    }
}
