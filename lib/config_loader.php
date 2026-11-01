<?php
/**
 * Reads the database settings from config.php, whatever style it uses:
 *  - constants:   define('DB_HOST', ...), DB_NAME, DB_USER, DB_PASS / DB_PASSWORD, DB_PORT, DB_PREFIX
 *  - variables:   $servername/$host/$dbhost/$db_host, $dbname/$db_name/$database,
 *                 $username/$user/$dbuser/$db_user, $password/$pass/$dbpass/$db_pass
 *  - arrays:      $db = [...], $config = ['db' => [...]], or `return [...]`
 *  - a ready PDO: $pdo
 * Without config.php the app runs on a local SQLite file (data/familytree.sqlite) for development.
 */

function ft_load_config(string $root): array
{
    // config.php next to the app, or one level up (outside the repo / web root – keeps the password out of git)
    $file = $root . '/config.php';
    if (!is_file($file) && is_file(dirname($root) . '/config.php')) $file = dirname($root) . '/config.php';
    $cfg = ['driver' => 'sqlite', 'path' => $root . '/data/familytree.sqlite', 'prefix' => 'ft_', 'source' => 'none'];
    if (!is_file($file)) return $cfg;
    $srcName = $file === $root . '/config.php' ? 'config.php' : '../config.php';

    $res = (function () use ($file) {
        $__ret = include $file;
        $__vars = get_defined_vars();
        unset($__vars['file']);
        return [$__ret, $__vars];
    })();
    [$ret, $vars] = $res;

    $pick = function (array $src, array $keys) {
        foreach ($keys as $k) {
            foreach ($src as $sk => $sv) {
                if (strcasecmp((string)$sk, $k) === 0 && is_scalar($sv) && $sv !== '') return (string)$sv;
            }
        }
        return null;
    };
    $sources = [];
    if (is_array($ret)) $sources[] = isset($ret['db']) && is_array($ret['db']) ? $ret['db'] : $ret;
    foreach (['db', 'database', 'config', 'cfg', 'dbconfig', 'db_config', 'settings'] as $an) {
        if (isset($vars[$an]) && is_array($vars[$an])) {
            $a = $vars[$an];
            if (isset($a['db']) && is_array($a['db'])) $a = $a['db'];
            if (isset($a['database']) && is_array($a['database'])) $a = $a['database'];
            $sources[] = $a;
        }
    }
    $consts = get_defined_constants(true)['user'] ?? [];
    $sources[] = $consts;
    $scalars = array_filter($vars, 'is_scalar');
    $sources[] = $scalars;

    $hostK = ['DB_HOST', 'DB_SERVER', 'DBHOST', 'MYSQL_HOST', 'host', 'hostname', 'server', 'servername', 'dbhost', 'db_host'];
    $nameK = ['DB_NAME', 'DB_DATABASE', 'DBNAME', 'MYSQL_DATABASE', 'dbname', 'db_name', 'database', 'name', 'db'];
    $userK = ['DB_USER', 'DB_USERNAME', 'DBUSER', 'MYSQL_USER', 'username', 'user', 'dbuser', 'db_user', 'dbusername'];
    $passK = ['DB_PASS', 'DB_PASSWORD', 'DBPASS', 'MYSQL_PASSWORD', 'password', 'pass', 'pwd', 'dbpass', 'db_pass', 'dbpassword', 'db_password'];
    $portK = ['DB_PORT', 'port', 'dbport', 'db_port'];
    $prefK = ['FT_PREFIX', 'DB_PREFIX', 'TABLE_PREFIX', 'prefix', 'db_prefix', 'table_prefix'];
    $drvK  = ['DB_DRIVER', 'driver', 'db_driver'];

    $found = ['host' => null, 'name' => null, 'user' => null, 'pass' => null, 'port' => null, 'prefix' => null, 'driver' => null];
    foreach ($sources as $s) {
        foreach (['host' => $hostK, 'name' => $nameK, 'user' => $userK, 'pass' => $passK, 'port' => $portK, 'prefix' => $prefK, 'driver' => $drvK] as $f => $keys) {
            if ($found[$f] === null) $found[$f] = $pick($s, $keys);
        }
    }
    // password may legitimately be empty (local XAMPP)
    if ($found['pass'] === null) {
        foreach ($sources as $s) foreach ($passK as $k) if (array_key_exists($k, $s) && $s[$k] === '') { $found['pass'] = ''; break 2; }
    }

    if (isset($vars['pdo']) && $vars['pdo'] instanceof PDO) {
        return ['driver' => 'pdo', 'pdo' => $vars['pdo'], 'prefix' => $found['prefix'] ?? 'ft_', 'source' => $srcName . ' ($pdo)'];
    }
    if ($found['driver'] && strtolower($found['driver']) === 'sqlite') {
        return ['driver' => 'sqlite', 'path' => $found['name'] ?: $root . '/data/familytree.sqlite', 'prefix' => $found['prefix'] ?? 'ft_', 'source' => $srcName];
    }
    if (!$found['name'] || !$found['user']) {
        return ['driver' => 'error', 'source' => $srcName,
            'error' => 'A config.php nem tartalmaz felismerhető adatbázis-beállítást.',
            'seen' => array_values(array_unique(array_merge(array_keys($scalars), array_keys($consts))))];
    }
    return [
        'driver' => 'mysql',
        'host' => $found['host'] ?: 'localhost',
        'port' => $found['port'],
        'name' => $found['name'],
        'user' => $found['user'],
        'pass' => $found['pass'] ?? '',
        'prefix' => $found['prefix'] ?? 'ft_',
        'source' => $srcName,
    ];
}

/** The starter GEDCOM: *.ged in the app folder, or one level up. */
function ft_find_ged(string $root): ?string
{
    foreach ([$root, dirname($root)] as $d) { $f = glob($d . '/*.ged'); if ($f) return $f[0]; }
    return null;
}
