<?php
/**
 * Every data change is an "op". The op declares what it touches (targets) and how to apply it.
 * ft_run_op() decides – via ft_mode() – whether it is applied directly or queued for admin approval.
 */
const FT_EVENT_TYPES = [
    'BIRT' => 'Születés', 'CHR' => 'Keresztelő', 'BAPM' => 'Keresztség', 'DEAT' => 'Halál', 'BURI' => 'Temetés',
    'CREM' => 'Hamvasztás', 'MARR' => 'Esküvő', 'ENGA' => 'Eljegyzés', 'DIV' => 'Válás', 'ADOP' => 'Örökbefogadás',
    'CONF' => 'Konfirmáció', 'FCOM' => 'Elsőáldozás', 'GRAD' => 'Diploma', 'EDUC' => 'Tanulmányok', 'OCCU' => 'Foglalkozás',
    'RESI' => 'Lakóhely', 'EMIG' => 'Kivándorlás', 'IMMI' => 'Bevándorlás', 'NATU' => 'Honosítás', 'RETI' => 'Nyugdíjba vonulás',
    'RELI' => 'Vallás', 'TITL' => 'Cím, rang', 'MARB' => 'Jegyesség kihirdetése', 'MARC' => 'Házassági szerződés',
    'ANUL' => 'Érvénytelenítés', 'DIVF' => 'Válókereset', 'EVEN' => 'Egyéb esemény',
];

function ft_err(string $m, int $code = 422): ApiError { return new ApiError($m, $code); }
function ft_int($v): ?int { return ($v === null || $v === '' || $v === false) ? null : (int)$v; }
function ft_str($v, int $max = 255): ?string { $v = trim((string)($v ?? '')); return $v === '' ? null : mb_substr($v, 0, $max); }

function ft_person_row(int $id): array
{
    $r = App::$db->row('SELECT * FROM {persons} WHERE id = ?', [$id]);
    if (!$r) throw ft_err('Nincs ilyen személy (#' . $id . ').', 404);
    return $r;
}
function ft_family_row(int $id): array
{
    $r = App::$db->row('SELECT * FROM {families} WHERE id = ?', [$id]);
    if (!$r) throw ft_err('Nincs ilyen család (#' . $id . ').', 404);
    return $r;
}

/** Set (or clear) the main BIRT/DEAT/MARR event of a person or family. */
function ft_set_vital(?int $pid, ?int $fid, string $type, ?string $date, ?string $place, bool $keepEmpty = false): void
{
    $db = App::$db;
    $col = $pid ? 'person_id' : 'family_id';
    $id = $pid ?: $fid;
    $ev = $db->row("SELECT * FROM {events} WHERE $col = ? AND type = ? ORDER BY id LIMIT 1", [$id, $type]);
    $date = ft_str($date, 80); $place = ft_str($place);
    if (!$date && !$place && !$keepEmpty) {
        if ($ev && !$ev['note'] && !$ev['label']) $db->delete('events', (int)$ev['id']);
        elseif ($ev) $db->update('events', ['date_raw' => null, 'y' => null, 'm' => null, 'd' => null, 'qual' => null, 'sort' => null, 'place' => null, 'updated' => ft_now()], (int)$ev['id']);
        return;
    }
    $p = ft_parse_date($date);
    $data = ['date_raw' => $p['raw'] ?? null, 'y' => $p['y'] ?? null, 'm' => $p['m'] ?? null, 'd' => $p['d'] ?? null,
        'qual' => $p['qual'] ?? null, 'sort' => $p['sort'] ?? null, 'place' => $place, 'updated' => ft_now()];
    if ($ev) $db->update('events', $data, (int)$ev['id']);
    else $db->insert('events', $data + [$col => $id, 'type' => $type, 'created_by' => App::uid(), 'created' => ft_now()]);
}

function ft_person_data(array $p): array
{
    $d = [];
    foreach (['given' => 120, 'surname' => 120, 'title' => 40, 'suffix' => 40, 'nickname' => 80, 'married_name' => 160] as $k => $max)
        if (array_key_exists($k, $p)) $d[$k] = ft_str($p[$k], $max);
    if (array_key_exists('notes', $p)) $d['notes'] = ft_str($p['notes'], 100000);
    if (array_key_exists('sex', $p)) $d['sex'] = in_array($p['sex'], ['M', 'F'], true) ? $p['sex'] : 'U';
    if (array_key_exists('deceased', $p)) $d['deceased'] = $p['deceased'] ? 1 : 0;
    return $d;
}

function ft_apply_vitals(int $pid, array $p): void
{
    if (array_key_exists('birth_date', $p) || array_key_exists('birth_place', $p)) ft_set_vital($pid, null, 'BIRT', $p['birth_date'] ?? null, $p['birth_place'] ?? null);
    if (array_key_exists('death_date', $p) || array_key_exists('death_place', $p)) {
        ft_set_vital($pid, null, 'DEAT', $p['death_date'] ?? null, $p['death_place'] ?? null);
        if (ft_str($p['death_date'] ?? null) || ft_str($p['death_place'] ?? null)) App::$db->update('persons', ['deceased' => 1], $pid);
    }
}

function ft_new_family(?int $h, ?int $w): int
{
    return App::$db->insert('families', ['husband_id' => $h, 'wife_id' => $w, 'created_by' => App::uid(), 'created' => ft_now(), 'updated' => ft_now()]);
}
function ft_add_child(int $fid, int $pid, string $rel = 'birth'): void
{
    $db = App::$db;
    if ($db->val('SELECT id FROM {children} WHERE family_id = ? AND person_id = ?', [$fid, $pid])) return;
    $sort = (int)$db->val('SELECT COUNT(*) FROM {children} WHERE family_id = ?', [$fid]);
    $db->insert('children', ['family_id' => $fid, 'person_id' => $pid, 'sort' => $sort, 'rel' => in_array($rel, ['birth', 'adopted', 'foster', 'step'], true) ? $rel : 'birth']);
}

function ft_ops(): array
{
    $db = fn() => App::$db;
    return [
        // ---------------- persons
        'person.create' => [
            'kind' => 'create',
            'targets' => function ($p) {
                $r = $p['rel'] ?? [];
                if (!empty($r['family_id'])) return [[], [(int)$r['family_id']]];
                if (!empty($r['of'])) return [[(int)$r['of']], []];
                return [[], [], ['free' => false]];
            },
            'summary' => fn($p) => 'Új személy: ' . trim(($p['surname'] ?? '') . ' ' . ($p['given'] ?? '')) . (isset($p['rel']['type']) ? ' (' . ['child' => 'gyermek', 'parent' => 'szülő', 'spouse' => 'házastárs'][$p['rel']['type']] . ')' : ''),
            'apply' => function ($p) {
                $d = ft_person_data($p);
                if (empty($d['given']) && empty($d['surname'])) throw ft_err('Adj meg legalább egy nevet.');
                $now = ft_now();
                $pid = App::$db->insert('persons', $d + ['sex' => 'U', 'deceased' => 0, 'created_by' => App::uid(), 'created' => $now, 'updated' => $now]);
                ft_apply_vitals($pid, $p);
                $r = $p['rel'] ?? [];
                $type = $r['type'] ?? null;
                $sex = $d['sex'] ?? 'U';
                if ($type === 'child') {
                    $fid = ft_int($r['family_id'] ?? null);
                    if (!$fid) {
                        $of = (int)$r['of'];
                        $par = ft_person_row($of);
                        $other = ft_int($r['other'] ?? null);
                        foreach (App::$db->all('SELECT * FROM {families} WHERE husband_id = ? OR wife_id = ?', [$of, $of]) as $f) {
                            $o = (int)$f['husband_id'] === $of ? ft_int($f['wife_id']) : ft_int($f['husband_id']);
                            if ($o === $other) { $fid = (int)$f['id']; break; }
                        }
                        if (!$fid) $fid = $par['sex'] === 'F' ? ft_new_family($other, $of) : ft_new_family($of, $other);
                    }
                    ft_family_row($fid);
                    ft_add_child($fid, $pid, $r['child_rel'] ?? 'birth');
                } elseif ($type === 'parent') {
                    $child = (int)$r['of'];
                    ft_person_row($child);
                    $slot = $sex === 'F' ? 'wife_id' : 'husband_id';
                    $fam = App::$db->row('SELECT f.* FROM {families} f JOIN {children} c ON c.family_id = f.id WHERE c.person_id = ? ORDER BY c.id LIMIT 1', [$child]);
                    if ($fam && !$fam[$slot]) App::$db->update('families', [$slot => $pid], (int)$fam['id']);
                    elseif ($fam && $fam[$slot] && !$fam[$slot === 'wife_id' ? 'husband_id' : 'wife_id'] && $sex === 'U') App::$db->update('families', [$slot === 'wife_id' ? 'husband_id' : 'wife_id' => $pid], (int)$fam['id']);
                    elseif ($fam) throw ft_err('Ennek a személynek már megvan ez a szülője. Új családot a házastárs hozzáadásával lehet kezdeni.');
                    else { $fid = $sex === 'F' ? ft_new_family(null, $pid) : ft_new_family($pid, null); ft_add_child($fid, $child); }
                } elseif ($type === 'spouse') {
                    $of = (int)$r['of'];
                    $o = ft_person_row($of);
                    $husbandIsNew = $sex === 'M' || ($sex === 'U' && $o['sex'] === 'F');
                    $fid = $husbandIsNew ? ft_new_family($pid, $of) : ft_new_family($of, $pid);
                    if (!empty($r['marriage_date']) || !empty($r['marriage_place'])) ft_set_vital(null, $fid, 'MARR', $r['marriage_date'] ?? null, $r['marriage_place'] ?? null);
                }
                return ['id' => $pid];
            },
        ],
        'person.update' => [
            'kind' => 'update',
            'targets' => fn($p) => [[(int)$p['id']], []],
            'before' => function ($p) { $r = ft_person_row((int)$p['id']); $g = ft_graph()['P'][(int)$p['id']] ?? []; return $r + ['birth_date' => $g['bdate'] ?? null, 'birth_place' => $g['bp'] ?? null, 'death_date' => $g['ddate'] ?? null, 'death_place' => $g['dp'] ?? null]; },
            'summary' => fn($p) => 'Személy módosítása: ' . ft_name(ft_person_row((int)$p['id'])),
            'apply' => function ($p) {
                $id = (int)$p['id'];
                ft_person_row($id);
                $d = ft_person_data($p);
                if (array_key_exists('given', $d) && array_key_exists('surname', $d) && !$d['given'] && !$d['surname']) throw ft_err('A név nem lehet üres.');
                App::$db->update('persons', $d + ['updated' => ft_now()], $id);
                ft_apply_vitals($id, $p);
                return ['id' => $id];
            },
        ],
        'person.delete' => [
            'kind' => 'delete',
            'targets' => fn($p) => [[(int)$p['id']], []],
            'before' => fn($p) => ft_person_row((int)$p['id']),
            'summary' => fn($p) => 'Személy törlése: ' . ft_name(ft_person_row((int)$p['id'])),
            'apply' => function ($p) {
                $db = App::$db; $id = (int)$p['id'];
                ft_person_row($id);
                $db->q('DELETE FROM {events} WHERE person_id = ?', [$id]);
                $db->q('DELETE FROM {children} WHERE person_id = ?', [$id]);
                $db->q('DELETE FROM {photo_links} WHERE person_id = ?', [$id]);
                $db->q('DELETE FROM {story_links} WHERE person_id = ?', [$id]);
                $db->q('DELETE FROM {branches} WHERE person_id = ?', [$id]);
                $db->q("DELETE FROM {pins} WHERE kind IN ('person','tree') AND ref_id = ?", [$id]);
                $db->q('UPDATE {users} SET person_id = NULL WHERE person_id = ?', [$id]);
                $db->q('UPDATE {families} SET husband_id = NULL WHERE husband_id = ?', [$id]);
                $db->q('UPDATE {families} SET wife_id = NULL WHERE wife_id = ?', [$id]);
                foreach ($db->col('SELECT id FROM {families} WHERE husband_id IS NULL AND wife_id IS NULL') as $fid) {
                    if (!$db->val('SELECT COUNT(*) FROM {children} WHERE family_id = ?', [$fid])) ft_family_purge((int)$fid);
                }
                $db->delete('persons', $id);
                return ['id' => $id];
            },
        ],
        // ---------------- families
        'family.create' => [
            'kind' => 'create',
            'targets' => fn($p) => [array_filter([ft_int($p['husband_id'] ?? null), ft_int($p['wife_id'] ?? null)]), []],
            'summary' => fn($p) => 'Új család',
            'apply' => function ($p) {
                $h = ft_int($p['husband_id'] ?? null); $w = ft_int($p['wife_id'] ?? null);
                if (!$h && !$w) throw ft_err('Legalább az egyik házastársat add meg.');
                if ($h) ft_person_row($h); if ($w) ft_person_row($w);
                $fid = ft_new_family($h, $w);
                ft_set_vital(null, $fid, 'MARR', $p['marriage_date'] ?? null, $p['marriage_place'] ?? null);
                return ['id' => $fid];
            },
        ],
        'family.update' => [
            'kind' => 'update',
            'targets' => fn($p) => [[], [(int)$p['id']]],
            'before' => function ($p) { $r = ft_family_row((int)$p['id']); $f = ft_graph()['F'][(int)$p['id']] ?? []; return $r + ['marriage_date' => $f['mdate'] ?? null, 'marriage_place' => $f['mplace'] ?? null, 'divorced' => $f['div'] ?? 0]; },
            'summary' => fn($p) => 'Család módosítása #' . (int)$p['id'],
            'apply' => function ($p) {
                $id = (int)$p['id']; ft_family_row($id);
                $d = ['updated' => ft_now()];
                foreach (['husband_id', 'wife_id'] as $k) if (array_key_exists($k, $p)) { $d[$k] = ft_int($p[$k]); if ($d[$k]) ft_person_row($d[$k]); }
                if (array_key_exists('notes', $p)) $d['notes'] = ft_str($p['notes'], 100000);
                App::$db->update('families', $d, $id);
                if (array_key_exists('marriage_date', $p) || array_key_exists('marriage_place', $p)) ft_set_vital(null, $id, 'MARR', $p['marriage_date'] ?? null, $p['marriage_place'] ?? null);
                if (array_key_exists('divorced', $p)) {
                    if ($p['divorced']) ft_set_vital(null, $id, 'DIV', $p['divorce_date'] ?? null, null, true);
                    else App::$db->q("DELETE FROM {events} WHERE family_id = ? AND type = 'DIV'", [$id]);
                }
                return ['id' => $id];
            },
        ],
        'family.delete' => [
            'kind' => 'delete',
            'targets' => fn($p) => [[], [(int)$p['id']]],
            'before' => fn($p) => ft_family_row((int)$p['id']),
            'summary' => fn($p) => 'Család törlése #' . (int)$p['id'] . ' (a személyek megmaradnak)',
            'apply' => function ($p) { ft_family_row((int)$p['id']); ft_family_purge((int)$p['id']); return ['id' => (int)$p['id']]; },
        ],
        'family.child_add' => [
            'kind' => 'create',
            'targets' => fn($p) => [[], [(int)$p['family_id']]],
            'summary' => fn($p) => 'Gyermek hozzárendelése: ' . ft_name(ft_person_row((int)$p['person_id'])),
            'apply' => function ($p) { ft_family_row((int)$p['family_id']); ft_person_row((int)$p['person_id']); ft_add_child((int)$p['family_id'], (int)$p['person_id'], $p['rel'] ?? 'birth'); return ['id' => (int)$p['family_id']]; },
        ],
        'family.child_remove' => [
            'kind' => 'update',
            'targets' => fn($p) => [[], [(int)$p['family_id']]],
            'summary' => fn($p) => 'Gyermek leválasztása a családról: ' . ft_name(ft_person_row((int)$p['person_id'])),
            'apply' => function ($p) { App::$db->q('DELETE FROM {children} WHERE family_id = ? AND person_id = ?', [(int)$p['family_id'], (int)$p['person_id']]); return ['id' => (int)$p['family_id']]; },
        ],
        // ---------------- events
        'event.create' => [
            'kind' => 'create',
            'targets' => fn($p) => [array_filter([ft_int($p['person_id'] ?? null)]), array_filter([ft_int($p['family_id'] ?? null)])],
            'summary' => fn($p) => 'Új esemény: ' . (FT_EVENT_TYPES[$p['type'] ?? ''] ?? '?'),
            'apply' => function ($p) {
                $pid = ft_int($p['person_id'] ?? null); $fid = ft_int($p['family_id'] ?? null);
                if (!$pid && !$fid) throw ft_err('Az esemény személyhez vagy családhoz tartozik.');
                if ($pid) ft_person_row($pid); if ($fid) ft_family_row($fid);
                return ['id' => ft_event_write(null, $p + ['person_id' => $pid, 'family_id' => $fid])];
            },
        ],
        'event.update' => [
            'kind' => 'update',
            'targets' => function ($p) { $e = ft_event_row((int)$p['id']); return [array_filter([ft_int($e['person_id'])]), array_filter([ft_int($e['family_id'])])]; },
            'before' => fn($p) => ft_event_row((int)$p['id']),
            'summary' => fn($p) => 'Esemény módosítása: ' . (FT_EVENT_TYPES[ft_event_row((int)$p['id'])['type']] ?? ''),
            'apply' => function ($p) { $e = ft_event_row((int)$p['id']); ft_event_write((int)$e['id'], $p + $e); return ['id' => (int)$e['id']]; },
        ],
        'event.delete' => [
            'kind' => 'delete',
            'targets' => function ($p) { $e = ft_event_row((int)$p['id']); return [array_filter([ft_int($e['person_id'])]), array_filter([ft_int($e['family_id'])])]; },
            'before' => fn($p) => ft_event_row((int)$p['id']),
            'summary' => fn($p) => 'Esemény törlése: ' . (FT_EVENT_TYPES[ft_event_row((int)$p['id'])['type']] ?? ''),
            'apply' => function ($p) { ft_event_row((int)$p['id']); App::$db->delete('events', (int)$p['id']); return ['id' => (int)$p['id']]; },
        ],
        // ---------------- photos
        'photo.update' => [
            'kind' => 'update',
            'targets' => 'ft_photo_targets',
            'before' => fn($p) => ft_photo_row((int)$p['id']) + ['links' => App::$db->all('SELECT person_id, family_id, story_id FROM {photo_links} WHERE photo_id = ?', [(int)$p['id']])],
            'summary' => fn($p) => 'Fotó adatainak módosítása: ' . (ft_photo_row((int)$p['id'])['title'] ?: '#' . (int)$p['id']),
            'apply' => function ($p) {
                $id = (int)$p['id']; ft_photo_row($id);
                $d = [];
                if (array_key_exists('title', $p)) $d['title'] = ft_str($p['title']);
                if (array_key_exists('descr', $p)) $d['descr'] = ft_str($p['descr'], 20000);
                if (array_key_exists('date', $p)) { $dt = ft_parse_date($p['date']); $d['date_raw'] = $dt['raw'] ?? null; $d['y'] = $dt['y'] ?? null; }
                if ($d) App::$db->update('photos', $d, $id);
                if (isset($p['links']) && is_array($p['links'])) ft_photo_set_links($id, $p['links']);
                return ['id' => $id];
            },
        ],
        'photo.tag' => [ // add a person/family to a photo, or move the focus point – additive, treated as "create"
            'kind' => 'create',
            'targets' => fn($p) => [array_filter([ft_int($p['person_id'] ?? null)]), array_filter([ft_int($p['family_id'] ?? null)])],
            'summary' => fn($p) => 'Fotó megjelölése',
            'apply' => function ($p) {
                $id = (int)$p['photo_id']; ft_photo_row($id);
                $pid = ft_int($p['person_id'] ?? null); $fid = ft_int($p['family_id'] ?? null);
                $l = App::$db->row('SELECT * FROM {photo_links} WHERE photo_id = ? AND ' . ($pid ? 'person_id = ?' : 'family_id = ?'), [$id, $pid ?: $fid]);
                $fx = isset($p['fx']) ? max(0, min(1, (float)$p['fx'])) : 0.5; $fy = isset($p['fy']) ? max(0, min(1, (float)$p['fy'])) : 0.35;
                if ($l) App::$db->update('photo_links', ['fx' => $fx, 'fy' => $fy], (int)$l['id']);
                else App::$db->insert('photo_links', ['photo_id' => $id, 'person_id' => $pid, 'family_id' => $fid, 'fx' => $fx, 'fy' => $fy]);
                if (!empty($p['primary'])) {
                    if ($pid) App::$db->update('persons', ['photo_id' => $id], $pid);
                    if ($fid) App::$db->update('families', ['photo_id' => $id], $fid);
                } elseif ($pid && !App::$db->val('SELECT photo_id FROM {persons} WHERE id = ?', [$pid])) {
                    App::$db->update('persons', ['photo_id' => $id], $pid);
                } elseif ($fid && !App::$db->val('SELECT photo_id FROM {families} WHERE id = ?', [$fid])) {
                    App::$db->update('families', ['photo_id' => $id], $fid);
                }
                return ['id' => $id];
            },
        ],
        'photo.untag' => [
            'kind' => 'update',
            'targets' => fn($p) => [array_filter([ft_int($p['person_id'] ?? null)]), array_filter([ft_int($p['family_id'] ?? null)])],
            'summary' => fn($p) => 'Jelölés levétele a fotóról #' . (int)$p['photo_id'],
            'apply' => function ($p) {
                $id = (int)$p['photo_id']; $pid = ft_int($p['person_id'] ?? null); $fid = ft_int($p['family_id'] ?? null);
                if ($pid) { App::$db->q('DELETE FROM {photo_links} WHERE photo_id = ? AND person_id = ?', [$id, $pid]); App::$db->q('UPDATE {persons} SET photo_id = NULL WHERE id = ? AND photo_id = ?', [$pid, $id]); }
                if ($fid) { App::$db->q('DELETE FROM {photo_links} WHERE photo_id = ? AND family_id = ?', [$id, $fid]); App::$db->q('UPDATE {families} SET photo_id = NULL WHERE id = ? AND photo_id = ?', [$fid, $id]); }
                return ['id' => $id];
            },
        ],
        'photo.primary' => [
            'kind' => function ($p) {
                $pid = ft_int($p['person_id'] ?? null);
                $cur = $pid ? App::$db->val('SELECT photo_id FROM {persons} WHERE id = ?', [$pid]) : App::$db->val('SELECT photo_id FROM {families} WHERE id = ?', [(int)($p['family_id'] ?? 0)]);
                return $cur ? 'update' : 'create';
            },
            'targets' => fn($p) => [array_filter([ft_int($p['person_id'] ?? null)]), array_filter([ft_int($p['family_id'] ?? null)])],
            'summary' => fn($p) => 'Fő fotó beállítása',
            'apply' => function ($p) {
                $id = (int)$p['photo_id']; ft_photo_row($id);
                if ($pid = ft_int($p['person_id'] ?? null)) App::$db->update('persons', ['photo_id' => $id], $pid);
                if ($fid = ft_int($p['family_id'] ?? null)) App::$db->update('families', ['photo_id' => $id], $fid);
                return ['id' => $id];
            },
        ],
        'photo.publish' => [
            'kind' => 'create',
            'targets' => 'ft_photo_targets',
            'summary' => fn($p) => 'Új fotó közzététele: ' . (ft_photo_row((int)$p['id'])['title'] ?: '#' . (int)$p['id']),
            'apply' => function ($p) { ft_photo_row((int)$p['id']); App::$db->update('photos', ['status' => 'ok'], (int)$p['id']); ft_photo_autoprimary((int)$p['id']); return ['id' => (int)$p['id']]; },
            'reject' => function ($p) { ft_photo_purge((int)$p['id']); },
        ],
        'photo.delete' => [
            'kind' => 'delete',
            'targets' => 'ft_photo_targets',
            'before' => fn($p) => ft_photo_row((int)$p['id']),
            'summary' => fn($p) => 'Fotó törlése: ' . (ft_photo_row((int)$p['id'])['title'] ?: '#' . (int)$p['id']),
            'apply' => function ($p) { ft_photo_row((int)$p['id']); ft_photo_purge((int)$p['id']); return ['id' => (int)$p['id']]; },
        ],
        // ---------------- stories
        'story.create' => [
            'kind' => 'create',
            'targets' => fn($p) => [array_map('intval', $p['person_ids'] ?? []), array_map('intval', $p['family_ids'] ?? []), ['free' => empty($p['person_ids']) && empty($p['family_ids'])]],
            'summary' => fn($p) => 'Új sztori: ' . ($p['title'] ?? ''),
            'apply' => function ($p) {
                $now = ft_now();
                $id = App::$db->insert('stories', ft_story_data($p) + ['status' => 'ok', 'created_by' => App::uid(), 'created' => $now, 'updated' => $now]);
                ft_story_links($id, $p);
                return ['id' => $id];
            },
        ],
        'story.update' => [
            'kind' => 'update',
            'targets' => function ($p) {
                $s = ft_story_row((int)$p['id']);
                $l = App::$db->all('SELECT person_id, family_id FROM {story_links} WHERE story_id = ?', [(int)$p['id']]);
                $own = App::$s['story_author_edit'] && App::uid() && (int)$s['created_by'] === App::uid();
                return [array_filter(array_map('intval', array_column($l, 'person_id'))), array_filter(array_map('intval', array_column($l, 'family_id'))), ['own' => $own, 'free' => !$l]];
            },
            'before' => fn($p) => ft_story_row((int)$p['id']),
            'summary' => fn($p) => 'Sztori módosítása: ' . ft_story_row((int)$p['id'])['title'],
            'apply' => function ($p) {
                $id = (int)$p['id']; ft_story_row($id);
                App::$db->update('stories', ft_story_data($p) + ['updated' => ft_now()], $id);
                if (isset($p['person_ids']) || isset($p['family_ids'])) ft_story_links($id, $p);
                return ['id' => $id];
            },
        ],
        'story.delete' => [
            'kind' => 'delete',
            'targets' => function ($p) {
                ft_story_row((int)$p['id']);
                $l = App::$db->all('SELECT person_id, family_id FROM {story_links} WHERE story_id = ?', [(int)$p['id']]);
                return [array_filter(array_map('intval', array_column($l, 'person_id'))), array_filter(array_map('intval', array_column($l, 'family_id'))), ['free' => !$l]];
            },
            'before' => fn($p) => ft_story_row((int)$p['id']),
            'summary' => fn($p) => 'Sztori törlése: ' . ft_story_row((int)$p['id'])['title'],
            'apply' => function ($p) {
                $id = (int)$p['id']; ft_story_row($id);
                App::$db->q('DELETE FROM {story_links} WHERE story_id = ?', [$id]);
                App::$db->q('DELETE FROM {photo_links} WHERE story_id = ?', [$id]);
                App::$db->q("DELETE FROM {pins} WHERE kind = 'story' AND ref_id = ?", [$id]);
                App::$db->delete('stories', $id);
                return ['id' => $id];
            },
        ],
    ];
}

function ft_family_purge(int $fid): void
{
    $db = App::$db;
    $db->q('DELETE FROM {children} WHERE family_id = ?', [$fid]);
    $db->q('DELETE FROM {events} WHERE family_id = ?', [$fid]);
    $db->q('DELETE FROM {photo_links} WHERE family_id = ?', [$fid]);
    $db->q('DELETE FROM {story_links} WHERE family_id = ?', [$fid]);
    $db->delete('families', $fid);
}

function ft_event_row(int $id): array
{
    $r = App::$db->row('SELECT * FROM {events} WHERE id = ?', [$id]);
    if (!$r) throw ft_err('Nincs ilyen esemény.', 404);
    return $r;
}
function ft_event_write(?int $id, array $p): int
{
    $type = strtoupper((string)($p['type'] ?? ''));
    if (!isset(FT_EVENT_TYPES[$type])) throw ft_err('Ismeretlen eseménytípus.');
    $dateIn = array_key_exists('date', $p) ? $p['date'] : ($p['date_raw'] ?? null);
    $dt = ft_parse_date($dateIn);
    $d = ['type' => $type, 'label' => ft_str($p['label'] ?? null, 120), 'date_raw' => $dt['raw'] ?? null, 'y' => $dt['y'] ?? null,
        'm' => $dt['m'] ?? null, 'd' => $dt['d'] ?? null, 'qual' => $dt['qual'] ?? null, 'sort' => $dt['sort'] ?? null,
        'place' => ft_str($p['place'] ?? null), 'note' => ft_str($p['note'] ?? null, 50000), 'updated' => ft_now()];
    if ($id) { App::$db->update('events', $d, $id); }
    else $id = App::$db->insert('events', $d + ['person_id' => $p['person_id'], 'family_id' => $p['family_id'], 'created_by' => App::uid(), 'created' => ft_now()]);
    if ($type === 'DEAT' && !empty($p['person_id'])) App::$db->update('persons', ['deceased' => 1], (int)$p['person_id']);
    return $id;
}

function ft_story_row(int $id): array
{
    $r = App::$db->row('SELECT * FROM {stories} WHERE id = ?', [$id]);
    if (!$r) throw ft_err('Nincs ilyen sztori.', 404);
    return $r;
}
function ft_story_data(array $p): array
{
    $d = [];
    if (array_key_exists('title', $p)) { $d['title'] = ft_str($p['title']); if (!$d['title']) throw ft_err('A sztorinak kell cím.'); }
    if (array_key_exists('body', $p)) $d['body'] = ft_str($p['body'], 500000);
    if (array_key_exists('date', $p)) { $dt = ft_parse_date($p['date']); $d['date_raw'] = $dt['raw'] ?? null; $d['y'] = $dt['y'] ?? null; }
    if (array_key_exists('cover_photo_id', $p)) $d['cover_photo_id'] = ft_int($p['cover_photo_id']);
    return $d;
}
function ft_story_links(int $id, array $p): void
{
    App::$db->q('DELETE FROM {story_links} WHERE story_id = ?', [$id]);
    foreach (array_unique(array_map('intval', $p['person_ids'] ?? [])) as $pid) if ($pid) App::$db->insert('story_links', ['story_id' => $id, 'person_id' => $pid]);
    foreach (array_unique(array_map('intval', $p['family_ids'] ?? [])) as $fid) if ($fid) App::$db->insert('story_links', ['story_id' => $id, 'family_id' => $fid]);
}

/** Run an op for the current user. */
function ft_run_op(string $name, array $payload): array
{
    $ops = ft_ops();
    if (!isset($ops[$name])) throw ft_err('Ismeretlen művelet: ' . $name, 400);
    $op = $ops[$name];
    $kind = is_callable($op['kind']) ? ($op['kind'])($payload) : $op['kind'];
    $t = ($op['targets'])($payload);
    $mode = ft_mode($kind, $t[0] ?? [], $t[1] ?? [], $t[2] ?? []);
    if ($mode === 'deny') throw ft_err(App::loggedIn() ? 'Ehhez nincs jogosultságod.' : 'Ehhez be kell jelentkezni.', App::loggedIn() ? 403 : 401);
    if ($mode === 'queue') {
        $before = isset($op['before']) ? ($op['before'])($payload) : null;
        $cid = App::$db->insert('changes', ['user_id' => App::uid(), 'action' => $name, 'entity' => explode('.', $name)[0],
            'entity_id' => ft_int($payload['id'] ?? $payload['photo_id'] ?? null), 'payload' => json_encode($payload, JSON_UNESCAPED_UNICODE),
            'before_json' => $before ? json_encode($before, JSON_UNESCAPED_UNICODE) : null, 'summary' => mb_substr(($op['summary'])($payload), 0, 255),
            'status' => 'pending', 'created' => ft_now()]);
        App::audit('queue', $name, $cid, ($op['summary'])($payload));
        return ['queued' => true, 'change_id' => $cid];
    }
    $summary = ($op['summary'])($payload);
    $res = App::$db->inTx(fn() => ($op['apply'])($payload));
    App::flush();
    App::audit($name, explode('.', $name)[0], ft_int($res['id'] ?? null), $summary);
    return ['queued' => false] + $res;
}

function ft_change_review(int $cid, bool $approve, string $note = ''): array
{
    ft_require_admin();
    $c = App::$db->row('SELECT * FROM {changes} WHERE id = ?', [$cid]);
    if (!$c) throw ft_err('Nincs ilyen kérés.', 404);
    if ($c['status'] !== 'pending') throw ft_err('Ezt a kérést már elbírálták.');
    $ops = ft_ops();
    $payload = json_decode($c['payload'], true) ?: [];
    $res = null;
    if ($approve) {
        $op = $ops[$c['action']] ?? null;
        if (!$op) throw ft_err('Ismeretlen művelet a kérésben.');
        try {
            $res = App::$db->inTx(fn() => ($op['apply'])($payload));
        } catch (ApiError $e) {
            throw ft_err('A kérés már nem alkalmazható: ' . $e->getMessage());
        }
    } elseif (isset($ops[$c['action']]['reject'])) {
        ($ops[$c['action']]['reject'])($payload);
    }
    App::$db->update('changes', ['status' => $approve ? 'approved' : 'rejected', 'reviewer_id' => App::uid(), 'review_note' => ft_str($note, 2000), 'reviewed' => ft_now()], $cid);
    App::flush();
    App::audit($approve ? 'approve' : 'reject', 'change', $cid, $c['summary']);
    return ['status' => $approve ? 'approved' : 'rejected', 'result' => $res];
}
