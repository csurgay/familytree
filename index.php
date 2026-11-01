<?php
declare(strict_types=1);
require __DIR__ . '/lib/app.php';
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('X-Frame-Options: SAMEORIGIN');

$err = App::init(__DIR__);
$e = fn($s) => htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
if ($err) {
    http_response_code(503);
    ?><!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Családfa – beállítás</title><link rel="stylesheet" href="assets/css/app.css"></head>
<body class="setup"><main class="setup-card">
<?php if (!empty($err['migrate'])): ?>
<h1>Nem sikerült létrehozni a táblákat</h1>
<p>A kapcsolat rendben van, de a MySQL ezt válaszolta:</p>
<pre><?= $e($err['error']) ?></pre>
<p>Ellenőrizd, hogy az adatbázis-felhasználónak van-e <b>CREATE</b> és <b>ALTER</b> joga ehhez az adatbázishoz (cPanelben: MySQL adatbázisok → felhasználó hozzáadása → „Minden jogosultság”). Utána frissítsd az oldalt: a már elkészült táblákat nem hozza létre újra.</p>
</main></body></html><?php exit; endif; ?>
<h1>Az adatbázis még nem érhető el</h1>
<p><?= $e($err['error']) ?></p>
<?php if (!empty($err['seen'])): ?><p>A config.php-ben ezeket a neveket láttam: <code><?= $e(implode(', ', $err['seen'])) ?></code></p><?php endif; ?>
<p>A <code>config.php</code> így nézzen ki (bármelyik szokásos írásmód működik, a <code>config.sample.php</code>-ben van minta):</p>
<pre>&lt;?php
define('DB_HOST', 'localhost');
define('DB_NAME', 'csurgay_familytree');
define('DB_USER', 'felhasznalo');
define('DB_PASS', 'jelszo');
define('DB_PREFIX', 'ft_');   // nem kötelező</pre>
</main></body></html><?php
    exit;
}
$s = App::$s;
$v = FT_VERSION . '-' . substr(md5((string)@filemtime(__DIR__ . '/assets/js/main.js') . @filemtime(__DIR__ . '/assets/css/app.css')), 0, 6);
?><!doctype html>
<html lang="hu" data-theme="<?= $e($s['theme'] === 'auto' ? '' : $s['theme']) ?>">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title><?= $e($s['site_title']) ?></title>
<meta name="description" content="<?= $e($s['site_subtitle']) ?>">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%231e3a33'/%3E%3Cpath d='M32 52V30M32 30l-12-10M32 30l12-10M20 20l-6-6M20 20v-8M44 20l6-6M44 20v-8' stroke='%23d9b46a' stroke-width='4' stroke-linecap='round' fill='none'/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Alegreya:ital,wght@0,400;0,500;0,700;0,800;1,400&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap&subset=latin-ext" rel="stylesheet">
<link rel="stylesheet" href="assets/css/app.css?v=<?= $e($v) ?>">
<style>:root{--accent:<?= $e($s['accent']) ?>}</style>
</head>
<body>
<a class="skip" href="#main">Ugrás a tartalomra</a>
<header class="topbar">
  <a class="brand" href="#/"><span class="brand-mark" aria-hidden="true"></span><span class="brand-text"><?= $e($s['site_title']) ?></span></a>
  <nav class="mainnav" id="mainnav" aria-label="Fő menü">
    <a href="#/" data-nav="home">Kezdőlap</a>
    <a href="#/tree" data-nav="tree">Családfa</a>
    <a href="#/people" data-nav="people">Arcképcsarnok</a>
    <a href="#/stories" data-nav="stories">Történetek</a>
    <a href="#/charts" data-nav="charts">Diagramok</a>
    <a href="#/quiz" data-nav="quiz">Kvíz</a>
  </nav>
  <div class="topbar-right">
    <div class="search" role="search">
      <input id="q" type="search" placeholder="Keresés névre…" autocomplete="off" aria-label="Keresés a családtagok között">
      <div class="search-results" id="qres" role="listbox" hidden></div>
    </div>
    <div id="userbox" class="userbox"></div>
    <button class="navtoggle" id="navtoggle" aria-label="Menü" aria-expanded="false"><span></span><span></span><span></span></button>
  </div>
</header>
<main id="main" tabindex="-1"><div class="loading">Betöltés…</div></main>
<div id="modal-root"></div>
<div id="toasts" aria-live="polite"></div>
<script type="module" src="assets/js/main.js?v=<?= $e($v) ?>"></script>
</body>
</html>
