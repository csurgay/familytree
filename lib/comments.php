<?php
/**
 * Comments (hozzászólások) under persons, families, stories and photos.
 * Only logged-in members read and write them; one level of replies; the author edits their own,
 * the admin may remove any. A removed comment that has replies stays as a "törölt" placeholder.
 */
const FT_COMMENT_ENTITIES = ['person', 'family', 'story', 'photo'];

function ft_comments_on(): bool
{
    return (App::$s['comments'] ?? 'members') !== 'off';
}

function ft_comments_guard(): void
{
    if (!ft_comments_on()) throw ft_err('A hozzászólások ki vannak kapcsolva.', 403);
    ft_require_login();
}

function ft_comment_target(string $entity, int $id): void
{
    if (!in_array($entity, FT_COMMENT_ENTITIES, true)) throw ft_err('Ismeretlen hozzászólás-cél.', 400);
    $table = ['person' => 'persons', 'family' => 'families', 'story' => 'stories', 'photo' => 'photos'][$entity];
    if (!App::$db->val("SELECT id FROM {{$table}} WHERE id = ?", [$id])) throw ft_err('Nincs ilyen elem.', 404);
}

function ft_comment_json(array $c, array $names): array
{
    $del = $c['status'] === 'deleted';
    $uid = (int)$c['user_id'];
    return ['id' => (int)$c['id'], 'parent_id' => ft_int($c['parent_id']), 'entity' => $c['entity'], 'entity_id' => (int)$c['entity_id'],
        'author' => $del ? null : ($names[$uid] ?? null), 'author_id' => $del ? null : $uid,
        'body' => $del ? null : $c['body'], 'deleted' => $del, 'created' => $c['created'],
        'edited' => !$del && $c['updated'] && $c['updated'] !== $c['created'],
        'mine' => !$del && $uid === App::uid(), 'can_delete' => !$del && ($uid === App::uid() || App::isAdmin())];
}

function ft_user_names(array $ids): array
{
    $ids = array_values(array_unique(array_filter(array_map('intval', $ids))));
    if (!$ids) return [];
    $out = [];
    foreach (App::$db->all('SELECT id, name FROM {users} WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids) as $u) $out[(int)$u['id']] = $u['name'];
    return $out;
}

function ft_comments_list(string $entity, int $id): array
{
    ft_comments_guard();
    if (!in_array($entity, FT_COMMENT_ENTITIES, true)) throw ft_err('Ismeretlen hozzászólás-cél.', 400);
    $rows = App::$db->all('SELECT * FROM {comments} WHERE entity = ? AND entity_id = ? ORDER BY created, id', [$entity, $id]);
    $names = ft_user_names(array_column($rows, 'user_id'));
    $hasReply = [];
    foreach ($rows as $r) if ($r['parent_id']) $hasReply[(int)$r['parent_id']] = true;
    $out = [];
    foreach ($rows as $r) {
        if ($r['status'] === 'deleted' && empty($hasReply[(int)$r['id']])) continue;
        $out[] = ft_comment_json($r, $names);
    }
    return $out;
}

function ft_comment_add(array $in): array
{
    ft_comments_guard();
    $entity = (string)($in['entity'] ?? ''); $id = (int)($in['entity_id'] ?? 0);
    ft_comment_target($entity, $id);
    $body = ft_str($in['body'] ?? null, 5000);
    if (!$body) throw ft_err('Üres hozzászólás.');
    $parent = ft_int($in['parent_id'] ?? null);
    if ($parent) {
        $pr = App::$db->row('SELECT * FROM {comments} WHERE id = ?', [$parent]);
        if (!$pr || $pr['entity'] !== $entity || (int)$pr['entity_id'] !== $id) throw ft_err('A megválaszolt hozzászólás nem található.', 404);
        if ($pr['parent_id']) $parent = (int)$pr['parent_id']; // replies stay one level deep
    }
    $recent = (int)App::$db->val('SELECT COUNT(*) FROM {comments} WHERE user_id = ? AND created >= ?', [App::uid(), date('Y-m-d H:i:s', time() - 600)]);
    if ($recent >= 30) throw ft_err('Túl sok hozzászólás rövid idő alatt. Próbáld újra pár perc múlva.', 429);
    $now = ft_now();
    $cid = App::$db->insert('comments', ['entity' => $entity, 'entity_id' => $id, 'parent_id' => $parent, 'user_id' => App::uid(),
        'body' => $body, 'status' => 'ok', 'created' => $now, 'updated' => $now]);
    App::audit('comment.add', $entity, $id, mb_substr($body, 0, 120));
    return ['id' => $cid];
}

function ft_comment_own(int $cid): array
{
    $c = App::$db->row('SELECT * FROM {comments} WHERE id = ?', [$cid]);
    if (!$c || $c['status'] === 'deleted') throw ft_err('Nincs ilyen hozzászólás.', 404);
    return $c;
}

function ft_comment_edit(array $in): array
{
    ft_comments_guard();
    $c = ft_comment_own((int)($in['id'] ?? 0));
    if ((int)$c['user_id'] !== App::uid()) throw ft_err('Csak a saját hozzászólásodat javíthatod.', 403);
    $body = ft_str($in['body'] ?? null, 5000);
    if (!$body) throw ft_err('Üres hozzászólás.');
    App::$db->update('comments', ['body' => $body, 'updated' => ft_now()], (int)$c['id']);
    return ['id' => (int)$c['id']];
}

function ft_comment_delete(array $in): array
{
    ft_comments_guard();
    $c = ft_comment_own((int)($in['id'] ?? 0));
    if ((int)$c['user_id'] !== App::uid() && !App::isAdmin()) throw ft_err('Ehhez nincs jogosultságod.', 403);
    $replies = (int)App::$db->val("SELECT COUNT(*) FROM {comments} WHERE parent_id = ? AND status <> 'deleted'", [(int)$c['id']]);
    if ($replies) App::$db->update('comments', ['status' => 'deleted', 'body' => null, 'updated' => ft_now()], (int)$c['id']);
    else App::$db->delete('comments', (int)$c['id']);
    App::audit('comment.delete', $c['entity'], (int)$c['entity_id'], mb_substr((string)$c['body'], 0, 120));
    return ['id' => (int)$c['id']];
}

/** Latest comments for the home page, with a label for what they are about. */
function ft_comments_recent(int $limit = 6): array
{
    if (!ft_comments_on() || !App::loggedIn()) return [];
    $rows = App::$db->all("SELECT * FROM {comments} WHERE status = 'ok' ORDER BY created DESC, id DESC LIMIT " . max(1, $limit));
    $names = ft_user_names(array_column($rows, 'user_id'));
    $out = [];
    foreach ($rows as $r) {
        $j = ft_comment_json($r, $names);
        if ($r['entity'] === 'story') $j['title'] = App::$db->val('SELECT title FROM {stories} WHERE id = ?', [(int)$r['entity_id']]);
        if ($r['entity'] === 'photo') $j['title'] = App::$db->val('SELECT title FROM {photos} WHERE id = ?', [(int)$r['entity_id']]);
        $out[] = $j;
    }
    return $out;
}

/** Remove the comments of an entity that is being deleted. */
function ft_comments_purge(string $entity, int $id): void
{
    App::$db->q('DELETE FROM {comments} WHERE entity = ? AND entity_id = ?', [$entity, $id]);
}
