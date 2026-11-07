<?php
/**
 * Server self-tests. Each test gets a fresh in-memory SQLite database, so the live data is never touched.
 * Run from the admin gear (Autotesztek) or from the command line:  php tests/run.php
 */

class FtAssert extends Exception {}
function t_eq($a, $b, string $m = ''): void { if ($a !== $b) throw new FtAssert(trim($m . ' várt: ' . var_export($b, true) . ', kapott: ' . var_export($a, true))); }
function t_ok($c, string $m = 'feltétel nem teljesült'): void { if (!$c) throw new FtAssert($m); }
function t_throws(callable $f, string $m = 'kivételt vártam'): void { try { $f(); } catch (Throwable $e) { return; } throw new FtAssert($m); }

function t_fresh_db(): DB
{
    $db = new DB(new PDO('sqlite::memory:'), 't_');
    if (getenv('FT_STRINGIFY')) $db->pdo->setAttribute(PDO::ATTR_STRINGIFY_FETCHES, true); // behave like PHP < 8.1
    $db->migrate(ft_schema());
    App::useDb($db, ft_settings_defaults());
    App::$user = null;
    return $db;
}
function t_user(DB $db, string $role, string $email = null): array
{
    $id = $db->insert('users', ['email' => $email ?: $role . rand(1000, 9999) . '@x.hu', 'name' => ucfirst($role), 'pass_hash' => password_hash('x', PASSWORD_DEFAULT), 'role' => $role, 'active' => 1, 'failed' => 0, 'created' => ft_now()]);
    return $db->row('SELECT * FROM {users} WHERE id = ?', [$id]);
}
function t_as(?array $u): void { App::$user = $u; App::flush(); }

const T_GED = <<<GED
0 HEAD
1 CHAR UTF-8
0 @I1@ INDI
1 NAME János /Nagy/ Dr.
1 SEX M
1 BIRT
2 DATE Mar 05 1900
2 PLAC Budapest
1 DEAT
2 DATE 1970
1 NOTE Első sor &#337;s
2 CONC  folytatás
2 CONT második sor
1 FAMS @F1@
0 @I2@ INDI
1 NAME Mária /Kiss/
1 SEX F
1 BIRT
2 DATE 12 JUN 1905
1 DEAT
1 FAMS @F1@
0 @I3@ INDI
1 NAME Péter /Nagy/ b.1930
1 SEX M
1 BIRT
2 DATE 1930
1 FAMC @F1@
1 FAMS @F2@
0 @I4@ INDI
1 NAME Éva /Tóth/
1 SEX F
1 FAMS @F2@
0 @I5@ INDI
1 NAME Anna /Nagy/
1 SEX F
1 BIRT
2 DATE 2001
1 FAMC @F2@
0 @I6@ INDI
1 NAME Gábor /Nagy/
1 SEX M
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 CHIL @I6@
1 MARR
2 DATE 1928
2 PLAC Szeged
0 @F2@ FAM
1 HUSB @I3@
1 WIFE @I4@
1 CHIL @I5@
1 DIV
0 @S1@ SOUR
1 TITL Családi krónika
0 TRLR
GED;

function t_import(DB $db): array
{
    $st = ft_gedcom_import($db, ft_gedcom_parse(T_GED), 'replace');
    App::flush();
    $ids = [];
    foreach ($db->all('SELECT id, xref FROM {persons}') as $r) $ids[$r['xref']] = (int)$r['id'];
    foreach ($db->all('SELECT id, xref FROM {families}') as $r) $ids[$r['xref']] = (int)$r['id'];
    return $ids + ['_stats' => $st];
}

function ft_server_tests(): array
{
    return [
        'Config: konstansos config.php felismerése' => function () {
            // the live config.php (define-style) is usually loaded already: its constants must not leak in
            if (!defined('DB_HOST')) define('DB_HOST', 'live.host');
            $dir = sys_get_temp_dir() . '/ftcfg' . bin2hex(random_bytes(4)); @mkdir($dir);
            file_put_contents("$dir/config.php", "<?php\ndefine('DB_HOST_T','x');\n\$servername='db.host';\$username='u1';\$password='';\$dbname='csurgay_ft';");
            $c = ft_load_config($dir);
            t_eq($c['driver'], 'mysql'); t_eq($c['host'], 'db.host'); t_eq($c['name'], 'csurgay_ft'); t_eq($c['user'], 'u1'); t_eq($c['pass'], '');
            file_put_contents("$dir/config.php", "<?php\nreturn ['db'=>['host'=>'h','dbname'=>'d','user'=>'us','password'=>'pw','prefix'=>'fa_']];");
            $c = ft_load_config($dir);
            t_eq([$c['host'], $c['name'], $c['user'], $c['pass'], $c['prefix']], ['h', 'd', 'us', 'pw', 'fa_']);
            file_put_contents("$dir/config.php", "<?php\n\$foo = 1;");
            t_eq(ft_load_config($dir)['driver'], 'error');
            // config one level up (outside the repo), in "return ['db' => [host,name,user,pass]]" form
            @unlink("$dir/config.php"); @mkdir("$dir/app");
            file_put_contents("$dir/config.php", "<?php\nreturn ['db'=>['host'=>'localhost','name'=>'n1','user'=>'u1','pass'=>'p1'],'admin_password'=>'x','allowed_hosts'=>['a.hu']];");
            $c = ft_load_config("$dir/app");
            t_eq([$c['driver'], $c['host'], $c['name'], $c['user'], $c['pass'], $c['source']], ['mysql', 'localhost', 'n1', 'u1', 'p1', '../config.php']);
            @unlink("$dir/config.php");
            t_eq(ft_load_config("$dir/app")['driver'], 'sqlite', 'config.php nélkül SQLite');
            @rmdir("$dir/app"); @rmdir($dir);
        },
        'Dátum: GEDCOM, TribalPages és magyar formák' => function () {
            t_eq(ft_parse_date('Sep 16 1953')['raw'], '16 SEP 1953');
            t_eq(ft_parse_date('1953. 09. 16.')['sort'], 19530916);
            t_eq(ft_parse_date('1953-09-16')['raw'], '16 SEP 1953');
            t_eq(ft_parse_date('16.09.1953')['raw'], '16 SEP 1953');
            t_eq(ft_parse_date('1953. szeptember 16.')['raw'], '16 SEP 1953');
            t_eq(ft_parse_date('kb. 1950')['raw'], 'ABT 1950');
            t_eq(ft_parse_date('1950 előtt')['raw'], 'BEF 1950');
            t_eq(ft_parse_date('BET 1900 AND 1910')['qual'], 'BET');
            t_eq(ft_parse_date('Dec 1902')['m'], 12);
            t_eq(ft_parse_date('furcsa szöveg')['qual'], 'TXT');
            t_eq(ft_parse_date(''), null);
            t_eq(ft_format_date('16 SEP 1953'), '1953. szeptember 16.');
            t_eq(ft_format_date('ABT 1950'), 'kb. 1950');
            t_eq(ft_format_date('1944'), '1944');
        },
        'GEDCOM: névbontás (előtag, TribalPages-utótag)' => function () {
            t_eq(ft_parse_name('Erzsébet /Kováts-Szabó/ Dr.'), ['given' => 'Erzsébet', 'surname' => 'Kováts-Szabó', 'title' => 'Dr.', 'suffix' => '']);
            t_eq(ft_parse_name('László /Csáki/ b.1928')['suffix'], '');
            t_eq(ft_parse_name('??? /Simon/')['given'], '');
            t_eq(ft_parse_name('Kálmán /Vashegyi/ Id.')['title'], 'Id.');
        },
        'GEDCOM: CONC/CONT összefűzés és HTML-entitások' => function () {
            $r = ft_gedcom_parse(T_GED);
            $i1 = array_values(array_filter($r, fn($x) => $x['xref'] === 'I1'))[0];
            t_eq(ft_subval($i1, 'NOTE'), "Első sor ős folytatás\nmásodik sor");
            t_eq(count(array_filter($r, fn($x) => $x['tag'] === 'INDI')), 6);
        },
        'GEDCOM: import – személyek, családok, események, források' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            t_eq($ids['_stats']['persons'], 6); t_eq($ids['_stats']['families'], 2); t_eq($ids['_stats']['sources'], 1);
            $g = ft_graph();
            t_eq($g['P'][$ids['I1']]['by'], 1900);
            t_eq($g['P'][$ids['I1']]['bp'], 'Budapest');
            t_eq($g['P'][$ids['I2']]['deceased'], 1, 'üres DEAT is elhunytat jelent');
            t_eq($g['F'][$ids['F1']]['children'], [$ids['I3'], $ids['I6']]);
            t_eq($g['F'][$ids['F1']]['my'], 1928);
            t_eq($g['F'][$ids['F2']]['div'], 1, 'üres DIV is válást jelent');
            t_eq($db->val('SELECT title FROM {persons} WHERE id = ?', [$ids['I1']]), 'Dr.');
        },
        'GEDCOM: export → újraimport ugyanazt adja' => function () {
            $db = t_fresh_db(); t_import($db);
            $ged = ft_gedcom_export($db, 'https://example.hu/fa');
            t_ok(str_contains($ged, '0 TRLR'));
            $db2 = new DB(new PDO('sqlite::memory:'), 't_'); $db2->migrate(ft_schema());
            $st = ft_gedcom_import($db2, ft_gedcom_parse($ged), 'replace');
            t_eq([$st['persons'], $st['families']], [6, 2]);
            t_eq($db2->val("SELECT notes FROM {persons} WHERE surname = 'Nagy' AND given = 'János'"), "Első sor ős folytatás\nmásodik sor");
            t_eq((int)$db2->val("SELECT COUNT(*) FROM {children}"), 3);
            App::useDb($db, ft_settings_defaults());
        },
        'GEDCOM: hosszú sorok CONC-darabolása ékezetekkel' => function () {
            $long = str_repeat('árvíztűrő tükörfúrógép ', 30);
            $out = ft_ged_line(1, 'NOTE', $long);
            t_ok(substr_count($out, 'CONC') >= 2);
            $back = ft_subval(ft_gedcom_parse("0 @I1@ INDI\n" . $out)[0], 'NOTE');
            t_eq($back, trim($long));
        },
        'GEDCOM: csurgay.ged teljes import (ha van a repóban)' => function () {
            $f = ft_find_ged(App::$root);
            if (!$f) return 'skip';
            $text = file_get_contents($f);
            $db = t_fresh_db();
            $st = ft_gedcom_import($db, ft_gedcom_parse($text), 'replace');
            t_eq($st['persons'], preg_match_all('/^0 @[^@]+@ INDI/m', $text));
            t_eq($st['families'], preg_match_all('/^0 @[^@]+@ FAM/m', $text));
            t_ok(!$db->val("SELECT COUNT(*) FROM {persons} WHERE notes LIKE '%&#%'"), 'HTML-entitás maradt a jegyzetekben');
            App::flush();
            t_ok(ft_pick_home_person(ft_graph()) > 0);
        },
        'Ág: leszármazottak és házastársaik' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $set = ft_branch_set(ft_graph(), $ids['I3'], true);
            t_ok(isset($set[$ids['I3']], $set[$ids['I4']], $set[$ids['I5']]));
            t_ok(!isset($set[$ids['I1']]), 'a szülő nem tartozik az ághoz');
            t_ok(!isset($set[$ids['I6']]), 'a testvér nem tartozik az ághoz');
            t_eq($set[$ids['I4']], 'spouse');
            t_ok(!isset(ft_branch_set(ft_graph(), $ids['I3'], false)[$ids['I4']]));
        },
        'Jogosultság: admin, családfő (ágon belül/kívül), családtag, vendég' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $admin = t_user($db, 'admin'); $head = t_user($db, 'head'); $mem = t_user($db, 'member');
            $db->insert('branches', ['user_id' => $head['id'], 'person_id' => $ids['I3'], 'created' => ft_now()]);
            t_as(null); t_eq(ft_mode('create', [$ids['I3']]), 'deny');
            t_as($admin); t_eq(ft_mode('delete', [$ids['I1']]), 'direct');
            t_as($head);
            t_eq(ft_mode('create', [$ids['I5']]), 'direct');
            t_eq(ft_mode('update', [$ids['I5']]), 'queue');
            t_eq(ft_mode('delete', [$ids['I5']]), 'queue');
            t_eq(ft_mode('create', [], [$ids['F2']]), 'direct', 'saját család');
            t_eq(ft_mode('create', [$ids['I1']]), 'direct', 'a gyökér fölé új adat felvihető');
            t_eq(ft_mode('update', [$ids['I1']]), 'queue', 'a gyökér feletti meglévő adat csak javaslattal módosul');
            t_eq(ft_mode('create', [$ids['I6']]), 'direct', 'testvér is a gyökér feletti részhez tartozik');
            App::$s['head_above_create'] = false;
            t_eq(ft_mode('create', [$ids['I1']]), 'queue', 'ágon kívül csak javaslat');
            App::$s['member_suggest'] = false;
            t_eq(ft_mode('create', [$ids['I1']]), 'deny');
            App::$s['member_suggest'] = true;
            App::$s['head_above_create'] = true;
            App::$s['head_update_approval'] = false;
            t_eq(ft_mode('update', [$ids['I5']]), 'direct');
            t_as($mem); t_eq(ft_mode('create', [$ids['I5']]), 'queue');
        },
        'Családfő: a gyökere fölé felvehet, de ott semmit nem módosíthat közvetlenül' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $admin = t_user($db, 'admin'); $head = t_user($db, 'head');
            $db->insert('branches', ['user_id' => $head['id'], 'person_id' => $ids['I3'], 'created' => ft_now()]);
            t_as($admin);
            $out = ft_run_op('person.create', ['given' => 'Idegen', 'surname' => 'Anya', 'sex' => 'F', 'rel' => ['type' => 'parent', 'of' => $ids['I4']]]);
            t_as($head);
            $gp = ft_run_op('person.create', ['given' => 'Nagyapa', 'surname' => 'Régi', 'sex' => 'M', 'rel' => ['type' => 'parent', 'of' => $ids['I1']]]);
            t_eq($gp['queued'], false, 'nagyszülő felvétele közvetlen');
            $ev = ft_run_op('event.create', ['person_id' => $ids['I1'], 'type' => 'OCCU', 'label' => 'molnár']);
            t_eq($ev['queued'], false, 'esemény a felmenőhöz közvetlen');
            t_eq(ft_run_op('person.update', ['id' => $gp['id'], 'given' => 'Nagyapó'])['queued'], true, 'saját felvitt felmenő módosítása is javaslat');
            t_eq(ft_run_op('event.delete', ['id' => $ev['id']])['queued'], true, 'felmenő eseményének törlése javaslat');
            t_eq(ft_run_op('person.update', ['id' => $ids['I1'], 'given' => 'X'])['queued'], true);
            $kid = ft_run_op('person.create', ['given' => 'Unoka', 'sex' => 'F', 'rel' => ['type' => 'child', 'family_id' => $ids['F2']]]);
            t_eq(ft_run_op('person.update', ['id' => $kid['id'], 'given' => 'Unoka Ilona'])['queued'], true, 'ágon belül a beállítás szerint');
            App::$s['head_update_approval'] = false;
            t_eq(ft_run_op('person.update', ['id' => $kid['id'], 'given' => 'Unoka Ilona'])['queued'], false, 'saját ágon közvetlen');
            t_eq(ft_run_op('person.update', ['id' => $gp['id'], 'given' => 'Nagyapó'])['queued'], true, 'a gyökér fölött ekkor is javaslat');
            t_eq(ft_mode('create', [$out['id']]), 'queue', 'a házastárs felmenői nem tartoznak hozzá');
        },
        'Hozzászólások: írás, válasz, javítás, törlés, jogok' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $admin = t_user($db, 'admin'); $a = t_user($db, 'member', 'ca@x.hu'); $b = t_user($db, 'member', 'cb@x.hu');
            t_as(null);
            t_throws(fn() => ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'body' => 'x']), 'vendég nem írhat');
            t_as($a);
            $c = ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'body' => "Szerintem 1902-ben született.\nA keresztlevél nálam van."]);
            t_throws(fn() => ft_comment_add(['entity' => 'person', 'entity_id' => 999999, 'body' => 'x']), 'nem létező személy');
            t_throws(fn() => ft_comment_add(['entity' => 'user', 'entity_id' => 1, 'body' => 'x']), 'ismeretlen cél');
            t_throws(fn() => ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'body' => '   ']), 'üres');
            t_as($b);
            $r1 = ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'parent_id' => $c['id'], 'body' => 'Köszönöm!']);
            $r2 = ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'parent_id' => $r1['id'], 'body' => 'Válasz a válaszra']);
            t_eq((int)$db->val('SELECT parent_id FROM {comments} WHERE id = ?', [$r2['id']]), $c['id'], 'egy szint mély');
            t_throws(fn() => ft_comment_edit(['id' => $c['id'], 'body' => 'más']), 'másét nem javíthatja');
            t_throws(fn() => ft_comment_delete(['id' => $c['id']]), 'másét nem törölheti');
            $l = ft_comments_list('person', $ids['I1']);
            t_eq(count($l), 3); t_eq($l[0]['mine'], false); t_eq($l[1]['mine'], true);
            t_as($a);
            ft_comment_edit(['id' => $c['id'], 'body' => 'Javítva']);
            ft_comment_delete(['id' => $c['id']]);
            $l = ft_comments_list('person', $ids['I1']);
            t_eq($l[0]['deleted'], true, 'válaszok miatt helyőrző marad'); t_eq($l[0]['body'], null);
            t_as($admin);
            ft_comment_delete(['id' => $r1['id']]); ft_comment_delete(['id' => $r2['id']]);
            t_eq(count(ft_comments_list('person', $ids['I1'])), 0, 'üres helyőrző eltűnik');
            t_as($a);
            ft_comment_add(['entity' => 'family', 'entity_id' => $ids['F2'], 'body' => 'Esküvői kép?']);
            t_eq(count(ft_comments_recent(5)), 1);
            t_as($admin);
            ft_run_op('family.delete', ['id' => $ids['F2']]);
            t_eq((int)$db->val("SELECT COUNT(*) FROM {comments} WHERE entity = 'family'"), 0, 'törölt családdal együtt törlődik');
            App::$s['comments'] = 'off';
            t_throws(fn() => ft_comments_list('person', $ids['I1']), 'kikapcsolva');
            App::$s['comments'] = 'members';
        },
        'Műveletek: új gyermek a családba, szülő és házastárs felvétele' => function () {
            $db = t_fresh_db(); $ids = t_import($db); t_as(t_user($db, 'admin'));
            $r = ft_run_op('person.create', ['given' => 'Bence', 'surname' => 'Nagy', 'sex' => 'M', 'birth_date' => '2004. 05. 06.', 'rel' => ['type' => 'child', 'family_id' => $ids['F2']]]);
            t_eq($r['queued'], false);
            $g = ft_graph();
            t_ok(in_array($r['id'], $g['F'][$ids['F2']]['children'], true));
            t_eq($g['P'][$r['id']]['bdate'], '6 MAY 2004');
            $sp = ft_run_op('person.create', ['given' => 'Zsófi', 'surname' => 'Kis', 'sex' => 'F', 'rel' => ['type' => 'spouse', 'of' => $r['id'], 'marriage_date' => '2030']]);
            $g = ft_graph();
            t_eq(count($g['P'][$r['id']]['fams']), 1);
            t_eq($g['F'][$g['P'][$r['id']]['fams'][0]]['wife_id'], $sp['id']);
            $par = ft_run_op('person.create', ['given' => 'Ilona', 'surname' => 'Régi', 'sex' => 'F', 'rel' => ['type' => 'parent', 'of' => $ids['I4']]]);
            t_eq(ft_parents(ft_graph(), $ids['I4']), [$par['id']]);
            t_throws(fn() => ft_run_op('person.create', ['given' => 'Másik', 'sex' => 'F', 'rel' => ['type' => 'parent', 'of' => $ids['I4']]]), 'második anya nem lehet');
            t_throws(fn() => ft_run_op('person.create', ['sex' => 'M']), 'név nélkül nem lehet');
        },
        'Jóváhagyás: a családfő módosítása csak elfogadás után érvényes' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $admin = t_user($db, 'admin'); $head = t_user($db, 'head');
            $db->insert('branches', ['user_id' => $head['id'], 'person_id' => $ids['I3'], 'created' => ft_now()]);
            t_as($head);
            $r = ft_run_op('person.update', ['id' => $ids['I5'], 'given' => 'Anna Mária', 'birth_date' => '2001. 03. 04.']);
            t_eq($r['queued'], true);
            t_eq($db->val('SELECT given FROM {persons} WHERE id = ?', [$ids['I5']]), 'Anna', 'még nem változhat');
            t_ok($db->val('SELECT before_json FROM {changes} WHERE id = ?', [$r['change_id']]) !== null, 'előtte-állapot mentve');
            t_throws(fn() => ft_change_review($r['change_id'], true), 'családfő nem hagyhat jóvá');
            t_as($admin);
            ft_change_review($r['change_id'], true, 'ok');
            t_eq($db->val('SELECT given FROM {persons} WHERE id = ?', [$ids['I5']]), 'Anna Mária');
            t_eq(ft_graph()['P'][$ids['I5']]['bdate'], '4 MAR 2001');
            t_throws(fn() => ft_change_review($r['change_id'], true), 'kétszer nem bírálható el');
            t_as($head);
            $d = ft_run_op('person.delete', ['id' => $ids['I5']]);
            t_as($admin);
            ft_change_review($d['change_id'], false, 'nem');
            t_ok($db->val('SELECT id FROM {persons} WHERE id = ?', [$ids['I5']]), 'elutasított törlés után megmarad');
        },
        'Műveletek: törlés minden kapcsolatot takarít' => function () {
            $db = t_fresh_db(); $ids = t_import($db); t_as(t_user($db, 'admin'));
            ft_run_op('person.delete', ['id' => $ids['I4']]);
            t_eq($db->val('SELECT wife_id FROM {families} WHERE id = ?', [$ids['F2']]), null);
            t_eq((int)$db->val('SELECT COUNT(*) FROM {events} WHERE person_id = ?', [$ids['I4']]), 0);
            ft_run_op('family.delete', ['id' => $ids['F2']]);
            t_eq((int)$db->val('SELECT COUNT(*) FROM {children} WHERE family_id = ?', [$ids['F2']]), 0);
            t_ok($db->val('SELECT id FROM {persons} WHERE id = ?', [$ids['I5']]), 'a gyermek megmarad');
        },
        'Események: létrehozás, módosítás, halál jelölése' => function () {
            $db = t_fresh_db(); $ids = t_import($db); t_as(t_user($db, 'admin'));
            $e = ft_run_op('event.create', ['person_id' => $ids['I5'], 'type' => 'CHR', 'date' => '2001. 06. 10.', 'place' => 'Szeged']);
            t_eq($db->val('SELECT date_raw FROM {events} WHERE id = ?', [$e['id']]), '10 JUN 2001');
            ft_run_op('event.update', ['id' => $e['id'], 'type' => 'CHR', 'date' => 'kb. 2001', 'place' => 'Pécs']);
            t_eq($db->row('SELECT date_raw, place FROM {events} WHERE id = ?', [$e['id']]), ['date_raw' => 'ABT 2001', 'place' => 'Pécs']);
            ft_run_op('event.create', ['person_id' => $ids['I5'], 'type' => 'DEAT', 'date' => '2090']);
            t_eq((int)$db->val('SELECT deceased FROM {persons} WHERE id = ?', [$ids['I5']]), 1);
            t_throws(fn() => ft_run_op('event.create', ['person_id' => $ids['I5'], 'type' => 'XXXX']));
        },
        'Fotó: GD-vel újrakódolva, bélyegkép, nem-kép elutasítva' => function () {
            if (!function_exists('imagecreatetruecolor')) return 'skip';
            $db = t_fresh_db(); $ids = t_import($db); $admin = t_user($db, 'admin'); t_as($admin);
            $oldRoot = App::$root;
            App::$root = sys_get_temp_dir() . '/ftimg' . bin2hex(random_bytes(4)); @mkdir(App::$root);
            try {
                $im = imagecreatetruecolor(3000, 1500); imagefill($im, 0, 0, imagecolorallocate($im, 200, 100, 50));
                $tmp = App::$root . '/in.png'; imagepng($im, $tmp);
                $res = ft_photo_upload(['error' => UPLOAD_ERR_OK, 'tmp_name' => $tmp, 'name' => 'x.png'], ['person_id' => $ids['I5'], 'title' => 'Teszt']);
                t_eq($res['queued'], false);
                $ph = $db->row('SELECT * FROM {photos} WHERE id = ?', [$res['id']]);
                t_ok(is_file(App::$root . '/' . $ph['file']) && is_file(App::$root . '/' . $ph['thumb']));
                t_eq([(int)$ph['w'], (int)$ph['h']], [800, 400], 'portré: max 800×800 px'); t_eq(getimagesize(App::$root . '/' . $ph['file'])[2], IMAGETYPE_JPEG);
                $g = ft_photo_upload(['error' => UPLOAD_ERR_OK, 'tmp_name' => $tmp, 'name' => 'x.png'], ['family_id' => $ids['F2']]);
                t_eq((int)$db->val('SELECT w FROM {photos} WHERE id = ?', [$g['id']]), 1600, 'családi fotó: max 1600 px');
                $g2 = ft_photo_upload(['error' => UPLOAD_ERR_OK, 'tmp_name' => $tmp, 'name' => 'x.png'], ['person_id' => $ids['I5'], 'group' => '1']);
                t_eq((int)$db->val('SELECT w FROM {photos} WHERE id = ?', [$g2['id']]), 1600, 'csoportképként jelölve: 1600 px');
                $im2 = imagecreatetruecolor(300, 200); $tmp2 = App::$root . '/small.png'; imagepng($im2, $tmp2);
                $sm = ft_photo_upload(['error' => UPLOAD_ERR_OK, 'tmp_name' => $tmp2, 'name' => 's.png'], ['person_id' => $ids['I5']]);
                t_eq((int)$db->val('SELECT w FROM {photos} WHERE id = ?', [$sm['id']]), 300, 'kis képet nem nagyít');
                t_eq((int)$db->val('SELECT photo_id FROM {persons} WHERE id = ?', [$ids['I5']]), $res['id'], 'automatikusan fő portré');
                foreach ([$g, $g2, $sm] as $x) ft_run_op('photo.delete', ['id' => $x['id']]);
                file_put_contents($tmp, "<?php echo 'x'; ?>");
                t_throws(fn() => ft_photo_upload(['error' => UPLOAD_ERR_OK, 'tmp_name' => $tmp, 'name' => 'x.php'], ['person_id' => $ids['I5']]), 'PHP fájl nem mehet át');
                ft_run_op('photo.delete', ['id' => $res['id']]);
                t_ok(!is_file(App::$root . '/' . $ph['file']), 'törléskor a fájl is törlődik');
                t_eq($db->val('SELECT photo_id FROM {persons} WHERE id = ?', [$ids['I5']]), null);
            } finally {
                foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(App::$root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) $f->isDir() ? @rmdir($f) : @unlink($f);
                @rmdir(App::$root);
                App::$root = $oldRoot;
            }
        },
        'Fotócsomag: ZIP-import személyhez kötve, ismételve nem duplikál' => function () {
            if (!function_exists('imagecreatetruecolor')) return 'skip';
            $db = t_fresh_db(); $ids = t_import($db); t_as(t_user($db, 'admin'));
            $oldRoot = App::$root;
            App::$root = sys_get_temp_dir() . '/ftzip' . bin2hex(random_bytes(4)); @mkdir(App::$root);
            try {
                $im = imagecreatetruecolor(200, 250); ob_start(); imagejpeg($im); $jpg = ob_get_clean();
                $man = json_encode(['photos' => [
                    ['file' => 'p/1.jpg', 'key' => 'tp:1', 'xref' => 'I5', 'title' => 'Anna', 'date' => '2005'],
                    ['file' => 'p/2.jpg', 'key' => 'tp:2', 'xref' => 'I99', 'title' => 'Ismeretlen'],
                ]]);
                // hand-built ZIP: manifest deflated, images stored – exercises both code paths
                $entries = ['manifest.json' => [$man, 8], 'p/1.jpg' => [$jpg, 0], 'p/2.jpg' => [$jpg, 0]];
                $zip = ''; $cd = '';
                foreach ($entries as $name => [$data, $m]) {
                    $c = $m === 8 ? gzdeflate($data) : $data; $crc = crc32($data); $off = strlen($zip);
                    $zip .= pack('VvvvvvVVVvv', 0x04034b50, 20, 0, $m, 0, 0, $crc, strlen($c), strlen($data), strlen($name), 0) . $name . $c;
                    $cd .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0, $m, 0, 0, $crc, strlen($c), strlen($data), strlen($name), 0, 0, 0, 0, 0, $off) . $name;
                }
                $zip .= $cd . pack('VvvvvVVv', 0x06054b50, 0, 0, count($entries), count($entries), strlen($cd), strlen($zip), 0);
                $zf = App::$root . '/pkg.zip'; file_put_contents($zf, $zip);
                $r = ft_photo_package_import($zf);
                t_eq([$r['imported'], $r['linked'], $r['unmatched']], [2, 1, ['I99']]);
                t_eq((int)$db->val('SELECT photo_id IS NOT NULL FROM {persons} WHERE id = ?', [$ids['I5']]), 1, 'portré beállítva');
                t_eq($db->val("SELECT date_raw FROM {photos} WHERE source = 'tp:1'"), '2005');
                $r2 = ft_photo_package_import($zf);
                t_eq([$r2['imported'], $r2['skipped']], [0, 2], 'második futás');
                file_put_contents($zf, 'nem zip');
                t_throws(fn() => ft_photo_package_import($zf));
            } finally {
                foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator(App::$root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST) as $f) $f->isDir() ? @rmdir($f) : @unlink($f);
                @rmdir(App::$root);
                App::$root = $oldRoot;
            }
        },
        'Adatvédelem: élők becslése és elrejtése vendégnek' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $g = ft_graph();
            t_ok(ft_is_living($g, $ids['I5']), '2001-es születésű él');
            t_ok(!ft_is_living($g, $ids['I1']), 'elhunyt');
            t_ok(isset($g['est'][$ids['I4']]), 'születési év becslés a házastársból');
            t_as(null);
            App::$s['privacy_living'] = 'names';
            $tree = ft_handlers()['tree']([]);
            $anna = array_values(array_filter($tree['persons'], fn($p) => $p['id'] === $ids['I5']))[0];
            t_eq($anna['g'], 'Élő személy'); t_eq($anna['b'], null);
            $janos = array_values(array_filter($tree['persons'], fn($p) => $p['id'] === $ids['I1']))[0];
            t_eq($janos['b'], 1900);
            t_as(t_user($db, 'member'));
            $tree = ft_handlers()['tree']([]);
            t_eq(array_values(array_filter($tree['persons'], fn($p) => $p['id'] === $ids['I5']))[0]['g'], 'Anna', 'bejelentkezve minden látszik');
            // stories about living people: hidden from guests everywhere, readable for members
            t_as(t_user($db, 'admin'));
            $live = ft_run_op('story.create', ['title' => 'Anna ballagása', 'body' => 'Szép nap volt.', 'person_ids' => [$ids['I5']]]);
            $fam = ft_run_op('story.create', ['title' => 'A család nyaralása', 'body' => 'Balaton.', 'family_ids' => [$ids['F2']]]);
            $old = ft_run_op('story.create', ['title' => 'János malma', 'body' => 'Régen.', 'person_ids' => [$ids['I1']]]);
            $free = ft_run_op('story.create', ['title' => 'A falu', 'body' => 'Általános.']);
            App::$s['public_access'] = 'public';
            t_as(null);
            $H = ft_handlers();
            $titles = array_column($H['stories']([]), 'title');
            t_ok(in_array('János malma', $titles, true) && in_array('A falu', $titles, true), 'régi és általános sztori látszik');
            t_ok(!in_array('Anna ballagása', $titles, true), 'élőről szóló sztori rejtve');
            t_ok(!in_array('A család nyaralása', $titles, true), 'élő házaspár családjáról szóló sztori rejtve');
            t_throws(fn() => $H['story'](['id' => $live['id']]), 'közvetlen linkkel sem olvasható');
            t_eq(array_column($H['person'](['id' => $ids['I5']])['stories'], 'title'), [], 'a személy lapján sincs');
            t_ok(!in_array('Anna ballagása', array_column($H['home']([])['stories'], 'title'), true), 'a kezdőlapon sincs');
            t_as(t_user($db, 'member', 'olvaso@x.hu'));
            t_ok(in_array('Anna ballagása', array_column($H['stories']([]), 'title'), true), 'bejelentkezve látszik');
            t_eq($H['story'](['id' => $live['id']])['title'], 'Anna ballagása');
        },
        'Beállítások: típusellenőrzés és határértékek' => function () {
            $defs = []; foreach (ft_settings_def() as $d) $defs[$d[1]] = $d;
            t_eq(ft_setting_coerce($defs['quiz_count'], '12'), 12);
            t_throws(fn() => ft_setting_coerce($defs['quiz_count'], '500'));
            t_throws(fn() => ft_setting_coerce($defs['name_order'], 'xx'));
            t_throws(fn() => ft_setting_coerce($defs['accent'], 'red'));
            t_eq(ft_setting_coerce($defs['recent_types'], ['BIRT', 'HACK']), ['BIRT']);
            foreach (ft_settings_def() as $d) ft_setting_coerce($d, $d[3]); // every default must be valid
        },
        'API: főoldal, személy, család, keresések hibátlanul futnak' => function () {
            $db = t_fresh_db(); $ids = t_import($db); $u = t_user($db, 'admin'); t_as($u);
            $_SESSION['csrf'] = $_SESSION['csrf'] ?? 'x';
            $H = ft_handlers();
            $home = $H['home']([]);
            t_ok(isset($home['recent'], $home['anniversaries'], $home['pins'], $home['stats']));
            t_eq($home['stats']['persons'], 6);
            t_eq($home['stats']['generations'], 3);
            $p = $H['person'](['id' => $ids['I3']]);
            t_eq($p['person']['s'], 'Nagy'); t_eq($p['modes']['update'], 'direct');
            $H['family'](['id' => $ids['F1']]);
            $H['pin'](['kind' => 'tree', 'ref_id' => $ids['I3'], 'params' => ['kind' => 'fan']]);
            t_eq(count($H['home']([])['pins']), 1);
            $s = ft_run_op('story.create', ['title' => 'A nagy utazás', 'body' => "Egyszer volt…\n\nVége.", 'person_ids' => [$ids['I1']]]);
            t_eq($H['story'](['id' => $s['id']])['person_ids'], [$ids['I1']]);
            t_eq(count($H['events']([])) > 0, true);
            t_ok(strlen($H['quiz.save'](['score' => 9, 'total' => 10, 'mode' => 'choice'])['id'] . '') > 0);
            t_eq($H['quiz.top']([])[0]['score'], 9);
        },
        'Séma: a migráció ismételhető és pótolja a hiányzó oszlopot' => function () {
            $db = t_fresh_db();
            t_eq($db->migrate(ft_schema()), [], 'második futás nem változtat');
            $db->pdo->exec('CREATE TABLE t_extra_test (id INTEGER PRIMARY KEY)');
            $log = $db->migrate(['extra_test' => ['cols' => ['id' => 'id', 'name' => 'str20']]]);
            t_eq($log, ['ALTER t_extra_test ADD name']);
        },
        'Séma: egy nem létrehozható index nem akasztja meg a telepítést' => function () {
            $db = new DB(new PDO('sqlite::memory:'), 't_');
            $db->pdo->exec('CREATE TABLE t_settings_u_k (x INTEGER)'); // name clash → that one CREATE INDEX must fail
            $log = $db->migrate(ft_schema());
            t_eq(count($log), count(ft_schema()), 'minden tábla egy menetben létrejön');
            t_eq(count($db->warnings), 1);
            t_eq($db->migrate(ft_schema()), [], 'ismételt / párhuzamos futás nem hibázik');
        },
        'Regisztráció: jóváhagyásig nem léphet be, utána ággal családfő lesz' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $H = ft_handlers(); $sess = $_SESSION ?? []; $_SESSION = [];
            $H['register'](['name' => 'Új Rokon', 'email' => 'Uj@Rokon.hu', 'password' => 'titkos-123', 'intro' => 'Anna fia']);
            $u = $db->row('SELECT * FROM {users} WHERE email = ?', ['uj@rokon.hu']);
            t_eq([$u['status'], (int)$u['active'], $u['role']], ['pending', 0, 'member']);
            try { $H['login'](['email' => 'uj@rokon.hu', 'password' => 'titkos-123']); throw new FtAssert('beléphetett jóváhagyás előtt'); }
            catch (ApiError $e) { t_ok(str_contains($e->getMessage(), 'jóváhagyásra vár'), 'érthető üzenet: ' . $e->getMessage()); }
            t_throws(fn() => $H['register'](['name' => 'X', 'email' => 'uj@rokon.hu', 'password' => 'titkos-123']), 'dupla e-mail');
            t_eq($H['register'](['name' => 'Bot', 'email' => 'bot@x.hu', 'password' => 'titkos-123', 'website' => 'spam'])['ok'], true);
            t_eq($H['register'](['name' => 'Bot2', 'email' => 'bot2@x.hu', 'password' => 'titkos-123', 'hp_x7' => 'spam'])['ok'], true);
            t_eq($db->val('SELECT id FROM {users} WHERE email IN (?, ?)', ['bot@x.hu', 'bot2@x.hu']), null, 'a csapdába esett robot nem regisztrál');
            t_eq($db->val('SELECT id FROM {users} WHERE email = ?', ['bot@x.hu']), null, 'csapda mező: nem jön létre');
            App::$s['allow_register'] = false;
            t_throws(fn() => $H['register'](['name' => 'Y', 'email' => 'y@x.hu', 'password' => 'titkos-123']), 'kikapcsolt regisztráció');
            App::$s['allow_register'] = true;
            t_throws(fn() => $H['admin.user.approve'](['id' => (int)$u['id']]), 'nem-admin nem hagyhat jóvá');
            t_as(t_user($db, 'admin'));
            $r = $H['admin.user.approve'](['id' => (int)$u['id'], 'role' => 'member', 'person_id' => $ids['I5'], 'branch_ids' => [$ids['I3']]]);
            t_eq($r['role'], 'head', 'ág megadásával családfő');
            $u = $db->row('SELECT * FROM {users} WHERE id = ?', [(int)$u['id']]);
            t_eq([$u['status'], (int)$u['active'], (int)$u['person_id']], ['active', 1, $ids['I5']]);
            t_as($u);
            t_eq(ft_mode('create', [$ids['I5']]), 'direct', 'saját ágán közvetlenül szerkeszt');
            t_as(t_user($db, 'admin'));
            $H['admin.user.branches'](['user_id' => (int)$u['id'], 'person_ids' => []]);
            t_eq((int)$db->val('SELECT COUNT(*) FROM {branches} WHERE user_id = ?', [(int)$u['id']]), 0);
            $_SESSION = $sess;
        },
        'Történetek: életrajzok és emlék-hozzászólások is megjelennek, másolat nélkül' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $admin = t_user($db, 'admin'); $a = t_user($db, 'member', 'sa@x.hu'); $b = t_user($db, 'member', 'sb@x.hu');
            $db->update('persons', ['notes' => str_repeat('Hosszú életrajz. ', 10)], $ids['I3']);
            t_as($admin);
            $kinds = fn() => array_map(fn($x) => $x['kind'] . ':' . $x['id'], ft_story_feed('hu'));
            $bio = array_values(array_filter(ft_story_feed('hu'), fn($x) => $x['kind'] === 'bio'));
            t_eq(count($bio), 1, 'a rövid jegyzet (I1) nem jelenik meg');
            t_eq([$bio[0]['id'], $bio[0]['title'], $bio[0]['y']], [$ids['I3'], 'Nagy Péter (sz. 1930)', 1930]);
            t_eq((int)$db->val('SELECT COUNT(*) FROM {stories}'), 0, 'nem készül másolat');
            App::$s['notes_story_min'] = 10;
            t_ok(in_array('bio:' . $ids['I1'], $kinds(), true), 'alacsonyabb határral a rövidebb is');
            $x = ft_story_extra('bio', $ids['I3']);
            t_eq($x['body'], trim(str_repeat('Hosszú életrajz. ', 10)), 'ugyanaz a szöveg, ami a személy lapján');
            App::$s['bios_in_stories'] = false;
            t_ok(!array_filter(ft_story_feed('hu'), fn($x) => $x['kind'] === 'bio'), 'kikapcsolható');
            App::$s['bios_in_stories'] = true;
            // an old copy (earlier import) of the biography: no second entry
            $sid = $db->insert('stories', ['title' => 'Nagy Péter', 'body' => 'x', 'status' => 'ok', 'source' => 'note:I3', 'lang' => 'hu', 'created' => ft_now(), 'updated' => ft_now()]);
            $db->insert('story_links', ['story_id' => $sid, 'person_id' => $ids['I3']]);
            t_ok(!in_array('bio:' . $ids['I3'], $kinds(), true) && in_array('story:' . $sid, $kinds(), true), 'régi másolatnál csak egyszer');
            // comments marked as a memory
            t_as($a);
            $c1 = ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'body' => 'Nagyapa mindig a kertben fütyörészett.', 'story' => true])['id'];
            $c2 = ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'body' => 'Szerintem 1902-ben született.'])['id'];
            ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'parent_id' => $c1, 'body' => 'Igen, a Kék Duna keringőt!']);
            $ks = $kinds();
            t_ok(in_array('comment:' . $c1, $ks, true) && !in_array('comment:' . $c2, $ks, true), 'csak a megjelölt hozzászólás');
            $it = array_values(array_filter(ft_story_feed('hu'), fn($x) => $x['kind'] === 'comment'))[0];
            t_eq([$it['title'], $it['author'], $it['person_ids']], ['Dr. Nagy János', 'Member', [$ids['I1']]]);
            $x = ft_story_extra('comment', $c1);
            t_eq([count($x['replies']), $x['replies'][0]['body']], [1, 'Igen, a Kék Duna keringőt!'], 'a válaszok is látszanak');
            t_as($b);
            t_throws(fn() => ft_comment_story(['id' => $c1, 'on' => false]), 'más nem veheti ki');
            t_as($admin);
            ft_comment_story(['id' => $c2, 'on' => true]);
            t_ok(in_array('comment:' . $c2, $kinds(), true), 'az admin megjelölheti');
            t_as($a);
            ft_comment_story(['id' => $c1, 'on' => false]);
            t_ok(!in_array('comment:' . $c1, $kinds(), true), 'a szerző kiveheti');
            t_eq(array_column(ft_comments_list('person', $ids['I1']), 'story'), [false, true, false], 'a hozzászólásoknál is látszik');
            t_as(null);
            t_ok(!array_filter(ft_story_feed('hu'), fn($x) => $x['kind'] === 'comment'), 'vendég nem látja a hozzászólásokat');
            t_throws(fn() => ft_story_extra('comment', $c2), 'vendég a hozzászólást sem');
            App::$s['notes_story_min'] = 80;
        },
        'Beírt szövegek fordítása: bármelyik nyelvről, gyorsítótárral, az eredeti érintetlen' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $admin = t_user($db, 'admin'); t_as($admin);
            $calls = [];
            // "DE:" = German text, everything else Hungarian
            $GLOBALS['ft_translate_mock'] = fn() => ['texts' => [], 'detected' => ''];
            $GLOBALS['ft_translate_each_mock'] = function ($texts, $target) use (&$calls) {
                $calls[] = $target . ':' . count($texts);
                return array_map(fn($t) => ['text' => str_starts_with($t, 'DE:') && $target === 'de' || !str_starts_with($t, 'DE:') && $target === 'hu' ? $t : "[$target] $t",
                    'detected' => str_starts_with($t, 'DE:') ? 'de' : 'hu'], $texts);
            };
            try {
                App::$s['translate_content'] = true; App::$s['_tr_pause'] = 0;
                $bio = 'Kovácsmester volt a faluban, és hét gyermeket nevelt fel.';
                $db->update('persons', ['notes' => $bio], $ids['I1']);
                $ev = $db->insert('events', ['person_id' => $ids['I1'], 'type' => 'OCCU', 'label' => 'kovács', 'created' => ft_now(), 'updated' => ft_now()]);
                App::flush();
                $h = ft_handlers();
                $get = fn($lang) => ft_tr_apply($h['person'](['id' => $ids['I1']]), $lang);
                $en = $get('en');
                t_eq([$en['notes'], $en['notes_tr'], $en['notes_src']], [$bio, "[en] $bio", 'hu'], 'a fordítás külön mezőben, az eredeti marad');
                $occ = array_values(array_filter($en['events'], fn($e) => $e['id'] === $ev))[0];
                t_eq($occ['label_tr'] ?? null, '[en] kovács', 'a foglalkozás is');
                t_ok(!str_contains(json_encode($en), '"_tr"'), 'a jelölők nem mennek ki');
                t_eq($calls, ['en:2'], 'egyetlen kérés a lapra');
                $get('en');
                t_eq($calls, ['en:2'], 'másodszor a tárolt fordítás jön');
                $hu = $get('hu');
                t_ok(!isset($hu['notes_tr']), 'magyar nézetben a magyar szöveg marad (helyi felismerés, nincs DeepL)');
                t_ok(!isset(array_values(array_filter($hu['events'], fn($e) => $e['id'] === $ev))[0]['label_tr']), 'rövid szónál a DeepL felismerte nyelv dönt');
                t_eq(count($calls), 1, 'ehhez nem kell újabb kérés (az angol fordításkor kiderült, hogy magyar)');
                // a German comment, read in Hungarian
                ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'body' => 'DE: Er war ein guter Mann.']);
                $cl = ft_tr_apply(ft_comments_list('person', $ids['I1']), 'hu');
                t_eq([$cl[0]['body_tr'], $cl[0]['body_src']], ['[hu] DE: Er war ein guter Mann.', 'de'], 'német hozzászólás magyarul');
                $cl = ft_tr_apply(ft_comments_list('person', $ids['I1']), 'de');
                t_ok(!isset($cl[0]['body_tr']), 'németül az eredeti');
                // edited text → translated again
                $db->update('persons', ['notes' => $bio . ' Később a tsz-ben dolgozott.'], $ids['I1']);
                t_eq($get('en')['notes_tr'], "[en] $bio Később a tsz-ben dolgozott.", 'módosított szöveget újrafordít');
                // in the stories feed too (excerpt of the biography)
                App::$s['notes_story_min'] = 10;
                $feed = ft_tr_apply(ft_story_feed('en'), 'en');
                $b = array_values(array_filter($feed, fn($x) => $x['kind'] === 'bio' && $x['id'] === $ids['I1']))[0];
                t_ok(str_starts_with($b['excerpt_tr'] ?? '', 'en Kovácsmester'), 'a Történetek kivonata is (a kivonatból a zárójelek kimaradnak)');
                App::$s['notes_story_min'] = 80;
                // DeepL fails: originals shown, and a pause instead of slow pages
                $GLOBALS['ft_translate_each_mock'] = function () { throw ft_err('DeepL fordítás sikertelen: elfogyott a havi DeepL keret', 502); };
                $db->update('persons', ['notes' => 'Egészen új szöveg, amit még senki nem fordított le.'], $ids['I1']);
                $x = $get('en');
                t_ok(!isset($x['notes_tr']) && $x['notes'] === 'Egészen új szöveg, amit még senki nem fordított le.', 'hibánál az eredeti látszik');
                t_ok(!ft_tr_on(), 'és szünetel');
                // the admin translates everything in advance
                App::$s['_tr_pause'] = 0;
                $GLOBALS['ft_translate_each_mock'] = fn($texts, $target) => array_map(fn($t) => ['text' => "[$target] $t", 'detected' => 'hu'], $texts);
                $miss = ft_tr_missing();
                t_ok($miss['en']['n'] > 0 && $miss['de']['n'] > 0, 'látszik, mennyi van hátra');
                for ($i = 0; $i < 10 && array_sum(array_column(ft_tr_step()['left'], 'n')); $i++);
                t_eq(array_sum(array_column(ft_tr_missing(), 'n')), 0, 'előre mindent lefordít');
            } finally { unset($GLOBALS['ft_translate_mock'], $GLOBALS['ft_translate_each_mock']); App::$s['_tr_pause'] = 0; }
        },
        'Fordítás: minden nyelvre, változatlan szöveget nem küld újra, nyelv szerint mutatja' => function () {
            $db = t_fresh_db(); t_import($db); t_as(t_user($db, 'admin'));
            $calls = [];
            $GLOBALS['ft_translate_mock'] = function ($texts, $target, $src) use (&$calls) { $calls[] = "$src>$target"; return ['texts' => array_map(fn($t) => "[$target] $t", $texts), 'detected' => $src]; };
            try {
                $r = ft_run_op('story.create', ['title' => 'Nagyapa', 'body' => 'Egyszer volt.', 'lang' => 'hu']);
                t_eq(ft_story_after_save($r['id']), null);
                t_eq($calls, ['hu>en', 'hu>de']);
                ft_story_translate($r['id']);
                t_eq(count($calls), 2, 'változatlan szöveg: nincs új DeepL-hívás');
                ft_run_op('story.update', ['id' => $r['id'], 'body' => 'Egyszer volt, hol nem volt.']);
                ft_story_after_save($r['id']);
                t_eq(count($calls), 4, 'módosítás után újrafordít');
                $H = ft_handlers();
                $de = $H['story'](['id' => $r['id'], 'lang' => 'de']);
                t_eq([$de['title'], $de['orig_title'], $de['shown_lang']], ['[de] Nagyapa', 'Nagyapa', 'de']);
                t_eq($de['raw_body'], 'Egyszer volt, hol nem volt.', 'szerkesztéshez az eredeti');
                t_eq($H['story'](['id' => $r['id'], 'lang' => 'hu'])['title'], 'Nagyapa');
                App::$s['languages'] = ['hu', 'en'];
                $r2 = ft_run_op('story.create', ['title' => 'Grandpa', 'body' => 'Once.', 'lang' => 'en']);
                ft_story_after_save($r2['id']);
                t_eq(array_slice($calls, -1), ['en>hu'], 'csak a bekapcsolt nyelvekre');
                ft_run_op('story.delete', ['id' => $r['id']]);
                t_eq((int)$db->val('SELECT COUNT(*) FROM {story_tr} WHERE story_id = ?', [$r['id']]), 0);
                $GLOBALS['ft_translate_mock'] = function () { throw ft_err('DeepL fordítás sikertelen: elfogyott a havi DeepL keret', 502); };
                $w = ft_story_after_save($r2['id'] + 0) ?? '';
                // unchanged text → nothing to translate → no error; a changed one reports a warning but the save stands
                ft_run_op('story.update', ['id' => $r2['id'], 'body' => 'Once upon a time.']);
                t_ok(str_contains((string)ft_story_after_save($r2['id']), 'keret'), 'hiba esetén figyelmeztetés');
                t_eq($db->val('SELECT body FROM {stories} WHERE id = ?', [$r2['id']]), 'Once upon a time.', 'a mentés megmaradt');
            } finally { unset($GLOBALS['ft_translate_mock']); }
        },
        'Config: DeepL kulcs kiolvasása a config.php-ből' => function () {
            $dir = sys_get_temp_dir() . '/ftcfgd' . bin2hex(random_bytes(4)); @mkdir($dir);
            file_put_contents("$dir/config.php", "<?php\nreturn ['db'=>['host'=>'h','name'=>'n','user'=>'u','pass'=>'p'],'deepl_key'=>'abc:fx'];");
            t_eq(ft_load_config($dir)['deepl'], 'abc:fx');
            file_put_contents("$dir/config.php", "<?php\ndefine('DB_NAME_X','');\n\$dbname='n';\$username='u';\$password='p';");
            t_eq(ft_load_config($dir)['deepl'], null);
            @unlink("$dir/config.php"); @rmdir($dir);
        },
        'Bejelentkezés: hibás jelszó után zárolás' => function () {
            $db = t_fresh_db();
            $db->insert('users', ['email' => 'a@b.hu', 'name' => 'A', 'pass_hash' => password_hash('jo-jelszo-1', PASSWORD_DEFAULT), 'role' => 'member', 'active' => 1, 'failed' => 0, 'created' => ft_now()]);
            App::$s['login_max_attempts'] = 2;
            $H = ft_handlers();
            $sess = $_SESSION ?? [];
            for ($i = 0; $i < 2; $i++) t_throws(fn() => $H['login'](['email' => 'a@b.hu', 'password' => 'rossz']));
            t_ok($db->val('SELECT locked_until FROM {users} WHERE email = ?', ['a@b.hu']) > ft_now(), 'zárolva');
            t_throws(fn() => $H['login'](['email' => 'a@b.hu', 'password' => 'jo-jelszo-1']), 'zárolás alatt jó jelszóval sem');
            $_SESSION = $sess;
        },
        'Teljes mentés → visszaállítás: minden tábla és fájl változatlanul visszajön' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $admin = t_user($db, 'admin', 'admin@x.hu'); t_as($admin);
            ft_comment_add(['entity' => 'person', 'entity_id' => $ids['I1'], 'body' => 'Árvíztűrő tükörfúrógép „idézőjel”']);
            ft_setting_set($db, 'site_title', 'Próba család');
            ft_setting_set($db, 'deepl_key', 'TITKOS-KULCS');
            $db->update('users', ['reset_hash' => str_repeat('a', 64), 'reset_until' => '2099-01-01 00:00:00'], (int)$admin['id']);
            $oldRoot = App::$root;
            App::$root = sys_get_temp_dir() . '/ftbak' . bin2hex(random_bytes(4));
            mkdir(App::$root . '/uploads/photos/2026', 0755, true); mkdir(App::$root . '/uploads/thumbs/2026', 0755, true);
            file_put_contents(App::$root . '/uploads/.htaccess', "php_flag engine off\n");
            $jpg = random_bytes(300000);                       // incompressible, like a real photo
            file_put_contents(App::$root . '/uploads/photos/2026/a.jpg', $jpg);
            file_put_contents(App::$root . '/uploads/thumbs/2026/a.jpg', 'kicsi');
            file_put_contents(App::$root . '/uploads/photos/2026/rossz.php', '<?php echo 1;');
            $phid = $db->insert('photos', ['file' => 'uploads/photos/2026/a.jpg', 'thumb' => 'uploads/thumbs/2026/a.jpg', 'w' => 10, 'h' => 10, 'status' => 'ok', 'created' => ft_now()]);
            $db->insert('photo_links', ['photo_id' => $phid, 'person_id' => $ids['I1'], 'fx' => 0.25, 'fy' => 0.75]);
            $sess = $_SESSION ?? [];
            try {
                $snap = function () use ($db) {
                    $o = [];
                    foreach (array_keys(ft_schema()) as $t) if (!in_array($t, ['audit', 'settings'], true)) $o[$t] = $db->all('SELECT * FROM {' . $t . '} ORDER BY id');
                    foreach ($o['users'] as &$u) { $u['reset_hash'] = $u['reset_until'] = $u['reset_sent'] = null; } unset($u);
                    $o['settings'] = $db->all("SELECT k, v FROM {settings} WHERE k NOT IN ('session_epoch', 'deepl_key') ORDER BY k");
                    return $o;
                };
                $before = $snap();
                $r = ft_backup_start();
                for ($i = 0; $i < 50 && empty($r['done']); $i++) $r = ft_backup_step();
                t_ok(!empty($r['done']), 'a mentés elkészült');
                $zip = App::$root . '/data/backups/' . $r['name'];
                $idx = ft_zip_index($zip);
                t_ok(isset($idx['manifest.json'], $idx['db/persons.json'], $idx['db/users.json'], $idx['db/settings.json'], $idx['uploads/photos/2026/a.jpg'], $idx['uploads/thumbs/2026/a.jpg']), 'minden benne van');
                t_ok(!isset($idx['uploads/photos/2026/rossz.php']) && !isset($idx['uploads/.htaccess']), 'szkript és .htaccess nem kerül bele');
                $set = ft_zip_extract($zip, 'db/settings.json', $idx['db/settings.json']);
                t_ok(!str_contains($set, 'TITKOS-KULCS'), 'a DeepL kulcs nincs a mentésben');
                t_ok(!str_contains(ft_zip_extract($zip, 'db/users.json', $idx['db/users.json']), str_repeat('a', 64)), 'jelszó-visszaállító token nincs a mentésben');
                $info = ft_backup_inspect($zip);
                t_eq([$info['files'], $info['manifest']['tables']['persons'], $info['blocking']], [2, count($before['persons']), false]);
                if (class_exists('ZipArchive')) {                // a standard tool must be able to open it too
                    $za = new ZipArchive(); t_eq($za->open($zip, ZipArchive::CHECKCONS), true, 'szabványos ZIP');
                    t_eq($za->getFromName('uploads/photos/2026/a.jpg') === $jpg, true); $za->close();
                }
                // everything changes…
                $db->q('DELETE FROM {persons} WHERE id = ?', [$ids['I3']]);
                $db->q('DELETE FROM {comments}');
                ft_setting_set($db, 'site_title', 'Elrontva');
                $db->insert('users', ['email' => 'uj@x.hu', 'name' => 'Új', 'pass_hash' => 'x', 'role' => 'admin', 'active' => 1, 'failed' => 0, 'created' => ft_now()]);
                unlink(App::$root . '/uploads/photos/2026/a.jpg');
                file_put_contents(App::$root . '/uploads/photos/2026/uj.jpg', 'új');
                $_SESSION = ['uid' => (int)$admin['id'], 'ep' => ''];
                // …and comes back
                $r = ft_restore_start(basename($zip));
                for ($i = 0; $i < 50 && empty($r['done']); $i++) $r = ft_backup_step();
                t_ok(!empty($r['done']), 'a visszaállítás lefutott');
                t_eq($snap(), $before, 'minden tábla a mentés szerinti');
                t_eq(file_get_contents(App::$root . '/uploads/photos/2026/a.jpg'), $jpg, 'a fotó bájtra azonos');
                t_ok(!is_file(App::$root . '/uploads/photos/2026/uj.jpg'), 'a mentés utáni fájl eltűnt');
                t_eq(file_get_contents(App::$root . '/uploads/.htaccess'), "php_flag engine off\n", 'az uploads védelme megmaradt');
                t_eq($db->val("SELECT v FROM {settings} WHERE k = 'deepl_key'"), null);
                t_ok(empty($_SESSION['uid']), 'mindenki újra belép');
                t_ok((string)App::$s['session_epoch'] !== '', 'a régi munkamenetek érvénytelenek');
                t_eq(ft_backup_job(), null, 'nem maradt félkész folyamat');
                t_eq(glob(App::$root . '/data/backups/.restore-*') ?: [], [], 'az ideiglenes mappa törölve');

                // a damaged file: nothing changes
                $bad = App::$root . '/data/backups/serult.zip'; copy($zip, $bad);
                $lh = ft_zip_index($bad)['uploads/photos/2026/a.jpg']['off'];
                $fh = fopen($bad, 'r+b'); fseek($fh, $lh + 30 + strlen('uploads/photos/2026/a.jpg') + 1000); fwrite($fh, 'XXXX'); fclose($fh);
                $db->q('DELETE FROM {comments}');
                try { $r = ft_restore_start('serult.zip'); for ($i = 0; $i < 50 && empty($r['done']); $i++) $r = ft_backup_step(); throw new FtAssert('sérült mentést visszaállított'); }
                catch (ApiError $e) { t_ok(str_contains($e->getMessage(), 'Ellenőrzőösszeg'), $e->getMessage()); }
                t_eq((int)$db->val('SELECT COUNT(*) FROM {comments}'), 0, 'sérült mentés után az adatbázis érintetlen');
                t_eq(file_get_contents(App::$root . '/uploads/photos/2026/a.jpg'), $jpg, 'sérült mentés után a fotók érintetlenek');
                t_eq(ft_backup_job(), null);

                // a hostile ZIP: path tricks and scripts are never unpacked; a newer schema is refused
                $evil = App::$root . '/data/backups/gonosz.zip'; $fh = fopen($evil, 'wb'); $c = [];
                ft_zip_put($fh, 'manifest.json', json_encode(['format' => FT_BACKUP_FORMAT, 'format_version' => 1, 'schema' => FT_SCHEMA_VERSION, 'tables' => ['users' => 1]]), $c);
                ft_zip_put($fh, 'db/users.json', ft_zip_extract($zip, 'db/users.json', $idx['db/users.json']), $c);
                ft_zip_put($fh, 'uploads/photos/../../hack.jpg', 'x', $c);
                ft_zip_put($fh, 'uploads/photos/2026/hack.php', 'x', $c);
                ft_zip_put($fh, 'uploads/photos/2026/ok.png', 'png', $c);
                ft_zip_finish($fh, $c); fclose($fh);
                t_eq(count(ft_backup_inspect($evil)['problems']), 1, 'figyelmeztet a tiltott fájlokra');
                $r = ft_restore_start('gonosz.zip'); for ($i = 0; $i < 50 && empty($r['done']); $i++) $r = ft_backup_step();
                t_ok(!is_file(App::$root . '/hack.jpg') && !is_file(sys_get_temp_dir() . '/hack.jpg') && !is_file(App::$root . '/uploads/photos/2026/hack.php'), 'nem írt a mappán kívülre, szkriptet sem');
                t_ok(is_file(App::$root . '/uploads/photos/2026/ok.png'));
                $new = App::$root . '/data/backups/ujabb.zip'; $fh = fopen($new, 'wb'); $c = [];
                ft_zip_put($fh, 'manifest.json', json_encode(['format' => FT_BACKUP_FORMAT, 'format_version' => 1, 'schema' => FT_SCHEMA_VERSION + 1, 'tables' => []]), $c);
                ft_zip_finish($fh, $c); fclose($fh);
                t_throws(fn() => ft_restore_start('ujabb.zip'), 'újabb szerkezetű mentést nem tölt vissza');
                t_throws(fn() => ft_backup_path('../config.php'), 'csak a mentések mappájából');

                // upload in chunks, with a resume
                $bytes = file_get_contents($zip); $id = bin2hex(random_bytes(8)); $tot = strlen($bytes); $cs = intdiv($tot, 3) + 1;
                $send = function (int $off) use ($bytes, $id, $tot, $cs) {
                    $tmp = tempnam(sys_get_temp_dir(), 'ch'); file_put_contents($tmp, substr($bytes, $off, $cs));
                    $_FILES['chunk'] = ['tmp_name' => $tmp, 'error' => UPLOAD_ERR_OK, 'size' => min($cs, $tot - $off)];
                    try { return ft_backup_upload_chunk(['id' => $id, 'offset' => $off, 'total' => $tot, 'name' => 'Péter mentése.zip']); } finally { @unlink($tmp); }
                };
                t_eq($send(0)['have'], $cs);
                t_eq($send(0)['have'], $cs, 'ismételt rész: a szerver megmondja, hol tart');
                $send($cs); $last = $send(2 * $cs);
                t_ok(!empty($last['done']) && str_starts_with($last['name'], 'feltoltott-'), 'összeállt');
                t_eq(md5_file(App::$root . '/data/backups/' . $last['name']), md5($bytes));
                unset($_FILES['chunk']);
                // keep only the newest N own backups
                App::$s['backup_keep'] = 1;
                foreach ([1, 2] as $k) { $r = ft_backup_start(); for ($i = 0; $i < 50 && empty($r['done']); $i++) $r = ft_backup_step(); $lastOwn = $r['name']; }
                t_eq(array_map('basename', glob(App::$root . '/data/backups/csaladfa-mentes-*.zip')), [$lastOwn], 'csak a legújabb saját mentés marad');
                t_ok(is_file(App::$root . '/data/backups/' . $last['name']), 'a feltöltöttet nem törli');
            } finally {
                $_SESSION = $sess;
                ft_rrmdir(App::$root);
                App::$root = $oldRoot;
            }
        },
        'Google / Facebook belépés: kapcsolás e-mail alapján, új tag jóváhagyással, hamisítás ellen' => function () {
            $db = t_fresh_db();
            $cfg = App::$cfg;
            App::$cfg = array_merge($cfg, ['google_id' => 'gid.apps', 'google_secret' => 'gsec', 'facebook_id' => 'fbid', 'facebook_secret' => 'fbsec']);
            $anna = t_user($db, 'member', 'anna@x.hu');
            $db->insert('users', ['email' => 'tilt@x.hu', 'name' => 'Tiltott', 'pass_hash' => 'x', 'role' => 'member', 'active' => 0, 'status' => 'disabled', 'failed' => 0, 'created' => ft_now()]);
            $sess = $_SESSION ?? [];
            $H = ft_handlers();
            $claims = []; $fbMe = []; $seen = [];
            $GLOBALS['ft_oauth_mock'] = function ($m, $url, $p) use (&$claims, &$fbMe, &$seen) {
                $seen[] = [$url, $p];
                if (str_contains($url, 'googleapis')) return ['id_token' => 'x.' . ft_b64url(json_encode($claims)) . '.sig', 'access_token' => 'at'];
                if (str_contains($url, 'oauth/access_token')) return ['access_token' => 'fbtok'];
                return $fbMe;
            };
            // one round trip: start → provider → callback; $mut may spoil the claims
            $google = function (array $c, ?callable $mut = null) use (&$claims) {
                $u = ft_oauth_start('google', App::loggedIn() ? 'link' : 'login', '#/person/5');
                parse_str((string)parse_url($u, PHP_URL_QUERY), $q);
                $claims = $c + ['iss' => 'https://accounts.google.com', 'aud' => 'gid.apps', 'exp' => time() + 300, 'nonce' => $_SESSION['oauth']['nonce'], 'email_verified' => true];
                if ($mut) $mut($claims);
                return ft_oauth_callback(['state' => $q['state'], 'code' => 'c1']);
            };
            try {
                $_SESSION = [];
                t_eq(ft_oauth_enabled(), ['google', 'facebook']);
                App::$s['oauth_facebook'] = false; t_eq(ft_oauth_enabled(), ['google'], 'kikapcsolható'); App::$s['oauth_facebook'] = true;
                $u = ft_oauth_start('google');
                t_ok(str_contains($u, 'client_id=gid.apps') && str_contains($u, 'code_challenge=') && str_contains($u, 'redirect_uri='), 'Google URL');
                t_ok(!str_contains($u, 'gsec'), 'a titkos kulcs nem megy a böngészőbe');
                // forged / replayed / expired callbacks
                t_throws(fn() => ft_oauth_callback(['state' => 'hamis', 'code' => 'c']), 'hamis state');
                t_eq($_SESSION['oauth'] ?? null, null, 'a state egyszer használható');
                ft_oauth_start('google'); $_SESSION['oauth']['t'] -= 700; $st = $_SESSION['oauth']['state'];
                t_throws(fn() => ft_oauth_callback(['state' => $st, 'code' => 'c']), 'lejárt');
                t_throws(fn() => $google(['sub' => 'g1', 'email' => 'anna@x.hu'], function (&$c) { $c['aud'] = 'masik-app'; }), 'más alkalmazásnak szóló azonosító');
                t_throws(fn() => $google(['sub' => 'g1', 'email' => 'anna@x.hu'], function (&$c) { $c['nonce'] = 'x'; }), 'rossz nonce');
                t_throws(fn() => $google(['sub' => 'g1', 'email' => 'anna@x.hu'], function (&$c) { $c['iss'] = 'https://evil.example'; }), 'rossz kibocsátó');
                t_throws(fn() => $google(['sub' => 'g1', 'email' => 'anna@x.hu'], function (&$c) { $c['email_verified'] = false; }), 'nem igazolt cím nem kapcsol meglévő taghoz');
                t_eq(App::$user, null, 'eddig senki nem lépett be');
                // a member with the same verified address: linked and logged in, PKCE verifier sent
                t_eq($google(['sub' => 'g1', 'email' => 'Anna@X.hu', 'name' => 'Anna']), '#/person/5');
                t_eq((int)App::uid(), (int)$anna['id']);
                t_eq((int)$db->val("SELECT user_id FROM {user_identities} WHERE provider = 'google' AND subject = 'g1'"), (int)$anna['id']);
                $tokCall = array_values(array_filter($seen, fn($x) => str_contains($x[0], 'googleapis')))[0][1];
                t_ok(strlen($tokCall['code_verifier']) > 40 && $tokCall['client_secret'] === 'gsec', 'PKCE + titok a szerverek között');
                // next time by the identity, even if the address changed at Google
                App::$user = null; $_SESSION = [];
                $google(['sub' => 'g1', 'email' => 'mas@gmail.com']);
                t_eq((int)App::uid(), (int)$anna['id'], 'az azonosító alapján lép be');
                // link Facebook while logged in; appsecret_proof sent
                $fbMe = ['id' => 'f9', 'name' => 'Anna F', 'email' => 'anna.fb@x.hu'];
                $u = ft_oauth_start('facebook', 'link'); parse_str((string)parse_url($u, PHP_URL_QUERY), $q);
                t_eq(ft_oauth_callback(['state' => $q['state'], 'code' => 'c']), '#/account?linked=facebook');
                $me = array_values(array_filter($seen, fn($x) => str_ends_with($x[0], '/me')))[0][1];
                t_eq($me['appsecret_proof'], hash_hmac('sha256', 'fbtok', 'fbsec'));
                t_eq(count(ft_oauth_mine()['linked']), 2);
                // somebody else cannot take over an identity that is already linked
                $bela = t_user($db, 'member', 'bela@x.hu'); t_as($bela); $_SESSION['uid'] = (int)$bela['id'];
                $u = ft_oauth_start('facebook', 'link'); parse_str((string)parse_url($u, PHP_URL_QUERY), $q);
                t_throws(fn() => ft_oauth_callback(['state' => $q['state'], 'code' => 'c']), 'másik taghoz kötött fiók');
                // a stranger: registration with approval, no password
                t_as(null); $_SESSION = [];
                t_eq($google(['sub' => 'g2', 'email' => 'uj@gmail.com', 'name' => 'Új Rokon']), '#/register?oauth=google');
                t_eq(App::$user, null, 'új ember nem lép be azonnal');
                t_eq(ft_oauth_pending_info()['email'], 'uj@gmail.com');
                $H['register.oauth'](['name' => 'Új Rokon', 'intro' => 'Anna unokája', 'email' => 'hamis@x.hu']);
                $nu = $db->row('SELECT * FROM {users} WHERE email = ?', ['uj@gmail.com']);
                t_ok($nu && !$nu['active'] && $nu['status'] === 'pending' && $nu['pass_hash'] === '', 'jóváhagyásra vár, jelszó nélkül; a Google-cím számít, nem a beírt');
                t_throws(fn() => $H['register.oauth'](['name' => 'X']), 'egyszer használható');
                t_eq($google(['sub' => 'g2', 'email' => 'uj@gmail.com']), '#/login?oauth=pending');
                t_eq(App::$user, null);
                t_throws(fn() => $H['login'](['email' => 'uj@gmail.com', 'password' => '']), 'üres jelszóval nem lehet belépni');
                $db->update('users', ['active' => 1, 'status' => 'ok'], (int)$nu['id']);
                $google(['sub' => 'g2', 'email' => 'uj@gmail.com']);
                t_eq((int)App::uid(), (int)$nu['id'], 'jóváhagyás után belép');
                // the only way in cannot be removed; after setting a password it can
                t_throws(fn() => ft_oauth_unlink('google'), 'az utolsó belépési mód marad');
                $H['password'](['new' => 'uj-jelszo-1']);
                App::$user = $db->row('SELECT * FROM {users} WHERE id = ?', [(int)$nu['id']]);
                t_ok(password_verify('uj-jelszo-1', App::$user['pass_hash']), 'jelszó beállítva régi nélkül');
                ft_oauth_unlink('google');
                t_eq((int)$db->val('SELECT COUNT(*) FROM {user_identities} WHERE user_id = ?', [(int)$nu['id']]), 0);
                // Facebook without e-mail (phone sign-up): must type an address
                t_as(null); $_SESSION = [];
                $fbMe = ['id' => 'f7', 'name' => 'Telefonos'];
                $u = ft_oauth_start('facebook'); parse_str((string)parse_url($u, PHP_URL_QUERY), $q);
                t_eq(ft_oauth_callback(['state' => $q['state'], 'code' => 'c']), '#/register?oauth=facebook');
                t_throws(fn() => $H['register.oauth'](['name' => 'Telefonos']), 'e-mail kell');
                t_throws(fn() => $H['register.oauth'](['name' => 'Telefonos', 'email' => 'anna@x.hu']), 'foglalt cím');
                $H['register.oauth'](['name' => 'Telefonos', 'email' => 'tel@x.hu']);
                t_ok((bool)$db->val('SELECT id FROM {users} WHERE email = ?', ['tel@x.hu']));
                // disabled member; registration switched off
                $_SESSION = [];
                t_throws(fn() => $google(['sub' => 'g3', 'email' => 'tilt@x.hu']), 'tiltott tag nem lép be');
                App::$s['allow_register'] = false; $_SESSION = [];
                t_throws(fn() => $google(['sub' => 'g4', 'email' => 'idegen@x.hu']), 'kikapcsolt regisztráció');
                // the user cancels at the provider
                $u = ft_oauth_start('google'); parse_str((string)parse_url($u, PHP_URL_QUERY), $q);
                t_throws(fn() => ft_oauth_callback(['state' => $q['state'], 'error' => 'access_denied']), 'megszakítva');
                // deleting a member removes the links
                t_as(t_user($db, 'admin'));
                $H['admin.user.delete'](['id' => (int)$anna['id']]);
                t_eq((int)$db->val('SELECT COUNT(*) FROM {user_identities} WHERE user_id = ?', [(int)$anna['id']]), 0);
            } finally {
                unset($GLOBALS['ft_oauth_mock']);
                App::$cfg = $cfg;
                $_SESSION = $sess;
            }
        },
        'Ugyanaz a pár nem lehet kétszer házas (dupla család ellen)' => function () {
            $db = t_fresh_db(); t_as(t_user($db, 'admin'));
            $a = ft_run_op('person.create', ['surname' => 'Csáki', 'given' => 'László', 'sex' => 'M'])['id'];
            $i = ft_run_op('person.create', ['surname' => 'Csáki', 'given' => 'István', 'sex' => 'M', 'rel' => ['type' => 'parent', 'of' => $a]])['id'];
            $g = ft_run_op('person.create', ['surname' => 'Kovács', 'given' => 'Ágnes', 'sex' => 'F', 'rel' => ['type' => 'parent', 'of' => $a]])['id'];
            t_eq((int)$db->val('SELECT COUNT(*) FROM {families} WHERE husband_id = ? AND wife_id = ?', [$i, $g]), 1, 'a két szülő egy családban');
            t_throws(fn() => ft_run_op('family.create', ['husband_id' => $i, 'wife_id' => $g]), 'második házasság ugyanazzal a párral');
            t_throws(fn() => ft_run_op('family.create', ['husband_id' => $g, 'wife_id' => $i]), 'fordított sorrendben sem');
            $solo = ft_run_op('family.create', ['husband_id' => $i])['id'];
            t_throws(fn() => ft_run_op('family.update', ['id' => $solo, 'wife_id' => $g]), 'utólag sem tehető kettőbe');
            t_eq((int)$db->val('SELECT COUNT(*) FROM {families} WHERE husband_id = ? AND wife_id = ?', [$i, $g]), 1);
        },
        'Rokon hozzáadása: másik szülő a házastársak közül, közös gyerekek új házastársnál' => function () {
            $db = t_fresh_db(); t_as(t_user($db, 'admin'));
            $kids = fn($fid) => array_map('intval', $db->col('SELECT person_id FROM {children} WHERE family_id = ? ORDER BY person_id', [$fid]));
            // László has only his father; the father already has a wife → "the other parent is her"
            $l = ft_run_op('person.create', ['surname' => 'Csáki', 'given' => 'László', 'sex' => 'M'])['id'];
            $i = ft_run_op('person.create', ['surname' => 'Csáki', 'given' => 'István', 'sex' => 'M', 'rel' => ['type' => 'parent', 'of' => $l]])['id'];
            $single = (int)$db->val('SELECT family_id FROM {children} WHERE person_id = ?', [$l]);
            $g = ft_run_op('person.create', ['surname' => 'Kovács', 'given' => 'Ágnes', 'sex' => 'F', 'rel' => ['type' => 'spouse', 'of' => $i]])['id'];
            $couple = (int)$db->val('SELECT id FROM {families} WHERE husband_id = ? AND wife_id = ?', [$i, $g]);
            ft_run_op('family.child_move', ['person_id' => $l, 'family_id' => $couple]);
            t_eq($kids($couple), [$l], 'László a közös családban');
            t_eq($db->val('SELECT id FROM {families} WHERE id = ?', [$single]), null, 'az egyszülős család megszűnt');
            // a new spouse with "common children": only children who had just this one parent move
            $p = ft_run_op('person.create', ['surname' => 'Nagy', 'given' => 'Péter', 'sex' => 'M'])['id'];
            $a = ft_run_op('person.create', ['surname' => 'Nagy', 'given' => 'Anna', 'sex' => 'F', 'rel' => ['type' => 'child', 'of' => $p]])['id'];
            $b = ft_run_op('person.create', ['surname' => 'Nagy', 'given' => 'Béla', 'sex' => 'M', 'rel' => ['type' => 'child', 'of' => $p]])['id'];
            $old = (int)$db->val('SELECT family_id FROM {children} WHERE person_id = ?', [$a]);
            $w = ft_run_op('person.create', ['surname' => 'Kis', 'given' => 'Éva', 'sex' => 'F', 'rel' => ['type' => 'spouse', 'of' => $p, 'children' => [$a]]])['id'];
            $pw = (int)$db->val('SELECT id FROM {families} WHERE husband_id = ? AND wife_id = ?', [$p, $w]);
            t_eq($kids($pw), [$a], 'Anna közös gyerek lett');
            t_eq($kids($old), [$b], 'Béla maradt egyszülős');
            t_throws(fn() => ft_run_op('person.create', ['surname' => 'X', 'given' => 'Y', 'sex' => 'F', 'rel' => ['type' => 'spouse', 'of' => $p, 'children' => [$l]]]), 'idegen gyerek nem lehet közös');
            // linking an existing spouse with common children
            $z = ft_run_op('person.create', ['surname' => 'Tóth', 'given' => 'Zita', 'sex' => 'F'])['id'];
            $pz = ft_run_op('family.create', ['husband_id' => $p, 'wife_id' => $z, 'children' => [$b]])['id'];
            t_eq($kids($pz), [$b], 'meglévő házastárs közös gyerekkel');
            t_eq($db->val('SELECT id FROM {families} WHERE id = ?', [$old]), null, 'kiürült egyszülős család törölve');
            // "only the mother's child": out of the couple's family into a family with just her
            $cp = ft_run_op('person.create', ['surname' => 'Cholnoky', 'given' => 'Péter', 'sex' => 'M'])['id'];
            $fe = ft_run_op('person.create', ['surname' => 'Ferenczy', 'given' => 'Éva', 'sex' => 'F', 'rel' => ['type' => 'spouse', 'of' => $cp]])['id'];
            $fam = (int)$db->val('SELECT id FROM {families} WHERE husband_id = ? AND wife_id = ?', [$cp, $fe]);
            $zs = ft_run_op('person.create', ['surname' => 'Cholnoky', 'given' => 'Zsuzsa', 'sex' => 'F', 'rel' => ['type' => 'child', 'family_id' => $fam]])['id'];
            $zo = ft_run_op('person.create', ['surname' => 'Zeke', 'given' => 'Zsófia', 'sex' => 'F', 'rel' => ['type' => 'child', 'family_id' => $fam]])['id'];
            $only = ft_run_op('family.child_single', ['family_id' => $fam, 'person_id' => $zo, 'parent_id' => $fe])['id'];
            t_eq($kids($fam), [$zs], 'Zsuzsa maradt közös');
            t_eq([$kids($only), (int)$db->val('SELECT wife_id FROM {families} WHERE id = ?', [$only]), $db->val('SELECT husband_id FROM {families} WHERE id = ?', [$only])], [[$zo], $fe, null], 'Zsófia csak Éva gyermeke');
            t_throws(fn() => ft_run_op('family.child_single', ['family_id' => $fam, 'person_id' => $zs, 'parent_id' => $p]), 'idegen szülő');
            // and back: common child again
            ft_run_op('family.child_move', ['person_id' => $zo, 'family_id' => $fam]);
            t_eq($kids($fam), [$zs, $zo]);
            t_eq($db->val('SELECT id FROM {families} WHERE id = ?', [$only]), null, 'az egyszülős család megszűnt');
            // a new father for one child of a single mother: the half-sibling keeps an unknown father
            $mo = ft_run_op('person.create', ['surname' => 'Zeke', 'given' => 'Éva', 'sex' => 'F'])['id'];
            $c1 = ft_run_op('person.create', ['surname' => 'Zeke', 'given' => 'Zsófia', 'sex' => 'F', 'rel' => ['type' => 'child', 'of' => $mo]])['id'];
            $c2 = ft_run_op('person.create', ['surname' => 'Zeke', 'given' => 'Ákos', 'sex' => 'M', 'rel' => ['type' => 'child', 'of' => $mo]])['id'];
            $c3 = ft_run_op('person.create', ['surname' => 'Zeke', 'given' => 'Bori', 'sex' => 'F', 'rel' => ['type' => 'child', 'of' => $mo]])['id'];
            $fa = ft_run_op('person.create', ['surname' => 'Zeke', 'given' => 'Tamás', 'sex' => 'M', 'rel' => ['type' => 'parent', 'of' => $c1, 'siblings' => [$c3]]])['id'];
            $par = fn($c) => array_map('intval', $db->col('SELECT x.pid FROM (SELECT f.husband_id pid FROM {children} c JOIN {families} f ON f.id = c.family_id WHERE c.person_id = ? UNION SELECT f.wife_id FROM {children} c JOIN {families} f ON f.id = c.family_id WHERE c.person_id = ?) x WHERE x.pid IS NOT NULL ORDER BY x.pid', [$c, $c]));
            t_eq([$par($c1), $par($c2), $par($c3)], [[$mo, $fa], [$mo], [$mo, $fa]], 'Ákos apja ismeretlen maradt, Bori megkapta');
        },
        'Elfelejtett jelszó: e-mailes link, lejárat, egyszeri használat' => function () {
            $db = t_fresh_db();
            $db->insert('users', ['email' => 'a@b.hu', 'name' => 'Anna', 'pass_hash' => password_hash('regi-jelszo', PASSWORD_DEFAULT), 'role' => 'member', 'active' => 1, 'failed' => 3, 'locked_until' => date('Y-m-d H:i:s', time() + 600), 'lang' => 'en', 'created' => ft_now()]);
            $db->insert('users', ['email' => 'p@b.hu', 'name' => 'Pál', 'pass_hash' => password_hash('x', PASSWORD_DEFAULT), 'role' => 'member', 'active' => 0, 'status' => 'pending', 'failed' => 0, 'created' => ft_now()]);
            $H = ft_handlers();
            $sess = $_SESSION ?? []; $_SESSION = [];
            $GLOBALS['ft_mail_sink'] = [];
            try {
                // unknown and pending addresses get the same answer, but no mail
                t_eq($H['pwreset.request'](['email' => 'nincs@b.hu']), ['ok' => true]);
                t_eq($H['pwreset.request'](['email' => 'p@b.hu']), ['ok' => true]);
                t_eq(count($GLOBALS['ft_mail_sink']), 0, 'nem létező / jóváhagyásra váró címre nem megy levél');
                t_eq($H['pwreset.request'](['email' => ' A@B.hu ']), ['ok' => true]);
                t_eq(count($GLOBALS['ft_mail_sink']), 1, 'egy levél ment');
                $m = $GLOBALS['ft_mail_sink'][0];
                t_eq($m['to'], 'a@b.hu');
                t_ok(preg_match('~#/reset/([0-9a-f]{48})~', $m['body'], $mm), 'link a levélben');
                $tok = $mm[1];
                t_ok(!$db->val('SELECT id FROM {users} WHERE reset_hash = ?', [$tok]), 'a token nyersen nincs az adatbázisban');
                // a second request right away does not send another mail (and keeps the first link valid)
                $H['pwreset.request'](['email' => 'a@b.hu']);
                t_eq(count($GLOBALS['ft_mail_sink']), 1, 'két percen belül nincs újabb levél');
                t_throws(fn() => $H['pwreset'](['token' => str_repeat('a', 48), 'password' => 'uj-jelszo-1']), 'rossz token');
                t_throws(fn() => $H['pwreset'](['token' => $tok, 'password' => 'rovid']), 'rövid jelszó');
                t_eq($H['pwreset'](['token' => $tok, 'check' => 1])['name'], 'Anna');
                $H['pwreset'](['token' => $tok, 'password' => 'uj-jelszo-1']);
                $u = $db->row('SELECT * FROM {users} WHERE email = ?', ['a@b.hu']);
                t_ok(password_verify('uj-jelszo-1', $u['pass_hash']), 'új jelszó él');
                t_eq($u['locked_until'], null, 'zárolás feloldva');
                t_eq((int)$_SESSION['uid'], (int)$u['id'], 'be is lépett');
                t_throws(fn() => $H['pwreset'](['token' => $tok, 'password' => 'masik-jelszo']), 'egyszer használható');
                // expiry
                $db->update('users', ['reset_sent' => null], (int)$u['id']);
                $H['pwreset.request'](['email' => 'a@b.hu']);
                preg_match('~#/reset/([0-9a-f]{48})~', end($GLOBALS['ft_mail_sink'])['body'], $mm);
                $db->update('users', ['reset_until' => date('Y-m-d H:i:s', time() - 1)], (int)$u['id']);
                t_throws(fn() => $H['pwreset'](['token' => $mm[1], 'password' => 'uj-jelszo-2']), 'lejárt link');
                // switched off
                App::$s['pw_reset'] = false;
                t_throws(fn() => $H['pwreset.request'](['email' => 'a@b.hu']), 'kikapcsolva');
            } finally {
                unset($GLOBALS['ft_mail_sink']);
                $_SESSION = $sess;
            }
        },
    ];
}

function ft_run_server_tests(string $only = ''): array
{
    $saved = ['db' => App::$db ?? null, 's' => App::$s, 'u' => App::$user, 'root' => App::$root];
    $sess = $_SESSION ?? [];
    $out = [];
    $note = null;
    if (!extension_loaded('pdo_sqlite')) {
        return ['results' => [['name' => 'pdo_sqlite', 'status' => 'skip', 'ms' => 0, 'msg' => 'A szerveren nincs pdo_sqlite, ezért az izolált adatbázis-tesztek nem futtathatók.']], 'note' => null];
    }
    // session_regenerate_id() in login tests must not touch the real session
    foreach (ft_server_tests() as $name => $fn) {
        if ($only && stripos($name, $only) === false) continue;
        $t0 = microtime(true);
        try {
            $r = $fn();
            $out[] = ['name' => $name, 'status' => $r === 'skip' ? 'skip' : 'pass', 'ms' => (microtime(true) - $t0) * 1000];
        } catch (Throwable $e) {
            $out[] = ['name' => $name, 'status' => 'fail', 'ms' => (microtime(true) - $t0) * 1000, 'msg' => $e->getMessage() . ($e instanceof FtAssert ? '' : ' (' . basename($e->getFile()) . ':' . $e->getLine() . ')')];
        } finally {
            if ($saved['db']) App::useDb($saved['db'], $saved['s']);
            App::$s = $saved['s']; App::$user = $saved['u']; App::$root = $saved['root'];
            App::flush();
        }
    }
    $_SESSION = $sess;
    return ['results' => $out, 'note' => $note];
}
