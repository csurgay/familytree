<?php
/** PHP 7.4 compatibility: functions that only exist from PHP 8.0 on. */
if (!function_exists('str_starts_with')) {
    function str_starts_with(string $h, string $n): bool { return $n === '' || strncmp($h, $n, strlen($n)) === 0; }
}
if (!function_exists('str_ends_with')) {
    function str_ends_with(string $h, string $n): bool { return $n === '' || substr($h, -strlen($n)) === $n; }
}
if (!function_exists('str_contains')) {
    function str_contains(string $h, string $n): bool { return $n === '' || strpos($h, $n) !== false; }
}

/** Headers of the last HTTP stream request: http_get_last_response_headers() from PHP 8.4 on, before that the
 *  locally scoped $http_response_header (deprecated in 8.5) – callers pass get_defined_vars() to reach it. */
function ft_response_headers(array $scope): array
{
    if (function_exists('http_get_last_response_headers')) return http_get_last_response_headers() ?? [];
    return $scope['http_response_header'] ?? [];
}

/* A newer PHP announces what it will drop later ("Deprecated: …"). Such notices go to the error log, once
 * each, and never into a page or a JSON answer, where they would break the app. */
set_error_handler(static function (int $no, string $msg, string $file = '', int $line = 0): bool {
    static $seen = [];
    if (!($no & (E_DEPRECATED | E_USER_DEPRECATED))) return false;
    $k = "$file:$line";
    if (!isset($seen[$k]) && count($seen) < 50) { $seen[$k] = true; error_log("[familytree] PHP deprecated: $msg ($file:$line)"); }
    return true;
});
