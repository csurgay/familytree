<?php
const FT_INDI_EVENTS = ['BIRT', 'CHR', 'BAPM', 'DEAT', 'BURI', 'CREM', 'ADOP', 'CONF', 'FCOM', 'GRAD', 'EDUC', 'OCCU', 'RESI', 'EMIG', 'IMMI', 'NATU', 'RETI', 'EVEN', 'RELI', 'TITL'];
const FT_FAM_EVENTS = ['MARR', 'DIV', 'ENGA', 'MARB', 'MARC', 'ANUL', 'DIVF', 'EVEN'];
const FT_TITLES = ['dr.', 'dr', 'id.', 'ifj.', 'özv.', 'prof.', 'vitéz', 'gróf', 'báró', 'br.', 'gr.', 'sir', 'mr.', 'mrs.', 'ing.', 'phd', 'id', 'ifj'];

function ft_clean_text(string $s): string
{
    // TribalPages writes ő/ű as numeric entities
    $s = preg_replace('#<br\s*/?>#i', "\n", $s);
    // Hungarian text that went through Latin-1 somewhere: õ/û never occur in Hungarian, they are ő/ű
    $s = strtr($s, ['õ' => 'ő', 'Õ' => 'Ő', 'û' => 'ű', 'Û' => 'Ű']);
    return html_entity_decode($s, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

/** Parse GEDCOM text into a list of level-0 records: ['xref','tag','value','sub'=>[...]] */
function ft_gedcom_parse(string $text): array
{
    if (str_starts_with($text, "\xEF\xBB\xBF")) $text = substr($text, 3);
    if (!mb_check_encoding($text, 'UTF-8')) $text = mb_convert_encoding($text, 'UTF-8', 'Windows-1250');
    $nodes = []; $kids = []; $at = []; $roots = [];
    foreach (preg_split('/\r\n|\r|\n/', $text) as $line) {
        if (trim($line) === '') continue;
        if (!preg_match('/^\s*(\d+)\s+(?:(@[^@]+@)\s+)?(\S+)(?: (.*))?$/u', $line, $m)) continue;
        $lvl = (int)$m[1];
        $tag = strtoupper($m[3]);
        $val = $m[4] ?? '';
        if (($tag === 'CONC' || $tag === 'CONT') && $lvl > 0 && isset($at[$lvl - 1])) {
            $nodes[$at[$lvl - 1]]['value'] .= ($tag === 'CONT' ? "\n" : '') . $val;
            continue;
        }
        while ($lvl > 0 && !isset($at[$lvl - 1])) $lvl--;
        $i = count($nodes);
        $nodes[$i] = ['xref' => $m[2] !== '' ? trim($m[2], '@') : null, 'tag' => $tag, 'value' => $val];
        if ($lvl === 0) $roots[] = $i; else $kids[$at[$lvl - 1]][] = $i;
        $at[$lvl] = $i;
        foreach (array_keys($at) as $k) if ($k > $lvl) unset($at[$k]);
    }
    $build = function ($i) use (&$build, &$nodes, &$kids) {
        $n = $nodes[$i];
        $n['sub'] = array_map($build, $kids[$i] ?? []);
        return $n;
    };
    return array_map($build, $roots);
}

function ft_sub(array $node, string $tag): ?array
{
    foreach ($node['sub'] as $s) if ($s['tag'] === $tag) return $s;
    return null;
}
function ft_subval(array $node, string $tag): string
{
    $s = ft_sub($node, $tag);
    return $s ? ft_clean_text(trim($s['value'])) : '';
}

/** "Árpád István /Csurgay/ Dr." → parts */
function ft_parse_name(string $v): array
{
    $v = ft_clean_text(trim($v));
    $given = $v; $surname = ''; $after = '';
    if (preg_match('#^(.*?)/(.*?)/(.*)$#u', $v, $m)) { $given = trim($m[1]); $surname = trim($m[2]); $after = trim($m[3]); }
    $title = []; $suffix = [];
    foreach (preg_split('/\s+/u', $after, -1, PREG_SPLIT_NO_EMPTY) as $tok) {
        if (in_array(mb_strtolower($tok), FT_TITLES, true)) $title[] = $tok;
        elseif (preg_match('/^[bd]\.\d{3,4}$/i', $tok)) continue; // TribalPages disambiguation (b.1928 / d.1919)
        else $suffix[] = $tok;
    }
    // titles written before the given name
    $gt = preg_split('/\s+/u', $given, -1, PREG_SPLIT_NO_EMPTY);
    while ($gt && in_array(mb_strtolower($gt[0]), FT_TITLES, true)) $title[] = array_shift($gt);
    $given = implode(' ', $gt);
    if ($given === '???' || $given === '?') $given = '';
    if ($surname === '???' || $surname === '?') $surname = '';
    return ['given' => $given, 'surname' => $surname, 'title' => implode(' ', $title), 'suffix' => implode(' ', $suffix)];
}

/**
 * Import parsed records. $mode: 'replace' wipes genealogy tables first; 'add' skips xrefs already present.
 * Returns stats.
 */
function ft_gedcom_import(DB $db, array $records, string $mode = 'replace', ?int $userId = null): array
{
    $now = ft_now();
    $stats = ['persons' => 0, 'families' => 0, 'events' => 0, 'sources' => 0, 'skipped' => 0];
    return $db->inTx(function () use ($db, $records, $mode, $userId, $now, &$stats) {
        if ($mode === 'replace') {
            foreach (['persons', 'families', 'children', 'events', 'sources', 'story_links', 'branches'] as $t) $db->q("DELETE FROM {{$t}}");
            $db->q('DELETE FROM {photo_links} WHERE person_id IS NOT NULL OR family_id IS NOT NULL');
            $db->q('DELETE FROM {pins} WHERE kind IN (\'person\',\'tree\',\'event\')');
        }
        $existingP = $mode === 'add' ? array_flip(array_filter($db->col('SELECT xref FROM {persons}'))) : [];
        $existingF = $mode === 'add' ? array_flip(array_filter($db->col('SELECT xref FROM {families}'))) : [];
        $pmap = [];
        if ($mode === 'add') foreach ($db->all('SELECT id, xref FROM {persons} WHERE xref IS NOT NULL') as $r) $pmap[$r['xref']] = (int)$r['id'];

        $addEvent = function (array $ev, ?int $pid, ?int $fid) use ($db, $userId, $now, &$stats) {
            $date = ft_subval($ev, 'DATE');
            $place = ft_subval($ev, 'PLAC');
            $note = ft_subval($ev, 'NOTE');
            $label = ft_clean_text(trim($ev['value']));
            $type = ft_subval($ev, 'TYPE');
            if ($ev['tag'] === 'EVEN' && $type) $label = $type . ($label && $label !== 'Y' ? ': ' . $label : '');
            if ($label === 'Y') $label = '';
            if ($date === '' && $place === '' && $note === '' && $label === '') return false;
            $p = ft_parse_date($date);
            $db->insert('events', [
                'person_id' => $pid, 'family_id' => $fid, 'type' => $ev['tag'], 'label' => mb_substr($label, 0, 120),
                'date_raw' => $p['raw'] ?? null, 'y' => $p['y'] ?? null, 'm' => $p['m'] ?? null, 'd' => $p['d'] ?? null,
                'qual' => $p['qual'] ?? null, 'sort' => $p['sort'] ?? null, 'place' => $place ?: null, 'note' => $note ?: null,
                'created_by' => $userId, 'created' => $now, 'updated' => $now]);
            $stats['events']++;
            return true;
        };

        foreach ($records as $r) {
            if ($r['tag'] === 'SOUR' && $r['xref']) {
                $db->insert('sources', ['xref' => $r['xref'], 'title' => ft_subval($r, 'TITL'), 'author' => ft_subval($r, 'AUTH'),
                    'publ' => ft_subval($r, 'PUBL'), 'abbr' => ft_subval($r, 'ABBR'), 'text' => ft_subval($r, 'TEXT') ?: null,
                    'type' => ($ref = ft_sub($r, 'REFN')) ? ft_subval($ref, 'TYPE') : '']);
                $stats['sources']++;
            }
            if ($r['tag'] !== 'INDI') continue;
            if (isset($existingP[$r['xref']])) { $stats['skipped']++; continue; }
            $nameNode = ft_sub($r, 'NAME');
            $n = ft_parse_name($nameNode['value'] ?? '');
            $nick = '';
            $married = '';
            if ($nameNode) {
                if ($v = ft_subval($nameNode, 'GIVN')) $n['given'] = $v;
                if ($v = ft_subval($nameNode, 'SURN')) $n['surname'] = $v;
                if ($v = ft_subval($nameNode, 'NPFX')) $n['title'] = $v;
                if ($v = ft_subval($nameNode, 'NSFX')) $n['suffix'] = $v;
                $nick = ft_subval($nameNode, 'NICK');
                $married = ft_subval($nameNode, '_MARNM');
            }
            $notes = []; $extra = [];
            $deceased = 0;
            $sex = strtoupper(ft_subval($r, 'SEX'));
            foreach ($r['sub'] as $s) {
                if ($s['tag'] === 'NOTE') { $v = ft_clean_text(trim($s['value'])); if ($v !== '' && $v[0] !== '@') $notes[] = $v; }
                elseif ($s['tag'] === 'DEAT') $deceased = 1;
                elseif (in_array($s['tag'], ['NAME', 'SEX', 'FAMS', 'FAMC', 'CHAN', 'OBJE', 'SOUR', 'RIN', '_UID', 'UID'], true) || in_array($s['tag'], FT_INDI_EVENTS, true)) continue;
                elseif ($s['tag'] === 'ADDR' && trim($s['value']) === '' && !$s['sub']) continue;
                else $extra[] = [$s['tag'], ft_clean_text(trim($s['value']))];
            }
            $pid = $db->insert('persons', [
                'xref' => $r['xref'], 'given' => $n['given'], 'surname' => $n['surname'], 'title' => $n['title'] ?: null,
                'suffix' => $n['suffix'] ?: null, 'nickname' => $nick ?: null, 'married_name' => $married ?: null,
                'sex' => in_array($sex, ['M', 'F'], true) ? $sex : 'U', 'deceased' => $deceased,
                'notes' => $notes ? implode("\n\n", $notes) : null, 'extra' => $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null,
                'created_by' => $userId, 'created' => $now, 'updated' => $now]);
            $pmap[$r['xref']] = $pid;
            $stats['persons']++;
            foreach ($r['sub'] as $s) if (in_array($s['tag'], FT_INDI_EVENTS, true)) $addEvent($s, $pid, null);
        }

        foreach ($records as $r) {
            if ($r['tag'] !== 'FAM') continue;
            if (isset($existingF[$r['xref']])) { $stats['skipped']++; continue; }
            $h = trim(ft_subval($r, 'HUSB'), '@'); $w = trim(ft_subval($r, 'WIFE'), '@');
            $notes = []; $extra = [];
            foreach ($r['sub'] as $s) {
                if ($s['tag'] === 'NOTE') { $v = ft_clean_text(trim($s['value'])); if ($v !== '') $notes[] = $v; }
                elseif (in_array($s['tag'], ['HUSB', 'WIFE', 'CHIL', 'CHAN', 'OBJE', 'SOUR', 'RIN', '_UID'], true) || in_array($s['tag'], FT_FAM_EVENTS, true)) continue;
                else $extra[] = [$s['tag'], ft_clean_text(trim($s['value']))];
            }
            $fid = $db->insert('families', [
                'xref' => $r['xref'], 'husband_id' => $pmap[$h] ?? null, 'wife_id' => $pmap[$w] ?? null,
                'notes' => $notes ? implode("\n\n", $notes) : null, 'extra' => $extra ? json_encode($extra, JSON_UNESCAPED_UNICODE) : null,
                'created_by' => $userId, 'created' => $now, 'updated' => $now]);
            $stats['families']++;
            $i = 0;
            foreach ($r['sub'] as $s) {
                if ($s['tag'] === 'CHIL') {
                    $cx = trim($s['value'], '@');
                    if (isset($pmap[$cx])) {
                        $pedi = strtolower(ft_subval($s, '_FREL') ?: ft_subval($s, 'PEDI'));
                        $db->insert('children', ['family_id' => $fid, 'person_id' => $pmap[$cx], 'sort' => $i++,
                            'rel' => in_array($pedi, ['adopted', 'foster', 'step'], true) ? $pedi : 'birth']);
                    }
                } elseif (in_array($s['tag'], FT_FAM_EVENTS, true)) {
                    if (!$addEvent($s, null, $fid) && $s['tag'] !== 'EVEN') {
                        // bare "1 MARR" / "1 DIV" carries meaning even without details
                        $db->insert('events', ['family_id' => $fid, 'type' => $s['tag'], 'created_by' => $userId, 'created' => $now, 'updated' => $now]);
                        $stats['events']++;
                    }
                }
            }
        }
        return $stats;
    });
}

function ft_ged_line(int $lvl, string $tag, ?string $val = null, ?string $xref = null): string
{
    $out = '';
    $val = $val === null ? null : str_replace("\r", '', $val);
    if ($val !== null && str_contains($val, "\n")) {
        $parts = explode("\n", $val);
        $out .= ft_ged_line($lvl, $tag, array_shift($parts), $xref);
        foreach ($parts as $p) $out .= ft_ged_line($lvl + 1, 'CONT', $p);
        return $out;
    }
    $head = $lvl . ($xref ? " @$xref@" : '') . ' ' . $tag;
    if ($val === null || $val === '') return $head . "\n";
    $chunks = [];
    while (mb_strlen($val) > 200) {
        $cut = 200;
        // avoid splitting on a space (CONC joins without one)
        while ($cut > 1 && mb_substr($val, $cut - 1, 1) === ' ') $cut--;
        $chunks[] = mb_substr($val, 0, $cut);
        $val = mb_substr($val, $cut);
    }
    $chunks[] = $val;
    $out = $head . ' ' . array_shift($chunks) . "\n";
    foreach ($chunks as $c) $out .= ($lvl + 1) . ' CONC ' . $c . "\n";
    return $out;
}

function ft_gedcom_export(DB $db, string $baseUrl = ''): string
{
    $o = ft_ged_line(0, 'HEAD') . ft_ged_line(1, 'SOUR', 'FAMILYTREE') . ft_ged_line(2, 'NAME', 'Családfa webapp')
        . ft_ged_line(1, 'DATE', strtoupper(date('d M Y'))) . ft_ged_line(1, 'GEDC') . ft_ged_line(2, 'VERS', '5.5.1')
        . ft_ged_line(2, 'FORM', 'LINEAGE-LINKED') . ft_ged_line(1, 'CHAR', 'UTF-8');
    $px = fn($id) => 'I' . $id;
    $fx = fn($id) => 'F' . $id;
    $events = [];
    foreach ($db->all('SELECT * FROM {events} ORDER BY sort IS NULL, sort, id') as $e) {
        if ($e['person_id']) $events['p'][$e['person_id']][] = $e;
        if ($e['family_id']) $events['f'][$e['family_id']][] = $e;
    }
    $photos = [];
    foreach ($db->all('SELECT l.person_id, l.family_id, p.file, p.title FROM {photo_links} l JOIN {photos} p ON p.id = l.photo_id WHERE p.status = \'ok\'') as $ph) {
        if ($ph['person_id']) $photos['p'][$ph['person_id']][] = $ph;
        if ($ph['family_id']) $photos['f'][$ph['family_id']][] = $ph;
    }
    $famc = []; $fams = [];
    foreach ($db->all('SELECT family_id, person_id, rel FROM {children} ORDER BY sort') as $c) $famc[$c['person_id']][] = $c;
    $fams_rows = $db->all('SELECT * FROM {families} ORDER BY id');
    foreach ($fams_rows as $f) { if ($f['husband_id']) $fams[$f['husband_id']][] = $f['id']; if ($f['wife_id']) $fams[$f['wife_id']][] = $f['id']; }
    $children = [];
    foreach ($db->all('SELECT family_id, person_id, rel FROM {children} ORDER BY sort') as $c) $children[$c['family_id']][] = $c;

    $evOut = function (array $e, int $lvl = 1) {
        $tag = $e['type'] ?: 'EVEN';
        $s = '';
        $val = $e['label'] ?? '';
        if ($tag === 'EVEN' && $val !== '') {
            [$typ, $rest] = array_pad(explode(': ', $val, 2), 2, '');
            $s .= ft_ged_line($lvl, $tag, $rest) . ft_ged_line($lvl + 1, 'TYPE', $typ);
        } else {
            $s .= ft_ged_line($lvl, $tag, $val !== '' ? $val : (empty($e['date_raw']) && empty($e['place']) ? 'Y' : null));
        }
        if (!empty($e['date_raw'])) $s .= ft_ged_line($lvl + 1, 'DATE', $e['date_raw']);
        if (!empty($e['place'])) $s .= ft_ged_line($lvl + 1, 'PLAC', $e['place']);
        if (!empty($e['note'])) $s .= ft_ged_line($lvl + 1, 'NOTE', $e['note']);
        return $s;
    };
    $objOut = function (array $ph) use ($baseUrl) {
        return ft_ged_line(1, 'OBJE') . ft_ged_line(2, 'FILE', rtrim($baseUrl, '/') . '/' . $ph['file']) . ft_ged_line(3, 'FORM', 'jpg')
            . ($ph['title'] ? ft_ged_line(2, 'TITL', $ph['title']) : '');
    };

    foreach ($db->all('SELECT * FROM {persons} ORDER BY id') as $p) {
        $o .= ft_ged_line(0, 'INDI', null, $px($p['id']));
        $o .= ft_ged_line(1, 'NAME', trim(($p['given'] ?? '') . ' /' . ($p['surname'] ?? '') . '/ ' . ($p['suffix'] ?? '')));
        if ($p['given']) $o .= ft_ged_line(2, 'GIVN', $p['given']);
        if ($p['surname']) $o .= ft_ged_line(2, 'SURN', $p['surname']);
        if ($p['title']) $o .= ft_ged_line(2, 'NPFX', $p['title']);
        if ($p['suffix']) $o .= ft_ged_line(2, 'NSFX', $p['suffix']);
        if ($p['nickname']) $o .= ft_ged_line(2, 'NICK', $p['nickname']);
        if ($p['married_name']) $o .= ft_ged_line(2, '_MARNM', $p['married_name']);
        $o .= ft_ged_line(1, 'SEX', $p['sex'] ?: 'U');
        $hasDeat = false;
        foreach ($events['p'][$p['id']] ?? [] as $e) { $o .= $evOut($e); if ($e['type'] === 'DEAT') $hasDeat = true; }
        if ($p['deceased'] && !$hasDeat) $o .= ft_ged_line(1, 'DEAT', 'Y');
        if ($p['notes']) $o .= ft_ged_line(1, 'NOTE', $p['notes']);
        foreach (json_decode($p['extra'] ?? '[]', true) ?: [] as $x) $o .= ft_ged_line(1, $x[0], $x[1]);
        foreach ($photos['p'][$p['id']] ?? [] as $ph) $o .= $objOut($ph);
        foreach ($famc[$p['id']] ?? [] as $c) {
            $o .= ft_ged_line(1, 'FAMC', '@' . $fx($c['family_id']) . '@');
            if ($c['rel'] && $c['rel'] !== 'birth') $o .= ft_ged_line(2, 'PEDI', $c['rel']);
        }
        foreach ($fams[$p['id']] ?? [] as $f) $o .= ft_ged_line(1, 'FAMS', '@' . $fx($f) . '@');
    }
    foreach ($fams_rows as $f) {
        $o .= ft_ged_line(0, 'FAM', null, $fx($f['id']));
        if ($f['husband_id']) $o .= ft_ged_line(1, 'HUSB', '@' . $px($f['husband_id']) . '@');
        if ($f['wife_id']) $o .= ft_ged_line(1, 'WIFE', '@' . $px($f['wife_id']) . '@');
        foreach ($children[$f['id']] ?? [] as $c) $o .= ft_ged_line(1, 'CHIL', '@' . $px($c['person_id']) . '@');
        foreach ($events['f'][$f['id']] ?? [] as $e) $o .= $evOut($e);
        if ($f['notes']) $o .= ft_ged_line(1, 'NOTE', $f['notes']);
        foreach (json_decode($f['extra'] ?? '[]', true) ?: [] as $x) $o .= ft_ged_line(1, $x[0], $x[1]);
        foreach ($photos['f'][$f['id']] ?? [] as $ph) $o .= $objOut($ph);
    }
    foreach ($db->all('SELECT * FROM {sources} ORDER BY id') as $s) {
        $o .= ft_ged_line(0, 'SOUR', null, $s['xref'] ?: 'S' . $s['id']);
        foreach (['ABBR' => 'abbr', 'TITL' => 'title', 'AUTH' => 'author', 'PUBL' => 'publ', 'TEXT' => 'text'] as $t => $c)
            if (!empty($s[$c])) $o .= ft_ged_line(1, $t, $s[$c]);
    }
    return $o . "0 TRLR\n";
}
