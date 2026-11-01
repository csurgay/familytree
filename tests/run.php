<?php
// Command-line runner: php tests/run.php [filter]
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require __DIR__ . '/../lib/app.php';
require __DIR__ . '/../lib/api.php';
require __DIR__ . '/server_tests.php';
$err = App::init(dirname(__DIR__));
if ($err) { // tests do not need the live DB
    App::$root = dirname(__DIR__);
    App::useDb(new DB(new PDO('sqlite::memory:'), 'x_'), ft_settings_defaults());
}
$_SESSION = [];
$r = ft_run_server_tests($argv[1] ?? '');
$fail = 0;
foreach ($r['results'] as $t) {
    printf("%s %-70s %7.1f ms\n", ['pass' => '✓', 'fail' => '✗', 'skip' => '-'][$t['status']], $t['name'], $t['ms']);
    if (!empty($t['msg'])) echo "    → {$t['msg']}\n";
    if ($t['status'] === 'fail') $fail++;
}
echo $fail ? "\n$fail hibás teszt\n" : "\nMinden teszt sikeres\n";
exit($fail ? 1 : 0);
