<?php
/**
 * Distributed editing rules.
 *   admin               → everything directly
 *   head (családfő)     → inside own branch: create directly; update/delete via admin approval (configurable)
 *   member / outside    → suggestions go to the approval queue (if enabled), otherwise denied
 *   guest               → denied
 * Returns 'direct' | 'queue' | 'deny'.
 */
function ft_mode(string $kind, array $persons = [], array $families = [], array $opts = []): string
{
    $s = App::$s;
    $role = App::role();
    if ($role === 'admin') return 'direct';
    if (!App::loggedIn()) return 'deny';
    $uid = App::uid();

    if (!empty($opts['own']) && $kind !== 'delete') return 'direct';   // e.g. author editing own story

    $inBranch = false;
    if ($role === 'head') {
        $b = ft_user_branch($uid);
        $persons = array_values(array_filter($persons));
        $families = array_values(array_filter($families));
        $inBranch = ($persons || $families);
        foreach ($persons as $p) if (!isset($b['P'][(int)$p])) $inBranch = false;
        foreach ($families as $f) if (!isset($b['F'][(int)$f])) $inBranch = false;
        if (!empty($opts['free'])) $inBranch = true; // not tied to any person (e.g. a general story)
    }
    if ($inBranch) {
        if ($kind === 'create') return $s['head_create_direct'] ? 'direct' : 'queue';
        if ($kind === 'update') return $s['head_update_approval'] ? 'queue' : 'direct';
        if ($kind === 'delete') return $s['head_delete_approval'] ? 'queue' : 'direct';
    }
    return $s['member_suggest'] ? 'queue' : 'deny';
}

function ft_can_see_contacts(): bool
{
    $v = App::$s['show_contacts'];
    $r = App::role();
    if ($r === 'admin') return true;
    if ($v === 'heads') return $r === 'head';
    if ($v === 'members') return App::loggedIn();
    return false;
}

function ft_require_login(): void
{
    if (!App::loggedIn()) throw new ApiError('Ehhez be kell jelentkezni.', 401);
}
function ft_require_admin(): void
{
    if (!App::isAdmin()) throw new ApiError('Ehhez admin jogosultság kell.', 403);
}
function ft_can_read(): bool
{
    return App::loggedIn() || App::$s['public_access'] === 'public';
}
/** Should living people be masked for the current viewer? */
function ft_mask_living(): bool
{
    return !App::loggedIn() && App::$s['privacy_living'] !== 'none';
}
