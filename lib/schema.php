<?php
const FT_SCHEMA_VERSION = 6;

function ft_schema(): array
{
    $stamp = ['created_by' => 'int', 'created' => 'datetime', 'updated' => 'datetime'];
    return [
        'settings' => ['cols' => ['id' => 'id', 'k' => 'str80', 'v' => 'text'], 'idx' => ['u_k' => ['k']]],
        'users' => ['cols' => [
            'id' => 'id', 'email' => 'str190', 'name' => 'str120', 'pass_hash' => 'str255', 'role' => 'str16',
            'person_id' => 'int', 'active' => 'bool', 'failed' => 'int', 'locked_until' => 'datetime',
            'created' => 'datetime', 'last_login' => 'datetime',
            'status' => 'str16', 'intro' => 'text', 'lang' => 'str5'],
            'idx' => ['u_email' => ['email']]],
        'persons' => ['cols' => [
            'id' => 'id', 'xref' => 'str20', 'given' => 'str120', 'surname' => 'str120', 'title' => 'str40',
            'suffix' => 'str40', 'nickname' => 'str80', 'married_name' => 'str160', 'sex' => 'str1',
            'deceased' => 'bool', 'notes' => 'text', 'extra' => 'text', 'photo_id' => 'int'] + $stamp,
            'idx' => ['xref' => ['xref'], 'surname' => ['surname']]],
        'families' => ['cols' => [
            'id' => 'id', 'xref' => 'str20', 'husband_id' => 'int', 'wife_id' => 'int', 'notes' => 'text',
            'extra' => 'text', 'photo_id' => 'int'] + $stamp,
            'idx' => ['h' => ['husband_id'], 'w' => ['wife_id'], 'xref' => ['xref']]],
        'children' => ['cols' => ['id' => 'id', 'family_id' => 'int', 'person_id' => 'int', 'sort' => 'int', 'rel' => 'str16'],
            'idx' => ['f' => ['family_id'], 'p' => ['person_id']]],
        'events' => ['cols' => [
            'id' => 'id', 'person_id' => 'int', 'family_id' => 'int', 'type' => 'str8', 'label' => 'str120',
            'date_raw' => 'str80', 'y' => 'int', 'm' => 'int', 'd' => 'int', 'qual' => 'str8', 'sort' => 'int',
            'place' => 'str255', 'note' => 'text'] + $stamp,
            'idx' => ['p' => ['person_id'], 'f' => ['family_id'], 'md' => ['m', 'd'], 's' => ['sort'], 'c' => ['created']]],
        'photos' => ['cols' => [
            'id' => 'id', 'file' => 'str190', 'thumb' => 'str190', 'w' => 'int', 'h' => 'int', 'title' => 'str255',
            'descr' => 'text', 'date_raw' => 'str80', 'y' => 'int', 'status' => 'str16', 'uploaded_by' => 'int', 'created' => 'datetime',
            'source' => 'str60'], 'idx' => ['src' => ['source']]],
        'photo_links' => ['cols' => [
            'id' => 'id', 'photo_id' => 'int', 'person_id' => 'int', 'family_id' => 'int', 'story_id' => 'int',
            'fx' => 'float', 'fy' => 'float'],
            'idx' => ['ph' => ['photo_id'], 'p' => ['person_id'], 'f' => ['family_id'], 's' => ['story_id']]],
        'stories' => ['cols' => [
            'id' => 'id', 'title' => 'str255', 'body' => 'text', 'date_raw' => 'str80', 'y' => 'int',
            'cover_photo_id' => 'int', 'status' => 'str16', 'source' => 'str60', 'lang' => 'str5'] + $stamp,
            'idx' => ['src' => ['source']]],
        'story_tr' => ['cols' => ['id' => 'id', 'story_id' => 'int', 'lang' => 'str5', 'title' => 'str255', 'body' => 'text',
            'src_hash' => 'str40', 'created' => 'datetime'], 'idx' => ['sl' => ['story_id', 'lang']]],
        'story_links' => ['cols' => ['id' => 'id', 'story_id' => 'int', 'person_id' => 'int', 'family_id' => 'int'],
            'idx' => ['s' => ['story_id'], 'p' => ['person_id']]],
        'sources' => ['cols' => ['id' => 'id', 'xref' => 'str20', 'title' => 'str255', 'author' => 'str255',
            'publ' => 'str255', 'abbr' => 'str80', 'text' => 'text', 'type' => 'str40']],
        'branches' => ['cols' => ['id' => 'id', 'user_id' => 'int', 'person_id' => 'int', 'created' => 'datetime'],
            'idx' => ['u' => ['user_id']]],
        'changes' => ['cols' => [
            'id' => 'id', 'user_id' => 'int', 'action' => 'str40', 'entity' => 'str20', 'entity_id' => 'int',
            'payload' => 'text', 'before_json' => 'text', 'summary' => 'str255', 'status' => 'str16',
            'reviewer_id' => 'int', 'review_note' => 'text', 'created' => 'datetime', 'reviewed' => 'datetime'],
            'idx' => ['st' => ['status']]],
        'pins' => ['cols' => ['id' => 'id', 'kind' => 'str16', 'ref_id' => 'int', 'params' => 'text', 'caption' => 'str255',
            'sort' => 'int', 'created_by' => 'int', 'created' => 'datetime']],
        'charts' => ['cols' => ['id' => 'id', 'title' => 'str255', 'kind' => 'str20', 'person_id' => 'int', 'config' => 'text',
            'png' => 'str190', 'svg' => 'str190', 'created_by' => 'int', 'created' => 'datetime']],
        'quiz_scores' => ['cols' => ['id' => 'id', 'name' => 'str80', 'user_id' => 'int', 'score' => 'int', 'total' => 'int',
            'mode' => 'str16', 'ms' => 'int', 'created' => 'datetime']],
        'comments' => ['cols' => ['id' => 'id', 'entity' => 'str16', 'entity_id' => 'int', 'parent_id' => 'int', 'user_id' => 'int',
            'body' => 'text', 'status' => 'str16', 'created' => 'datetime', 'updated' => 'datetime'],
            'idx' => ['e' => ['entity', 'entity_id'], 'c' => ['created']]],
        'audit' => ['cols' => ['id' => 'id', 'user_id' => 'int', 'action' => 'str40', 'entity' => 'str20', 'entity_id' => 'int',
            'summary' => 'text', 'created' => 'datetime'], 'idx' => ['c' => ['created']]],
    ];
}
