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
        'Életrajzok → sztorik: névvel, évekkel, személyhez kötve, ismételhetően' => function () {
            $db = t_fresh_db(); $ids = t_import($db);
            $db->update('persons', ['notes' => str_repeat('Hosszú életrajz. ', 10)], $ids['I3']);
            $r = ft_notes_to_stories(80);
            t_eq([$r['created'], $r['short']], [1, 1], 'a rövid jegyzet (I1) nem lesz sztori');
            $st = $db->row("SELECT * FROM {stories} WHERE source = 'note:I3'");
            t_eq($st['title'], 'Nagy Péter (sz. 1930)');
            t_eq((int)$st['y'], 1930);
            t_eq((int)$db->val('SELECT person_id FROM {story_links} WHERE story_id = ?', [(int)$st['id']]), $ids['I3']);
            t_eq(ft_notes_to_stories(80)['created'], 0, 'második futás');
            t_eq(ft_notes_to_stories(10)['created'], 1, 'alacsonyabb határral a rövidebb is');
            t_eq($db->val("SELECT title FROM {stories} WHERE source = 'note:I1'"), 'Dr. Nagy János (1900–1970)');
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
