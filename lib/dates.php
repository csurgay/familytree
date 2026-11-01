<?php
/**
 * Dates: GEDCOM ("16 SEP 1953", "ABT 1950", "BET 1900 AND 1910"), TribalPages ("Sep 16 1953")
 * and Hungarian user input ("1953. 09. 16.", "1953-09-16", "kb. 1950", "1950 előtt").
 * Result: ['raw' => normalized GEDCOM, 'y','m','d','qual','sort'] or null.
 */
const FT_MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const FT_HU_MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

function ft_month_num(string $s): int
{
    $s = mb_strtolower(trim($s, ". \t"));
    if ($s === '') return 0;
    $en = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    $hu = ['jan', 'feb', 'már', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szep', 'okt', 'nov', 'dec'];
    foreach ($en as $i => $m) if (str_starts_with($s, $m)) return $i + 1;
    foreach ($hu as $i => $m) if (str_starts_with($s, $m)) return $i + 1;
    if ($s === 'mar' || $s === 'marc') return 3;
    return 0;
}

/** Parse one simple date (no qualifier). Returns [y,m,d] or null. */
function ft_parse_simple(string $s): ?array
{
    $s = trim($s);
    if ($s === '') return null;
    // ISO / Hungarian numeric: 1953-09-16, 1953.09.16., 1953. 09. 16, 1953/9/16, 1953. 9.
    if (preg_match('/^(\d{3,4})\s*[.\-\/]\s*(\d{1,2})\s*(?:[.\-\/]\s*(\d{1,2}))?\s*\.?$/u', $s, $m)) {
        $y = (int)$m[1]; $mo = (int)$m[2]; $d = isset($m[3]) ? (int)$m[3] : 0;
        if ($mo >= 1 && $mo <= 12 && $d >= 0 && $d <= 31) return [$y, $mo, $d];
    }
    // European numeric: 16.09.1953 or 16/09/1953
    if (preg_match('/^(\d{1,2})\s*[.\/]\s*(\d{1,2})\s*[.\/]\s*(\d{4})\.?$/', $s, $m)) {
        return [(int)$m[3], (int)$m[2], (int)$m[1]];
    }
    // Hungarian textual: 1953. szeptember 16. / 1953 szept. 16 / 1953. szeptember
    if (preg_match('/^(\d{3,4})\.?\s+([[:alpha:]áéíóöőúüű]+)\.?\s*(\d{1,2})?\.?$/u', $s, $m)) {
        $mo = ft_month_num($m[2]);
        if ($mo) return [(int)$m[1], $mo, isset($m[3]) ? (int)$m[3] : 0];
    }
    // GEDCOM: 16 SEP 1953 / SEP 1953
    if (preg_match('/^(?:(\d{1,2})\s+)?([A-Za-z]{3,})\.?\s+(\d{3,4})$/u', $s, $m)) {
        $mo = ft_month_num($m[2]);
        if ($mo) return [(int)$m[3], $mo, $m[1] !== '' ? (int)$m[1] : 0];
    }
    // TribalPages: Sep 16 1953 / Sep 16, 1953
    if (preg_match('/^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{3,4})$/u', $s, $m)) {
        $mo = ft_month_num($m[1]);
        if ($mo) return [(int)$m[3], $mo, (int)$m[2]];
    }
    if (preg_match('/^(\d{3,4})\.?$/', $s, $m)) return [(int)$m[1], 0, 0];
    return null;
}

function ft_parse_date(?string $input): ?array
{
    $s = trim((string)$input);
    if ($s === '') return null;
    $qual = '';
    $low = mb_strtolower($s);
    $s2 = null;

    if (preg_match('/^bet\s+(.+?)\s+and\s+(.+)$/i', $s, $m) || preg_match('/^(.+?)\s*(?:–|-|és)\s*(.+?)\s+között$/u', $s, $m)) {
        $a = ft_parse_simple($m[1]); $b = ft_parse_simple($m[2]);
        if ($a && $b) return ft_date_result($a, 'BET', $b);
    }
    $map = [
        '/^(abt|about|ca\.?|circa|kb\.?|kb|körülbelül|cca\.?)\s+/iu' => 'ABT',
        '/^(est|becs\.?|becsült)\s+/iu' => 'EST',
        '/^(cal|számított)\s+/iu' => 'CAL',
        '/^(bef|before|előtt)\s+/iu' => 'BEF',
        '/^(aft|after|után)\s+/iu' => 'AFT',
    ];
    foreach ($map as $re => $q) {
        if (preg_match($re, $s)) { $qual = $q; $s2 = preg_replace($re, '', $s); break; }
    }
    if ($qual === '') {
        if (preg_match('/^(.+?)\s+előtt$/u', $s, $m)) { $qual = 'BEF'; $s2 = $m[1]; }
        elseif (preg_match('/^(.+?)\s+után$/u', $s, $m)) { $qual = 'AFT'; $s2 = $m[1]; }
        elseif (preg_match('/^(.+?)\s+körül$/u', $s, $m)) { $qual = 'ABT'; $s2 = $m[1]; }
        else $s2 = $s;
    }
    $a = ft_parse_simple($s2);
    if (!$a) return ['raw' => $s, 'y' => null, 'm' => null, 'd' => null, 'qual' => 'TXT', 'sort' => null];
    return ft_date_result($a, $qual);
}

function ft_date_result(array $a, string $qual, ?array $b = null): array
{
    [$y, $m, $d] = $a;
    $fmt = fn($x) => trim(($x[2] ? $x[2] . ' ' : '') . ($x[1] ? FT_MONTHS[$x[1] - 1] . ' ' : '') . $x[0]);
    $raw = $fmt($a);
    if ($qual === 'BET') $raw = 'BET ' . $raw . ' AND ' . $fmt($b);
    elseif ($qual) $raw = $qual . ' ' . $raw;
    return ['raw' => $raw, 'y' => $y, 'm' => $m ?: null, 'd' => $d ?: null, 'qual' => $qual, 'sort' => $y * 10000 + $m * 100 + $d];
}

const FT_MONTH_NAMES = [
    'en' => ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    'de' => ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
];

/** Display a date in the request language: "1953. szeptember 16." / "16 September 1953" / "16. September 1953". */
function ft_format_date(?string $raw, ?string $lang = null): string
{
    $lang = $lang ?? (class_exists('App') ? App::$lang : 'hu');
    $p = ft_parse_date($raw);
    if (!$p) return '';
    if ($p['qual'] === 'TXT') return $p['raw'];
    $one = function ($y, $m, $d) use ($lang) {
        if (!$m) return (string)$y;
        if ($lang === 'en') return ($d ? "$d " : '') . FT_MONTH_NAMES['en'][$m - 1] . " $y";
        if ($lang === 'de') return ($d ? "$d. " : '') . FT_MONTH_NAMES['de'][$m - 1] . " $y";
        return $y . '. ' . FT_HU_MONTHS[$m - 1] . ($d ? ' ' . $d . '.' : '');
    };
    $fmt = ['hu' => ['kb. %s', '%s előtt', '%s után', '%s–%s között'], 'en' => ['c. %s', 'before %s', 'after %s', '%s–%s'], 'de' => ['ca. %s', 'vor %s', 'nach %s', 'zwischen %s und %s']][$lang] ?? ['kb. %s', '%s előtt', '%s után', '%s–%s között'];
    $main = $one($p['y'], $p['m'], $p['d']);
    switch ($p['qual']) {
        case 'ABT': case 'EST': case 'CAL': return sprintf($fmt[0], $main);
        case 'BEF': return sprintf($fmt[1], $main);
        case 'AFT': return sprintf($fmt[2], $main);
        case 'BET':
            preg_match('/AND\s+(.+)$/', $p['raw'], $m);
            $b = ft_parse_simple($m[1] ?? '');
            return sprintf($fmt[3], $main, $b ? $one($b[0], $b[1], $b[2]) : '');
    }
    return $main;
}
