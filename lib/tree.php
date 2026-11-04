<?php
/**
 * In-memory family graph (a few thousand people fits easily).
 * persons[id] = row + by (birth year), dy (death year), fams[], famc[]
 * families[id] = row + children[]
 */
function ft_graph(): array
{
    return App::cache('graph', function () {
        $db = App::$db;
        $P = []; $F = [];
        foreach ($db->all('SELECT id, xref, given, surname, title, suffix, nickname, married_name, sex, deceased, photo_id, created_by FROM {persons}') as $r) {
            $r['id'] = (int)$r['id']; $r['deceased'] = (int)$r['deceased'];
            $r['by'] = null; $r['dy'] = null; $r['bsort'] = null; $r['bp'] = null; $r['dp'] = null; $r['bdate'] = null; $r['ddate'] = null;
            $r['fams'] = []; $r['famc'] = [];
            $P[$r['id']] = $r;
        }
        foreach ($db->all('SELECT id, husband_id, wife_id, photo_id, created_by FROM {families}') as $r) {
            $r['id'] = (int)$r['id'];
            $r['husband_id'] = $r['husband_id'] ? (int)$r['husband_id'] : null;
            $r['wife_id'] = $r['wife_id'] ? (int)$r['wife_id'] : null;
            $r['children'] = []; $r['my'] = null; $r['mdate'] = null; $r['mplace'] = null; $r['div'] = 0;
            $F[$r['id']] = $r;
            foreach (['husband_id', 'wife_id'] as $k) if ($r[$k] && isset($P[$r[$k]])) $P[$r[$k]]['fams'][] = $r['id'];
        }
        foreach ($db->all('SELECT family_id, person_id, rel FROM {children} ORDER BY sort, id') as $c) {
            $f = (int)$c['family_id']; $p = (int)$c['person_id'];
            if (!isset($F[$f]) || !isset($P[$p])) continue;
            $F[$f]['children'][] = $p;
            $P[$p]['famc'][] = $f;
            $P[$p]['rel'][$f] = $c['rel'];
        }
        $prio = ['BIRT' => 2, 'CHR' => 1, 'BAPM' => 1, 'DEAT' => 2, 'BURI' => 1, 'CREM' => 1];
        $best = [];
        foreach ($db->all("SELECT person_id, family_id, type, date_raw, y, sort, place FROM {events} WHERE type IN ('BIRT','CHR','BAPM','DEAT','BURI','CREM','MARR','DIV')") as $e) {
            if ($e['person_id'] && isset($P[(int)$e['person_id']])) {
                $pid = (int)$e['person_id'];
                $slot = in_array($e['type'], ['BIRT', 'CHR', 'BAPM'], true) ? 'b' : 'd';
                $pr = $prio[$e['type']] * 10 + ($e['y'] ? 1 : 0);
                if (!isset($best[$pid][$slot]) || $best[$pid][$slot] < $pr) {
                    $best[$pid][$slot] = $pr;
                    if ($slot === 'b') { $P[$pid]['by'] = $e['y'] ? (int)$e['y'] : null; $P[$pid]['bsort'] = $e['sort'] ? (int)$e['sort'] : null; $P[$pid]['bp'] = $e['place']; $P[$pid]['bdate'] = $e['date_raw']; }
                    else { $P[$pid]['dy'] = $e['y'] ? (int)$e['y'] : null; $P[$pid]['dp'] = $e['place']; $P[$pid]['ddate'] = $e['date_raw']; $P[$pid]['deceased'] = 1; }
                }
            } elseif ($e['family_id'] && isset($F[(int)$e['family_id']])) {
                $fid = (int)$e['family_id'];
                if ($e['type'] === 'MARR') { $F[$fid]['my'] = $e['y'] ? (int)$e['y'] : null; $F[$fid]['mdate'] = $e['date_raw']; $F[$fid]['mplace'] = $e['place']; }
                if ($e['type'] === 'DIV') $F[$fid]['div'] = 1;
            }
        }
        // children ordered by birth when known
        foreach ($F as &$f) {
            $order = $f['children'];
            usort($f['children'], function ($a, $b) use ($P, $order) {
                $x = $P[$a]['bsort']; $y = $P[$b]['bsort'];
                if ($x && $y && $x !== $y) return $x <=> $y;
                return array_search($a, $order) <=> array_search($b, $order);
            });
        }
        unset($f);
        $g = ['P' => $P, 'F' => $F];
        $g['est'] = ft_estimate_years($g);
        return $g;
    });
}

function ft_parents(array $g, int $pid): array
{
    $out = [];
    foreach ($g['P'][$pid]['famc'] ?? [] as $f) foreach (['husband_id', 'wife_id'] as $k) if ($g['F'][$f][$k]) $out[] = $g['F'][$f][$k];
    return $out;
}
function ft_spouses(array $g, int $pid): array
{
    $out = [];
    foreach ($g['P'][$pid]['fams'] ?? [] as $f) {
        $fam = $g['F'][$f];
        $o = $fam['husband_id'] === $pid ? $fam['wife_id'] : $fam['husband_id'];
        if ($o) $out[] = $o;
    }
    return $out;
}
function ft_children(array $g, int $pid): array
{
    $out = [];
    foreach ($g['P'][$pid]['fams'] ?? [] as $f) foreach ($g['F'][$f]['children'] as $c) $out[] = $c;
    return $out;
}

/** Birth-year estimates for people without one, propagated from relatives (±28 years per generation). */
function ft_estimate_years(array $g): array
{
    $est = [];
    foreach ($g['P'] as $id => $p) if ($p['by']) $est[$id] = $p['by'];
    for ($pass = 0; $pass < 8; $pass++) {
        $changed = false;
        foreach ($g['P'] as $id => $p) {
            if (isset($est[$id])) continue;
            $c = [];
            foreach ($g['P'][$id]['famc'] as $f) foreach (['husband_id', 'wife_id'] as $k) { $pp = $g['F'][$f][$k]; if ($pp && isset($est[$pp])) $c[] = $est[$pp] + 28; }
            foreach ($g['P'][$id]['fams'] as $f) {
                foreach ($g['F'][$f]['children'] as $ch) if (isset($est[$ch])) $c[] = $est[$ch] - 28;
                foreach (['husband_id', 'wife_id'] as $k) { $s = $g['F'][$f][$k]; if ($s && $s !== $id && isset($est[$s])) $c[] = $est[$s]; }
                if ($g['F'][$f]['my']) $c[] = $g['F'][$f]['my'] - 25;
            }
            if ($p['dy']) $c[] = $p['dy'] - 70;
            if ($c) { $est[$id] = (int)round(array_sum($c) / count($c)); $changed = true; }
        }
        if (!$changed) break;
    }
    return $est;
}

function ft_is_living(array $g, int $pid): bool
{
    $p = $g['P'][$pid] ?? null;
    if (!$p || $p['deceased']) return false;
    $y = $g['est'][$pid] ?? null;
    if ($y === null) return false; // no clue at all: treat as historical
    return (int)date('Y') - $y < (int)App::$s['living_years'];
}

/** Descendants of a root (incl. root) and, optionally, their spouses. */
function ft_branch_set(array $g, int $root, bool $spouses = true): array
{
    if (!isset($g['P'][$root])) return [];
    $set = [$root => true];
    $queue = [$root];
    while ($queue) {
        $id = array_shift($queue);
        foreach ($g['P'][$id]['fams'] as $f) {
            $fam = $g['F'][$f];
            if ($spouses) foreach (['husband_id', 'wife_id'] as $k) if ($fam[$k] && !isset($set[$fam[$k]])) $set[$fam[$k]] = 'spouse';
            foreach ($fam['children'] as $c) if (!isset($set[$c]) || $set[$c] === 'spouse') { $set[$c] = true; $queue[] = $c; }
        }
    }
    return $set;
}

/**
 * Everything "above" a root: its ancestors, the families they are partners in (incl. the root's own
 * birth family) and the people in those families – siblings, aunts, uncles, step-parents.
 * A family head may add new people and data here, but not change what is already there.
 */
function ft_above_zone(array $g, int $root): array
{
    $A = []; $AF = [];
    if (!isset($g['P'][$root])) return [$A, $AF];
    $anc = []; $queue = [$root];
    while ($queue) {
        $id = array_shift($queue);
        foreach ($g['P'][$id]['famc'] as $f) {
            $AF[$f] = true;
            foreach (['husband_id', 'wife_id'] as $k) { $x = $g['F'][$f][$k]; if ($x && !isset($anc[$x]) && $x !== $root) { $anc[$x] = true; $queue[] = $x; } }
        }
    }
    foreach ($anc as $id => $v) foreach ($g['P'][$id]['fams'] as $f) $AF[$f] = true;
    foreach ($AF as $f => $v) {
        $fam = $g['F'][$f];
        foreach (['husband_id', 'wife_id'] as $k) if ($fam[$k]) $A[$fam[$k]] = true;
        foreach ($fam['children'] as $c) $A[$c] = true;
    }
    unset($A[$root]);
    return [$A, $AF];
}

/** Persons + families a user may treat as "their branch". */
function ft_user_branch(?int $uid): array
{
    if (!$uid) return ['P' => [], 'F' => []];
    return App::cache('branch_' . $uid, function () use ($uid) {
        $g = ft_graph();
        $P = [];
        foreach (App::$db->col('SELECT person_id FROM {branches} WHERE user_id = ?', [$uid]) as $root) {
            foreach (ft_branch_set($g, (int)$root, (bool)App::$s['branch_spouses']) as $id => $v) $P[$id] = (($P[$id] ?? null) === true) ? true : $v;
        }
        // the zone above the roots: ancestors, their families, and everyone in those families (siblings, aunts…)
        $A = []; $AF = [];
        foreach (App::$db->col('SELECT person_id FROM {branches} WHERE user_id = ?', [$uid]) as $root) {
            [$za, $zf] = ft_above_zone($g, (int)$root);
            $A += $za; $AF += $zf;
        }
        foreach ($g['P'] as $id => $p) if ((int)$p['created_by'] === $uid && !isset($A[$id])) $P[$id] = true;
        foreach ($P as $id => $v) unset($A[$id]);
        $F = [];
        foreach ($g['F'] as $fid => $f) {
            $h = $f['husband_id']; $w = $f['wife_id'];
            // a family belongs to the branch if a branch member (not just an in-law) is a partner, or the user created it
            $isCore = fn($x) => $x && (($P[$x] ?? null) === true);
            if ($isCore($h) || $isCore($w) || ((int)$f['created_by'] === $uid && !isset($AF[$fid]))) $F[$fid] = true;
        }
        foreach ($F as $fid => $v) unset($AF[$fid]);
        return ['P' => $P, 'F' => $F, 'A' => $A, 'AF' => $AF];
    });
}

/** Display name for server-side summaries. */
function ft_name(array $p): string
{
    $parts = App::$s['name_order'] === 'west' ? [$p['given'] ?? '', $p['surname'] ?? ''] : [$p['surname'] ?? '', $p['given'] ?? ''];
    $n = trim(($p['title'] ? $p['title'] . ' ' : '') . implode(' ', array_filter($parts)));
    return $n !== '' ? $n : 'Névtelen';
}
