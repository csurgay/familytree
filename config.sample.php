<?php
// Másold config.php néven, és írd be a tárhely MySQL adatait.
// Bármelyik szokásos forma működik (define-ok, $servername/$username/$password/$dbname változók, vagy return [...]).
define('DB_HOST', 'localhost');
define('DB_NAME', 'csurgay_familytree');
define('DB_USER', 'felhasznalonev');
define('DB_PASS', 'jelszo');
// define('DB_PORT', 3306);
// Tábla-előtag – így közös adatbázisban is elfér más appok mellett:
define('DB_PREFIX', 'ft_');

// Nem kötelező – belépés Google- / Facebook-fiókkal (README: „Belépés Google- vagy Facebook-fiókkal”).
// Az átirányítási cím mindkét helyen: https://<a te oldalad>/oauth.php
// define('GOOGLE_CLIENT_ID', '….apps.googleusercontent.com');
// define('GOOGLE_CLIENT_SECRET', '…');
// define('FACEBOOK_APP_ID', '…');
// define('FACEBOOK_APP_SECRET', '…');
